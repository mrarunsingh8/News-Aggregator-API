#!/usr/bin/env node
/*
 * Creates one pull request for one npm-audit vulnerability.
 *
 * This is deliberately PR-only: it never merges, approves, enables
 * auto-merge, or changes the status of an external vulnerability service.
 * The vulnerability source of truth is the local
 * `npm audit --json` report generated from the checked-out package-lock.json.
 *
 * `GITHUB_REPOSITORY` is used when available; otherwise the script derives
 * owner/repository from the origin remote.
 *
 * Optional environment:
 *   VULNERABILITY_PACKAGE    limits a run to one package; otherwise the script
 *                            selects one safe candidate from npm audit itself
 *   REMEDIATION_BASE         PR base branch (default: GITHUB_REF_NAME, then main)
 *   REMEDIATION_DRY_RUN      "true" skips branch/PR creation
 *   REMEDIATION_VALIDATION   newline-separated commands, e.g. "npm test\nnpm run lint"
 *   REMEDIATION_PLAN         required for transitive remediations, for example:
 *                            {"package":"qs","strategy":"transitive-bump","parent":{"name":"body-parser","version":"1.20.3"}}
 *                            {"package":"qs","strategy":"transitive-override","fixedVersion":"6.13.5","parent":"body-parser"}
 *
 * The script intentionally does not call `npm audit fix` or use `--force`:
 * either can modify unrelated packages, violating the one-vulnerability-per-PR
 * contract. When audit does not name a fixed direct version, it queries npm's
 * registry and uses semver to find the smallest safe version in the current
 * major line.
 */

'use strict';

const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const GITHUB_REPOSITORY="https://github.com/mrarunsingh8/News-Aggregator-API";
const API_VERSION = '2022-11-28';
const BRANCH_ROOT = 'security-remediation';
const dryRun = process.env.REMEDIATION_DRY_RUN === 'true';
let cachedSemver;

function repositoryFromOrigin() {
  const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const origin = (result.stdout || '').trim();
  const match = origin.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (!match) return null;
  return match[1];
}

function repositoryName() {
  const repository = process.env.GITHUB_REPOSITORY || repositoryFromOrigin();
  if (!repository) {
    throw new Error('Cannot determine the repository. Run in GitHub Actions or configure an origin remote such as git@github.com:owner/repository.git.');
  }
  return repository;
}

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`${command} failed with exit code ${result.status}.${detail}`);
  }
  return result.stdout || '';
}

function runShell(command) {
  console.log(`$ ${command}`);
  const result = spawnSync(command, { cwd: process.cwd(), shell: true, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Validation failed: ${command}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function semverLibrary() {
  if (cachedSemver) return cachedSemver;
  try {
    cachedSemver = require('semver');
    return cachedSemver;
  } catch {
    // semver is bundled with npm, though it is not normally exposed as a
    // project dependency. Resolve it from npm's global installation so this
    // script remains standalone and does not alter package.json.
    const npmRoot = run('npm', ['root', '-g'], { capture: true }).trim();
    for (const candidate of [`${npmRoot}/npm/node_modules/semver`, `${npmRoot}/semver`]) {
      try {
        cachedSemver = require(candidate);
        return cachedSemver;
      } catch {
        // Try the next known npm layout.
      }
    }
    throw new Error('Unable to load semver from this runner. Install semver for the workflow runtime or provide REMEDIATION_PLAN.fixedVersion.');
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parsePlan() {
  if (!process.env.REMEDIATION_PLAN) return null;
  try {
    return JSON.parse(process.env.REMEDIATION_PLAN);
  } catch (error) {
    throw new Error(`REMEDIATION_PLAN must be valid JSON: ${error.message}`);
  }
}

function auditReport() {
  const result = spawnSync('npm', ['audit', '--json'], {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    return JSON.parse(result.stdout || '{}');
  } catch {
    throw new Error(`npm audit did not return JSON. ${result.stderr || ''}`);
  }
}

function advisoryDetails(vulnerability, packageName) {
  const details = (vulnerability.via || []).find((item) => typeof item === 'object') || {};
  const url = details.url || '';
  const ghsa = url.match(/GHSA-[\w-]+/i)?.[0]?.toUpperCase();
  const id = ghsa || (details.source ? `npm-${details.source}` : `npm-audit-${packageName}`);
  return {
    id,
    url: url || undefined,
    title: details.title || `${packageName} vulnerability reported by npm audit`,
    severity: details.severity || vulnerability.severity || 'unknown',
    range: details.range || vulnerability.range || 'unknown',
  };
}

function fixedVersionFromAudit(vulnerability, packageName) {
  const fix = vulnerability.fixAvailable;
  if (fix && typeof fix === 'object' && fix.name === packageName && fix.version) return fix.version;
  return null;
}

function availableFix(vulnerability) {
  return vulnerability.fixAvailable && typeof vulnerability.fixAvailable === 'object'
    ? vulnerability.fixAvailable
    : null;
}

function lockedVersion(packageName) {
  const lockfile = readJson('package-lock.json');
  const packageEntry = lockfile.packages?.[`node_modules/${packageName}`];
  return packageEntry?.version || lockfile.dependencies?.[packageName]?.version || null;
}

function fixedVersionFromRegistry(packageName, declaredRange, vulnerability) {
  const semver = semverLibrary();
  const current = lockedVersion(packageName) || semver.minVersion(declaredRange)?.version;
  if (!current || !semver.valid(current)) return null;
  const currentMajor = semver.major(current);
  const currentMinor = semver.minor(current);
  const ranges = (vulnerability.via || [])
    .filter((item) => typeof item === 'object' && item.range)
    .map((item) => item.range);
  if (!ranges.length && vulnerability.range) ranges.push(vulnerability.range);
  if (!ranges.length) return null;

  const output = run('npm', ['view', packageName, 'versions', '--json'], { capture: true });
  let versions;
  try {
    versions = JSON.parse(output);
  } catch {
    throw new Error(`npm registry returned invalid version data for ${packageName}.`);
  }
  const candidates = (Array.isArray(versions) ? versions : [versions])
    .filter((version) => semver.valid(version) && !semver.prerelease(version))
    .filter((version) => semver.major(version) === currentMajor)
    // In 0.x, a minor bump can be breaking, so preserve the current minor too.
    .filter((version) => currentMajor !== 0 || semver.minor(version) === currentMinor)
    .filter((version) => semver.gte(version, current))
    .filter((version) => ranges.every((range) => !semver.satisfies(version, range)))
    .sort(semver.compare);
  return candidates[0] || null;
}

function dependencySection(manifest, name) {
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (manifest[section] && Object.hasOwn(manifest[section], name)) return section;
  }
  return null;
}

function packageSlug(name) {
  return name.replace(/^@/, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60);
}

function quote(value) {
  return String(value).replace(/`/g, '\\`');
}

function setOverride(manifest, vulnerablePackage, fixedVersion, parent) {
  manifest.overrides ||= {};
  if (!parent) {
    manifest.overrides[vulnerablePackage] = fixedVersion;
    return;
  }
  if (manifest.overrides[parent] && typeof manifest.overrides[parent] !== 'object') {
    throw new Error(`Existing override for ${parent} is not an object; cannot scope a new override to it.`);
  }
  manifest.overrides[parent] = { ...(manifest.overrides[parent] || {}), [vulnerablePackage]: fixedVersion };
}

function selectChange(manifest, packageName, vulnerability, plan) {
  const directSection = dependencySection(manifest, packageName);
  const auditFixedVersion = fixedVersionFromAudit(vulnerability, packageName);
  const fix = availableFix(vulnerability);

  if (directSection) {
    if (fix?.isSemVerMajor && !plan?.allowBreaking) {
      throw new Error(`The npm audit fix for ${packageName} is a major-version upgrade; it needs manual migration review.`);
    }
    const fixedVersion = plan?.fixedVersion
      || auditFixedVersion
      || fixedVersionFromRegistry(packageName, manifest[directSection][packageName], vulnerability);
    if (!fixedVersion) {
      throw new Error(`Could not determine a non-breaking fixed version for ${packageName}. Supply REMEDIATION_PLAN.fixedVersion after reviewing its migration impact.`);
    }
    return {
      type: 'direct', vulnerablePackage: packageName, changedPackage: packageName,
      oldRange: manifest[directSection][packageName], newVersion: fixedVersion,
      apply() { manifest[directSection][packageName] = fixedVersion; },
    };
  }

  if (plan?.strategy === 'transitive-bump') {
    const parent = plan.parent;
    if (!parent?.name || !parent?.version) {
      throw new Error('transitive-bump requires REMEDIATION_PLAN.parent.name and parent.version.');
    }
    const parentSection = dependencySection(manifest, parent.name);
    if (!parentSection) {
      throw new Error(`${parent.name} is not a direct dependency; refusing to bump a non-direct parent.`);
    }
    return {
      type: 'transitive-bump', vulnerablePackage: packageName, changedPackage: parent.name,
      oldRange: manifest[parentSection][parent.name], newVersion: parent.version,
      apply() { manifest[parentSection][parent.name] = parent.version; },
    };
  }

  if (plan?.strategy && plan.strategy !== 'transitive-override') {
    throw new Error(`Unsupported remediation strategy: ${plan.strategy}`);
  }

  // npm audit occasionally identifies a safe direct parent upgrade for a
  // transitive issue. Use it only when that parent is declared directly and
  // npm confirms it is not a major-version change.
  if (!plan && fix?.name && fix?.version && !fix.isSemVerMajor) {
    const parentSection = dependencySection(manifest, fix.name);
    if (parentSection) {
      return {
        type: 'transitive-bump', vulnerablePackage: packageName, changedPackage: fix.name,
        oldRange: manifest[parentSection][fix.name], newVersion: fix.version,
        apply() { manifest[parentSection][fix.name] = fix.version; },
      };
    }
  }
  const fixedVersion = plan?.fixedVersion || auditFixedVersion;
  if (!fixedVersion) {
    throw new Error(`A transitive override needs REMEDIATION_PLAN.fixedVersion for ${packageName}.`);
  }
  return {
    type: 'transitive-override', vulnerablePackage: packageName, changedPackage: packageName,
    oldRange: 'transitive', newVersion: fixedVersion, parent: plan?.parent,
    apply() { setOverride(manifest, packageName, fixedVersion, plan?.parent); },
  };
}

function severityRank(severity) {
  return { critical: 4, high: 3, moderate: 2, medium: 2, low: 1, info: 0 }[severity] ?? -1;
}

function selectCandidate(manifest, report, plan, requestedPackage) {
  const names = requestedPackage
    ? [requestedPackage]
    : Object.keys(report.vulnerabilities || {}).sort((a, b) => {
      const left = report.vulnerabilities[a];
      const right = report.vulnerabilities[b];
      const directOrder = Number(Boolean(right.isDirect)) - Number(Boolean(left.isDirect));
      return directOrder || severityRank(right.severity) - severityRank(left.severity) || a.localeCompare(b);
    });
  const reasons = [];
  for (const packageName of names) {
    const vulnerability = report.vulnerabilities?.[packageName];
    if (!vulnerability) {
      reasons.push(`${packageName}: not reported by npm audit`);
      continue;
    }
    if (plan?.package && plan.package !== packageName) continue;
    try {
      return {
        packageName,
        vulnerability,
        advisory: advisoryDetails(vulnerability, packageName),
        change: selectChange(manifest, packageName, vulnerability, plan),
      };
    } catch (error) {
      reasons.push(`${packageName}: ${error.message}`);
    }
  }
  throw new Error(`npm audit found no safely remediable vulnerability for this run. ${reasons.join(' | ')}`);
}

function branchName(change, advisory) {
  return `${BRANCH_ROOT}/${change.type}/${advisory.id}/${packageSlug(change.vulnerablePackage)}`;
}

function prTitle(change, advisory) {
  if (change.type === 'direct') return `security(direct): remediate ${advisory.id} in ${change.changedPackage}`;
  if (change.type === 'transitive-bump') return `security(transitive): remediate ${advisory.id} via ${change.changedPackage}`;
  return `security(override): remediate ${advisory.id} in ${change.changedPackage}`;
}

function prBody(change, advisory) {
  const lifecycle = change.type === 'transitive-override'
    ? `\n## Override lifecycle\n- Temporary ${change.parent ? `override scoped to \`${quote(change.parent)}\`` : 'root-level override'}.\n- Remove it once an upstream parent resolves the dependency safely.\n- Review it during the next dependency-maintenance cycle.\n`
    : '';
  const source = advisory.url ? `[${advisory.id}](${advisory.url})` : `\`${advisory.id}\``;
  return `## Vulnerability
- Source: npm audit
- Advisory: ${source}
- Severity: ${advisory.severity}
- Affected package: \`${quote(change.vulnerablePackage)}\`
- Vulnerable range: \`${quote(advisory.range)}\`
- Summary: ${advisory.title}

## Remediation
- Type: \`${change.type}\`
- Change: \`${quote(change.changedPackage)}\` from \`${quote(change.oldRange)}\` to \`${quote(change.newVersion)}\`
- Auto-merge: disabled by design

## Validation
- [x] Lockfile regenerated with npm
- [x] npm audit no longer reports the affected package
- [x] \`npm ci --ignore-scripts\`
${lifecycle}`;
}

async function api(token, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
      'x-github-api-version': API_VERSION,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

function validate(change) {
  run('npm', ['install', '--package-lock-only', '--ignore-scripts']);
  run('npm', ['ci', '--ignore-scripts']);
  const after = auditReport();
  if (after.vulnerabilities?.[change.vulnerablePackage]) {
    throw new Error(`npm audit still reports ${change.vulnerablePackage}; refusing to create a PR.`);
  }
  for (const command of (process.env.REMEDIATION_VALIDATION || '').split('\n').map((item) => item.trim()).filter(Boolean)) {
    runShell(command);
  }
}

async function main() {
  const repository = repositoryName();
  const requestedPackage = process.env.VULNERABILITY_PACKAGE;
  if (!existsSync('package.json') || !existsSync('package-lock.json')) {
    throw new Error('Run this script from an npm repository root with package.json and package-lock.json.');
  }

  const before = auditReport();
  const manifest = readJson('package.json');
  if (!Object.keys(before.vulnerabilities || {}).length) {
    console.log('npm audit found no vulnerabilities. Nothing to remediate.');
    return;
  }
  const candidate = selectCandidate(manifest, before, parsePlan(), requestedPackage);
  const { advisory, change } = candidate;
  const branch = branchName(change, advisory);
  const base = process.env.REMEDIATION_BASE || process.env.GITHUB_REF_NAME || 'main';
  const owner = repository.split('/')[0];

  change.apply();
  writeJson('package.json', manifest);
  validate(change);

  if (dryRun) {
    console.log(`Dry run complete. Would create ${branch} and a PR against ${base}.`);
    return;
  }

  // GitHub creates this short-lived token for each Actions job. It is not a
  // user-managed secret and the script never reads a token from configuration.
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error('No Actions token is available. Expose the job token as GITHUB_TOKEN for this Node step.');
  }
  const openPulls = await api(token, `/repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  if (openPulls.length) {
    console.log(`An open remediation PR already exists: ${openPulls[0].html_url}`);
    return;
  }

  run('git', ['checkout', '-B', branch]);
  run('git', ['config', 'user.name', 'github-actions[bot]']);
  run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  run('git', ['add', '--', 'package.json', 'package-lock.json']);
  run('git', ['commit', '-m', prTitle(change, advisory)]);
  run('git', ['push', '--force-with-lease', 'origin', branch]);

  const pull = await api(token, `/repos/${repository}/pulls`, {
    method: 'POST',
    body: { title: prTitle(change, advisory), head: branch, base, body: prBody(change, advisory) },
  });
  console.log(`Created PR: ${pull.html_url}`);
}

main().catch((error) => {
  console.error(`Remediation failed: ${error.message}`);
  process.exitCode = 1;
});

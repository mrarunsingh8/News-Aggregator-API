#!/usr/bin/env node
/*
 * Creates remediation pull requests for npm-audit vulnerabilities.
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
 *   MAX_PRS                  maximum remediation PRs to create (default: 3)
 *   REMEDIATION_VALIDATION   newline-separated commands, e.g. "npm test\nnpm run lint"
 *   REMEDIATION_PLAN         optional explicit parent-bump plan, for example:
 *                            {"package":"qs","strategy":"transitive-bump","parent":{"name":"body-parser","version":"1.20.3"}}
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

const API_VERSION = '2022-11-28';
const BRANCH_ROOT = 'security-remediation';
const dryRun = process.env.REMEDIATION_DRY_RUN === 'true' || process.env.DRY_RUN === 'true';
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
  if (packageEntry?.version || lockfile.dependencies?.[packageName]?.version) {
    return packageEntry?.version || lockfile.dependencies?.[packageName]?.version;
  }
  const nested = Object.entries(lockfile.packages || {})
    .find(([path, entry]) => path.endsWith(`/node_modules/${packageName}`) && entry?.version);
  return nested?.[1]?.version || null;
}

function fixedVersionFromRegistry(packageName, declaredRange, vulnerability, { allowMajor = false } = {}) {
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
    .filter((version) => allowMajor || semver.major(version) === currentMajor)
    // In 0.x, a minor bump can be breaking, so preserve the current minor too.
    .filter((version) => allowMajor || currentMajor !== 0 || semver.minor(version) === currentMinor)
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

function latestParentUpgrade(packageName, declaredRange) {
  const semver = semverLibrary();
  const current = lockedVersion(packageName) || semver.minVersion(declaredRange)?.version;
  if (!current || !semver.valid(current)) return null;
  const output = run('npm', ['view', packageName, 'versions', '--json'], { capture: true });
  const versions = JSON.parse(output);
  return (Array.isArray(versions) ? versions : [versions])
    .filter((version) => semver.valid(version) && !semver.prerelease(version) && semver.gt(version, current))
    .sort(semver.rcompare)[0] || null;
}

function directDependencyNames(manifest) {
  return new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap((section) => Object.keys(manifest[section] || {})));
}

function packageNamesInLockPath(packagePath) {
  const parts = packagePath.split('/');
  const names = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] !== 'node_modules' || !parts[index + 1]) continue;
    index += 1;
    if (parts[index].startsWith('@') && parts[index + 1]) {
      names.push(`${parts[index]}/${parts[index + 1]}`);
      index += 1;
    } else {
      names.push(parts[index]);
    }
  }
  return names;
}

function topParent(manifest, packageName, vulnerability) {
  const directNames = directDependencyNames(manifest);
  const auditCandidates = [availableFix(vulnerability)?.name, ...(vulnerability.effects || [])];
  const fromAudit = auditCandidates.find((name) => name !== packageName && directNames.has(name));
  if (fromAudit) return fromAudit;

  const lockfile = readJson('package-lock.json');
  for (const path of Object.keys(lockfile.packages || {})) {
    const names = packageNamesInLockPath(path);
    if (names.at(-1) !== packageName) continue;
    const parent = names.slice(0, -1).find((name) => directNames.has(name));
    if (parent) return parent;
  }
  return null;
}

function isMajorUpgrade(packageName, oldRange, newVersion) {
  const semver = semverLibrary();
  const current = lockedVersion(packageName) || semver.minVersion(oldRange)?.version;
  return Boolean(current && semver.valid(current) && semver.valid(newVersion)
    && semver.major(newVersion) > semver.major(current));
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
  const parentName = plan?.parent?.name || (typeof plan?.parent === 'string' ? plan.parent : topParent(manifest, packageName, vulnerability));
  const parentSection = parentName && dependencySection(manifest, parentName);
  const fixedVersion = plan?.fixedVersion || auditFixedVersion
    || fixedVersionFromRegistry(packageName, directSection ? manifest[directSection][packageName] : '*', vulnerability, { allowMajor: true });

  // For a nested finding, npm audit's parent fix is the least-invasive repair.
  if (!plan && fix?.name && fix.name !== packageName && fix.version) {
    const fixedParentSection = dependencySection(manifest, fix.name);
    if (fixedParentSection) {
      return {
        type: 'transitive-bump', vulnerablePackage: packageName, changedPackage: fix.name,
        oldRange: manifest[fixedParentSection][fix.name], newVersion: fix.version,
        requiresCompatibility: isMajorUpgrade(fix.name, manifest[fixedParentSection][fix.name], fix.version),
        apply() { manifest[fixedParentSection][fix.name] = fix.version; },
      };
    }
  }

  if (!plan && !directSection && parentName && parentSection) {
    const targetVersion = latestParentUpgrade(parentName, manifest[parentSection][parentName]);
    if (targetVersion) {
      return {
        type: 'transitive-bump', vulnerablePackage: packageName, changedPackage: parentName,
        oldRange: manifest[parentSection][parentName], newVersion: targetVersion,
        requiresCompatibility: isMajorUpgrade(parentName, manifest[parentSection][parentName], targetVersion),
        apply() { manifest[parentSection][parentName] = `^${targetVersion}`; },
      };
    }
  }

  if (directSection && !parentSection) {
    if (!fixedVersion) throw new Error(`No fixed version is available for ${packageName}.`);
    return {
      type: 'direct', vulnerablePackage: packageName, changedPackage: packageName,
      oldRange: manifest[directSection][packageName], newVersion: fixedVersion,
      requiresCompatibility: isMajorUpgrade(packageName, manifest[directSection][packageName], fixedVersion),
      apply() { manifest[directSection][packageName] = fixedVersion; },
    };
  }

  if (plan?.strategy === 'transitive-bump') {
    const parent = plan.parent;
    if (!parent?.name || !parent?.version || !parentSection) {
      throw new Error('transitive-bump requires a direct REMEDIATION_PLAN.parent with name and version.');
    }
    return {
      type: 'transitive-bump', vulnerablePackage: packageName, changedPackage: parent.name,
      oldRange: manifest[parentSection][parent.name], newVersion: parent.version,
      requiresCompatibility: isMajorUpgrade(parent.name, manifest[parentSection][parent.name], parent.version),
      apply() { manifest[parentSection][parent.name] = parent.version; },
    };
  }

  if (plan?.strategy && plan.strategy !== 'transitive-bump') {
    throw new Error(`Unsupported remediation strategy: ${plan.strategy}`);
  }
  throw new Error(`No safe direct or parent upgrade was found for nested ${packageName}; override remediation is disabled by policy.`);
}

function severityRank(severity) {
  return { critical: 4, high: 3, moderate: 2, medium: 2, low: 1, info: 0 }[severity] ?? -1;
}

function maxPullRequests() {
  const raw = process.env.MAX_PRS || process.env.MAX_REMEDIATIONS || '3';
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error('MAX_PRS must be a positive integer.');
  }
  // A small cap prevents one scheduled run from unexpectedly creating a large
  // number of review requests if a new advisory feed is published.
  return Math.min(Number(raw), 20);
}

function selectCandidates(manifest, report, plan, requestedPackage) {
  const names = requestedPackage
    ? [requestedPackage]
    : Object.keys(report.vulnerabilities || {}).sort((a, b) => {
      const left = report.vulnerabilities[a];
      const right = report.vulnerabilities[b];
      const directOrder = Number(Boolean(right.isDirect)) - Number(Boolean(left.isDirect));
      return directOrder || severityRank(right.severity) - severityRank(left.severity) || a.localeCompare(b);
    });
  const candidates = [];
  const reasons = [];
  for (const packageName of names) {
    const vulnerability = report.vulnerabilities?.[packageName];
    if (!vulnerability) {
      reasons.push(`${packageName}: not reported by npm audit`);
      continue;
    }
    if (plan?.package && plan.package !== packageName) continue;
    try {
      // Confirm this candidate has a safe strategy now, but keep only its
      // immutable audit details. The actual change is rebuilt on a fresh base
      // branch immediately before the PR is created.
      selectChange(JSON.parse(JSON.stringify(manifest)), packageName, vulnerability, plan);
      candidates.push({
        packageName,
        vulnerability,
        advisory: advisoryDetails(vulnerability, packageName),
      });
    } catch (error) {
      reasons.push(`${packageName}: ${error.message}`);
    }
  }
  if (!candidates.length) {
    throw new Error(`npm audit found no safely remediable vulnerability for this run. ${reasons.join(' | ')}`);
  }
  return candidates;
}

function branchName(change, advisory) {
  return `${BRANCH_ROOT}/${change.type}/${advisory.id}/${packageSlug(change.vulnerablePackage)}`;
}

function prTitle(change, advisory) {
  if (change.type === 'direct') return `security(direct): remediate ${advisory.id} in ${change.changedPackage}`;
  if (change.type === 'transitive-bump') return `security(transitive): remediate ${advisory.id} via ${change.changedPackage}`;
  return `security(transitive): remediate ${advisory.id} via ${change.changedPackage}`;
}

function prBody(change, advisory) {
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
`;
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

async function openPullRequests(token, repository) {
  const pulls = [];
  for (let page = 1; ; page += 1) {
    const pageItems = await api(token, `/repos/${repository}/pulls?state=open&per_page=100&page=${page}`);
    pulls.push(...pageItems);
    if (pageItems.length < 100) return pulls;
  }
}

function hasOpenRemediation(pulls, branch, candidate) {
  const advisoryId = candidate.advisory.id;
  const packageName = candidate.packageName;
  return pulls.find((pull) => {
    if (pull.head?.ref === branch) return true;
    const text = `${pull.title || ''}\n${pull.body || ''}`;
    return text.includes(advisoryId)
      && (text.includes(`Affected package: \`${packageName}\``) || text.includes(packageName));
  });
}

function validate(change) {
  run('npm', ['install', '--package-lock-only', '--ignore-scripts']);
  run('npm', ['ci', '--ignore-scripts']);
  const after = auditReport();
  if (after.vulnerabilities?.[change.vulnerablePackage]) {
    throw new Error(`npm audit still reports ${change.vulnerablePackage}; refusing to create a PR.`);
  }
  const commands = (process.env.REMEDIATION_VALIDATION || '').split('\n').map((item) => item.trim()).filter(Boolean);
  if (change.requiresCompatibility && !commands.length) {
    throw new Error(`Major upgrade for ${change.changedPackage} needs REMEDIATION_VALIDATION (for example: npm test, npm run lint, npm run build).`);
  }
  for (const command of commands) {
    runShell(command);
  }
}

function restoreBaseFiles(base) {
  // Called only after validation fails, before any commit or push.
  run('git', ['restore', '--source', base, '--staged', '--worktree', 'package.json', 'package-lock.json']);
  run('git', ['checkout', base]);
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
  const plan = parsePlan();
  const candidates = selectCandidates(manifest, before, plan, requestedPackage);
  const limit = maxPullRequests();
  const base = process.env.REMEDIATION_BASE || process.env.BASE_BRANCH || process.env.GITHUB_REF_NAME || 'main';

  // GitHub creates this short-lived token for each Actions job. It is not a
  // user-managed secret and the script never reads a token from configuration.
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error('No Actions token is available. Expose the job token as GITHUB_TOKEN for this Node step.');
  }
  const pulls = await openPullRequests(token, repository);
  let created = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    if (created >= limit) break;
    // Preview the exact strategy before creating a branch. selectChange only
    // mutates its supplied manifest when apply() is called.
    const preview = JSON.parse(JSON.stringify(manifest));
    const previewChange = selectChange(preview, candidate.packageName, candidate.vulnerability, plan);
    const branch = branchName(previewChange, candidate.advisory);
    const existing = hasOpenRemediation(pulls, branch, candidate);
    if (existing) {
      skipped += 1;
      console.log(`Skipping ${candidate.packageName}: remediation PR already open: ${existing.html_url}`);
      continue;
    }

    if (dryRun) {
      created += 1;
      console.log(`Dry run: would create ${branch} for ${candidate.packageName} against ${base}.`);
      continue;
    }

    // Every PR begins from the same base branch; changes from one vulnerability
    // never leak into another remediation PR.
    run('git', ['checkout', '-B', branch, base]);
    const workingManifest = readJson('package.json');
    const change = selectChange(workingManifest, candidate.packageName, candidate.vulnerability, plan);
    change.apply();
    writeJson('package.json', workingManifest);
    try {
      validate(change);
    } catch (error) {
      restoreBaseFiles(base);
      skipped += 1;
      console.log(`Skipping ${candidate.packageName}: candidate did not fully remove the audit finding (${error.message}).`);
      continue;
    }

    run('git', ['config', 'user.name', 'github-actions[bot]']);
    run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    run('git', ['add', '--', 'package.json', 'package-lock.json']);
    run('git', ['commit', '-m', prTitle(change, candidate.advisory)]);
    run('git', ['push', '--force-with-lease', 'origin', branch]);

    const pull = await api(token, `/repos/${repository}/pulls`, {
      method: 'POST',
      body: { title: prTitle(change, candidate.advisory), head: branch, base, body: prBody(change, candidate.advisory) },
    });
    pulls.push(pull);
    created += 1;
    console.log(`Created PR: ${pull.html_url}`);
  }
  console.log(`Remediation run complete: ${created} ${dryRun ? 'planned' : 'created'}, ${skipped} skipped, limit ${limit}.`);
}

main().catch((error) => {
  console.error(`Remediation failed: ${error.message}`);
  process.exitCode = 1;
});

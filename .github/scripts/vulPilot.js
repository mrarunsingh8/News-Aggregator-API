#!/usr/bin/env node
/*
 * Creates narrowly-scoped remediation PRs for npm-audit advisories.
 *
 * npm audit is the advisory source of truth. Its fixAvailable recommendation
 * is preferred within an equally safe risk tier, but every candidate is
 * independently checked against npm registry versions, the advisory range,
 * install, audit, and project checks before a PR is created.
 */

'use strict';

const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const API_VERSION = '2022-11-28';
const BRANCH_ROOT = 'security-remediation';
const dryRun = process.env.REMEDIATION_DRY_RUN === 'true' || process.env.DRY_RUN === 'true';
let cachedSemver;

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(), encoding: 'utf8', stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
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
  if (result.status !== 0) throw new Error(`Project check failed: ${command}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function semverLibrary() {
  if (cachedSemver) return cachedSemver;
  try {
    cachedSemver = require('semver');
    return cachedSemver;
  } catch {
    const npmRoot = run('npm', ['root', '-g'], { capture: true }).trim();
    for (const candidate of [`${npmRoot}/npm/node_modules/semver`, `${npmRoot}/semver`]) {
      try {
        cachedSemver = require(candidate);
        return cachedSemver;
      } catch {
        // Try the next npm installation layout.
      }
    }
    throw new Error('Unable to load semver. Install it for the workflow runner.');
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
  const detail = (vulnerability.via || []).find((item) => typeof item === 'object') || {};
  const url = detail.url || '';
  const ghsa = url.match(/GHSA-[\w-]+/i)?.[0]?.toUpperCase();
  return {
    id: ghsa || (detail.source ? `npm-${detail.source}` : `npm-audit-${packageName}`),
    url: url || undefined,
    title: detail.title || `${packageName} vulnerability reported by npm audit`,
    severity: detail.severity || vulnerability.severity || 'unknown',
    range: detail.range || vulnerability.range || 'unknown',
  };
}

function auditRecommendation(vulnerability) {
  const fix = vulnerability.fixAvailable;
  return fix && typeof fix === 'object' && fix.name && fix.version ? fix : null;
}

function dependencySection(manifest, name) {
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (manifest[section] && Object.hasOwn(manifest[section], name)) return section;
  }
  return null;
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

function lockedVersions(packageName) {
  const lockfile = readJson('package-lock.json');
  const values = Object.entries(lockfile.packages || {})
    .filter(([location, entry]) => packageNamesInLockPath(location).at(-1) === packageName && entry?.version)
    .map(([, entry]) => entry.version);
  if (!values.length && lockfile.dependencies?.[packageName]?.version) values.push(lockfile.dependencies[packageName].version);
  return [...new Set(values)];
}

function lockedVersion(packageName) {
  const semver = semverLibrary();
  return lockedVersions(packageName).filter((version) => semver.valid(version)).sort(semver.rcompare)[0] || null;
}

function registryVersions(packageName) {
  const semver = semverLibrary();
  const output = run('npm', ['view', packageName, 'versions', '--json'], { capture: true });
  let versions;
  try {
    versions = JSON.parse(output);
  } catch {
    throw new Error(`npm registry returned invalid version data for ${packageName}.`);
  }
  return (Array.isArray(versions) ? versions : [versions])
    .filter((version) => semver.valid(version) && !semver.prerelease(version));
}

function vulnerabilityRanges(vulnerability) {
  const ranges = (vulnerability.via || [])
    .filter((item) => typeof item === 'object' && item.range)
    .map((item) => item.range);
  if (!ranges.length && vulnerability.range) ranges.push(vulnerability.range);
  return ranges;
}

function upgradeRisk(current, candidate) {
  const semver = semverLibrary();
  if (semver.major(candidate) !== semver.major(current)) return 2;
  if (semver.minor(candidate) !== semver.minor(current)) return 1;
  return 0;
}

function orderedUpgrades(packageName, declaredRange) {
  const semver = semverLibrary();
  const current = lockedVersion(packageName) || semver.minVersion(declaredRange)?.version;
  if (!current || !semver.valid(current)) return [];
  return registryVersions(packageName)
    .filter((version) => semver.gt(version, current))
    .sort((left, right) => upgradeRisk(current, left) - upgradeRisk(current, right) || semver.compare(left, right));
}

function safeVersions(packageName, declaredRange, vulnerability) {
  const ranges = vulnerabilityRanges(vulnerability);
  if (!ranges.length) return [];
  const semver = semverLibrary();
  const current = lockedVersion(packageName) || semver.minVersion(declaredRange)?.version;
  if (!current || !semver.valid(current)) return [];
  return orderedUpgrades(packageName, declaredRange)
    .filter((version) => ranges.every((range) => !semver.satisfies(version, range)));
}

function minimumPatchedVersion(packageName, vulnerability, declaredRange = '*') {
  const semver = semverLibrary();
  const current = lockedVersion(packageName) || semver.minVersion(declaredRange)?.version;
  const ranges = vulnerabilityRanges(vulnerability);
  if (!ranges.length) return null;
  return registryVersions(packageName)
    .filter((version) => !current || semver.gte(version, current))
    .filter((version) => ranges.every((range) => !semver.satisfies(version, range)))
    .sort(semver.compare)[0] || null;
}

function dependencyPaths(lockfile, packageName, manifest, vulnerability) {
  const direct = directDependencyNames(manifest);
  const paths = [];
  for (const [location, entry] of Object.entries(lockfile.packages || {})) {
    const names = packageNamesInLockPath(location);
    if (names.at(-1) !== packageName) continue;
    paths.push({
      location: location || '.', version: entry?.version || 'unknown',
      highestDirectParent: names.slice(0, -1).find((name) => direct.has(name)) || null,
    });
  }
  // Hoisted lockfile entries have no physical ancestor. Retain npm audit's
  // affected direct parent so it can still be tried and reported.
  const recommendation = auditRecommendation(vulnerability);
  const effects = [...(vulnerability.effects || []), recommendation?.name]
    .filter((name) => name && name !== packageName && direct.has(name));
  for (const parent of effects) {
    if (!paths.some((item) => item.highestDirectParent === parent)) {
      paths.push({ location: `(hoisted; npm audit effect: ${parent})`, version: lockedVersion(packageName) || 'unknown', highestDirectParent: parent });
    }
  }
  return paths;
}

function parentCandidates(manifest, paths) {
  const seen = new Set();
  return paths.flatMap((path) => {
    const name = path.highestDirectParent;
    const section = name && dependencySection(manifest, name);
    if (!name || !section || seen.has(name)) return [];
    seen.add(name);
    return [{ name, section, oldRange: manifest[section][name] }];
  });
}

function severityRank(severity) {
  return { critical: 4, high: 3, moderate: 2, medium: 2, low: 1, info: 0 }[severity] ?? -1;
}

function selectFindings(report, requestedPackage) {
  const names = requestedPackage ? [requestedPackage] : Object.keys(report.vulnerabilities || {})
    .sort((left, right) => {
      const a = report.vulnerabilities[left];
      const b = report.vulnerabilities[right];
      return Number(Boolean(b.isDirect)) - Number(Boolean(a.isDirect))
        || severityRank(b.severity) - severityRank(a.severity) || left.localeCompare(right);
    });
  return names.flatMap((packageName) => {
    const vulnerability = report.vulnerabilities?.[packageName];
    return vulnerability ? [{ packageName, vulnerability, advisory: advisoryDetails(vulnerability, packageName) }] : [];
  });
}

function packageSlug(name) {
  return name.replace(/^@/, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60);
}

function quote(value) {
  return String(value).replace(/`/g, '\\`');
}

function formatPaths(paths) {
  return paths.map((item) => `- \`${quote(item.location)}\` (${quote(item.version)}); highest direct parent: ${item.highestDirectParent ? `\`${quote(item.highestDirectParent)}\`` : 'not identified'}`).join('\n') || '- No package-lock paths were found.';
}

function directChanges(manifest, finding) {
  const section = dependencySection(manifest, finding.packageName);
  if (!section) return [];
  const semver = semverLibrary();
  const oldRange = manifest[section][finding.packageName];
  const current = lockedVersion(finding.packageName) || semver.minVersion(oldRange)?.version;
  const recommendation = auditRecommendation(finding.vulnerability);
  return safeVersions(finding.packageName, oldRange, finding.vulnerability).map((version) => ({
    type: 'direct', vulnerablePackage: finding.packageName, changedPackage: finding.packageName,
    section, oldRange, newVersion: version,
    advisoryRecommended: recommendation?.name === finding.packageName && recommendation.version === version,
  })).sort((left, right) => upgradeRisk(current, left.newVersion) - upgradeRisk(current, right.newVersion)
    || Number(right.advisoryRecommended) - Number(left.advisoryRecommended)
    || semver.compare(left.newVersion, right.newVersion));
}

function parentChanges(manifest, finding, paths) {
  const semver = semverLibrary();
  const recommendation = auditRecommendation(finding.vulnerability);
  const changes = parentCandidates(manifest, paths).flatMap((parent) => orderedUpgrades(parent.name, parent.oldRange)
    .map((version) => ({
      type: 'parent-upgrade', vulnerablePackage: finding.packageName, changedPackage: parent.name,
      section: parent.section, oldRange: parent.oldRange, newVersion: version,
      advisoryRecommended: recommendation?.name === parent.name && recommendation.version === version,
    })));
  return changes.sort((left, right) => {
    const leftCurrent = lockedVersion(left.changedPackage) || semver.minVersion(left.oldRange)?.version;
    const rightCurrent = lockedVersion(right.changedPackage) || semver.minVersion(right.oldRange)?.version;
    return upgradeRisk(leftCurrent, left.newVersion) - upgradeRisk(rightCurrent, right.newVersion)
      || Number(right.advisoryRecommended) - Number(left.advisoryRecommended)
      || left.changedPackage.localeCompare(right.changedPackage) || semver.compare(left.newVersion, right.newVersion);
  });
}

function overrideChange(manifest, finding) {
  const section = dependencySection(manifest, finding.packageName);
  const oldRange = section ? manifest[section][finding.packageName] : 'transitive';
  const fixedVersion = minimumPatchedVersion(finding.packageName, finding.vulnerability, oldRange);
  return fixedVersion ? {
    type: 'override', vulnerablePackage: finding.packageName, changedPackage: finding.packageName,
    oldRange, newVersion: fixedVersion, advisoryRecommended: false,
  } : null;
}

function projectChecks(manifest) {
  const configured = (process.env.REMEDIATION_VALIDATION || '').split('\n').map((item) => item.trim()).filter(Boolean);
  if (configured.length) return configured;
  return ['test', 'lint', 'build'].filter((name) => manifest.scripts?.[name]).map((name) => `npm run ${name}`);
}

function validate(manifest, vulnerablePackage) {
  run('npm', ['install', '--package-lock-only', '--ignore-scripts']);
  run('npm', ['install', '--ignore-scripts']);
  if (auditReport().vulnerabilities?.[vulnerablePackage]) throw new Error(`npm audit still reports ${vulnerablePackage}`);
  for (const command of projectChecks(manifest)) runShell(command);
}

function restoreBaseFiles(base) {
  run('git', ['restore', '--source', base, '--staged', '--worktree', 'package.json', 'package-lock.json']);
}

function applyChange(change) {
  const manifest = readJson('package.json');
  if (change.type === 'override') {
    manifest.overrides ||= {};
    manifest.overrides[change.vulnerablePackage] = change.newVersion;
  } else {
    manifest[change.section][change.changedPackage] = change.newVersion;
  }
  writeJson('package.json', manifest);
  return manifest;
}

function tryChange(base, change) {
  restoreBaseFiles(base);
  try {
    const manifest = applyChange(change);
    validate(manifest, change.vulnerablePackage);
    return { ok: true };
  } catch (error) {
    restoreBaseFiles(base);
    return { ok: false, reason: error.message.replace(/\s+/g, ' ').trim() };
  }
}

function attemptSummary(change, result) {
  return `${change.type}: ${change.changedPackage} ${change.oldRange} -> ${change.newVersion}${change.advisoryRecommended ? ' (npm-audit recommendation)' : ''}: ${result.ok ? 'passed' : result.reason}`;
}

function reportNoFix(finding, paths, attempts, reason) {
  const report = `No remediation PR created for ${finding.packageName} (${finding.advisory.id}).
Affected paths:
${formatPaths(paths)}
Attempted changes:
${attempts.length ? attempts.map((item) => `- ${item}`).join('\n') : '- None'}
Reason: ${reason}
Recommended manual next steps: review the affected parent release notes and compatibility requirements; update or replace the parent dependency, or approve and test a temporary npm override for the minimum patched version.`;
  console.error(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## npm audit remediation not created\n\n${report}\n`);
}

function branchName(change, advisory) {
  return `${BRANCH_ROOT}/${change.type}/${advisory.id}/${packageSlug(change.vulnerablePackage)}`;
}

function prTitle(change, advisory) {
  const type = change.type === 'direct' ? 'direct' : change.type === 'parent-upgrade' ? 'transitive' : 'override';
  return `security(${type}): remediate ${advisory.id} in ${change.changedPackage}`;
}

function prBody(change, advisory, paths) {
  const source = advisory.url ? `[${advisory.id}](${advisory.url})` : `\`${advisory.id}\``;
  const override = change.type === 'override'
    ? '\n## Override lifecycle\n- Temporary root-level override for every affected lockfile path.\n- Remove it once an upstream parent provides a safe update.\n'
    : '';
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
- Candidate source: ${change.advisoryRecommended ? 'npm audit recommendation (independently range-checked)' : 'npm registry version search'}
- Auto-merge: disabled by design

## Affected lockfile paths
${formatPaths(paths)}

## Validation
- [x] Lockfile regenerated with npm install
- [x] npm install completed
- [x] npm audit no longer reports the affected package
- [x] Project checks passed
${override}`;
}

function maxPullRequests() {
  const raw = process.env.MAX_PRS || process.env.MAX_REMEDIATIONS || '3';
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error('MAX_PRS must be a positive integer.');
  return Math.min(Number(raw), 20);
}

function repositoryFromOrigin() {
  const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
    cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return (result.stdout || '').trim().match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i)?.[1] || null;
}

function repositoryName() {
  const repository = process.env.GITHUB_REPOSITORY || repositoryFromOrigin();
  if (!repository) throw new Error('Cannot determine the GitHub repository.');
  return repository;
}

async function api(token, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || 'GET',
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': API_VERSION, ...(options.body ? { 'content-type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function openPullRequests(token, repository) {
  const pulls = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(token, `/repos/${repository}/pulls?state=open&per_page=100&page=${page}`);
    pulls.push(...batch);
    if (batch.length < 100) return pulls;
  }
}

function hasOpenRemediation(pulls, finding) {
  return pulls.find((pull) => {
    const text = `${pull.title || ''}\n${pull.body || ''}`;
    return text.includes(finding.advisory.id)
      && (text.includes(`Affected package: \`${finding.packageName}\``) || text.includes(finding.packageName));
  });
}

async function main() {
  if (!existsSync('package.json') || !existsSync('package-lock.json')) throw new Error('Run this script from an npm repository root with package.json and package-lock.json.');
  const report = auditReport();
  const findings = selectFindings(report, process.env.VULNERABILITY_PACKAGE);
  if (!findings.length) return console.log('npm audit found no vulnerabilities. Nothing to remediate.');

  const base = process.env.REMEDIATION_BASE || process.env.BASE_BRANCH || process.env.GITHUB_REF_NAME || 'main';
  const manifest = readJson('package.json');
  const lockfile = readJson('package-lock.json');
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!dryRun && !token) throw new Error('No Actions token is available. Expose GITHUB_TOKEN for this Node step.');
  const repository = dryRun ? null : repositoryName();
  const pulls = dryRun ? [] : await openPullRequests(token, repository);
  const limit = maxPullRequests();
  let created = 0;
  let skipped = 0;

  for (const finding of findings) {
    if (created >= limit) break;
    if (!dryRun) {
      run('git', ['checkout', base]);
      restoreBaseFiles(base);
    }
    const existing = hasOpenRemediation(pulls, finding);
    if (existing) {
      skipped += 1;
      console.log(`Skipping ${finding.packageName}: remediation PR already open: ${existing.html_url}`);
      continue;
    }

    const paths = dependencyPaths(lockfile, finding.packageName, manifest, finding.vulnerability);
    const direct = Boolean(dependencySection(manifest, finding.packageName));
    const attempts = [];
    let changes = [];
    let planningError = null;
    try {
      changes = direct ? directChanges(manifest, finding) : parentChanges(manifest, finding, paths);
    } catch (error) {
      planningError = error.message.replace(/\s+/g, ' ').trim();
      attempts.push(`candidate discovery: ${planningError}`);
    }
    let selected = null;
    for (const change of changes) {
      const result = dryRun ? { ok: true } : tryChange(base, change);
      attempts.push(attemptSummary(change, result));
      if (result.ok) {
        selected = change;
        break;
      }
    }

    if (!selected && !direct && !planningError) {
      try {
        const change = overrideChange(manifest, finding);
        if (!change) {
          attempts.push('override: no minimum patched package version was available from npm');
        } else {
          const result = dryRun ? { ok: true } : tryChange(base, change);
          attempts.push(attemptSummary(change, result));
          if (result.ok) selected = change;
        }
      } catch (error) {
        planningError = error.message.replace(/\s+/g, ' ').trim();
        attempts.push(`override discovery: ${planningError}`);
      }
    }

    if (!selected) {
      skipped += 1;
      const reason = planningError
        ? `Automatic remediation could not be evaluated safely: ${planningError}`
        : direct && !changes.length
          ? 'npm has no patched release newer than the currently locked direct dependency.'
          : direct
            ? 'No safe direct package version passed install, audit, and project checks.'
            : 'No safe direct-parent upgrade or npm override passed install, audit, and project checks.';
      reportNoFix(finding, paths, attempts, reason);
      continue;
    }

    const branch = branchName(selected, finding.advisory);
    if (dryRun) {
      created += 1;
      console.log(`Dry run: would create ${branch} for ${finding.packageName} against ${base}.`);
      continue;
    }
    // Validation modifies only package.json and package-lock.json. Replay the
    // selected candidate from the exact base branch before committing it.
    run('git', ['checkout', '-B', branch, base]);
    const finalResult = tryChange(base, selected);
    if (!finalResult.ok) {
      restoreBaseFiles(base);
      run('git', ['checkout', base]);
      skipped += 1;
      reportNoFix(finding, paths, [...attempts, attemptSummary(selected, finalResult)], 'The selected candidate was not reproducible on its remediation branch.');
      continue;
    }
    run('git', ['config', 'user.name', 'github-actions[bot]']);
    run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    run('git', ['add', '--', 'package.json', 'package-lock.json']);
    run('git', ['commit', '-m', prTitle(selected, finding.advisory)]);
    run('git', ['push', '--force-with-lease', 'origin', branch]);
    const pull = await api(token, `/repos/${repository}/pulls`, {
      method: 'POST', body: { title: prTitle(selected, finding.advisory), head: branch, base, body: prBody(selected, finding.advisory, paths) },
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

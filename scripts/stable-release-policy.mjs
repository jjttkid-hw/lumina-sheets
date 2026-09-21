import assert from 'node:assert/strict';
import { releasePolicy } from './release-policy.mjs';
import { createHash } from 'node:crypto';
import { declaredLicenseCoverage, hasLicenseText } from './license-evidence.mjs';

/** Verify the shipped notice bytes, independent of local node_modules or summary claims. */
export function validateStableLicenses(inventory, notices) {
  assert(Array.isArray(inventory.packages) && inventory.packages.length > 0, 'Missing dependency packages');
  assert(Array.isArray(inventory.vendorBundles), 'Missing vendor bundle inventory');
  // Schema 1 records embedded components as unresolved; no resolution format exists yet.
  for (const bundle of inventory.vendorBundles)
    assert(Array.isArray(bundle.components) && bundle.components.length === 0, 'Unresolved embedded vendor components remain');
  assert(typeof notices === 'string' && notices.length > 0, 'Missing packed third-party notices');
  const bytes = Buffer.from(notices);
  const locations = new Set();
  const versions = new Set();
  let noticeCount = 0;
  for (const dependency of inventory.packages) {
    const label = `${dependency.name}@${dependency.version}`;
    assert(typeof dependency.name === 'string' && dependency.name.trim() && typeof dependency.version === 'string' && dependency.version.trim(), 'Missing dependency identity');
    assert(typeof dependency.location === 'string' && /^node_modules\/[\w@./-]+$/.test(dependency.location) && !dependency.location.split('/').includes('..'), `Invalid dependency location: ${label}`);
    assert(!locations.has(dependency.location), `Duplicate dependency location: ${label}`);
    locations.add(dependency.location);
    versions.add(label);
    assert(Array.isArray(dependency.licenseFiles) && dependency.licenseFiles.length > 0, `Missing license files: ${label}`);
    const paths = new Set();
    const texts = dependency.licenseFiles.map(notice => {
      assert(typeof notice.path === 'string' && notice.path.length > 0 && !/[\r\n]/.test(notice.path), `Invalid notice path: ${label}`);
      assert(!paths.has(notice.path), `Duplicate notice path: ${label}`);
      paths.add(notice.path);
      const marker = Buffer.from(`--- ${dependency.location}/${notice.path} ---\n`);
      const offset = bytes.indexOf(marker);
      assert(offset >= 0 && (offset === 0 || bytes[offset - 1] === 10), `Missing packed notice: ${label}/${notice.path}`);
      assert(bytes.indexOf(marker, offset + marker.length) === -1, `Duplicate packed notice: ${label}/${notice.path}`);
      assert(Number.isSafeInteger(notice.bytes) && notice.bytes > 0, `Invalid notice length: ${label}`);
      const start = offset + marker.length;
      const end = start + notice.bytes;
      assert(end <= bytes.length && (end === bytes.length || bytes[end] === 10), `Invalid packed notice boundary: ${label}`);
      const content = bytes.subarray(start, end);
      assert(createHash('sha256').update(content).digest('hex') === notice.sha256, `Packed notice digest mismatch: ${label}`);
      const text = content.toString('utf8');
      assert(hasLicenseText(text) === notice.hasLicenseText, `Incorrect license text flag: ${label}`);
      return text;
    });
    const coverage = declaredLicenseCoverage(dependency.license, texts);
    assert.deepEqual(dependency.licenseCoverage, coverage, `License coverage differs from packed notices: ${label}`);
    assert(coverage.status === 'text-evidenced', `Unresolved declared license: ${label}`);
    noticeCount += texts.length;
  }
  assert(inventory.summary.packageInstallations === locations.size, 'Dependency package count mismatch');
  assert(inventory.summary.uniqueNameVersions === versions.size, 'Dependency version count mismatch');
  assert(inventory.summary.noticeFiles === noticeCount, 'Dependency notice count mismatch');
}

export const browserTargets = ['chromium', 'firefox', 'safari', 'mobile-touch'];
export const browserChecks = [
  'render-zoom', 'editing-ime', 'layout-navigation', 'clipboard-validation',
  'history-persistence', 'file-roundtrip', 'sdk-lifecycle', 'accessibility',
];
export const evidenceGates = ['performance', 'xlsx-corpus', 'frameworks', 'api', 'reproducibility'];
/** Inspect the actual recorded result, not just the acceptance ledger's passed flag. */
export function validateStableReproducibility(report, evidence) {
  assert(report?.schema === 1 && report.status === 'passed', 'Reproducibility report must be passed schema 1');
  assert(report.version === evidence.version, 'Reproducibility version mismatch');
  assert(report.dirty === false, 'Stable reproducibility requires a clean checkout');
  assert(typeof report.commit === 'string' && /^[a-f0-9]{40}$/.test(report.commit), 'Missing reproducibility commit');
  assert(typeof report.inputSha256 === 'string' && /^[a-f0-9]{64}$/.test(report.inputSha256), 'Missing reproducibility input digest');
  assert(typeof report.sourceDateEpoch === 'string' && /^\d+$/.test(report.sourceDateEpoch), 'Invalid reproducibility source epoch');
  const milliseconds = Number(report.sourceDateEpoch) * 1000;
  assert(Number.isSafeInteger(milliseconds) && Number.isFinite(new Date(milliseconds).getTime()), 'Invalid reproducibility source epoch');
  assert(report.sourceTimestamp === new Date(milliseconds).toISOString(), 'Reproducibility source timestamp mismatch');
  for (const key of ['node', 'npm', 'platform', 'arch'])
    assert(typeof report.environment?.[key] === 'string' && report.environment[key].trim(), `Reproducibility lacks ${key}`);
  assert(Array.isArray(report.runs) && report.runs.length === 2, 'Reproducibility requires exactly two runs');
  assert.deepEqual(report.runs[0], report.runs[1], 'Reproducibility runs differ');
  const run = report.runs[0];
  assert(run?.artifactSha256 === evidence.artifactSha256, 'Reproducibility belongs to a different artifact');
  assert(typeof evidence.siteSha256 === 'string' && /^[a-f0-9]{64}$/.test(evidence.siteSha256), 'Missing accepted reproducibility site digest');
  assert(run.siteSha256 === evidence.siteSha256, 'Reproducibility belongs to a different site');
  for (const key of ['artifactBytes', 'siteFiles'])
    assert(Number.isSafeInteger(run[key]) && run[key] > 0, `Invalid reproducibility ${key}`);
}
export function requiresStableAcceptance(version) {
  const plan = releasePolicy(version, `v${version}`);
  return plan.distTag === 'latest' && Number(version.split('.')[0]) >= 1;
}

/** Validate the shape and artifact binding; human evidence still requires review. */
export function validateStableAcceptance(evidence, version, artifactSha256, inventory, notices) {
  assert(evidence?.schema === 1, 'Missing stable acceptance evidence (schema 1)');
  assert(evidence.version === version, 'Acceptance version does not match package');
  assert(evidence.artifactSha256 === artifactSha256, 'Acceptance belongs to a different artifact');
  assert(/^[a-f0-9]{64}$/.test(artifactSha256), 'Invalid artifact digest');
  assert(inventory?.schemaVersion === 1, 'Missing dependency inventory');
  for (const name of ['errors', 'reviewItems', 'unresolvedVendorComponents'])
    assert(inventory.summary?.[name] === 0, `Dependency inventory has unresolved ${name}`);
  assert(Array.isArray(inventory.issues) && inventory.issues.length === 0, 'Dependency issues remain');
  validateStableLicenses(inventory, notices);
  const records = [];
  const record = (value, label) => {
    assert(value?.status === 'passed', `${label} is not passed`);
    for (const field of ['reviewer', 'environment'])
      assert(typeof value[field] === 'string' && value[field].trim(), `${label} lacks ${field}`);
    assert(typeof value.executedAt === 'string' && Number.isFinite(Date.parse(value.executedAt)), `${label} lacks execution time`);
    assert(typeof value.report === 'string' && /^docs\/acceptance\/[a-zA-Z0-9_./-]+$/.test(value.report) && !value.report.split('/').includes('..'), `${label} report path must be under docs/acceptance`);
    assert(/^[a-f0-9]{64}$/.test(value.reportSha256), `${label} lacks report digest`);
    records.push(value);
  };
  for (const target of browserTargets) {
    const value = evidence.browsers?.[target];
    record(value, target);
    assert(typeof value.browserVersion === 'string' && value.browserVersion.trim(), `${target} lacks browser version`);
    for (const check of browserChecks)
      assert(value.checks?.[check] === 'passed', `${target}/${check} is not passed`);
  }
  for (const gate of evidenceGates) record(evidence.gates?.[gate], gate);
  return records;
}

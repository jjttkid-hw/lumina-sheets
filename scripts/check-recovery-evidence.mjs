import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { siteDigest } from './site-evidence.mjs';

const [directory = 'artifacts/browser-recovery'] = process.argv.slice(2);
const root = path.resolve(directory);
const engines = ['chromium', 'firefox', 'webkit'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const packageManifest = JSON.parse(await readFile('package.json', 'utf8'));
const artifact = await readFile(`artifacts/lumina-report-sdk-${packageManifest.version}.tgz`);
const site = await siteDigest('dist');
const expectedChecks = [
  'damaged-journal-download-and-raw-snapshot-restore',
  'partial-backup-invalid-selection-search-and-cancel',
  'historical-snapshot-restores-independent-copy',
];
const reports = [];
for (const engine of engines) {
  const relative = `${engine}/result.json`;
  const report = JSON.parse(await readFile(path.join(root, relative), 'utf8'));
  assert.equal(report.schema, 1, `${relative}: schema must be 1`);
  assert.equal(report.status, 'passed', `${relative}: report is not passed`);
  assert.equal(report.version, packageManifest.version, `${relative}: version mismatch`);
  assert.equal(report.siteSha256, site.sha256, `${relative}: site hash mismatch`);
  assert.equal(report.artifactSha256, hash(artifact), `${relative}: artifact hash mismatch`);
  assert.equal(report.screenshotEvidence, 'complete', `${relative}: screenshot evidence incomplete`);
  assert.deepEqual(report.screenshots, expectedChecks.length === 3 ? [
    { file: 'startup-1280.png', status: 'captured' },
    { file: 'startup-390.png', status: 'captured' },
    { file: 'startup-320.png', status: 'captured' },
    { file: 'startup-rescue.png', status: 'captured' },
    { file: 'history-selection.png', status: 'captured' },
  ] : [], `${relative}: screenshot ledger mismatch`);
  assert.deepEqual(report.validation?.expectedChecks, expectedChecks, `${relative}: expected checks mismatch`);
  assert.deepEqual(report.validation?.actualChecks, expectedChecks, `${relative}: actual checks mismatch`);
  assert.deepEqual(report.validation?.missingChecks, [], `${relative}: missing checks`);
  assert.deepEqual(report.validation?.unexpectedChecks, [], `${relative}: unexpected checks`);
  assert.deepEqual(report.validation?.duplicateChecks, [], `${relative}: duplicate checks`);
  assert.deepEqual(report.validation?.failedChecks, [], `${relative}: failed checks`);
  assert.equal(report.validation?.pageErrorCount, 0, `${relative}: page errors`);
  assert.equal(report.validation?.consoleErrorCount, 0, `${relative}: console errors`);
  assert.equal(report.validation?.runErrorCount, 0, `${relative}: run errors`);
  for (const screenshot of report.screenshots) {
    const filename = path.join(root, engine, screenshot.file);
    const info = await stat(filename);
    assert(info.isFile() && info.size > 0, `${relative}: missing screenshot ${screenshot.file}`);
  }
  reports.push({ engine, browserVersion: report.browserVersion, checks: report.checks.length });
}
console.log(JSON.stringify({
  status: 'passed',
  directory: path.relative(process.cwd(), root),
  version: packageManifest.version,
  siteSha256: site.sha256,
  artifactSha256: hash(artifact),
  screenshotsPerEngine: 5,
  reports,
}, null, 2));

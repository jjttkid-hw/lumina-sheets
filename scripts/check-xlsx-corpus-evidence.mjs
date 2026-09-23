import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [reportArg = 'docs/acceptance/browser-candidate-2026-09-23-r9/xlsx-corpus.json'] =
  process.argv.slice(2);
assert(process.argv.length === 3, 'Usage: node scripts/check-xlsx-corpus-evidence.mjs <report>');
const reportPath = path.resolve(reportArg);
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const packageManifest = JSON.parse(await readFile('package.json', 'utf8'));
const artifactPath = path.resolve(`artifacts/lumina-report-sdk-${packageManifest.version}.tgz`);
const artifact = await readFile(artifactPath);
const digest = createHash('sha256').update(artifact).digest('hex');
const expectedChecks = [
  'business-report-roundtrip',
  'structure-report-roundtrip',
  'synthetic-supported-subset',
  'independent-reader-contract',
  'unsupported-image-rejection',
];
assert.equal(report.schema, 1, 'Corpus report schema must be 1');
assert.equal(report.status, 'passed', 'Corpus report must be passed');
assert.equal(report.version, packageManifest.version, 'Corpus report version mismatch');
assert.equal(report.artifactSha256, digest, 'Corpus report belongs to a different SDK archive');
assert.deepEqual(report.validation?.expectedChecks, expectedChecks, 'Corpus check list changed');
assert.deepEqual(report.validation?.actualChecks, expectedChecks, 'Corpus checks are incomplete');
assert.deepEqual(report.validation?.missingChecks, [], 'Corpus checks are missing');
assert.deepEqual(report.validation?.unexpectedChecks, [], 'Corpus has unexpected checks');
assert.deepEqual(report.validation?.duplicateChecks, [], 'Corpus checks are duplicated');
assert.deepEqual(report.validation?.failedChecks, [], 'Corpus contains failed checks');
assert.equal(report.validation?.errorCount, 0, 'Corpus recorded runtime errors');
for (const check of report.checks) assert.equal(check.status, 'passed', `${check.name} is not passed`);
const byName = new Map(report.checks.map((check) => [check.name, check]));
assert.equal(byName.get('business-report-roundtrip')?.details?.inputSha256, '75cbfb28402a8a199484417f8463c7360bbb107b12ac3213d2791cb625a1ad6d');
assert.equal(byName.get('structure-report-roundtrip')?.details?.inputSha256, 'd0549d7ebca354e3c1e613c117b609d893f98241ba036a1c6358ecc835690311');
assert.equal(byName.get('independent-reader-contract')?.details?.reader, 'exceljs@4.4.0');
assert.equal(byName.get('unsupported-image-rejection')?.details?.rejected, true);
console.log(JSON.stringify({ status: 'passed', report: path.relative(process.cwd(), reportPath), artifactSha256: digest, checks: expectedChecks.length }, null, 2));

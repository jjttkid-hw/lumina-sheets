import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { siteDigest } from './site-evidence.mjs';
import { verifyValidationWorkspaceEvidence } from './validation-workspace-evidence.mjs';

assert(
  process.argv.length <= 3,
  'Usage: node scripts/check-validation-workspace-evidence.mjs [report-directory]',
);
const directory = process.argv[2] ?? 'artifacts/browser-validation-workspace';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = {
  version,
  siteSha256: (await siteDigest('dist')).sha256,
  artifactSha256: hash(await readFile(`artifacts/lumina-report-sdk-${version}.tgz`)),
  fixtureSha256: hash(
    await readFile('docs/acceptance/wps-business-2026-10-03-r34/wps-custom-title.xlsx'),
  ),
};
const reports = [];
for (const engine of ['chromium', 'firefox', 'webkit'])
  reports.push(
    await verifyValidationWorkspaceEvidence(path.join(directory, engine), { ...identity, engine }),
  );
console.log(JSON.stringify({ status: 'passed', directory, ...identity, reports }, null, 2));

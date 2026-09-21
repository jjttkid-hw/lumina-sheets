import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { requiresStableAcceptance, validateStableAcceptance, validateStableReproducibility } from './stable-release-policy.mjs';
import { siteDigest } from './site-evidence.mjs';

const siteMode = process.argv[2] === '--site';
assert(process.argv.length === 2 || (siteMode && process.argv.length === 3), 'Usage: node scripts/check-stable-release.mjs [--site]');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (!requiresStableAcceptance(version)) {
  console.log('Development/prerelease package: stable acceptance not claimed.');
} else {
  const artifact = path.resolve(`artifacts/lumina-report-sdk-${version}.tgz`);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const digest = hash(await readFile(artifact));
  const memberText = name => execFileSync('tar', ['-xOf', artifact, `package/${name}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const member = name => JSON.parse(memberText(name));
  const manifest = member('package.json');
  assert(manifest.name === 'lumina-report-sdk' && manifest.version === version, 'Packed manifest mismatch');
  const evidence = JSON.parse(await readFile('docs/acceptance/stable-release.json', 'utf8'));
  const records = validateStableAcceptance(evidence, version, digest, member('dependency-inventory.json'), memberText('THIRD_PARTY_NOTICES.txt'));
  if (siteMode) {
    const site = await siteDigest('dist');
    assert(evidence.siteSha256 === site.sha256, 'Acceptance belongs to a different site build (siteSha256)');
  }
  const root = await realpath('docs/acceptance');
  for (const record of records) {
    const report = await realpath(record.report);
    assert(report.startsWith(root + path.sep), 'Report escapes acceptance directory');
    const bytes = await readFile(report);
    assert(bytes.length > 0 && hash(bytes) === record.reportSha256, `Missing or changed evidence: ${record.report}`);
    if (record === evidence.gates.reproducibility)
      validateStableReproducibility(JSON.parse(bytes.toString('utf8')), evidence);
  }
  console.log(`Stable acceptance evidence verified for ${version}: ${digest}`);
}

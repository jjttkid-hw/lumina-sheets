import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { siteDigest } from './site-evidence.mjs';

const args = process.argv.slice(2);
const verifyBuild = args.includes('--verify-build');
const requireAccessibility = args.includes('--require-accessibility');
const requireIme = args.includes('--require-ime');
const requirePersistence = args.includes('--require-persistence');
const flags = new Set([
  '--verify-build',
  '--require-accessibility',
  '--require-ime',
  '--require-persistence',
]);
const directories = args.filter((arg) => !flags.has(arg));
assert(
  directories.length <= 1,
  'Usage: node scripts/check-browser-evidence.mjs [report-directory] [--verify-build] [--require-accessibility] [--require-ime] [--require-persistence]',
);
const root = path.resolve(directories[0] ?? 'docs/acceptance/browser-candidate-2026-09-23-r8');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const expected = [
  ...['chromium', 'firefox', 'webkit'].flatMap((engine) =>
    ['smoke', 'interactions', 'focus', 'layout', 'performance'].map((suite) => `${engine}/${suite}.json`),
  ),
  ...(requireAccessibility
    ? ['chromium', 'firefox', 'webkit'].map((engine) => `accessibility/${engine}.json`)
    : []),
  ...(requireIme ? ['chromium', 'firefox', 'webkit'].map((engine) => `ime/${engine}.json`) : []),
  ...(requirePersistence
    ? ['chromium', 'firefox', 'webkit'].map((engine) => `persistence/${engine}.json`)
    : []),
  'touch/result.json',
];
const expectedSet = new Set(expected);
const reports = [];
for (const relative of expected) {
  const report = await readJson(relative);
  assert.equal(report.schema, 1, `${relative}: schema must be 1`);
  assert.equal(report.status, 'passed', `${relative}: report is not passed`);
  assert.match(report.siteSha256, /^[a-f0-9]{64}$/, `${relative}: invalid site hash`);
  assert.match(report.artifactSha256, /^[a-f0-9]{64}$/, `${relative}: invalid artifact hash`);
  assert(Array.isArray(report.checks) && report.checks.length > 0, `${relative}: missing checks`);
  assert.equal(report.validation?.pageErrorCount, 0, `${relative}: page errors recorded`);
  assert.equal(report.validation?.consoleErrorCount, 0, `${relative}: console errors recorded`);
  assert.equal(report.validation?.runErrorCount, 0, `${relative}: run errors recorded`);
  assert.deepEqual(report.validation?.missingChecks, [], `${relative}: missing checks`);
  assert.deepEqual(report.validation?.unexpectedChecks, [], `${relative}: unexpected checks`);
  assert.deepEqual(report.validation?.duplicateChecks, [], `${relative}: duplicate checks`);
  assert.deepEqual(report.validation?.failedChecks, [], `${relative}: failed checks`);
  reports.push({ relative, report });
}
const siteHashes = new Set(reports.map(({ report }) => report.siteSha256));
const artifactHashes = new Set(reports.map(({ report }) => report.artifactSha256));
assert.equal(siteHashes.size, 1, 'Reports are bound to different site builds');
assert.equal(artifactHashes.size, 1, 'Reports are bound to different SDK archives');

const manifest = await readJson('sha256-manifest.json');
assert.equal(manifest.schema, 1, 'Manifest schema must be 1');
assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'Manifest is empty');
const listed = new Set();
for (const entry of manifest.files) {
  assert.equal(typeof entry.path, 'string', 'Manifest entry path is invalid');
  assert(!path.isAbsolute(entry.path) && !entry.path.includes('..'), `Manifest escapes root: ${entry.path}`);
  assert(!listed.has(entry.path), `Manifest repeats ${entry.path}`);
  listed.add(entry.path);
  const bytes = await readFile(path.join(root, entry.path));
  assert.equal(entry.bytes, bytes.length, `Manifest byte count mismatch: ${entry.path}`);
  assert.equal(entry.sha256, hash(bytes), `Manifest hash mismatch: ${entry.path}`);
}
assert(!listed.has('sha256-manifest.json'), 'Manifest must not hash itself');
const files = [];
async function walk(relative = '') {
  const directory = path.join(root, relative);
  for (const name of await readdir(directory)) {
    const child = relative ? `${relative}/${name}` : name;
    if (child === 'sha256-manifest.json') continue;
    const info = await stat(path.join(root, child));
    if (info.isDirectory()) await walk(child);
    else files.push(child);
  }
}
await walk();
files.sort();
assert.deepEqual([...listed].sort(), files, 'Manifest does not cover exactly the report files');
assert.deepEqual([...new Set(reports.map(({ relative }) => relative))].sort(), expectedSet.size ? expected.sort() : []);
let build;
if (verifyBuild) {
  const packageManifest = JSON.parse(await readFile('package.json', 'utf8'));
  const site = await siteDigest('dist');
  assert.equal(site.sha256, [...siteHashes][0], 'Built site differs from accepted browser evidence');
  const artifactPath = path.join('artifacts', `lumina-report-sdk-${packageManifest.version}.tgz`);
  const artifact = await readFile(artifactPath);
  assert.equal(
    hash(artifact),
    [...artifactHashes][0],
    'Built SDK archive differs from accepted browser evidence',
  );
  build = { siteSha256: site.sha256, artifactSha256: hash(artifact), artifact: artifactPath };
}
console.log(
  JSON.stringify(
    {
      status: 'passed',
      directory: path.relative(process.cwd(), root),
      reports: reports.length,
      siteSha256: [...siteHashes][0],
      artifactSha256: [...artifactHashes][0],
      manifestFiles: manifest.files.length,
      ...(build ? { build } : {}),
    },
    null,
    2,
  ),
);

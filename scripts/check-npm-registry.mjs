import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const packageName = process.env.NPM_PACKAGE ?? 'lumina-report-sdk';
const version = process.env.NPM_VERSION;
assert.match(packageName, /^[@a-z0-9][\w.-]*(?:\/[a-z0-9][\w.-]*)?$/, 'Invalid NPM_PACKAGE');
assert(
  version && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version),
  'Set NPM_VERSION to a SemVer',
);
const registry = process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org';
const expectedArchive = process.env.NPM_EXPECTED_ARCHIVE;
const request = async (url) => {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Registry request failed ${response.status}: ${url}`);
  return response.json();
};
const metadata = await request(
  `${registry.replace(/\/$/, '')}/${encodeURIComponent(packageName).replace('%2F', '/')}`,
);
const entry = metadata.versions?.[version];
assert(entry, `${packageName}@${version} is missing from the registry`);
assert.equal(entry.name, packageName);
assert.equal(entry.version, version);
const dist = metadata.dist?.[version];
assert(dist?.tarball, 'Registry metadata has no tarball URL');
const response = await fetch(dist.tarball);
assert(response.ok, `Tarball request failed ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (expectedArchive) {
  const expected = await readFile(expectedArchive);
  assert.equal(
    sha256,
    createHash('sha256').update(expected).digest('hex'),
    'Registry tarball differs from the release artifact uploaded by this workflow',
  );
}
if (dist.shasum)
  assert.equal(
    createHash('sha1').update(bytes).digest('hex'),
    dist.shasum,
    'Registry tarball shasum mismatch',
  );
if (dist.integrity) {
  const expected = dist.integrity.replace(/^sha512-/, '');
  const actual = createHash('sha512').update(bytes).digest('base64');
  assert.equal(actual, expected, 'Registry tarball integrity mismatch');
}
const dir = await mkdtemp(path.join(os.tmpdir(), 'lumina-registry-'));
try {
  const archive = path.join(dir, `${packageName.replace(/[\\/]/g, '-')}-${version}.tgz`);
  await writeFile(archive, bytes);
  execFileSync('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore' });
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], {
    cwd: dir,
    stdio: 'inherit',
  });
  const installed = JSON.parse(
    await readFile(
      path.join(dir, 'node_modules', ...packageName.split('/'), 'package.json'),
      'utf8',
    ),
  );
  assert.equal(installed.version, version);
  console.log(
    JSON.stringify({
      status: 'passed',
      package: packageName,
      version,
      tarballBytes: bytes.length,
      sha256,
      integrity: dist.integrity ?? null,
    }),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

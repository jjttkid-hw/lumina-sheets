import assert from 'node:assert/strict';
import { registryVersion, verifyRegistryBytes } from './registry-artifact.mjs';
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
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Registry request failed ${response.status}: ${url}`);
  return response.json();
};
const metadata = await request(
  `${registry.replace(/\/$/, '')}/${encodeURIComponent(packageName).replace('%2F', '/')}`,
);
const dist = registryVersion(metadata, packageName, version, process.env.NPM_DIST_TAG);
const response = await fetch(dist.tarball, { signal: AbortSignal.timeout(30_000) });
assert(response.ok, `Tarball request failed ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const sha256 = verifyRegistryBytes(
  bytes,
  dist,
  expectedArchive ? await readFile(expectedArchive) : undefined,
);
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
  assert.equal(installed.name, packageName);
  assert.equal(installed.version, version);
  await writeFile(
    path.join(dir, 'consumer.mjs'),
    `const sdk = await import(${JSON.stringify(packageName)}); if (!Object.keys(sdk).length) throw new Error('Empty package exports');`,
  );
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: dir, timeout: 30_000, stdio: 'pipe' });
  console.log(
    JSON.stringify({
      status: 'passed',
      package: packageName,
      version,
      tarballBytes: bytes.length,
      sha256,
      integrity: dist.integrity,
      releaseArtifactMatched: !!expectedArchive,
      distTag: process.env.NPM_DIST_TAG ?? null,
      esmImport: 'passed',
      provenance: 'not-verified-by-this-check',
    }),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

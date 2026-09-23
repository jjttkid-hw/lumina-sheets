import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
// @ts-expect-error release tooling is plain ESM
import { registryVersion, verifyRegistryBytes } from '../scripts/registry-artifact.mjs';
const run = promisify(execFile);
const bytes = Buffer.from('verified package');
const digest = (bytes: Buffer) => ({
  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  shasum: createHash('sha1').update(bytes).digest('hex'),
});
const dist = {
  tarball: 'https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz',
  ...digest(bytes),
};
const metadata = () => ({
  versions: { '1.0.0': { name: 'fixture', version: '1.0.0', dist } },
  'dist-tags': { next: '1.0.0' },
});
it('reads dist from the requested version and checks its tag', () => {
  expect(registryVersion(metadata(), 'fixture', '1.0.0', 'next')).toEqual(dist);
  expect(() => registryVersion(metadata(), 'fixture', '2.0.0')).toThrow('missing');
  expect(() => registryVersion(metadata(), 'wrong', '1.0.0')).toThrow('name mismatch');
  expect(() => registryVersion(metadata(), 'fixture', '1.0.0', 'latest')).toThrow('tag mismatch');
});
it('rejects top-level dist, absent integrity and mismatched version', () => {
  for (const bad of [undefined, { tarball: dist.tarball }]) {
    const m = metadata();
    m.versions['1.0.0'].dist = bad as typeof dist;
    expect(() => registryVersion({ ...m, dist: { '1.0.0': dist } }, 'fixture', '1.0.0')).toThrow();
  }
  const m = metadata();
  m.versions['1.0.0'].version = '2.0.0';
  expect(() => registryVersion(m, 'fixture', '1.0.0')).toThrow('version mismatch');
});
it('requires both registry integrity and expected release bytes to agree', () => {
  expect(verifyRegistryBytes(bytes, dist, bytes)).toBe(
    createHash('sha256').update(bytes).digest('hex'),
  );
  expect(() => verifyRegistryBytes(Buffer.from('tampered'), dist, bytes)).toThrow(
    'integrity mismatch',
  );
  expect(() => verifyRegistryBytes(bytes, dist, Buffer.from('other release'))).toThrow(
    'release artifact',
  );
  expect(() => verifyRegistryBytes(bytes, { ...dist, shasum: 'bad' }, bytes)).toThrow(
    'shasum mismatch',
  );
});
it('downloads a version from a local registry fixture, installs and imports it; rejects tampering and 404', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lumina-registry-test-'));
  const script = path.resolve('scripts/check-npm-registry.mjs');
  let notFound = false;
  let body: Buffer;
  let entry: object;
  const server = createServer((req, res) => {
    if (notFound) {
      res.writeHead(404).end();
      return;
    }
    if (req.url === '/fixture.tgz') {
      res.end(body);
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(entry));
  });
  try {
    await mkdir(path.join(dir, 'package'));
    await writeFile(
      path.join(dir, 'package/package.json'),
      JSON.stringify({
        name: 'registry-fixture',
        version: '1.0.0',
        type: 'module',
        exports: './index.js',
      }),
    );
    await writeFile(path.join(dir, 'package/index.js'), 'export const ready = true;');
    const archive = path.join(dir, 'fixture.tgz');
    await run('tar', ['-czf', archive, '-C', dir, 'package']);
    body = await readFile(archive);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    entry = {
      versions: {
        '1.0.0': {
          name: 'registry-fixture',
          version: '1.0.0',
          dist: { tarball: `${origin}/fixture.tgz`, ...digest(body) },
        },
      },
      'dist-tags': { next: '1.0.0' },
    };
    const env = {
      ...process.env,
      NPM_REGISTRY: origin,
      NPM_PACKAGE: 'registry-fixture',
      NPM_VERSION: '1.0.0',
      NPM_EXPECTED_ARCHIVE: archive,
      NPM_DIST_TAG: 'next',
    };
    const result = await run(process.execPath, [script], { env, timeout: 30_000 });
    expect(result.stdout).toContain('"esmImport":"passed"');
    expect(result.stdout).toContain('"releaseArtifactMatched":true');
    body = Buffer.from('tampered');
    await expect(run(process.execPath, [script], { env, timeout: 10_000 })).rejects.toMatchObject({
      stderr: expect.stringContaining('integrity mismatch'),
    });
    notFound = true;
    await expect(run(process.execPath, [script], { env, timeout: 10_000 })).rejects.toMatchObject({
      stderr: expect.stringContaining('404'),
    });
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await rm(dir, { recursive: true, force: true });
  }
}, 45_000);

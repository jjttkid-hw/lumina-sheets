import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  productBuildIdentity as collectIdentity,
  productBuildPlugin,
  // @ts-expect-error Build-only ESM helper.
} from '../scripts/product-build.mjs';
import { productBuildIdentity } from '../src/lib/product-build';
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lumina-build-identity-'));
  roots.push(root);
  for (const directory of ['src', 'examples', 'scripts', 'docs'])
    await mkdir(path.join(root, directory));
  for (const file of [
    'package-lock.json',
    'index.html',
    'vite.config.ts',
    'vite.sdk.config.ts',
    'tsconfig.json',
    'tsconfig.sdk.json',
    'src/main.ts',
    'scripts/build.mjs',
  ])
    await writeFile(path.join(root, file), 'fixture');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.29.0' }));
  vi.stubEnv('SOURCE_DATE_EPOCH', '123');
  return root;
}
it('records reproducible source identity independently of absolute root and evidence-only changes', async () => {
  const root = await fixture();
  const first = await collectIdentity(root);
  const other = await fixture();
  expect(await collectIdentity(other)).toEqual(first);
  await writeFile(path.join(root, 'docs/report.md'), 'new acceptance evidence');
  expect(await collectIdentity(root)).toEqual(first);
  expect(first).toMatchObject({
    schema: 1,
    version: '0.29.0',
    mode: 'production',
    sourceTimestamp: '1970-01-01T00:02:03.000Z',
  });
  expect(first.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(first)).not.toContain(root);
});
it.each(['src/main.ts', 'package-lock.json', 'vite.config.ts', 'scripts/build.mjs'])(
  'changes identity when input %s changes',
  async (file) => {
    const root = await fixture();
    const before = await collectIdentity(root);
    await writeFile(path.join(root, file), 'changed');
    expect((await collectIdentity(root)).sourceSha256).not.toBe(before.sourceSha256);
  },
);
it('includes optional public assets and rejects symlinks instead of reading outside inputs', async () => {
  const root = await fixture();
  const before = await collectIdentity(root);
  await mkdir(path.join(root, 'public'));
  await writeFile(path.join(root, 'public/asset.txt'), 'asset');
  expect((await collectIdentity(root)).sourceSha256).not.toBe(before.sourceSha256);
  await symlink(path.join(root, 'package.json'), path.join(root, 'src/linked'));
  await expect(collectIdentity(root)).rejects.toThrow('symlinks');
});
it('injects development identity and returns an isolated runtime copy', async () => {
  const root = await fixture();
  const config = await productBuildPlugin().config({ root }, { command: 'serve' });
  const identity = JSON.parse(config.define.__LUMINA_BUILD__);
  expect(identity.mode).toBe('development');
  expect(productBuildIdentity()).toMatchObject({ version: '0.29.0', mode: 'development' });
  const copy = productBuildIdentity()!;
  copy.version = 'modified';
  expect(productBuildIdentity()!.version).toBe('0.29.0');
});

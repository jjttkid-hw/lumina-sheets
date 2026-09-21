import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
// @ts-expect-error build tooling is not part of the SDK public declaration graph
import { collectBundleEvidence } from '../scripts/bundle-evidence.mjs';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lumina-inputs-'));
  roots.push(root);
  await mkdir(path.join(root, 'node_modules/vendor/dist'), { recursive: true });
  await mkdir(path.join(root, 'src'));
  await writeFile(
    path.join(root, 'package-lock.json'),
    JSON.stringify({
      packages: { 'node_modules/vendor': { version: '1.2.3', integrity: 'sha512-fixture' } },
    }),
  );
  await writeFile(
    path.join(root, 'node_modules/vendor/package.json'),
    JSON.stringify({ name: 'vendor', version: '1.2.3' }),
  );
  await writeFile(
    path.join(root, 'node_modules/vendor/dist/bundle.js'),
    '/* unknown embedded components */',
  );
  await writeFile(path.join(root, 'src/main.ts'), 'export const value = 1');
  const chunk = {
    type: 'chunk',
    fileName: 'main.js',
    code: 'const value=1;',
    modules: {
      [path.join(root, 'src/main.ts')]: { renderedLength: 14 },
      [path.join(root, 'node_modules/vendor/dist/bundle.js')]: { renderedLength: 8 },
      '\0commonjsHelpers.js': { renderedLength: 42 },
    },
  };
  return { root, chunk };
}
describe('SDK actual bundle evidence', () => {
  it('records real input hashes and locked package identity without claiming embedded versions', async () => {
    const { root, chunk } = await fixture();
    const result = await collectBundleEvidence(root, { main: chunk });
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({
      path: 'node_modules/vendor/dist/bundle.js',
      dependency: { name: 'vendor', version: '1.2.3', integrity: 'sha512-fixture' },
    });
    expect(result.sources[1].dependency).toBeNull();
    expect(result.chunks[0].sha256).toBe(createHash('sha256').update(chunk.code).digest('hex'));
    expect(JSON.stringify(result)).not.toContain(root);
    expect(result.scope).toContain('Prebundled internal components remain unresolved');
    const reordered = {
      ...chunk,
      modules: Object.fromEntries(Object.entries(chunk.modules).reverse()),
    };
    expect(await collectBundleEvidence(root, { main: reordered })).toEqual(result);
  });
  it('fails rather than emitting evidence for a package different from its lock', async () => {
    const { root, chunk } = await fixture();
    await writeFile(
      path.join(root, 'node_modules/vendor/package.json'),
      JSON.stringify({ name: 'vendor', version: '9.0.0' }),
    );
    await expect(collectBundleEvidence(root, { main: chunk })).rejects.toThrow('version mismatch');
  });
  it('rejects outside input paths, missing inputs and empty output', async () => {
    const { root, chunk } = await fixture();
    await expect(
      collectBundleEvidence(root, {
        main: { ...chunk, modules: { [path.join(root, '..', 'secret')]: { renderedLength: 1 } } },
      }),
    ).rejects.toThrow('escapes');
    await expect(
      collectBundleEvidence(root, {
        main: { ...chunk, modules: { [path.join(root, 'missing.ts')]: { renderedLength: 1 } } },
      }),
    ).rejects.toThrow();
    await expect(collectBundleEvidence(root, {})).rejects.toThrow('No SDK');
  });
});

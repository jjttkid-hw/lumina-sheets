import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error Build-only ESM helper.
import { supplementalNotices } from '../scripts/supplemental-notices.mjs';
const dependency = {
  name: 'saxes',
  version: '5.0.1',
  integrity:
    'sha512-5LBh1Tls8c9xgGjw3QrMwETmTMVk0oFgvrFSvWx62llR2hcEInrKNZ2GZCCuuy2lvWrdl5jhbpeqc5hRYKFOcw==',
};
const downstreamDependency = {
  name: 'buffers',
  version: '0.1.1',
  integrity:
    'sha512-9q/rDEGSb/Qsvv2qvzIzdluL5k7AaJOTrw23z9reQthrbF7is4CtlT0DXyO1oei2DCp4uojjzQ7igaSHp1kAEQ==',
};
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lumina-license-'));
  roots.push(root);
  const directory = path.join(root, 'docs/third-party/saxes-5.0.1');
  await mkdir(directory, { recursive: true });
  await cp('docs/third-party/saxes-5.0.1', directory, { recursive: true });
  return { root, directory };
}
it('loads the actual pinned upstream grant for only the matching locked version', async () => {
  const [item] = await supplementalNotices(process.cwd(), dependency);
  expect(item.notice.kind).toBe('upstream-license-text');
  expect(item.text).toContain('The ISC License');
  expect(item.notice.bytes).toBe(Buffer.byteLength(item.text));
  expect(await supplementalNotices(process.cwd(), { ...dependency, version: '5.0.2' })).toEqual([]);
  await expect(
    supplementalNotices(process.cwd(), { ...dependency, integrity: 'different' }),
  ).rejects.toThrow('integrity');
});

it('loads downstream copyright evidence with an explicit provenance type', async () => {
  const [item] = await supplementalNotices(process.cwd(), downstreamDependency);
  expect(item.notice.kind).toBe('downstream-copyright-evidence');
  expect(item.notice.path).toBe('@downstream/debian-copyright');
  expect(item.text).toContain('License: Expat');
  expect(item.notice.provenance.downstream.distribution).toBe('Debian');
  expect(item.notice.provenance.comparison.allExact).toBe(true);
});
it.each(['name', 'version', 'commit', 'sha256', 'integrity', 'source'])(
  'rejects changed provenance %s',
  async (field) => {
    const { root, directory } = await fixture();
    const p = path.join(directory, 'provenance.json');
    const value = JSON.parse(await readFile(p, 'utf8'));
    value[field] = 'changed';
    await writeFile(p, JSON.stringify(value));
    await expect(supplementalNotices(root, dependency)).rejects.toThrow();
  },
);
it('rejects edited license bytes', async () => {
  const { root, directory } = await fixture();
  await writeFile(path.join(directory, 'LICENSE'), 'ISC');
  await expect(supplementalNotices(root, dependency)).rejects.toThrow('text changed');
});
it('rejects supplemental material symlinked outside the project', async () => {
  const { root, directory } = await fixture();
  await rm(path.join(directory, 'LICENSE'));
  await symlink(
    path.resolve('docs/third-party/saxes-5.0.1/LICENSE'),
    path.join(directory, 'LICENSE'),
  );
  await expect(supplementalNotices(root, dependency)).rejects.toThrow('escapes');
});

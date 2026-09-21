import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error Node-only build tooling
import { siteDigest } from '../scripts/site-evidence.mjs';
const folders: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'lumina-site-'));
  folders.push(root);
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'index.html'), '<script src="assets/app.js"></script>');
  writeFileSync(path.join(root, 'assets/app.js'), 'initial');
  return root;
}
afterEach(() =>
  folders.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })),
);
describe('deployed site content evidence', () => {
  it('binds filenames and bytes while excluding only the trace metadata', async () => {
    const root = fixture();
    const before = await siteDigest(root);
    expect(await siteDigest(root)).toEqual(before);
    writeFileSync(path.join(root, 'build-info.json'), '{"commit":"evidence-only"}');
    expect(await siteDigest(root)).toEqual(before);
    writeFileSync(path.join(root, 'assets/app.js'), 'changed');
    expect((await siteDigest(root)).sha256).not.toBe(before.sha256);
    writeFileSync(path.join(root, 'assets/app.js'), 'initial');
    renameSync(path.join(root, 'assets/app.js'), path.join(root, 'assets/renamed.js'));
    expect((await siteDigest(root)).sha256).not.toBe(before.sha256);
  });
  it('includes new SDK, worker and hidden files, and detects removals', async () => {
    const root = fixture();
    let before = await siteDigest(root);
    for (const name of ['sdk/example.html', 'assets/worker.js', '.config']) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), 'new');
      const next = await siteDigest(root);
      expect(next.sha256).not.toBe(before.sha256);
      before = next;
    }
    rmSync(path.join(root, '.config'));
    expect((await siteDigest(root)).sha256).not.toBe(before.sha256);
  });
  it('rejects missing entrypoints and symbolic links including the excluded metadata', async () => {
    const root = fixture();
    for (const name of ['build-info.json', 'assets/link']) {
      symlinkSync(path.join(root, 'index.html'), path.join(root, name));
      await expect(siteDigest(root)).rejects.toThrow('symlinks');
      rmSync(path.join(root, name));
    }
    rmSync(path.join(root, 'index.html'));
    await expect(siteDigest(root)).rejects.toThrow('index.html');
  });
});

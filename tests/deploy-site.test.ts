import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-expect-error Node release tooling has no public declarations
import { siteDigest } from '../scripts/site-evidence.mjs';
const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })),
);
describe('downloaded deployment artifact verification', () => {
  it('requires tested commit, version, and actual file bytes before deployment', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lumina-deploy-'));
    temporary.push(root);
    const site = path.join(root, 'site');
    mkdirSync(site);
    const write = (name: string, value: string) => writeFileSync(path.join(root, name), value);
    write('package.json', JSON.stringify({ version: '1.0.0' }));
    write('site/index.html', '<h1>accepted</h1>');
    const commit = 'a'.repeat(40);
    const info = { commit, version: '1.0.0', siteSha256: (await siteDigest(site)).sha256 };
    const metadata = (extra = {}) =>
      write('site/build-info.json', JSON.stringify({ ...info, ...extra }));
    const run = (sha = commit) =>
      spawnSync(process.execPath, [path.resolve('scripts/check-deploy-site.mjs'), site, sha], {
        cwd: root,
        encoding: 'utf8',
      });
    expect(run().status).not.toBe(0);
    metadata();
    expect(run().status).toBe(0);
    expect(run('bad').stderr).toContain('Invalid tested commit');
    metadata({ commit: 'b'.repeat(40) });
    expect(run().stderr).toContain('different commit');
    metadata({ version: '0.9.0' });
    expect(run().stderr).toContain('version');
    metadata();
    write('site/index.html', '<h1>changed</h1>');
    expect(run().stderr).toContain('files differ');
    write('site/index.html', '<h1>accepted</h1>');
    write('site/extra.js', 'unverified');
    expect(run().stderr).toContain('files differ');
    rmSync(path.join(site, 'extra.js'));
    symlinkSync(path.join(root, 'package.json'), path.join(site, 'linked.json'));
    expect(run().stderr).toContain('symlinks');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error Node build tooling has no SDK declaration
import { siteDigest } from '../scripts/site-evidence.mjs';

const script = path.resolve('scripts/build-info.mjs');
const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);
function fixture() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'lumina-build-info-'));
  directories.push(cwd);
  mkdirSync(path.join(cwd, 'dist'));
  writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ version: '1.0.0-rc.1' }));
  writeFileSync(path.join(cwd, 'dist/index.html'), '<html>candidate</html>');
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('add', 'package.json');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'candidate',
  );
  return { cwd, commit: git('rev-parse', 'HEAD') };
}
function run(cwd: string, trigger = 'f'.repeat(40)) {
  return spawnSync(process.execPath, [script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_SHA: trigger },
  });
}
describe('deployed build identity', () => {
  it('records the checked-out commit rather than a different workflow trigger', async () => {
    const { cwd, commit } = fixture();
    expect(run(cwd).status).toBe(0);
    const info = JSON.parse(readFileSync(path.join(cwd, 'dist/build-info.json'), 'utf8'));
    expect(info.commit).toBe(commit);
    expect(info.version).toBe('1.0.0-rc.1');
    expect(info.siteSha256).toBe((await siteDigest(path.join(cwd, 'dist'))).sha256);
  });
  it('updates the content digest when deployed bytes change and is repeatable otherwise', () => {
    const { cwd } = fixture();
    const read = () => readFileSync(path.join(cwd, 'dist/build-info.json'), 'utf8');
    expect(run(cwd).status).toBe(0);
    const first = read();
    expect(run(cwd, 'e'.repeat(40)).status).toBe(0);
    expect(read()).toBe(first);
    writeFileSync(path.join(cwd, 'dist/index.html'), '<html>changed</html>');
    expect(run(cwd).status).toBe(0);
    expect(JSON.parse(read()).siteSha256).not.toBe(JSON.parse(first).siteSha256);
  });
  it('fails without a checked-out commit instead of inventing one from the environment', () => {
    const { cwd } = fixture();
    rmSync(path.join(cwd, '.git'), { recursive: true });
    expect(run(cwd).status).not.toBe(0);
  });
});

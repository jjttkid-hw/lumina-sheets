import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// Node release tooling is plain ESM and ships outside the browser SDK.
// @ts-expect-error release tooling has no public TypeScript declaration
import { releasePolicy } from '../scripts/release-policy.mjs';

describe('npm release routing', () => {
  it.each(['1.0.0', '1.2.3+build.5'])(
    'routes stable %s to latest with one exact artifact',
    (version) => {
      expect(releasePolicy(version, `v${version}`, false)).toEqual({
        version,
        tag: `v${version}`,
        distTag: 'latest',
        artifact: `artifacts/lumina-report-sdk-${version}.tgz`,
      });
    },
  );
  it('keeps both GitHub classifications of unsuffixed 0.x releases on next', () => {
    expect(releasePolicy('0.29.0', 'v0.29.0', true).distTag).toBe('next');
    expect(releasePolicy('0.29.0', 'v0.29.0', false).distTag).toBe('next');
    expect(releasePolicy('0.29.0', 'v0.29.0').distTag).toBe('next');
  });
  it.each(['1.0.0-rc.1', '1.0.0-alpha', '1.0.0-0', '1.0.0-beta.2+build'])(
    'routes prerelease %s to next for release and manual dispatch',
    (version) => {
      expect(releasePolicy(version, `v${version}`, true).distTag).toBe('next');
      expect(releasePolicy(version, `v${version}`).distTag).toBe('next');
    },
  );
  it.each([
    '01.0.0',
    '1.0',
    '1.0.0-01',
    '1.0.0-rc..1',
    '1.0.0\nartifact=evil',
    '1.0.0\n',
    '../1.0.0',
    '1.0.0;echo',
    '',
    null,
  ])('rejects invalid version %s', (version) => {
    expect(() => releasePolicy(version, `v${version}`)).toThrow();
  });
  it('rejects tag mismatch and GitHub flags that mislabel a release', () => {
    expect(() => releasePolicy('1.0.0', 'v0.23.0')).toThrow('Release tag');
    expect(() => releasePolicy('1.0.0-rc.1', 'v1.0.0-rc.1', false)).toThrow('prerelease flag');
    expect(() => releasePolicy('0.29.0-rc.1', 'v0.29.0-rc.1', false)).toThrow('prerelease flag');
    expect(() => releasePolicy('1.0.0', 'v1.0.0', true)).toThrow('prerelease flag');
    expect(() => releasePolicy('1.0.0', 'v1.0.0', 'false')).toThrow('boolean');
  });
});

// Exercise the actual Actions entry point with the current GitHub release shape.
it('accepts a GitHub 0.x prerelease event and emits exact next-channel outputs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumina-release-event-'));
  try {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.29.0' }));
    const event = path.join(root, 'event.json');
    const output = path.join(root, 'output');
    writeFileSync(event, JSON.stringify({ release: { prerelease: true } }));
    const run = spawnSync(process.execPath, [path.resolve('scripts/check-release.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'release',
        GITHUB_EVENT_PATH: event,
        GITHUB_OUTPUT: output,
        RELEASE_TAG: 'v0.29.0',
      },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(
      'dist-tag=next\nartifact=artifacts/lumina-report-sdk-0.29.0.tgz\nversion=0.29.0\n',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

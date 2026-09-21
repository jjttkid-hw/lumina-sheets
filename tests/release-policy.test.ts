import { describe, expect, it } from 'vitest';
// Node release tooling is plain ESM and ships outside the browser SDK.
// @ts-expect-error release tooling has no public TypeScript declaration
import { releasePolicy } from '../scripts/release-policy.mjs';

describe('npm release routing', () => {
  it.each(['0.23.0', '1.0.0', '1.2.3+build.5'])(
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
    expect(() => releasePolicy('1.0.0', 'v1.0.0', true)).toThrow('prerelease flag');
    expect(() => releasePolicy('1.0.0', 'v1.0.0', 'false')).toThrow('boolean');
  });
});

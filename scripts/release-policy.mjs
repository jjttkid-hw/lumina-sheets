/** Pure release decisions, shared by local verification and GitHub Actions. */
export function releasePolicy(version, tag, prerelease) {
  const numeric = '(?:0|[1-9][0-9]*)';
  const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
  const pattern = new RegExp(
    `^(${numeric})\\.(${numeric})\\.(${numeric})(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
  );
  const match = typeof version === 'string' ? pattern.exec(version) : null;
  if (!match || match[0] !== version) throw new Error('Package version must be valid SemVer');
  if (tag !== `v${version}`) throw new Error(`Release tag must be v${version}, received ${tag}`);
  if (prerelease !== undefined && typeof prerelease !== 'boolean')
    throw new Error('Release prerelease flag must be boolean');
  const candidate = !!match[4];
  if (prerelease !== undefined && prerelease !== candidate)
    throw new Error('GitHub prerelease flag must match the SemVer prerelease suffix');
  return {
    version,
    tag,
    distTag: candidate ? 'next' : 'latest',
    artifact: `artifacts/lumina-report-sdk-${version}.tgz`,
  };
}

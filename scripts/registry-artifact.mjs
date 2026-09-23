import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function registryVersion(metadata, name, version, tag) {
  const entry = metadata?.versions?.[version];
  assert(entry, `${name}@${version} is missing from the registry`);
  assert.equal(entry.name, name, 'Registry package name mismatch');
  assert.equal(entry.version, version, 'Registry package version mismatch');
  if (tag) assert.equal(metadata['dist-tags']?.[tag], version, `Registry ${tag} tag mismatch`);
  assert(entry.dist?.tarball, 'Registry version has no tarball URL');
  assert.match(
    entry.dist.integrity ?? '',
    /^sha512-[A-Za-z0-9+/]{86}==$/,
    'Missing SHA-512 registry integrity',
  );
  return entry.dist;
}

export function verifyRegistryBytes(bytes, dist, expected) {
  const hash = (algorithm, encoding = 'hex') =>
    createHash(algorithm).update(bytes).digest(encoding);
  assert.equal(
    `sha512-${hash('sha512', 'base64')}`,
    dist.integrity,
    'Registry tarball integrity mismatch',
  );
  if (dist.shasum) assert.equal(hash('sha1'), dist.shasum, 'Registry tarball shasum mismatch');
  const sha256 = hash('sha256');
  if (expected)
    assert.equal(
      sha256,
      createHash('sha256').update(expected).digest('hex'),
      'Registry tarball differs from the release artifact',
    );
  return sha256;
}

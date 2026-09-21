import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hasLicenseText } from './license-evidence.mjs';

// Explicitly reviewed upstream source locations. Never borrow a license from a
// different version or silently substitute a generic license template.
const sources = {
  'saxes@5.0.1': {
    directory: 'docs/third-party/saxes-5.0.1',
    commit: '6ef6a275b20f19cb67808daf0d8f64e06aaf5b0e',
    sha256: '0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e',
    integrity:
      'sha512-5LBh1Tls8c9xgGjw3QrMwETmTMVk0oFgvrFSvWx62llR2hcEInrKNZ2GZCCuuy2lvWrdl5jhbpeqc5hRYKFOcw==',
    source:
      'https://raw.githubusercontent.com/lddubeau/saxes/6ef6a275b20f19cb67808daf0d8f64e06aaf5b0e/LICENSE',
  },
};

export async function supplementalNotices(root, dependency) {
  const source = sources[`${dependency.name}@${dependency.version}`];
  if (!source) return [];
  assert.equal(
    dependency.integrity,
    source.integrity,
    'Supplemental license package integrity mismatch',
  );
  const project = await realpath(root);
  async function read(relative) {
    const filename = await realpath(path.join(project, source.directory, relative));
    assert(filename.startsWith(project + path.sep), 'Supplemental notice escapes repository');
    return readFile(filename, 'utf8');
  }
  const provenance = JSON.parse(await read('provenance.json'));
  assert.equal(provenance.name, dependency.name, 'Supplemental license name mismatch');
  assert.equal(provenance.version, dependency.version, 'Supplemental license version mismatch');
  for (const key of ['commit', 'sha256', 'integrity', 'source'])
    assert.equal(provenance[key], source[key], `Supplemental license ${key} mismatch`);
  const text = await read('LICENSE');
  assert.equal(
    createHash('sha256').update(text).digest('hex'),
    source.sha256,
    'Supplemental license text changed',
  );
  assert(hasLicenseText(text), 'Supplemental license is missing grant/disclaimer');
  return [
    {
      text,
      notice: {
        path: '@upstream/LICENSE',
        kind: 'upstream-license-text',
        hasLicenseText: true,
        sha256: source.sha256,
        bytes: Buffer.byteLength(text),
        provenance,
      },
    },
  ];
}

import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hasLicenseText } from './license-evidence.mjs';

// Explicitly reviewed license evidence locations. Upstream text is preferred;
// downstream copyright records are accepted only when their provenance and the
// exact npm package bytes are recorded separately.
const sources = {
  'saxes@5.0.1': {
    directory: 'docs/third-party/saxes-5.0.1',
    noticeFile: 'LICENSE',
    noticePath: '@upstream/LICENSE',
    noticeKind: 'upstream-license-text',
    license: 'ISC',
    commit: '6ef6a275b20f19cb67808daf0d8f64e06aaf5b0e',
    sha256: '0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e',
    integrity:
      'sha512-5LBh1Tls8c9xgGjw3QrMwETmTMVk0oFgvrFSvWx62llR2hcEInrKNZ2GZCCuuy2lvWrdl5jhbpeqc5hRYKFOcw==',
    source:
      'https://raw.githubusercontent.com/lddubeau/saxes/6ef6a275b20f19cb67808daf0d8f64e06aaf5b0e/LICENSE',
  },
  'buffers@0.1.1': {
    directory: 'docs/third-party/downstream/buffers-0.1.1',
    noticeFile: 'COPYRIGHT-EVIDENCE',
    noticePath: '@downstream/debian-copyright',
    noticeKind: 'downstream-copyright-evidence',
    license: 'MIT',
    sha256: '7ed63688e5bc3c442bcebf756f04a4be5337a51ec8d4b51804349977a9667f0a',
    integrity:
      'sha512-9q/rDEGSb/Qsvv2qvzIzdluL5k7AaJOTrw23z9reQthrbF7is4CtlT0DXyO1oei2DCp4uojjzQ7igaSHp1kAEQ==',
    source:
      'https://sources.debian.org/data/main/n/node-buffers/0.1.1-5/debian/copyright',
  },
  'chainsaw@0.1.0': {
    directory: 'docs/third-party/downstream/chainsaw-0.1.0',
    noticeFile: 'COPYRIGHT-EVIDENCE',
    noticePath: '@downstream/debian-copyright',
    noticeKind: 'downstream-copyright-evidence',
    license: 'MIT',
    sha256: 'bd34bc03a00662f25c448882c33a467aec2834cb2abe3be410822af63fb5f803',
    integrity:
      'sha512-75kWfWt6MEKNC8xYXIdRpDehRYY/tNSgwKaJq+dbbDcxORuVrrQ+SEHoWsniVn9XPYfP4gmdWIeDk/4YNp1rNQ==',
    source:
      'https://sources.debian.org/data/main/n/node-chainsaw/0.1.0-5/debian/copyright',
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
  for (const key of ['integrity'])
    assert.equal(provenance[key], source[key], `Supplemental license ${key} mismatch`);
  assert.equal(
    provenance.downstream?.url ?? provenance.source,
    source.source,
    'Supplemental license source mismatch',
  );
  if (source.commit) {
    assert.equal(provenance.commit, source.commit, 'Supplemental license commit mismatch');
    assert.equal(provenance.sha256, source.sha256, 'Supplemental license sha256 mismatch');
  } else {
    assert.equal(
      provenance.downstream?.sha256,
      source.sha256,
      'Supplemental downstream evidence sha256 mismatch',
    );
  }
  const text = await read(source.noticeFile);
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
        path: source.noticePath,
        kind: source.noticeKind,
        hasLicenseText: true,
        license: source.license,
        sha256: source.sha256,
        bytes: Buffer.byteLength(text),
        provenance,
      },
    },
  ];
}

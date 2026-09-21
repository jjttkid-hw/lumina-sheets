import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error Build-only ESM helper.
import { hasLicenseText } from '../scripts/license-evidence.mjs';

describe('installed license text evidence', () => {
  it.each([
    'react/LICENSE',
    'lucide-react/LICENSE',
    'ieee754/LICENSE',
    'crc-32/LICENSE',
    'big-integer/LICENSE',
    'jszip/LICENSE.markdown',
    'pako/lib/zlib/README',
  ])('recognizes grant and disclaimer text actually shipped in %s', (file) => {
    expect(hasLicenseText(readFileSync(`node_modules/${file}`, 'utf8'))).toBe(true);
  });

  it.each([
    '',
    'Copyright Owner. Licensed under MIT; see https://example.org/LICENSE.',
    'NOTICE: Copyright Owner. AS IS. NO LIABILITY.',
    'Permission is hereby granted, free of charge.',
    'Apache License Version 2.0: http://www.apache.org/licenses/LICENSE-2.0',
    readFileSync('node_modules/jszip/lib/license_header.js', 'utf8'),
    readFileSync('node_modules/binary/README.markdown', 'utf8'),
  ])('does not accept a name, URL, attribution or truncated grant alone (%#)', (text) => {
    expect(hasLicenseText(text)).toBe(false);
  });

  it('does not treat a missing disclaimer as complete evidence', () => {
    const text = readFileSync('node_modules/react/LICENSE', 'utf8');
    expect(hasLicenseText(text.split('THE SOFTWARE IS PROVIDED')[0])).toBe(false);
  });
});

// @ts-expect-error Build-only ESM helper.
import { declaredLicenseCoverage, recognizedLicenseTexts } from '../scripts/license-evidence.mjs';
const mit = readFileSync('node_modules/react/LICENSE', 'utf8');
const zlib = readFileSync('node_modules/pako/lib/zlib/README', 'utf8');

it.each([
  ['MIT', [mit], 'text-evidenced'],
  ['ISC', [mit], 'review'],
  ['(MIT AND Zlib)', [mit], 'review'],
  ['(MIT AND Zlib)', [mit, zlib], 'text-evidenced'],
  ['MIT OR GPL-3.0-or-later', [mit], 'text-evidenced'],
  ['MIT AND Zlib OR ISC', [mit], 'review'],
  ['MIT OR Zlib AND ISC', [mit], 'text-evidenced'],
  ['(MIT OR Zlib) AND ISC', [mit], 'review'],
  ['MIT/X11', [mit], 'text-evidenced'],
  ['GPL-3.0-or-later', [mit], 'review'],
])('checks declared license route %s (%#)', (declared, texts, status) => {
  expect(declaredLicenseCoverage(declared, texts)).toMatchObject({
    status,
    expressionSupported: true,
  });
});

it.each([
  'MIT OR',
  'MIT AND',
  '(MIT',
  'MIT)',
  'MIT WITH Exception',
  'MIT OR Unknown',
  '',
  'MIT; doSomething()',
  '('.repeat(1000),
])('does not accept unsupported or malformed expressions: %s', (declared) => {
  expect(declaredLicenseCoverage(declared, [mit])).toMatchObject({
    status: 'review',
    expressionSupported: false,
  });
});

it('requires actual family grant text rather than a declared name appended to a different license', () => {
  expect(recognizedLicenseTexts(mit + '\nISC BSD-3-Clause Apache-2.0')).toEqual(['MIT']);
  expect(declaredLicenseCoverage('MIT AND Zlib', [mit + '\nZlib'])).toMatchObject({
    status: 'review',
  });
});

it.each([
  ['react/LICENSE', 'MIT'],
  ['lucide-react/LICENSE', 'ISC'],
  ['ieee754/LICENSE', 'BSD-3-Clause'],
  ['crc-32/LICENSE', 'Apache-2.0'],
  ['big-integer/LICENSE', 'Unlicense'],
  ['pako/lib/zlib/README', 'Zlib'],
])('recognizes the actual upstream license family for %s', (file, license) => {
  const text = readFileSync(`node_modules/${file}`, 'utf8');
  expect(recognizedLicenseTexts(text)).toContain(license);
  expect(declaredLicenseCoverage(license, [text]).status).toBe('text-evidenced');
});

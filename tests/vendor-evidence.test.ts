import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  embeddedComponentPaths,
  embeddedPackageEvidence,
  embeddedNoticeEvidence,
  embeddedAttributionEvidence,
  validateVendorEvidence,
  reviewedEmbeddedComponent,
  // @ts-expect-error Build-only ESM helper.
} from '../scripts/vendor-evidence.mjs';

describe('upstream embedded package metadata evidence', () => {
  it('binds actual vendor input bytes and rejects stale or altered attribution records', () => {
    const browserEntry = 'node_modules/exceljs/dist/exceljs.min.js';
    const browser = readFileSync(browserEntry);
    const mapBytes = readFileSync(`${browserEntry}.map`);
    const map = JSON.parse(mapBytes.toString('utf8'));
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const bundle = {
      browserEntry,
      browserEntrySha256: hash(browser),
      browserEntryBytes: browser.length,
      sourceMapSha256: hash(mapBytes),
      components: embeddedComponentPaths(map).map(({ name, sourcePaths }: any) => ({
        name,
        sourcePaths,
        ...embeddedPackageEvidence(map, name),
        noticeEvidence: embeddedNoticeEvidence(map, name),
        attributionEvidence: embeddedAttributionEvidence(map, name),
      })),
    };
    const inputs = {
      sources: [{ path: browserEntry, sha256: hash(browser), bytes: browser.length }],
    };
    expect(() => validateVendorEvidence(bundle, inputs, browser, mapBytes)).not.toThrow();
    for (const alter of [
      (copy: any) => copy.components.pop(),
      (copy: any) => copy.components.push(copy.components[0]),
      (copy: any) => copy.components[0].sourcePaths.pop(),
      (copy: any) => {
        copy.components = [];
      },
    ]) {
      const copy = structuredClone(bundle);
      alter(copy);
      expect(() => validateVendorEvidence(copy, inputs, browser, mapBytes)).toThrow(
        'component directory',
      );
    }
    expect(() => validateVendorEvidence(bundle, inputs, Buffer.from('changed'), mapBytes)).toThrow(
      'digest',
    );
    expect(() => validateVendorEvidence(bundle, { sources: [] }, browser, mapBytes)).toThrow(
      'actual SDK',
    );
    expect(() =>
      validateVendorEvidence(
        bundle,
        { sources: [{ ...inputs.sources[0], sha256: 'old' }] },
        browser,
        mapBytes,
      ),
    ).toThrow('actual SDK');
    expect(() => validateVendorEvidence(bundle, inputs, browser, Buffer.from('{}'))).toThrow(
      'source map',
    );
    const changed = structuredClone(bundle);
    changed.components.find((c: any) => c.name === 'events').noticeEvidence[0].text = 'fabricated';
    expect(() => validateVendorEvidence(changed, inputs, browser, mapBytes)).toThrow('notices');
    const metadata = structuredClone(bundle);
    metadata.components.find((c: any) => c.name === 'elliptic').bundledVersion = '99.0.0';
    expect(() => validateVendorEvidence(metadata, inputs, browser, mapBytes)).toThrow('metadata');
  });
  it('retains actual embedded notice text and its exact source provenance', () => {
    const map = JSON.parse(readFileSync('node_modules/exceljs/dist/exceljs.min.js.map', 'utf8'));
    const notices = embeddedNoticeEvidence(map, 'events');
    expect(notices).toHaveLength(1);
    const notice = notices[0];
    const source = map.sourcesContent[map.sources.indexOf(notice.sourcePath)];
    expect(source.startsWith(notice.text)).toBe(true);
    expect(notice.text).toContain('Copyright Joyent');
    expect(notice.text).toContain('USE OR OTHER DEALINGS IN THE SOFTWARE.');
    expect(notice.text).not.toContain('function EventEmitter');
    expect(notice.noticeSha256).toBe(createHash('sha256').update(notice.text).digest('hex'));
    expect(notice.sourceSha256).toBe(createHash('sha256').update(source).digest('hex'));
    expect(embeddedPackageEvidence(map, 'events').bundledVersion).toBeNull();
  });
  it('requires a leading comment, a permission grant and warranty text, without evaluating code', () => {
    const header = '/* Copyright Owner\nPermission is hereby granted\nAS IS; NO LIABILITY\n*/\n';
    const source = `${header}throw new Error("must not execute")`;
    const map = {
      sources: ['node_modules/outer/node_modules/@scope/pkg/a.js'],
      sourcesContent: [source],
    };
    expect(embeddedNoticeEvidence(map, '@scope/pkg')[0].text).toBe(header);
    expect(embeddedNoticeEvidence(map, 'outer')).toEqual([]);
    expect(embeddedNoticeEvidence(map, '@scope/p')).toEqual([]);
    for (const content of [
      '// Copyright owner; MIT\n',
      'const s = "Copyright; Permission is hereby granted; AS IS; LIABILITY";',
      `const x = 1;\n${header}`,
      '/* Copyright; Permission is hereby granted */',
    ])
      expect(embeddedNoticeEvidence({ ...map, sourcesContent: [content] }, '@scope/pkg')).toEqual(
        [],
      );
    expect(embeddedNoticeEvidence({ sources: map.sources }, '@scope/pkg')).toEqual([]);
  });
  it('reads the actual ExcelJS elliptic declaration without using installed package versions', () => {
    const map = JSON.parse(readFileSync('node_modules/exceljs/dist/exceljs.min.js.map', 'utf8'));
    const result = embeddedPackageEvidence(map, 'elliptic');
    expect(result).toMatchObject({
      bundledVersion: '6.5.4',
      bundledLicense: 'MIT',
      metadataConflict: false,
    });
    expect(result.metadataEvidence).toHaveLength(1);
    const sourcePath = result.metadataEvidence[0].sourcePath;
    expect(result.metadataEvidence[0].sourceSha256).toBe(
      createHash('sha256')
        .update(map.sourcesContent[map.sources.indexOf(sourcePath)])
        .digest('hex'),
    );
    expect(embeddedPackageEvidence(map, 'absent').bundledVersion).toBeNull();
  });
  it('accepts scoped nested paths and plain JSON while preserving conflicts', () => {
    const map = {
      sources: [
        'node_modules/a/node_modules/@scope/pkg/package.json',
        'node_modules/@scope/pkg/package.json',
      ],
      sourcesContent: [
        JSON.stringify({ name: '@scope/pkg', version: '1.2.3', license: 'MIT' }),
        'module.exports = {"name":"@scope/pkg","version":"2.0.0-beta.1","license":"ISC"};',
      ],
    };
    expect(embeddedPackageEvidence(map, '@scope/pkg')).toMatchObject({
      bundledVersion: null,
      bundledLicense: null,
      metadataConflict: true,
    });
  });
  it('never evaluates executable source and ignores mismatched names or invalid versions', () => {
    for (const content of [
      'module.exports = (() => { throw new Error("executed"); })()',
      '{"name":"other","version":"1.0.0","license":"MIT"}',
      '{"name":"pkg","version":"latest"}',
      'null',
    ]) {
      expect(
        embeddedPackageEvidence(
          { sources: ['node_modules/pkg/package.json'], sourcesContent: [content] },
          'pkg',
        ).metadataEvidence,
      ).toEqual([]);
    }
  });
  it('does not invent versions or licenses from filenames or missing source content', () => {
    expect(
      embeddedPackageEvidence({ sources: ['node_modules/pkg/package.json'] }, 'pkg').bundledVersion,
    ).toBeNull();
    expect(
      embeddedPackageEvidence(
        {
          sources: ['node_modules/pkg/package.json'],
          sourcesContent: ['{"name":"pkg","version":"1.0.0"}'],
        },
        'pkg',
      ),
    ).toMatchObject({ bundledVersion: '1.0.0', bundledLicense: null });
  });
});

it('preserves actual partial attribution without marking it as complete permission text', () => {
  const map = JSON.parse(readFileSync('node_modules/exceljs/dist/exceljs.min.js.map', 'utf8'));
  const evidence = embeddedAttributionEvidence(map, 'regenerator-runtime');
  expect(evidence).toHaveLength(1);
  expect(evidence[0].text).toContain('Facebook, Inc.');
  expect(evidence[0].text).toContain('LICENSE file');
  expect(evidence[0].interpretation).toContain('Partial');
  expect(embeddedNoticeEvidence(map, 'regenerator-runtime')).toEqual([]);
  expect(embeddedPackageEvidence(map, 'regenerator-runtime').bundledVersion).toBeNull();
  expect(embeddedAttributionEvidence(map, 'buffer')[0].text).toContain('@license  MIT');
  expect(embeddedAttributionEvidence(map, 'events')).toEqual([]);
  const source = map.sourcesContent[map.sources.indexOf(evidence[0].sourcePath)];
  expect(evidence[0].sourceSha256).toBe(createHash('sha256').update(source).digest('hex'));
  expect(evidence[0].noticeSha256).toBe(
    createHash('sha256').update(evidence[0].text).digest('hex'),
  );
});

it('accepts only literal leading attribution for the exact embedded package', () => {
  const header = '/* Copyright Author; licensed under MIT, see LICENSE file. */\n';
  const map = {
    sources: ['node_modules/outer/node_modules/@scope/pkg/index.js'],
    sourcesContent: [header + 'throw Error("never execute")'],
  };
  expect(embeddedAttributionEvidence(map, '@scope/pkg')[0].text).toBe(header);
  expect(embeddedAttributionEvidence(map, '@scope/p')).toEqual([]);
  expect(embeddedAttributionEvidence(map, 'outer')).toEqual([]);
  for (const text of [
    'const x = "@license MIT";',
    'const x=1;\n' + header,
    '// ordinary comment\n',
  ])
    expect(embeddedAttributionEvidence({ ...map, sourcesContent: [text] }, '@scope/pkg')).toEqual(
      [],
    );
});

it('binds reviewed elliptic evidence to the complete real source map', async () => {
  const bytes = readFileSync('node_modules/exceljs/dist/exceljs.min.js.map');
  const sourceMap = JSON.parse(bytes.toString('utf8'));
  const bundle = { sourceMapSha256: createHash('sha256').update(bytes).digest('hex') };
  const component = { name: 'elliptic', bundledVersion: '6.5.4' };
  const result = await reviewedEmbeddedComponent(process.cwd(), bundle, component, sourceMap);
  expect(result.status).toBe('upstream-license-reviewed');
  expect(result.licenseEvidence.text).toContain('Copyright Fedor Indutny, 2014.');
  await expect(
    reviewedEmbeddedComponent(process.cwd(), { sourceMapSha256: 'wrong' }, component, sourceMap),
  ).rejects.toThrow('digest');
  const modified = structuredClone(sourceMap);
  modified.sourcesContent[modified.sources.indexOf('node_modules/elliptic/lib/elliptic.js')] +=
    '\nchanged';
  await expect(
    reviewedEmbeddedComponent(process.cwd(), bundle, component, modified),
  ).rejects.toThrow('hash');
  const missing = structuredClone(sourceMap);
  const index = missing.sources.indexOf('node_modules/elliptic/lib/elliptic.js');
  missing.sources.splice(index, 1);
  missing.sourcesContent.splice(index, 1);
  await expect(
    reviewedEmbeddedComponent(process.cwd(), bundle, component, missing),
  ).rejects.toThrow('omits');
  await expect(
    reviewedEmbeddedComponent(
      process.cwd(),
      bundle,
      { ...component, bundledVersion: '6.5.5' },
      sourceMap,
    ),
  ).resolves.toBeNull();
});

it('binds every exact-source archive to the current ExcelJS map and notice text', async () => {
  const mapBytes = readFileSync('node_modules/exceljs/dist/exceljs.min.js.map');
  const sourceMap = JSON.parse(mapBytes.toString('utf8'));
  const bundle = { sourceMapSha256: createHash('sha256').update(mapBytes).digest('hex') };
  const manifest = JSON.parse(
    readFileSync('docs/third-party/embedded/exact-sources/manifest.json', 'utf8'),
  );
  const reviewed = [];
  for (const record of manifest.records) {
    const result = await reviewedEmbeddedComponent(
      process.cwd(),
      bundle,
      { name: record.name, bundledVersion: null },
      sourceMap,
    );
    expect(result).toMatchObject({
      status: 'upstream-source-and-license-reviewed',
      provenance: { package: record.name, version: record.version },
    });
    expect(result.licenseEvidence.text.length).toBeGreaterThan(0);
    reviewed.push(record.name);
  }
  expect(reviewed).toHaveLength(manifest.records.length);
  expect(new Set(reviewed).size).toBe(reviewed.length);
}, 30_000);

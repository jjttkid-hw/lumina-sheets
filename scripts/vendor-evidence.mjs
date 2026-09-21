import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import assert from 'node:assert/strict';

/** Recover the full component/path directory from source-map paths. */
export function embeddedComponentPaths(sourceMap) {
  assert(Array.isArray(sourceMap.sources), 'Vendor source map requires sources');
  const components = new Map();
  for (const source of sourceMap.sources) {
    assert(typeof source === 'string', 'Invalid vendor source path');
    const relative = source.split('node_modules/').at(-1);
    if (relative === source) continue;
    const name = relative
      .split('/')
      .slice(0, relative.startsWith('@') ? 2 : 1)
      .join('/');
    const paths = components.get(name) ?? [];
    paths.push(source);
    components.set(name, paths);
  }
  return [...components]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, sourcePaths]) => ({ name, sourcePaths }));
}

/** Bind collected attribution to the exact vendor bytes used by the SDK build.
 * A matching source map is provenance evidence, not proof of license fulfillment. */
export function validateVendorEvidence(bundle, inputs, browserBytes, mapBytes) {
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  assert(bundle.browserEntrySha256 === hash(browserBytes), 'Vendor browser entry digest mismatch');
  assert(bundle.browserEntryBytes === browserBytes.length, 'Vendor browser entry size mismatch');
  const sources = inputs.sources.filter((source) => source.path === bundle.browserEntry);
  assert(sources.length === 1, 'Vendor entry must match exactly one actual SDK input');
  assert(
    sources[0].sha256 === bundle.browserEntrySha256 &&
      sources[0].bytes === bundle.browserEntryBytes,
    'Vendor evidence differs from actual SDK input',
  );
  assert(bundle.sourceMapSha256 === hash(mapBytes), 'Vendor source map digest mismatch');
  const map = JSON.parse(mapBytes.toString('utf8'));
  assert(Array.isArray(bundle.components), 'Missing vendor components');
  assert.deepEqual(
    bundle.components.map(({ name, sourcePaths }) => ({ name, sourcePaths })),
    embeddedComponentPaths(map),
    'Vendor component directory differs from source map',
  );
  for (const component of bundle.components) {
    const metadata = embeddedPackageEvidence(map, component.name);
    for (const key of Object.keys(metadata))
      assert.deepEqual(component[key], metadata[key], 'Vendor metadata differs from source map');
    assert.deepEqual(
      component.noticeEvidence,
      embeddedNoticeEvidence(map, component.name),
      'Vendor notices differ from source map',
    );
    assert.deepEqual(
      component.attributionEvidence,
      embeddedAttributionEvidence(map, component.name),
      'Vendor attribution differs from source map',
    );
  }
}

/** Partial attribution headers are useful notice material, not complete licenses. */
export function embeddedAttributionEvidence(sourceMap, packageName) {
  const evidence = [];
  for (let index = 0; index < (sourceMap.sources ?? []).length; index++) {
    const sourcePath = sourceMap.sources[index];
    if (typeof sourcePath !== 'string') continue;
    const relative = sourcePath.split('node_modules/').at(-1);
    if (relative === sourcePath || !relative.startsWith(`${packageName}/`)) continue;
    const source = sourceMap.sourcesContent?.[index];
    if (typeof source !== 'string') continue;
    const header = source.match(
      /^\s*(?:(?:\/\/[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/\s*))+/,
    )?.[0];
    if (!header || !/copyright|@license\b|licensed under|license file/i.test(header)) continue;
    // Complete grant headers already have their own noticeEvidence entry.
    if (
      /permission (?:is hereby granted|to use, copy)|redistribution and use in source/i.test(
        header,
      ) &&
      /copyright/i.test(header) &&
      /AS IS/i.test(header) &&
      /LIABILITY|LIABLE/i.test(header)
    )
      continue;
    evidence.push({
      sourcePath,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      noticeSha256: createHash('sha256').update(header).digest('hex'),
      text: header,
      interpretation:
        'Partial source attribution only; does not establish package version or complete license obligations.',
    });
  }
  return evidence;
}

/** Preserve literal leading license comments, never execute bundled source or
 * infer package-wide license coverage from one file's notice. */
export function embeddedNoticeEvidence(sourceMap, packageName) {
  const notices = [];
  for (let index = 0; index < (sourceMap.sources ?? []).length; index++) {
    const sourcePath = sourceMap.sources[index];
    const marker = 'node_modules/';
    const relative = sourcePath.slice(sourcePath.lastIndexOf(marker) + marker.length);
    if (!sourcePath.includes(marker) || !relative.startsWith(`${packageName}/`)) continue;
    const source = sourceMap.sourcesContent?.[index];
    if (typeof source !== 'string') continue;
    const header = source.match(
      /^\s*(?:(?:\/\/[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/\s*))+/,
    )?.[0];
    if (
      !header ||
      !/copyright/i.test(header) ||
      !/permission (?:is hereby granted|to use, copy)|redistribution and use in source/i.test(
        header,
      ) ||
      !/AS IS/i.test(header) ||
      !/LIABILITY|LIABLE/i.test(header)
    )
      continue;
    notices.push({
      sourcePath,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      noticeSha256: createHash('sha256').update(header).digest('hex'),
      text: header,
    });
  }
  return notices;
}

/** Read embedded JSON metadata without evaluating source-map JavaScript.
 * Metadata is evidence of a declaration, never proof of license fulfillment. */
export function embeddedPackageEvidence(sourceMap, packageName) {
  const evidence = [];
  for (let index = 0; index < (sourceMap.sources ?? []).length; index++) {
    const sourcePath = sourceMap.sources[index];
    const marker = 'node_modules/';
    const relative = sourcePath.slice(sourcePath.lastIndexOf(marker) + marker.length);
    if (!sourcePath.includes(marker) || relative !== `${packageName}/package.json`) continue;
    const source = sourceMap.sourcesContent?.[index];
    if (typeof source !== 'string') continue;
    // Browserify embeds package.json as `module.exports={...}`. Accept only a
    // single JSON value, optionally wrapped by that literal assignment.
    const json = source
      .trim()
      .replace(/^module\.exports\s*=\s*/, '')
      .replace(/;\s*$/, '');
    let metadata;
    try {
      metadata = JSON.parse(json);
    } catch {
      continue;
    }
    if (
      !metadata ||
      metadata.name !== packageName ||
      typeof metadata.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(metadata.version)
    )
      continue;
    evidence.push({
      sourcePath,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      version: metadata.version,
      declaredLicense: typeof metadata.license === 'string' ? metadata.license : null,
    });
  }
  const versions = new Set(evidence.map((item) => item.version));
  const licenses = new Set(evidence.map((item) => item.declaredLicense));
  return {
    bundledVersion: versions.size === 1 ? evidence[0].version : null,
    bundledLicense: licenses.size === 1 ? evidence[0].declaredLicense : null,
    metadataEvidence: evidence,
    metadataConflict: versions.size > 1 || licenses.size > 1,
  };
}

// Components with an exact upstream source comparison may carry a reviewed
// license record. Keep this allowlist explicit: an npm declaration alone is
// not enough, and unresolved components must remain visible to release gates.
const reviewedEmbedded = {
  'elliptic@6.5.4': {
    directory: 'docs/third-party/embedded/elliptic-6.5.4',
    licenseSha256: '1368424157ced9e5837f09426e1ffddbbaf1c8d0dd4a573cec7f4ac457b6265f',
    licenseBytes: 1313,
    mapSha256: 'b65fb09908a8e2a3aaa6c751465c1662fc11fdfd59ae970b8b2d544fc18f6ac7',
    provenanceSha256: 'e0e5151c78d2d5cdc46cfe369b5ce44b6d1547a6c6d0b12283847e3014e7c0ad',
    comparisonSha256: '4d05c764246bed1253804c096a576ffec67285ef0b275d496515ebee08111047',
  },
};

/** Validate exact source-map/upstream evidence for one embedded component. */
export async function reviewedEmbeddedComponent(root, bundle, component, sourceMap) {
  const key = `${component.name}@${component.bundledVersion ?? ''}`;
  const record = reviewedEmbedded[key];
  if (!record) return null;
  assert.equal(bundle.sourceMapSha256, record.mapSha256, 'Reviewed vendor map digest mismatch');
  const project = await realpath(root);
  async function readEvidence(name, digest) {
    const filename = await realpath(path.join(project, record.directory, name));
    assert(filename.startsWith(project + path.sep), 'Reviewed vendor evidence escapes repository');
    const text = await readFile(filename, 'utf8');
    assert.equal(
      createHash('sha256').update(text).digest('hex'),
      digest,
      `Reviewed vendor ${name} changed`,
    );
    return text;
  }
  const provenance = JSON.parse(await readEvidence('provenance.json', record.provenanceSha256));
  const metadata = embeddedPackageEvidence(sourceMap, component.name);
  assert.equal(
    metadata.bundledVersion,
    component.bundledVersion,
    'Reviewed embedded metadata version mismatch',
  );
  assert.equal(metadata.bundledLicense, 'MIT', 'Reviewed embedded license mismatch');
  assert.equal(metadata.metadataConflict, false, 'Conflicting reviewed embedded metadata');
  assert.equal(provenance.package, component.name, 'Reviewed vendor package mismatch');
  assert.equal(provenance.version, component.bundledVersion, 'Reviewed vendor version mismatch');
  assert.equal(
    provenance.bundle.mapSha256,
    record.mapSha256,
    'Reviewed vendor provenance map mismatch',
  );
  assert.equal(
    provenance.comparison.allExact,
    true,
    'Reviewed vendor source comparison incomplete',
  );
  const license = await readEvidence('LICENSE', record.licenseSha256);
  assert.equal(
    createHash('sha256').update(license).digest('hex'),
    record.licenseSha256,
    'Reviewed vendor license changed',
  );
  assert.equal(
    Buffer.byteLength(license),
    record.licenseBytes,
    'Reviewed vendor license size changed',
  );
  const comparison = JSON.parse(
    await readEvidence('source-comparison.json', record.comparisonSha256),
  );
  const paths =
    embeddedComponentPaths(sourceMap).find((item) => item.name === component.name)?.sourcePaths ??
    [];
  assert.deepEqual(
    comparison.map((item) => item.sourcePath).sort(),
    paths.filter((p) => !p.endsWith('/package.json')).sort(),
    'Reviewed source comparison omits component files',
  );
  assert(
    comparison.length > 0 && comparison.every((item) => item.exactMatch),
    'Reviewed source comparison has non-exact input',
  );
  for (const item of comparison) {
    assert.equal(
      item.sourceSha256,
      item.upstreamTarballSha256,
      'Reviewed upstream source mismatch',
    );
    const index = sourceMap.sources.indexOf(item.sourcePath);
    assert(index >= 0, `Reviewed source missing from map: ${item.sourcePath}`);
    assert.equal(
      createHash('sha256').update(sourceMap.sourcesContent[index]).digest('hex'),
      item.sourceSha256,
      'Reviewed source hash mismatch',
    );
  }
  return {
    status: 'upstream-license-reviewed',
    licenseEvidence: {
      path: `${record.directory}/LICENSE`,
      sha256: record.licenseSha256,
      bytes: record.licenseBytes,
      text: license,
      source: provenance.source,
    },
    provenance,
  };
}

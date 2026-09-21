import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTimestamp } from './build-time.mjs';
import { hasLicenseText, declaredLicenseCoverage } from './license-evidence.mjs';
import { supplementalNotices } from './supplemental-notices.mjs';
import {
  embeddedComponentPaths,
  embeddedPackageEvidence,
  embeddedNoticeEvidence,
  embeddedAttributionEvidence,
  reviewedEmbeddedComponent,
} from './vendor-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildTime = buildTimestamp(root);
const output = path.join(root, 'dist/sdk');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
if (!lock.packages) throw new Error('package-lock.json must contain a packages table');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const issues = [];
const issue = (severity, code, location, message) =>
  issues.push({ severity, code, location, message });
const records = new Map();
const files = new Map();
const normalizeLicense = (value) => (typeof value === 'string' ? value : (value?.type ?? null));
const repositoryUrl = (value) => (typeof value === 'string' ? value : (value?.url ?? null));

function resolveLocked(name, parentPath) {
  let cursor = parentPath;
  while (true) {
    if (path.posix.basename(cursor) !== 'node_modules') {
      const candidate = path.posix.join(cursor, 'node_modules', name);
      if (lock.packages[candidate]) return candidate;
    }
    if (!cursor || cursor === '.') return null;
    const next = path.posix.dirname(cursor);
    cursor = next === '.' ? '' : next;
  }
}

async function noticeFiles(packagePath) {
  const result = [];
  const directory = path.join(root, packagePath);
  const queue = [{ absolute: directory, relative: '' }];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of await readdir(current.absolute, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.isSymbolicLink())
        continue;
      const relative = path.posix.join(current.relative, entry.name);
      const absolute = path.join(current.absolute, entry.name);
      if (entry.isDirectory()) queue.push({ absolute, relative });
      else if (
        entry.isFile() &&
        /^(licen[cs]e(?:s)?|copying|notice)(?:[._-].*)?$/i.test(entry.name)
      ) {
        const text = await readFile(absolute, 'utf8');
        const item = {
          path: relative,
          kind: 'notice-file',
          hasLicenseText: hasLicenseText(text),
          sha256: sha256(text),
          bytes: Buffer.byteLength(text),
        };
        result.push(item);
        files.set(`${packagePath}/${relative}`, text);
      } else if (entry.isFile() && /^readme(?:\..*)?$/i.test(entry.name)) {
        const text = await readFile(absolute, 'utf8');
        const match = /^(?:#{1,6}\s+licen[cs]e[^\n]*|licen[cs]e\s*\n[-=]+)\s*$/im.exec(text);
        if (match || hasLicenseText(text)) {
          const start = match?.index ?? 0;
          const section = text.slice(start);
          const fullText = hasLicenseText(section);
          result.push({
            path: relative,
            kind: fullText ? 'readme-license-text' : 'readme-license-declaration',
            hasLicenseText: fullText,
            excerptStartLine: text.slice(0, start).split('\n').length,
            sha256: sha256(section),
            bytes: Buffer.byteLength(section),
          });
          files.set(`${packagePath}/${relative}`, section);
        }
      }
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

async function visit(packagePath, requiredBy) {
  if (records.has(packagePath)) {
    records.get(packagePath).requiredBy.push(requiredBy);
    return;
  }
  const locked = lock.packages[packagePath];
  let installed;
  try {
    installed = JSON.parse(await readFile(path.join(root, packagePath, 'package.json'), 'utf8'));
  } catch (error) {
    issue(
      requiredBy.optional ? 'review' : 'error',
      'MISSING_INSTALLED_PACKAGE',
      packagePath,
      error.message,
    );
    return;
  }
  const name = installed.name ?? packagePath.split('node_modules/').at(-1);
  const version = locked.version ?? installed.version;
  const license =
    normalizeLicense(installed.license) ??
    normalizeLicense(locked.license) ??
    (Array.isArray(installed.licenses)
      ? installed.licenses.map(normalizeLicense).filter(Boolean).join(' OR ') || null
      : null);
  const notices = await noticeFiles(packagePath);
  for (const { notice, text } of await supplementalNotices(root, {
    name,
    version,
    integrity: locked.integrity,
  })) {
    notices.push(notice);
    files.set(`${packagePath}/${notice.path}`, text);
  }
  const licenseCoverage = declaredLicenseCoverage(
    license,
    notices.map((notice) => files.get(`${packagePath}/${notice.path}`)),
  );
  const record = {
    name,
    version,
    installedVersion: installed.version ?? null,
    location: packagePath,
    license,
    repository: repositoryUrl(installed.repository),
    resolved: locked.resolved ?? null,
    integrity: locked.integrity ?? null,
    licenseFiles: notices,
    licenseCoverage,
    requiredBy: [requiredBy],
    dependencies: [],
  };
  records.set(packagePath, record);
  if (locked.version && installed.version !== locked.version)
    issue(
      'error',
      'LOCK_VERSION_MISMATCH',
      packagePath,
      `Locked ${locked.version}; installed ${installed.version}`,
    );
  if (!license && !notices.length)
    issue(
      'review',
      'NO_LICENSE_EVIDENCE',
      packagePath,
      'Neither license metadata nor LICENSE/COPYING/NOTICE text found',
    );
  else if (!license)
    issue(
      'review',
      'LICENSE_METADATA_MISSING',
      packagePath,
      'License text exists but license identifier requires review',
    );
  else if (!notices.some((notice) => notice.hasLicenseText))
    issue(
      'review',
      'LICENSE_TEXT_MISSING',
      packagePath,
      `Metadata declares ${license}; collected files lack recognized grant and disclaimer text and require review`,
    );
  else if (licenseCoverage.status !== 'text-evidenced')
    issue(
      'review',
      'LICENSE_DECLARATION_UNEVIDENCED',
      packagePath,
      `Collected text does not establish a supported route for declared license ${license}`,
    );
  if (license === 'UNLICENSED')
    issue('error', 'UNLICENSED_DEPENDENCY', packagePath, 'Package explicitly declares UNLICENSED');

  const dependencies = { ...(locked.dependencies ?? installed.dependencies ?? {}) };
  const optional = locked.optionalDependencies ?? installed.optionalDependencies ?? {};
  const peers = locked.peerDependencies ?? installed.peerDependencies ?? {};
  const peerMeta = locked.peerDependenciesMeta ?? installed.peerDependenciesMeta ?? {};
  for (const [dependency, range] of Object.entries({ ...dependencies, ...optional, ...peers }).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const kind = Object.hasOwn(dependencies, dependency)
      ? 'dependency'
      : Object.hasOwn(optional, dependency)
        ? 'optionalDependency'
        : 'peerDependency';
    const isOptional =
      Object.hasOwn(optional, dependency) ||
      (kind === 'peerDependency' && peerMeta[dependency]?.optional === true);
    const resolved = resolveLocked(dependency, packagePath);
    record.dependencies.push({
      name: dependency,
      range,
      kind,
      optional: isOptional,
      location: resolved,
    });
    if (!resolved) {
      issue(
        isOptional ? 'review' : 'error',
        'UNRESOLVED_DEPENDENCY',
        packagePath,
        `${kind} ${dependency}@${range} absent from lockfile`,
      );
      continue;
    }
    await visit(resolved, { location: packagePath, kind, optional: isOptional });
  }
}

for (const [name, range] of Object.entries(manifest.dependencies ?? {}).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  const resolved = resolveLocked(name, '');
  if (!resolved)
    issue(
      'error',
      'UNRESOLVED_ROOT_DEPENDENCY',
      name,
      `Production dependency ${range} absent from lockfile`,
    );
  else await visit(resolved, { location: '', kind: 'dependency', optional: false });
}

// ExcelJS's browser entry is pre-bundled. Its build-time embedded packages are
// not reliably described by our lockfile. Preserve source-map evidence rather
// than assigning local package versions/licenses to historical bundled sources.
const vendorBundles = [];
for (const record of records.values()) {
  if (record.name !== 'exceljs') continue;
  const installed = JSON.parse(
    await readFile(path.join(root, record.location, 'package.json'), 'utf8'),
  );
  if (typeof installed.browser !== 'string') continue;
  const browserEntry = path.posix.normalize(path.posix.join(record.location, installed.browser));
  const sourceMapPath = `${browserEntry}.map`;
  try {
    const sourceMap = JSON.parse(await readFile(path.join(root, sourceMapPath), 'utf8'));
    const browserBytes = await readFile(path.join(root, browserEntry));
    const sourceMapBytes = await readFile(path.join(root, sourceMapPath));
    const bundleEvidence = {
      browserEntry,
      browserEntrySha256: sha256(browserBytes),
      browserEntryBytes: browserBytes.length,
      sourceMapPath,
      sourceMapSha256: sha256(sourceMapBytes),
    };
    const components = new Map(
      embeddedComponentPaths(sourceMap).map(({ name, sourcePaths }) => [
        name,
        {
          name,
          bundledVersion: null,
          bundledLicense: null,
          status: 'unresolved-vendor-bundle-review',
          sourcePaths,
        },
      ]),
    );
    for (const component of components.values()) {
      Object.assign(component, embeddedPackageEvidence(sourceMap, component.name));
      component.noticeEvidence = embeddedNoticeEvidence(sourceMap, component.name);
      component.attributionEvidence = embeddedAttributionEvidence(sourceMap, component.name);
      component.review = await reviewedEmbeddedComponent(
        root,
        bundleEvidence,
        component,
        sourceMap,
      );
      if (component.review) component.status = component.review.status;
    }
    const bundle = {
      package: `${record.name}@${record.version}`,
      ...bundleEvidence,
      interpretation:
        'Source-map paths identify embedded sources. Embedded package.json declarations, where available, are hashed metadata evidence; they do not establish complete license obligations or final-bundle inclusion. Local installed versions are never substituted.',
      components: [...components.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
    vendorBundles.push(bundle);
    issue(
      'review',
      'PREBUNDLED_COMPONENTS_UNRESOLVED',
      browserEntry,
      `${bundle.components.length} embedded component names require upstream version/license confirmation; ExcelJS dist/LICENSE is its MIT notice, not an exhaustive embedded dependency inventory`,
    );
  } catch (error) {
    issue('review', 'VENDOR_BUNDLE_MAP_UNAVAILABLE', browserEntry, error.message);
  }
}

const packages = [...records.values()].sort(
  (a, b) =>
    a.name.localeCompare(b.name) ||
    a.version.localeCompare(b.version) ||
    a.location.localeCompare(b.location),
);
const summary = {
  packageInstallations: packages.length,
  uniqueNameVersions: new Set(packages.map((p) => `${p.name}@${p.version}`)).size,
  noticeFiles: packages.reduce((count, p) => count + p.licenseFiles.length, 0),
  errors: issues.filter((i) => i.severity === 'error').length,
  reviewItems: issues.filter((i) => i.severity === 'review').length,
  unresolvedVendorComponents: vendorBundles.reduce(
    (count, bundle) => count + bundle.components.filter((component) => !component.review).length,
    0,
  ),
};
const inventory = {
  schemaVersion: 1,
  generatedAt: buildTime.timestamp,
  timestampSource: buildTime.source,
  scope:
    'Conservative installed production dependency closure: root dependencies recursively, including required peers and installed optional dependencies; dev-only roots excluded. This is not an exact tree-shaken browser bundle SBOM.',
  source: {
    manifest: 'package.json',
    lockfile: 'package-lock.json',
    lockfileVersion: lock.lockfileVersion,
    lockfileSha256: sha256(await readFile(path.join(root, 'package-lock.json'))),
  },
  summary,
  issues,
  packages,
  vendorBundles,
};
const text = [
  'THIRD-PARTY DEPENDENCY NOTICES',
  inventory.scope,
  'This file does not grant, select, or infer a license for the Lumina product itself.',
  'License metadata and installed upstream notice texts are reproduced as evidence. Review unresolved items before commercial redistribution.',
  `Summary: ${JSON.stringify(summary)}`,
  '',
  'UNRESOLVED / REVIEW ITEMS',
  ...issues.map((item) => `[${item.severity}] ${item.code} ${item.location}: ${item.message}`),
  '',
  'EXCELJS PRE-BUNDLED COMPONENT EVIDENCE',
  ...vendorBundles.flatMap((bundle) => [
    bundle.browserEntry,
    bundle.interpretation,
    ...bundle.components.map(
      (component) =>
        `${component.name}: embedded version ${component.bundledVersion ?? 'UNRESOLVED'}; declared license ${component.bundledLicense ?? 'UNRESOLVED'}; complete license review ${component.review ? 'UPSTREAM EVIDENCED' : 'UNRESOLVED'} (see dependency-inventory.json for hashed metadata and source paths)`,
    ),
    ...bundle.components.flatMap((component) =>
      component.review?.licenseEvidence
        ? [
            '',
            `--- Reviewed embedded upstream license: ${component.name}@${component.bundledVersion} ---`,
            `Source SHA-256: ${component.review.licenseEvidence.sha256}; bytes: ${component.review.licenseEvidence.bytes}`,
            component.review.licenseEvidence.text,
          ]
        : [],
    ),
    ...bundle.components.flatMap((component) =>
      component.noticeEvidence.flatMap((notice) => [
        '',
        `--- Embedded upstream notice: ${notice.sourcePath} ---`,
        `Source SHA-256: ${notice.sourceSha256}; notice SHA-256: ${notice.noticeSha256}`,
        'Literal source comment; does not establish complete package license coverage.',
        notice.text,
      ]),
    ),
    ...bundle.components.flatMap((component) =>
      component.attributionEvidence.flatMap((notice) => [
        '',
        `--- Partial embedded attribution: ${notice.sourcePath} ---`,
        `Source SHA-256: ${notice.sourceSha256}; notice SHA-256: ${notice.noticeSha256}`,
        notice.interpretation,
        notice.text,
      ]),
    ),
  ]),
  ...packages.flatMap((record) => [
    '',
    '='.repeat(78),
    `${record.name}@${record.version}`,
    `Location: ${record.location}`,
    `Declared license: ${record.license ?? 'UNRESOLVED'}`,
    `Repository: ${record.repository ?? 'not supplied'}`,
    ...record.licenseFiles.flatMap((notice) => [
      '',
      `--- ${record.location}/${notice.path} ---`,
      files.get(`${record.location}/${notice.path}`),
    ]),
    ...(record.licenseFiles.length
      ? []
      : ['No installed license text found; declared metadata requires review.']),
  ]),
].join('\n');
await mkdir(output, { recursive: true });
await writeFile(
  path.join(output, 'dependency-inventory.json'),
  `${JSON.stringify(inventory, null, 2)}\n`,
);
await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), `${text}\n`);
console.log(JSON.stringify(summary));
if (
  summary.errors ||
  ((process.argv.includes('--strict') || process.argv.includes('--strict-review')) &&
    summary.reviewItems)
)
  process.exitCode = 1;

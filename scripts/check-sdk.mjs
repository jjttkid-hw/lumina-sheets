import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { hasLicenseText, declaredLicenseCoverage } from './license-evidence.mjs';
import { supplementalNotices } from './supplemental-notices.mjs';
import { validateVendorEvidence, reviewedEmbeddedComponent } from './vendor-evidence.mjs';

// Run after build:sdk: node scripts/check-sdk.mjs. Nothing is published and all
// installs happen outside the repository; no host React or ambient types leak in.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkDirectory = path.join(root, 'dist/sdk');
const compiler = path.join(root, 'node_modules/typescript/bin/tsc');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packageName = 'lumina-report-sdk';
const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 2 && args[0] === '--pack-destination' && args[1]),
  'Usage: node scripts/check-sdk.mjs [--pack-destination artifacts]',
);
const packDestination = args.length ? path.resolve(args[1]) : undefined;
const temporary = await mkdtemp(path.join(os.tmpdir(), 'lumina-sdk-check-'));
// Keep package verification independent from a user's global npm cache. In
// particular, caches created by an earlier sudo npm invocation may contain
// root-owned entries and make `npm pack` fail with EPERM. A per-run cache is
// also what CI needs for isolated, repeatable checks.
const npmCache = path.join(temporary, 'npm-cache');
await mkdir(npmCache, { recursive: true });
const environment = {
  ...process.env,
  npm_config_cache: npmCache,
  npm_config_ignore_scripts: 'true',
  npm_config_offline: 'true',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
};

function run(executable, args, cwd) {
  try {
    return execFileSync(executable, args, {
      cwd,
      env: environment,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `${path.basename(executable)} ${args[0]} failed${output ? `:\n${output}` : ''}`,
      {
        cause: error,
      },
    );
  }
}

const consumerSource = `
import {
  createSpreadsheet,
  LuminaSpreadsheet,
  LuminaError,
  createEvaluator,
  generateReport,
  restDataSource,
  workbookToXlsx,
  workbookFromXlsx,
  workbookCsvReadableStream,
  reportDataCsvReadableStream,
  workbookFromReportData,
  parseCellInput,
  type ReportSnapshotOptions,
  type ImportOptions,
  type CellChange,
  type CellValue,
  type EvaluationResult,
  type RichTextRun,
  type RichTextStyle,
  type Workbook,
  type SheetLayout,
  type SpreadsheetOptions,
  type ReportDefinition,
  type ReportDataSource,
  type DataValidationRule,
  type ConditionalRule,
  type PrintSettings,
  type RowSortRequest,
  type StructureChangeEvent,
  type SheetRenameEvent,
  type ActiveSheetChangeEvent,
  productBuildIdentity,
  type ProductBuildIdentity,
} from 'lumina-report-sdk';
import 'lumina-report-sdk/style.css';

export function mount(host: HTMLElement, workbook: Workbook): LuminaSpreadsheet {
  const build: ProductBuildIdentity | null = productBuildIdentity();
  if (build) console.log(build.version, build.sourceSha256);
  const options: SpreadsheetOptions = {
    workbook,
    onChange(event) { const changes: CellChange[] = event.changes; void changes; },
    onStructureChange(event) { const change: StructureChangeEvent = event; void change; },
    onSheetRename(event) { const change: SheetRenameEvent = event; void change; },
    onActiveSheetChange(event) { const change: ActiveSheetChangeEvent = event; void change; },
    onSelectionChange(selection) { console.log(selection.row); },
    onRender(metrics) { console.log(metrics.drawMs); },
    onDataStateChange(state) { console.log(state.status); },
    onError(error) { if (error instanceof LuminaError) console.log(error.code); },
  };
  const grid = createSpreadsheet(host, options);
  const importOptions: ImportOptions = { signal: new AbortController().signal };
  void grid.import(new File(['{}'], 'book.json'), importOptions);
  const changes: CellChange[] = [{ key: 'A1', cell: { value: 10 } }];
  grid.setCells(changes);
  const inlineStyle: RichTextStyle = { bold: true, fontFamily: 'Arial', strike: false, verticalAlign: 'superscript', fontFamilyClass: 2, charset: 134 };
  const richText: RichTextRun[] = [{ text: 'Rich', style: inlineStyle }];
  grid.setCells([{ key: 'C1', cell: { value: 'Rich', richText } }]);
  const value: CellValue = grid.getValue('A1');
  const layout: SheetLayout = grid.getSheetLayout();
  grid.setSheetLayout(layout);
  const rules: DataValidationRule[] = grid.getDataValidation();
  grid.setDataValidation(rules);
  const conditionalRules: ConditionalRule[] = grid.getConditionalRules();
  grid.setConditionalRules(conditionalRules);
  const settings: PrintSettings | undefined = grid.getPrintSettings();
  grid.setPrintSettings(settings);
  const sort: RowSortRequest = {
    startRow: 1, rowCount: 2, keys: [{ column: 0, direction: 'asc' }],
  };
  grid.sortRows(sort);
  for (const sheet of grid.sheetInfos) {
    const readOnly: boolean = sheet.readOnly;
    void readOnly;
    grid.setActiveSheet(sheet.id);
  }
  grid.setActiveSheet(workbook.activeSheetId);
  grid.renameSheet("Renamed");
  grid.renameSheet("Renamed again", workbook.activeSheetId);
  grid.setCell('B1', '=A1*2');
  grid.getCell('B1');
  grid.undo();
  grid.redo();
  grid.select({ row: 0, col: 0 });
  grid.load(grid.toJSON());
  const outcome: EvaluationResult = createEvaluator(workbook).result(workbook.sheets[0], "A1");
  void outcome;
  createEvaluator(workbook, { readPagedCell: (sheet, key) => key === "A1" ? sheet.rowCount : undefined });
  void value;
  return grid;
}

export async function files(workbook: Workbook, data: ArrayBuffer) {
  const bytes: ArrayBuffer = await workbookToXlsx(workbook);
  const restored: Workbook = await workbookFromXlsx(data);
  workbookCsvReadableStream(restored);
  return bytes;
}

export function report(definition: ReportDefinition, source: ReportDataSource) {
  const workbook: Workbook = generateReport(definition, [{ amount: 10 }]);
  reportDataCsvReadableStream(source, { maxPageTextUnits: 1000 });
  const snapshotOptions: ReportSnapshotOptions = { maxRows: 1000, maxCells: 10000 };
  const snapshot: Promise<Workbook> = workbookFromReportData(source, snapshotOptions);
  const input: CellValue = parseCellInput("1e-999");
  void input;
  void snapshot;
  const remote: ReportDataSource = restDataSource('/data', { columnCount: 3, maxResponseBytes: 1024 });
  return { workbook, remote };
}
`;

try {
  const sourceManifest = JSON.parse(
    await readFile(path.join(sdkDirectory, 'package.json'), 'utf8'),
  );
  assert.equal(sourceManifest.name, packageName);
  const project = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(
    sourceManifest.version,
    project.version,
    'Rebuild the SDK after changing its version',
  );
  assert.notEqual(sourceManifest.private, true, 'The SDK package must be publishable');
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ])
    assert.equal(Object.keys(sourceManifest[field] ?? {}).length, 0, `${field} must be bundled`);

  const [packed] = JSON.parse(
    run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], sdkDirectory),
  );
  assert.equal(packed.name, packageName);
  assert.equal(packed.version, sourceManifest.version);
  assert.equal(path.basename(packed.filename), packed.filename);
  const packedPaths = new Set(packed.files.map((file) => file.path));
  assert.equal(packedPaths.size, packed.files.length, 'Archive contains duplicate paths');
  const allowedFile =
    /^(?:[^/]+\.(?:js|css)|types\/(?:[\w-]+\/)*[\w.-]+\.d\.ts|package\.json|README\.md|LICENSE|NOTICE|THIRD_PARTY_NOTICES\.txt|dependency-inventory\.json|bundle-inputs\.json|example\.html|favicon\.svg)$/;
  for (const filename of packedPaths) {
    assert(
      !path.posix.isAbsolute(filename) && !filename.split('/').includes('..'),
      `Unsafe archive path: ${filename}`,
    );
    assert(!filename.includes('\\'), `Unsafe archive separator: ${filename}`);
    assert(
      allowedFile.test(filename),
      `Unexpected source or configuration in package: ${filename}`,
    );
    assert(
      !/(^|\/)(node_modules|src|\.git|\.github)(\/|$)|(^|\/)(\.env(?:\..*)?|\.npmrc|\.yarnrc(?:\..*)?)$/i.test(
        filename,
      ),
      `Private configuration or source directory in package: ${filename}`,
    );
  }
  for (const required of [
    'lumina.js',
    'lumina.css',
    'types/sdk/index.d.ts',
    'types/style.d.ts',
    'README.md',
    'LICENSE',
    'NOTICE',
    'THIRD_PARTY_NOTICES.txt',
    'dependency-inventory.json',
    'bundle-inputs.json',
  ])
    assert(packedPaths.has(required), `Package is missing ${required}`);

  const consumer = path.join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  run(
    npm,
    [
      'install',
      '--ignore-scripts',
      '--offline',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      path.join(temporary, packed.filename),
    ],
    consumer,
  );
  const modules = await readdir(path.join(consumer, 'node_modules'));
  assert.deepEqual(
    modules.filter((name) => !name.startsWith('.')).sort(),
    [packageName],
    'Consumer unexpectedly installed runtime dependencies or React types',
  );
  const installed = path.join(consumer, 'node_modules', packageName);
  const evidence = JSON.parse(await readFile(path.join(installed, 'bundle-inputs.json'), 'utf8'));
  assert(
    evidence.schema === 1 && evidence.sources.length > 0 && evidence.chunks.length > 0,
    'Missing actual bundle input evidence',
  );
  const javascript = [...packedPaths].filter((filename) => filename.endsWith('.js'));
  assert.deepEqual(
    evidence.chunks.map((chunk) => chunk.file).sort(),
    javascript.sort(),
    'Bundle evidence must cover every JS chunk',
  );
  for (const chunk of evidence.chunks) {
    const bytes = await readFile(path.join(installed, chunk.file));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      chunk.sha256,
      'Packed chunk differs from build evidence',
    );
    assert.equal(bytes.length, chunk.bytes);
  }
  const inventory = JSON.parse(
    await readFile(path.join(installed, 'dependency-inventory.json'), 'utf8'),
  );
  const notices = await readFile(path.join(installed, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  for (const dependency of inventory.packages) {
    const licenseTexts = [];
    const supplements = await supplementalNotices(root, dependency);
    assert.deepEqual(
      dependency.licenseFiles.filter((notice) =>
        supplements.some((item) => item.notice.path === notice.path),
      ),
      supplements.map((item) => item.notice),
      'Supplemental license evidence missing or changed',
    );
    for (const notice of dependency.licenseFiles) {
      const supplemental = supplements.find((item) => item.notice.path === notice.path);
      let text;
      if (supplemental) text = supplemental.text;
      else {
        const filename = path.resolve(root, dependency.location, notice.path);
        assert(
          filename.startsWith(path.join(root, 'node_modules') + path.sep),
          'Notice source escapes dependencies',
        );
        text = await readFile(filename, 'utf8');
        if (notice.excerptStartLine !== undefined) {
          assert(
            Number.isSafeInteger(notice.excerptStartLine) && notice.excerptStartLine > 0,
            'Invalid notice excerpt',
          );
          text = text
            .split('\n')
            .slice(notice.excerptStartLine - 1)
            .join('\n');
        }
      }
      licenseTexts.push(text);
      assert.equal(
        createHash('sha256').update(text).digest('hex'),
        notice.sha256,
        'Installed dependency notice hash mismatch',
      );
      assert.equal(
        Buffer.byteLength(text),
        notice.bytes,
        'Installed dependency notice length mismatch',
      );
      assert.equal(
        hasLicenseText(text),
        notice.hasLicenseText,
        'Incorrect license text evidence flag',
      );
      assert(
        notices.includes(`--- ${dependency.location}/${notice.path} ---\n${text}`),
        'Packed third-party notices omit installed dependency text',
      );
    }
    assert.deepEqual(
      dependency.licenseCoverage,
      declaredLicenseCoverage(dependency.license, licenseTexts),
      'Declared license coverage does not match shipped source notices',
    );
  }
  for (const bundle of inventory.vendorBundles ?? []) {
    for (const relative of [bundle.browserEntry, bundle.sourceMapPath]) {
      assert(
        typeof relative === 'string' &&
          relative.startsWith('node_modules/') &&
          !relative.split('/').includes('..'),
        'Vendor source escapes dependencies',
      );
    }
    validateVendorEvidence(
      bundle,
      evidence,
      await readFile(path.join(root, bundle.browserEntry)),
      await readFile(path.join(root, bundle.sourceMapPath)),
    );
    const sourceMap = JSON.parse(await readFile(path.join(root, bundle.sourceMapPath), 'utf8'));
    for (const component of bundle.components) {
      const reviewed = await reviewedEmbeddedComponent(root, bundle, component, sourceMap);
      assert.deepEqual(component.review ?? null, reviewed, 'Reviewed embedded evidence changed');
      if (reviewed?.licenseEvidence)
        assert(
          notices.includes(reviewed.licenseEvidence.text),
          'Packed third-party notices omit reviewed embedded license text',
        );
      for (const notice of [
        ...(component.noticeEvidence ?? []),
        ...(component.attributionEvidence ?? []),
      ]) {
        assert.equal(
          createHash('sha256').update(notice.text).digest('hex'),
          notice.noticeSha256,
          'Embedded notice hash mismatch',
        );
        assert(
          component.sourcePaths.includes(notice.sourcePath),
          'Embedded notice lacks a recorded source path',
        );
        assert(
          notices.includes(notice.text),
          'Packed third-party notices omit recorded upstream attribution',
        );
      }
    }
  }
  const manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.deepEqual(manifest, sourceManifest, 'Installed package metadata differs from the build');

  const example = await readFile(path.join(installed, 'example.html'), 'utf8');
  assert(example.includes('href="./favicon.svg"'), 'Packaged example must use its local favicon');
  assert.deepEqual(
    await readFile(path.join(installed, 'favicon.svg')),
    await readFile(path.join(root, 'public/favicon.svg')),
    'Packaged favicon differs from source',
  );
  assert(!example.includes('src/sdk'), 'Packaged example still imports source code');
  assert(
    !example.includes('%BASE_URL%'),
    'Packaged example still contains the development base URL',
  );
  assert(
    example.includes('https://jjttkid-hw.github.io/lumina-sheets/'),
    'Packaged example is missing the online workspace link',
  );
  let exampleSdkImports = 0;
  for (const [, script] of example.matchAll(
    /<script\b[^>]*\btype=["']module["'][^>]*>([\s\S]*?)<\/script>/g,
  )) {
    const source = ts.createSourceFile(
      'example.js',
      script,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        assert(specifier.startsWith('./'), `Example import is not package-relative: ${specifier}`);
        assert(
          packedPaths.has(specifier.slice(2)),
          `Example import is missing from package: ${specifier}`,
        );
        if (specifier === './lumina.js') exampleSdkImports++;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert(exampleSdkImports > 0, 'Packaged example does not import the built SDK');
  assert(example.includes('href="./lumina.css"'), 'Packaged example does not load SDK styles');

  // Every runtime chunk and declaration must resolve only to files in the tarball.
  // Visit all published declarations, not just those exercised by the TS fixture.
  for (const filename of packedPaths) {
    if (!filename.endsWith('.js') && !filename.endsWith('.d.ts')) continue;
    const content = await readFile(path.join(installed, filename), 'utf8');
    const isDeclaration = filename.endsWith('.d.ts');
    const source = ts.createSourceFile(
      filename,
      content,
      ts.ScriptTarget.Latest,
      true,
      isDeclaration ? ts.ScriptKind.TS : ts.ScriptKind.JS,
    );
    assert.equal(
      source.parseDiagnostics.length,
      0,
      `Invalid JavaScript/declaration syntax: ${filename}`,
    );
    for (const reference of source.typeReferenceDirectives)
      assert.fail(`External ambient type ${reference.fileName} in ${filename}`);
    const checkReference = (specifier, isTripleSlash = false) => {
      assert(specifier.startsWith('.'), `Unbundled dependency ${specifier} in ${filename}`);
      if (!isTripleSlash)
        assert(specifier.endsWith('.js'), `Non-ESM reference ${specifier} in ${filename}`);
      const target = path.posix.normalize(
        path.posix.join(
          path.posix.dirname(filename),
          isDeclaration && specifier.endsWith('.js') ? specifier.slice(0, -3) + '.d.ts' : specifier,
        ),
      );
      assert(packedPaths.has(target), `Missing packaged dependency: ${filename} → ${target}`);
    };
    for (const reference of source.referencedFiles) checkReference(reference.fileName, true);
    function visit(node) {
      const specifier =
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
          ? node.moduleSpecifier
          : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
            ? node.argument.literal
            : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
              ? node.arguments[0]
              : ts.isExternalModuleReference(node)
                ? node.expression
                : undefined;
      if (specifier && ts.isStringLiteralLike(specifier)) checkReference(specifier.text);
      else if (specifier) assert.fail(`Unverifiable dynamic dependency in ${filename}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }

  await writeFile(path.join(consumer, 'index.ts'), consumerSource);
  for (const mode of ['NodeNext', 'Bundler']) {
    const configuration = {
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: mode === 'NodeNext' ? 'NodeNext' : 'ESNext',
        moduleResolution: mode,
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        noUncheckedSideEffectImports: true,
        verbatimModuleSyntax: true,
        types: [],
        typeRoots: [],
      },
      files: ['index.ts'],
    };
    const configPath = path.join(consumer, `tsconfig.${mode}.json`);
    await writeFile(configPath, JSON.stringify(configuration, null, 2));
    run(process.execPath, [compiler, '-p', configPath], consumer);
    console.log(
      `SDK consumer: strict TypeScript ${mode} passed without React or ambient type packages`,
    );
  }

  await writeFile(
    path.join(consumer, 'runtime.mjs'),
    `
import assert from 'node:assert/strict';
assert.equal(typeof document, 'undefined');
const sdk = await import('lumina-report-sdk');
for (const name of ['createSpreadsheet', 'LuminaSpreadsheet', 'LuminaError', 'DataValidationError', 'createEvaluator', 'generateReport', 'arrayDataSource', 'restDataSource', 'ReportChunkCache', 'workbookToXlsx', 'workbookFromXlsx', 'workbookToPdf', 'workbookCsvReadableStream', 'reportDataCsvReadableStream', 'workbookFromReportData', 'productBuildIdentity']) {
  assert.equal(typeof sdk[name], 'function', 'Missing runtime API: ' + name);
}
const build = sdk.productBuildIdentity();
assert(build && build.schema === 1 && build.mode === 'production');
assert.equal(build.version, '0.29.0');
assert.match(build.sourceSha256, /^[a-f0-9]{64}$/);
assert.equal(sdk.parseCellInput('1e-999'), '1e-999');
assert.equal(sdk.parseCellInput('0.1234567890123456789'), '0.1234567890123456789');
assert.equal(sdk.parseCellInput('12.5'), 12.5);
assert.equal(sdk.cellKey(1, 2), 'C2');
assert.deepEqual(sdk.parseCellKey('C2'), { row: 1, col: 2 });
const workbook = {
  id: 'consumer-check', name: 'Consumer check', description: '',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  activeSheetId: 'sheet-1',
  sheets: [{ id: 'sheet-1', name: 'Sheet1', rowCount: 2, colCount: 2, frozenRows: 0,
    cells: { A1: { value: 10 }, B1: { value: '=A1*2' } } }],
};
const evaluate = sdk.createEvaluator(workbook);
assert.equal(evaluate(workbook.sheets[0], 'B1'), 20);
workbook.sheets[0].cells.A2 = { value: '=IFERROR(1e999,42)' };
assert.equal(evaluate(workbook.sheets[0], 'A2'), 42);
assert.deepEqual(evaluate.result(workbook.sheets[0], 'A2'), { kind: 'value', value: 42 });
const source = sdk.arrayDataSource([[10, 20], [30, 40]], { columnCount: 2 });
assert.deepEqual((await source.fetchPage(1, 1)).rows, [[30, 40]]);
const cache = new sdk.ReportChunkCache(source, { pageSize: 1 });
const unsubscribe = cache.subscribe(() => {
  if (cache.size && !cache.loading) cache.clear();
});
await assert.rejects(cache.getRow(0), { name: 'AbortError' });
assert.equal(cache.size, 0);
unsubscribe();
assert.deepEqual(await cache.getRow(0), [10, 20]);
cache.dispose();
const budgetCache = new sdk.ReportChunkCache(source, { pageSize: 100, maxPageCells: 2, maxPageTextUnits: 4 });
assert.equal(budgetCache.pageSize, 1);
assert.deepEqual(await budgetCache.getRow(1), [30, 40]);
budgetCache.dispose();
const textCache = new sdk.ReportChunkCache(sdk.arrayDataSource([['12345']]), { maxPageTextUnits: 4 });
await assert.rejects(textCache.getPage(0), /maxPageTextUnits/);
assert.equal(textCache.size, 0);
textCache.dispose();
const snapshot = await sdk.workbookFromReportData(source, { pageSize: 1 });
assert.deepEqual(snapshot.sheets[0].dataSource, { kind: 'static', totalRows: 2 });
assert.equal(snapshot.sheets[0].cells.B2.value, 40);
const blankTail = await sdk.workbookFromReportData(sdk.arrayDataSource([[7], [], []], { columnCount: 3 }));
assert.equal(Object.keys(blankTail.sheets[0].cells).length, 2);
assert.equal(blankTail.sheets[0].cells.C3.value, '');
assert.equal(await (await sdk.workbookCsvBlob(blankTail)).text(), '7,,\\r\\n,,\\r\\n,,\\r\\n');

assert((await new Response(sdk.workbookCsvReadableStream(snapshot)).text()).includes('30,40'));
const partial = structuredClone(workbook);
partial.sheets[0].dataSource = { kind: 'paged', totalRows: 1000 };
assert.deepEqual(sdk.validateWorkbook(partial).sheets[0].dataSource, partial.sheets[0].dataSource);
await assert.rejects(sdk.workbookToXlsx(partial), /分页/);
await assert.rejects(sdk.workbookCsvBlob(partial), /分页/);
assert((await new Response(sdk.reportDataCsvReadableStream(source)).text()).includes('30,40'));
await assert.rejects(sdk.reportDataCsvBlob(sdk.arrayDataSource([['long']]), { maxPageTextUnits: 3 }), /maxPageTextUnits/);
const boundedRest = sdk.restDataSource('https://example.test/data', { columnCount: 1, maxResponseBytes: 8, fetcher: async () => new Response('{"rows":[[1]]}') });
await assert.rejects(boundedRest.fetchPage(0, 1), /maxResponseBytes/);
const invalidUtf8 = new Uint8Array([...new TextEncoder().encode('{"rows":[["'), 255, ...new TextEncoder().encode('"]]}')]);
const encodedRest = sdk.restDataSource('https://example.test/data', { columnCount: 1, fetcher: async () => new Response(invalidUtf8) });
await assert.rejects(encodedRest.fetchPage(0, 1), /UTF-8/);
assert.equal(new sdk.LuminaError('INVALID_ARGUMENT', 'check').code, 'INVALID_ARGUMENT');
console.log('SDK consumer: ESM import and non-DOM public API checks passed');
`,
  );
  process.stdout.write(run(process.execPath, ['runtime.mjs'], consumer));
  const archive = path.join(temporary, packed.filename);
  const sha256 = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
  if (packDestination) {
    await mkdir(packDestination, { recursive: true });
    await copyFile(archive, path.join(packDestination, packed.filename));
    await writeFile(
      path.join(packDestination, `${packed.filename}.sha256`),
      `${sha256}  ${packed.filename}\n`,
    );
  }
  console.log('SDK package: archive contents, example and dependency closure passed');
  console.log(
    JSON.stringify({
      name: packed.name,
      version: packed.version,
      files: packed.files.length,
      packedBytes: packed.size,
      sha256,
      artifact: packDestination ? path.join(packDestination, packed.filename) : null,
    }),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

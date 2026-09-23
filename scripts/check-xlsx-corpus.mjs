import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const artifact = path.resolve(`artifacts/lumina-report-sdk-${version}.tgz`);
const output = path.resolve('artifacts/xlsx-corpus/result.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const archive = await readFile(artifact);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'lumina-xlsx-corpus-'));
const expectedChecks = [
  'business-report-roundtrip',
  'structure-report-roundtrip',
  'synthetic-supported-subset',
  'independent-reader-contract',
  'unsupported-image-rejection',
];
const report = {
  schema: 1,
  version,
  executedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    exceljs: JSON.parse(await readFile('node_modules/exceljs/package.json', 'utf8')).version,
  },
  artifact: path.relative(process.cwd(), artifact),
  artifactSha256: hash(archive),
  scope:
    'Installed lumina-report-sdk XLSX supported-subset corpus. Covers tracked business inputs, package export/import, an independent ExcelJS reader and explicit rejection of embedded images. It is not complete Excel/OOXML compatibility or a desktop Excel/WPS certification.',
  checks: [],
  errors: [],
};
async function check(name, action) {
  const started = Date.now();
  try {
    const details = await action();
    report.checks.push({ name, status: 'passed', elapsedMs: Date.now() - started, details });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({
      name,
      status: 'failed',
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function data(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
function validation(rule) {
  const { id: _id, sheetId: _sheetId, ...value } = rule;
  return value;
}
function sheetProjection(sheet) {
  return {
    name: sheet.name,
    rowCount: sheet.rowCount,
    colCount: sheet.colCount,
    cells: Object.fromEntries(Object.entries(sheet.cells).sort(([a], [b]) => a.localeCompare(b))),
    columnWidths: sheet.columnWidths ?? {},
    rowHeights: sheet.rowHeights ?? {},
    hiddenRows: sheet.hiddenRows ?? [],
    hiddenColumns: sheet.hiddenColumns ?? [],
    frozenRows: sheet.frozenRows ?? 0,
    merges: sheet.merges ?? [],
    printSettings: sheet.printSettings ?? null,
    dataValidations: (sheet.dataValidations ?? []).map(validation),
  };
}
function workbookProjection(workbook) {
  return workbook.sheets.map(sheetProjection);
}
async function trackedRoundtrip(sdk, relative, verify) {
  const bytes = await readFile(relative);
  const first = await sdk.workbookFromXlsx(data(bytes));
  verify(first);
  const exported = new Uint8Array(await sdk.workbookToXlsx(first));
  const second = await sdk.workbookFromXlsx(data(exported));
  assert.deepEqual(workbookProjection(second), workbookProjection(first));
  return {
    input: relative,
    inputBytes: bytes.length,
    inputSha256: hash(bytes),
    exportedBytes: exported.length,
    semanticSha256: hash(Buffer.from(JSON.stringify(workbookProjection(second)))),
    sheets: second.sheets.length,
    storedCells: second.sheets.reduce((count, sheet) => count + Object.keys(sheet.cells).length, 0),
  };
}
function syntheticWorkbook() {
  const createdAt = '2026-09-23T00:00:00.000Z';
  return {
    id: 'corpus-workbook',
    name: 'XLSX 受支持子集',
    description: '公开安装包语料验收',
    activeSheetId: 'main',
    createdAt,
    updatedAt: createdAt,
    category: '验收',
    starred: false,
    sheets: [
      {
        id: 'main',
        name: '业务 数据',
        rowCount: 100,
        colCount: 16,
        cells: {
          A1: {
            value: '销售报告',
            richText: [
              { text: '销售', style: { bold: true, color: '#23644D' } },
              { text: '报告', style: { italic: true, fontFamily: 'Arial' } },
            ],
          },
          A2: { value: 120, style: { format: 'currency', align: 'right' } },
          B2: { value: 30, style: { format: 'number' } },
          C2: { value: '=A2-B2', style: { format: 'currency', bold: true } },
          D2: {
            value: '项目主页',
            hyperlink: { target: 'https://example.com/lumina', tooltip: '打开项目' },
          },
          A4: { value: '合并标题', style: { bold: true, background: '#E8F2EC' } },
          A5: { value: true },
          B5: { value: '_x0041_\r\n中文😀' },
          C5: { value: 45292, style: { format: 'date' } },
          D5: { value: '待审核' },
        },
        columnWidths: { 0: 98, 1: 112, 2: 126, 3: 140 },
        rowHeights: { 0: 32, 3: 28 },
        hiddenRows: [6],
        hiddenColumns: [5],
        frozenRows: 1,
        merges: [{ start: { row: 3, col: 0 }, end: { row: 3, col: 1 } }],
        printSettings: {
          paperSize: 'A4',
          orientation: 'landscape',
          margins: { top: 36, right: 36, bottom: 36, left: 36 },
          repeatRows: 1,
          rowBreaks: [20],
          columnBreaks: [8],
        },
        dataValidations: [
          {
            id: 'quantity',
            kind: 'whole',
            range: { start: { row: 1, col: 0 }, end: { row: 1, col: 0 } },
            operator: 'between',
            min: 0,
            max: 1000,
            allowBlank: false,
            message: '请输入 0–1000 的整数',
          },
          {
            id: 'status',
            kind: 'list',
            range: { start: { row: 4, col: 3 }, end: { row: 9, col: 3 } },
            values: ['待审核', '已确认', '已取消'],
            allowBlank: false,
          },
        ],
      },
      {
        id: 'summary',
        name: '汇总',
        rowCount: 100,
        colCount: 16,
        cells: {
          A1: { value: "='业务 数据'!C2*2", style: { format: 'currency' } },
          B1: { value: '跨表计算' },
        },
        columnWidths: { 0: 126 },
      },
    ],
  };
}
try {
  execFileSync('tar', ['-xzf', artifact, '-C', temporary], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  const installed = path.join(temporary, 'package');
  const manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'lumina-report-sdk');
  assert.equal(manifest.version, version);
  const sdk = await import(pathToFileURL(path.join(installed, 'lumina.js')).href);

  await check('business-report-roundtrip', () =>
    trackedRoundtrip(sdk, 'docs/artifacts/report-v05.xlsx', (workbook) => {
      const sheet = workbook.sheets[0];
      assert.equal(sheet.name, '报表');
      assert.equal(sheet.cells.E5.value, '=SUM(E2:E4)');
      assert.equal(sheet.dataValidations?.length, 4);
      assert.deepEqual(sheet.printSettings?.rowBreaks, [3]);
      assert.equal(sheet.frozenRows, 1);
    }),
  );
  await check('structure-report-roundtrip', () =>
    trackedRoundtrip(sdk, 'docs/artifacts/report-v06-structure.xlsx', (workbook) => {
      const sheet = workbook.sheets[0];
      assert.equal(sheet.cells.E2, undefined);
      assert.equal(sheet.cells.F2.value, '=B2*C2');
      assert.equal(sheet.cells.F6.value, '=SUM(F2:F5)');
      assert.equal(sheet.dataValidations?.[3].range.end.col, 6);
      assert.equal(sheet.columnWidths?.[6], 260);
    }),
  );

  const source = syntheticWorkbook();
  let syntheticBytes;
  let restored;
  await check('synthetic-supported-subset', async () => {
    syntheticBytes = new Uint8Array(await sdk.workbookToXlsx(source));
    restored = await sdk.workbookFromXlsx(data(syntheticBytes));
    assert.equal(restored.sheets.length, 2);
    const main = restored.sheets[0];
    const summary = restored.sheets[1];
    // ExcelJS materializes a default width for an otherwise unconfigured
    // hidden column and reports an explicit zero repeat-column count. Those
    // defaults are harmless normalization; the authored layout and values
    // must still remain intact.
    assert.deepEqual(
      { 0: main.columnWidths?.[0], 1: main.columnWidths?.[1], 2: main.columnWidths?.[2], 3: main.columnWidths?.[3] },
      { 0: 98, 1: 112, 2: 126, 3: 140 },
    );
    assert.deepEqual(main.hiddenRows, [6]);
    assert.deepEqual(main.hiddenColumns, [5]);
    assert.deepEqual(main.merges, [{ start: { row: 3, col: 0 }, end: { row: 3, col: 1 } }]);
    assert.equal(main.cells.C2.value, '=A2-B2');
    assert.equal(main.cells.D2.hyperlink?.target, 'https://example.com/lumina');
    assert.equal(main.cells.D2.hyperlink?.tooltip, '打开项目');
    assert.deepEqual(main.dataValidations?.map(validation), source.sheets[0].dataValidations?.map(validation));
    assert.deepEqual(main.printSettings, {
      paperSize: 'A4',
      orientation: 'landscape',
      margins: { top: 36, right: 36, bottom: 36, left: 36 },
      repeatRows: 1,
      repeatColumns: 0,
      rowBreaks: [20],
      columnBreaks: [8],
    });
    assert.equal(summary.cells.A1.value, "='业务 数据'!C2*2");
    assert.equal(sdk.createEvaluator(restored).result(restored.sheets[0], 'C2').value, 90);
    assert.equal(sdk.createEvaluator(restored).result(restored.sheets[1], 'A1').value, 180);
    return {
      generatedBytes: syntheticBytes.length,
      generatedSha256: hash(syntheticBytes),
      semanticSha256: hash(Buffer.from(JSON.stringify(workbookProjection(restored)))),
      sheets: restored.sheets.length,
      storedCells: restored.sheets.reduce(
        (count, sheet) => count + Object.keys(sheet.cells).length,
        0,
      ),
      features: [
        'scalar-values',
        'formulas-and-cached-results',
        'styles',
        'rich-text',
        'hyperlinks',
        'merges',
        'validation',
        'print-settings',
        'hidden-axes',
        'frozen-rows',
        'cross-sheet-reference',
      ],
    };
  });
  await check('independent-reader-contract', async () => {
    assert(syntheticBytes, 'Synthetic workbook was not generated');
    const external = new ExcelJS.Workbook();
    await external.xlsx.load(data(syntheticBytes));
    assert.equal(external.worksheets.length, 2);
    const main = external.getWorksheet('业务 数据');
    assert(main);
    const rich = main.getCell('A1').value;
    assert.equal(rich.richText.map((run) => run.text).join(''), '销售报告');
    assert.equal(main.getCell('C2').value.formula, 'A2-B2');
    assert.equal(main.getCell('C2').value.result, 90);
    assert.equal(main.getCell('D2').value.hyperlink, 'https://example.com/lumina');
    assert.equal(main.getCell('A4').isMerged, true);
    assert.equal(main.getCell('B4').isMerged, true);
    assert.equal(main.getRow(7).hidden, true);
    assert.equal(main.getColumn(6).hidden, true);
    const summary = external.getWorksheet('汇总');
    assert.equal(summary.getCell('A1').value.formula, "'业务 数据'!C2*2");
    assert.equal(summary.getCell('A1').value.result, 180);
    return {
      reader: `exceljs@${report.environment.exceljs}`,
      sheets: external.worksheets.map((sheet) => sheet.name),
      formulaCache: [main.getCell('C2').value.result, summary.getCell('A1').value.result],
      mergedRange: 'A4:B4',
      hyperlink: main.getCell('D2').value.hyperlink,
    };
  });
  await check('unsupported-image-rejection', async () => {
    const external = new ExcelJS.Workbook();
    const sheet = external.addWorksheet('含图片对象');
    sheet.getCell('A1').value = '正文必须保留';
    const imageId = external.addImage({
      base64:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      extension: 'png',
    });
    sheet.addImage(imageId, 'B2:C3');
    const bytes = new Uint8Array(await external.xlsx.writeBuffer());
    let message = '';
    try {
      await sdk.workbookFromXlsx(data(bytes));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.match(message, /图片|内容丢失/);
    return {
      generator: `exceljs@${report.environment.exceljs}`,
      inputBytes: bytes.length,
      inputSha256: hash(bytes),
      rejected: true,
      error: message,
    };
  });
} catch (error) {
  report.errors.push({
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack,
  });
} finally {
  const actual = report.checks.map((item) => item.name);
  const missingChecks = expectedChecks.filter((name) => !actual.includes(name));
  const unexpectedChecks = actual.filter((name) => !expectedChecks.includes(name));
  const duplicateChecks = actual.filter((name, index) => actual.indexOf(name) !== index);
  const failedChecks = report.checks.filter((item) => item.status !== 'passed').map((item) => item.name);
  report.validation = {
    expectedChecks,
    actualChecks: actual,
    missingChecks,
    unexpectedChecks,
    duplicateChecks: [...new Set(duplicateChecks)],
    failedChecks,
    errorCount: report.errors.length,
  };
  report.status =
    !missingChecks.length &&
    !unexpectedChecks.length &&
    !duplicateChecks.length &&
    !failedChecks.length &&
    !report.errors.length
      ? 'passed'
      : 'failed';
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await rm(temporary, { recursive: true, force: true });
  if (report.status !== 'passed') process.exitCode = 1;
  else
    console.log(
      JSON.stringify({
        status: report.status,
        report: path.relative(process.cwd(), output),
        checks: report.checks.length,
        artifactSha256: report.artifactSha256,
      }),
    );
}

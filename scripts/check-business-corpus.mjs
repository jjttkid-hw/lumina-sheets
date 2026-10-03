import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const root = 'docs/acceptance/wps-business-2026-10-03-r34';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const artifact = path.resolve(`artifacts/lumina-report-sdk-${version}.tgz`);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const data = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
const expected = {
  应收账款: { E2: 1000, E3: 0, E4: 800.25, E5: -200, E6: 1600.25, E8: 1800.25, E9: 2 },
  库存: {
    F2: 6,
    H2: 75,
    J2: '补货',
    F3: 22,
    H3: 181.5,
    J3: '充足',
    F4: 60,
    H4: 192,
    J4: '充足',
    H5: 448.5,
  },
  项目费用: { C6: 423.44, C7: 223.44, C8: 448.5, C9: 1600.25, C10: 1625.31 },
};
const editedExpected = {
  应收账款: { ...expected['应收账款'], E2: 900, E6: 1500.25, E8: 1700.25 },
  库存: { ...expected['库存'], F2: -2, H2: -25, H5: 348.5 },
  项目费用: { ...expected['项目费用'], C8: 348.5, C9: 1500.25, C10: 1425.31 },
};
const fixtureDigests = {
  'wps-business-saved.xlsx': '56bc904e89ae3f1bc55353876a9ace579fb4aa501bf2ef895cc8483c2141b9f3',
  'wps-reedited-export.xlsx': '4f633599ca393a517b318135f450911ae5ea961d01d14af05f1db55f6ed78fc0',
  'wps-nonblocking-validation.xlsx':
    '012d0bba6cdbef0a7f953b9b50c2ac216039d1dc36fe2d1bf53380df1b66a2b2',
  'wps-custom-title.xlsx': 'ac216df1a5c0e53ff37703d4e558531f001906c1aed92c3eb377e5b786ca77ae',
};
async function readFixture(file) {
  const bytes = await readFile(`${root}/${file}`);
  assert.equal(hash(bytes), fixtureDigests[file], `Retained WPS fixture changed: ${file}`);
  return bytes;
}
function equal(actual, target, label) {
  if (typeof target === 'number')
    assert(
      typeof actual === 'number' && Math.abs(actual - target) < 1e-9,
      `${label}: expected ${target}, got ${actual}`,
    );
  else assert.equal(actual, target, label);
}
function verify(sdk, workbook, values) {
  assert.deepEqual(
    workbook.sheets.map((s) => s.name),
    Object.keys(values),
  );
  const evaluate = sdk.createEvaluator(workbook);
  let formulas = 0;
  for (const sheet of workbook.sheets) {
    for (const [key, value] of Object.entries(values[sheet.name])) {
      assert(sheet.cells[key].value.startsWith('='), `${sheet.name}!${key} lost its formula`);
      equal(evaluate(sheet, key), value, `${sheet.name}!${key}`);
      formulas++;
    }
    assert.equal(sheet.frozenRows, 1);
    assert.equal(sheet.printSettings.orientation, 'landscape');
  }
  const ar = workbook.sheets[0];
  assert.equal(ar.cells.A2.value, '000001');
  assert.equal(ar.cells.B5.value, '跨行\n演示客户😀');
  assert.equal(ar.cells.G4.value, 45351);
  assert.equal(ar.cells.G5.value, 45352.5);
  assert.equal(ar.cells.G4.style.format, 'date');
  const rule = workbook.sheets[2].dataValidations[0];
  assert.deepEqual(rule.values, ['通过', '待审', '拒绝']);
  assert.equal(rule.allowBlank, false);
  return { formulas, values };
}
const checks = [];
const expectedChecks = [
  'desktop-caches',
  'installed-import',
  'installed-roundtrip',
  'edited-cross-sheet-roundtrip',
  'desktop-reedited-export',
  'nonblocking-validation-rejected',
  'custom-title-roundtrip',
  'native-input-prompt-roundtrip',
  'native-active-sheet-roundtrip',
];
const report = {
  schema: 1,
  version,
  executedAt: new Date().toISOString(),
  environment: { platform: process.platform, arch: process.arch, node: process.version },
  status: 'running',
  artifactSha256: hash(await readFile(artifact)),
  scope:
    'Installed SDK versus retained native WPS synthetic business workbook caches. Not full Excel/WPS certification, live desktop automation or customer data.',
  checks,
  errors: [],
};
const temporary = await mkdtemp(path.join(os.tmpdir(), 'lumina-business-'));
async function check(name, action) {
  try {
    checks.push({ name, status: 'passed', details: await action() });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, status: 'failed', error: error.message });
  }
}
try {
  execFileSync('tar', ['-xzf', artifact, '-C', temporary]);
  const sdk = await import(pathToFileURL(path.join(temporary, 'package/lumina.js')).href);
  const bytes = await readFixture('wps-business-saved.xlsx');
  report.fixtureSha256 = hash(bytes);
  await check('desktop-caches', async () => {
    const desktop = new ExcelJS.Workbook();
    await desktop.xlsx.load(data(bytes));
    let formulas = 0;
    for (const [name, values] of Object.entries(expected))
      for (const [key, value] of Object.entries(values)) {
        const raw = desktop.getWorksheet(name).getCell(key).value;
        assert(raw && typeof raw.formula === 'string');
        // ExcelJS's formula decoder omits a zero cache; inspect actual XML below.
        if (value !== 0) equal(raw.result, value, `${name}!${key} desktop cache`);
        formulas++;
      }
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    const cell = xml.match(/<c\b[^>]*\br="E3"[^>]*>([\s\S]*?)<\/c>/)?.[1];
    assert.match(cell ?? '', /<v>0<\/v>/);
    return { formulas, values: expected, source: 'WPS desktop-saved formula caches' };
  });
  let workbook;
  await check('installed-import', async () => {
    workbook = await sdk.workbookFromXlsx(data(bytes));
    return verify(sdk, workbook, expected);
  });
  await check('installed-roundtrip', async () =>
    verify(sdk, await sdk.workbookFromXlsx(await sdk.workbookToXlsx(workbook)), expected),
  );
  await check('edited-cross-sheet-roundtrip', async () => {
    workbook.sheets[0].cells.D2.value = 300.5;
    workbook.sheets[1].cells.E2.value = 20;
    verify(sdk, workbook, editedExpected);
    const exported = new Uint8Array(await sdk.workbookToXlsx(workbook));
    const restored = await sdk.workbookFromXlsx(data(exported));
    verify(sdk, restored, editedExpected);
    await mkdir('artifacts/business-corpus', { recursive: true });
    await writeFile('artifacts/business-corpus/lumina-business-edited.xlsx', exported);
    return { ...verify(sdk, restored, editedExpected), exportedSha256: hash(exported) };
  });
  await check('desktop-reedited-export', async () => {
    const bytes = await readFixture('wps-reedited-export.xlsx');
    const values = {
      应收账款: { ...editedExpected['应收账款'], E2: 800, E6: 1400.25, E8: 1600.25 },
      库存: editedExpected['库存'],
      项目费用: { ...editedExpected['项目费用'], C9: 1400.25, C10: 1325.31 },
    };
    const restored = await sdk.workbookFromXlsx(data(bytes));
    assert.equal(restored.sheets[0].cells.D2.value, 400.5);
    assert.equal(restored.sheets[1].cells.E2.value, 20);
    verify(sdk, restored, values);
    verify(sdk, await sdk.workbookFromXlsx(await sdk.workbookToXlsx(restored)), values);
    return { ...verify(sdk, restored, values), fixtureSha256: hash(bytes) };
  });
  await check('custom-title-roundtrip', async () => {
    const bytes = await readFixture('wps-custom-title.xlsx');
    const imported = await sdk.workbookFromXlsx(data(bytes));
    const rule = imported.sheets[2].dataValidations[0];
    assert.equal(rule.errorTitle, '审批状态');
    assert.equal(rule.message, '请选择通过、待审或拒绝');
    const json = sdk.validateWorkbook(JSON.parse(JSON.stringify(imported)));
    const failure = sdk.checkValue(
      json.sheets[2].id,
      'D2',
      '无效',
      json.sheets[2].dataValidations,
    )[0];
    assert.equal(sdk.formatDataValidationFailure(failure), 'D2：审批状态：请选择通过、待审或拒绝');
    const exported = await sdk.workbookToXlsx(json);
    const restored = await sdk.workbookFromXlsx(exported);
    assert.deepEqual(restored.sheets[2].dataValidations[0], rule);
    const external = new ExcelJS.Workbook();
    await external.xlsx.load(exported);
    assert.equal(external.worksheets[2].getCell('D2').dataValidation.errorTitle, '审批状态');
    await writeFile(
      'artifacts/business-corpus/lumina-validation-title.xlsx',
      new Uint8Array(exported),
    );
    return {
      fixtureSha256: hash(bytes),
      title: rule.errorTitle,
      message: rule.message,
      exportedSha256: hash(new Uint8Array(exported)),
    };
  });
  await check('native-input-prompt-roundtrip', async () => {
    const file =
      'docs/acceptance/browser-candidate-2026-10-03-r36/native-wps-input-prompt/wps-saved.xlsx';
    const bytes = await readFile(file);
    assert.equal(hash(bytes), 'bfdb6e22d34316bd34b9f2a2252658e128e92c4984c73dfd047d26bc4a54ab2c');
    const imported = await sdk.workbookFromXlsx(data(bytes));
    const verifyPrompt = (book) => {
      const sheet = book.sheets.find((s) => s.name === '项目费用');
      const rule = sheet.dataValidations[0];
      assert.equal(rule.promptTitle, '审批说明😀');
      assert.equal(rule.prompt, '请选择审批状态\n请先核对金额 <b>原文</b> _x0041_');
      assert.equal(rule.showInputMessage, true);
      assert.equal(rule.errorTitle, '审批状态');
      assert.equal(sheet.cells.D2.value, '通过');
      assert.equal(sdk.createEvaluator(book)(sheet, 'C6'), 423.44);
    };
    verifyPrompt(imported);
    const exported = new Uint8Array(await sdk.workbookToXlsx(imported));
    verifyPrompt(await sdk.workbookFromXlsx(data(exported)));
    const zip = await JSZip.loadAsync(exported);
    const xml = await zip.file('xl/worksheets/sheet3.xml').async('string');
    assert.match(xml, /showInputMessage="1"/);
    assert.match(xml, /promptTitle="审批说明😀"/);
    const output = 'lumina-native-prompt-roundtrip.xlsx';
    await writeFile(`artifacts/business-corpus/${output}`, exported);
    return {
      file,
      fixtureSha256: hash(bytes),
      output,
      exportedSha256: hash(exported),
      promptTitle: '审批说明😀',
    };
  });
  await check('native-active-sheet-roundtrip', async () => {
    const file =
      'docs/acceptance/browser-candidate-2026-10-03-r37/native-wps-active-sheet/wps-saved.xlsx';
    const bytes = await readFile(file);
    assert.equal(hash(bytes), 'b495f3340e154a7a1cd308577f2a01f8a7460baee59d217782eaaa729e327fe2');
    const desktop = new ExcelJS.Workbook();
    await desktop.xlsx.load(data(bytes));
    assert.equal(desktop.views[0].activeTab, 1);
    const imported = await sdk.workbookFromXlsx(data(bytes));
    const compare = (book) => {
      assert.deepEqual(
        book.sheets.map((s) => s.name),
        ['销售明细', '经营汇总'],
      );
      assert.equal(book.activeSheetId, book.sheets[1].id);
      const evaluate = sdk.createEvaluator(book);
      let storedCells = 0,
        formulas = 0;
      for (const sheet of book.sheets) {
        assert.equal(sheet.frozenRows, 1);
        const external = desktop.getWorksheet(sheet.name);
        for (const [key, cell] of Object.entries(sheet.cells)) {
          const other = external.getCell(key);
          if (typeof cell.value === 'string' && cell.value.startsWith('=')) {
            // ExcelJS resolves shared followers through .formula/.result getters.
            assert.equal(cell.value, `=${other.formula}`, `${sheet.name}!${key} formula`);
            assert.notEqual(other.result, undefined, `${sheet.name}!${key} missing desktop cache`);
            equal(evaluate(sheet, key), other.result, `${sheet.name}!${key} native cache`);
            formulas++;
          } else equal(cell.value, other.value ?? '', `${sheet.name}!${key} literal`);
          storedCells++;
        }
      }
      assert.equal(storedCells, 199);
      assert.equal(formulas, 41);
      assert.equal(evaluate(book.sheets[1], 'B2'), 8299000);
      assert.equal(evaluate(book.sheets[1], 'B3'), 4312000);
      return { storedCells, formulas, activeSheet: '经营汇总' };
    };
    compare(imported);
    const exported = new Uint8Array(await sdk.workbookToXlsx(imported));
    const details = compare(await sdk.workbookFromXlsx(data(exported)));
    const zip = await JSZip.loadAsync(exported);
    assert.match(await zip.file('xl/workbook.xml').async('string'), /activeTab="1"/);
    for (const [index, selected] of [
      [1, false],
      [2, true],
    ]) {
      const xml = await zip.file(`xl/worksheets/sheet${index}.xml`).async('string');
      assert.equal(/<sheetView\b[^>]*\btabSelected="1"/.test(xml), selected);
    }
    const output = 'lumina-native-active-roundtrip.xlsx';
    await writeFile(`artifacts/business-corpus/${output}`, exported);
    return { ...details, file, fixtureSha256: hash(bytes), output, exportedSha256: hash(exported) };
  });
  for (const [name, file, pattern] of [
    ['nonblocking-validation-rejected', 'wps-nonblocking-validation.xlsx', /Stop/],
  ])
    await check(name, async () => {
      const bytes = await readFixture(file);
      let message;
      try {
        await sdk.workbookFromXlsx(data(bytes));
      } catch (error) {
        message = error.message;
      }
      assert.match(message ?? '', pattern);
      return { file, fixtureSha256: hash(bytes), rejection: message };
    });
} catch (error) {
  report.errors.push(error.message);
} finally {
  const actualChecks = checks.map((c) => c.name);
  const missingChecks = expectedChecks.filter((name) => !actualChecks.includes(name));
  const unexpectedChecks = actualChecks.filter((name) => !expectedChecks.includes(name));
  const duplicateChecks = actualChecks.filter(
    (name, index) => actualChecks.indexOf(name) !== index,
  );
  report.validation = {
    expectedChecks,
    actualChecks,
    missingChecks,
    unexpectedChecks,
    duplicateChecks,
    errorCount: report.errors.length,
  };
  report.status =
    !missingChecks.length &&
    !unexpectedChecks.length &&
    !duplicateChecks.length &&
    checks.every((c) => c.status === 'passed') &&
    !report.errors.length
      ? 'passed'
      : 'failed';
  await mkdir('artifacts/business-corpus', { recursive: true });
  await writeFile('artifacts/business-corpus/result.json', JSON.stringify(report, null, 2) + '\n');
  await rm(temporary, { recursive: true, force: true });
  console.log(JSON.stringify(report));
  if (report.status !== 'passed') process.exitCode = 1;
}

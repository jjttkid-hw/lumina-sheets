import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';

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
  'custom-title-rejected',
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
  for (const [name, file, pattern] of [
    ['nonblocking-validation-rejected', 'wps-nonblocking-validation.xlsx', /Stop/],
    ['custom-title-rejected', 'wps-custom-title.xlsx', /标题/],
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

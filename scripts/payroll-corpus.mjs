import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';

const root = 'docs/acceptance/wps-payroll-2026-10-05-r41';
const cases = {
  baseline: {
    file: 'wps-saved.xlsx',
    sha256: '2f68875eeb641248564caf997a2e25776cb56317f509bdef248316ea27c7b886',
    attendance: 0.5,
    wages: [11200, 4000, 6100, 7400],
    paid: [10945.67, 3680, 5788.88, 6950],
    contributions: [1344, 480, 732, 888],
    costs: [12789.67, 4480, 6920.88, 8288],
    totals: [31900, 1600, 334.55, 1670, 28700, 27364.55, 3444, 32478.55],
    cash: [50000, 32478.55, 17521.45, 0, 334.55, 27100, 6841.1375, 10945.67, 3680, 2, 334.55],
  },
  edited: {
    file: 'wps-edited.xlsx',
    sha256: 'c91800dd93ccd717814df1fa7e4a35a2d9596dc6f269be9be5d64bb11d47dbc4',
    attendance: 0.75,
    wages: [11200, 6000, 6100, 7400],
    paid: [10945.67, 5680, 5788.88, 6950],
    contributions: [1344, 720, 732, 888],
    costs: [12789.67, 6720, 6920.88, 8288],
    totals: [31900, 1600, 334.55, 1670, 30700, 29364.55, 3684, 34718.55],
    cash: [50000, 34718.55, 15281.45, 0, 334.55, 29100, 7341.1375, 10945.67, 5680, 2, 334.55],
  },
};
cases.resaved = {
  ...cases.edited,
  file: 'wps-resaved-sdk.xlsx',
  sha256: '3f633dab9d22325c82476933a42266d25d2a08fc499c35ab0129e33079ce20e1',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function equal(actual, expected, label) {
  if (typeof expected === 'number')
    assert(
      typeof actual === 'number' && Math.abs(actual - expected) < 1e-9,
      `${label}: expected ${expected}, got ${actual}`,
    );
  else assert.equal(actual, expected, label);
}
function expectedValues(spec) {
  const payroll = {};
  for (const [column, values] of Object.entries({
    H: spec.wages,
    I: spec.paid,
    J: spec.contributions,
    K: spec.costs,
  }))
    values.forEach((value, i) => {
      payroll[`${column}${i + 2}`] = value;
    });
  spec.totals.forEach((value, i) => {
    payroll[`${'CEFGHIJK'[i]}6`] = value;
  });
  const departments = {};
  for (const [r, indices] of [
    [2, [0, 2]],
    [3, [1]],
    [4, [3]],
  ]) {
    departments[`B${r}`] = indices.length;
    for (const [column, values] of [
      ['C', spec.wages],
      ['D', spec.paid],
      ['E', spec.costs],
    ])
      departments[`${column}${r}`] = indices.reduce((total, i) => total + values[i], 0);
  }
  Object.assign(departments, { B5: 4, C5: spec.totals[4], D5: spec.totals[5], E5: spec.totals[7] });
  return {
    工资明细: payroll,
    部门汇总: departments,
    现金核对: Object.fromEntries(spec.cash.map((value, i) => [`B${i + 2}`, value])),
  };
}

export async function verifyPayrollCorpus(sdk, caseName, outputDirectory) {
  const spec = cases[caseName];
  assert(spec, `Unknown payroll case: ${caseName}`);
  const file = `${root}/${spec.file}`;
  const bytes = await readFile(file);
  assert.equal(hash(bytes), spec.sha256, 'Retained native payroll file changed');
  const desktop = new ExcelJS.Workbook();
  await desktop.xlsx.load(bytes);
  const expected = expectedValues(spec);
  const expectedSheets = ['参数', '工资明细', '部门汇总', '现金核对'];
  function compare(book, target = expected, attendance = spec.attendance) {
    assert.deepEqual(
      book.sheets.map((sheet) => sheet.name),
      expectedSheets,
    );
    assert.equal(book.activeSheetId, book.sheets[3].id);
    const evaluate = sdk.createEvaluator(book);
    let formulas = 0;
    let cells = 0;
    for (const sheet of book.sheets) {
      assert.equal(sheet.frozenRows, 1);
      assert.equal(sheet.printSettings.orientation, 'landscape');
      const external = desktop.getWorksheet(sheet.name);
      const keys = [];
      external.eachRow((row) =>
        row.eachCell((cell) => {
          if (cell.value !== null) keys.push(cell.address);
        }),
      );
      assert.deepEqual(
        Object.keys(sheet.cells)
          .filter((key) => sheet.cells[key].value !== '')
          .sort(),
        keys.sort(),
        `${sheet.name}: complete cell set`,
      );
      for (const key of keys) {
        const other = external.getCell(key);
        if (other.formula) {
          assert.equal(sheet.cells[key].value, `=${other.formula}`, `${sheet.name}!${key} formula`);
          assert(
            Object.hasOwn(target[sheet.name], key),
            `${sheet.name}!${key}: missing independent expectation`,
          );
          equal(evaluate(sheet, key), target[sheet.name][key], `${sheet.name}!${key} SDK result`);
          formulas++;
        } else {
          const value = sheet.name === '工资明细' && key === 'D3' ? attendance : other.value;
          equal(sheet.cells[key].value, value, `${sheet.name}!${key} literal`);
        }
        cells++;
      }
    }
    assert.equal(formulas, 51);
    assert.equal(cells, 119);
    return { formulas, cells };
  }
  let desktopFormulas = 0;
  for (const sheet of desktop.worksheets)
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (!cell.formula) return;
        equal(
          cell.result,
          expected[sheet.name][cell.address],
          `${sheet.name}!${cell.address} native cache`,
        );
        desktopFormulas++;
      }),
    );
  assert.equal(desktopFormulas, 51);
  const imported = await sdk.workbookFromXlsx(bytes);
  const details = compare(imported);
  const exported = new Uint8Array(await sdk.workbookToXlsx(imported));
  compare(await sdk.workbookFromXlsx(exported));
  const independent = new ExcelJS.Workbook();
  await independent.xlsx.load(exported);
  for (const [name, values] of Object.entries(expected))
    for (const [key, value] of Object.entries(values)) {
      const cell = independent.getWorksheet(name).getCell(key);
      assert.equal(cell.formula, desktop.getWorksheet(name).getCell(key).formula);
      equal(cell.result, value, `${name}!${key} exported cache`);
    }
  const output = `lumina-payroll-${caseName}.xlsx`;
  await writeFile(`${outputDirectory}/${output}`, exported);
  if (caseName === 'baseline') {
    imported.sheets[1].cells.D3.value = 0.75;
    const changed = expectedValues(cases.edited);
    compare(imported, changed, 0.75);
    const edited = new Uint8Array(await sdk.workbookToXlsx(imported));
    compare(await sdk.workbookFromXlsx(edited), changed, 0.75);
    await writeFile(`${outputDirectory}/lumina-payroll-edited.xlsx`, edited);
  }
  return {
    ...details,
    file,
    fixtureSha256: hash(bytes),
    output,
    exportedSha256: hash(exported),
    attendance: spec.attendance,
    cashCost: spec.cash[1],
    closingCash: spec.cash[2],
  };
}

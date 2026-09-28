// Executed in the isolated consumer, against only the downloaded npm package.
export function registryConsumerSource(packageName) {
  const prelude = `import assert from 'node:assert/strict';
const sdk = await import(${JSON.stringify(packageName)});
assert(Object.keys(sdk).length, 'Empty package exports');
`;
  if (packageName !== 'lumina-report-sdk') return prelude;
  return prelude + `
for (const name of ['createEvaluator', 'workbookToXlsx', 'workbookFromXlsx']) {
  assert.equal(typeof sdk[name], 'function', 'Missing SDK API: ' + name);
}
const timestamp = '2026-01-01T00:00:00.000Z';
const workbook = {
  id: 'registry-consumer', name: 'Public package check', description: '',
  category: 'verification', starred: false, createdAt: timestamp, updatedAt: timestamp,
  activeSheetId: 'sales',
  sheets: [
    { id: 'sales', name: '销售 明细', rowCount: 20, colCount: 8,
      cells: { A1: { value: '中文😀' }, A2: { value: 120 },
        B2: { value: 30 }, C2: { value: '=A2-B2' } } },
    { id: 'summary', name: '汇总', rowCount: 20, colCount: 8,
      cells: { A1: { value: "='销售 明细'!C2*2" } } },
  ],
};
function verify(book) {
  assert.deepEqual(book.sheets.map(sheet => sheet.name), ['销售 明细', '汇总']);
  const [sales, summary] = book.sheets;
  assert.equal(sales.cells.A1.value, '中文😀');
  assert.equal(sales.cells.A2.value, 120);
  assert.equal(sales.cells.B2.value, 30);
  assert.equal(sales.cells.C2.value, '=A2-B2');
  assert.equal(summary.cells.A1.value, "='销售 明细'!C2*2");
  const evaluate = sdk.createEvaluator(book);
  assert.equal(evaluate(sales, 'C2'), 90);
  assert.equal(evaluate(summary, 'A1'), 180);
}
verify(workbook);
const bytes = await sdk.workbookToXlsx(workbook);
assert(bytes instanceof ArrayBuffer && bytes.byteLength > 0, 'Empty XLSX export');
verify(await sdk.workbookFromXlsx(bytes));
console.log('SDK formula and XLSX roundtrip passed');
`;
}

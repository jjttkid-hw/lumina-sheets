import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const filename = process.argv[2] ?? 'artifacts/lookup-corpus/wps-lookup-input.xlsx';
const book = new ExcelJS.Workbook();
book.creator = 'Lumina synthetic lookup acceptance';
book.created = new Date('2026-10-03T00:00:00Z');
book.modified = book.created;
book.calcProperties.fullCalcOnLoad = true;
function sheet(name, rows) {
  const ws = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  rows.forEach((row) => ws.addRow(row));
  ws.columns.forEach((column) => {
    column.width = 20;
  });
  ws.getRow(1).font = { bold: true };
  return ws;
}
sheet('价目表', [
  ['SKU', '品名', '单价'],
  ['A-001', '组件甲', 12.5],
  ['A-002', '组件乙', 8.25],
  ['A-003', '组件丙', 3.2],
]);
sheet('折扣档位', [
  ['数量下限', '折扣'],
  [0, 0],
  [10, 0.05],
  [50, 0.1],
  [100, 0.15],
]);
const orders = sheet('报价单', [
  ['SKU', '数量', '品名', '单价', '折扣', '应付', '查找位置'],
  ['A-001', 1],
  ['A-002', 10],
  ['A-003', 50],
  ['A-001', 100],
  ['UNKNOWN', 2],
  ['合计'],
]);
for (let r = 2; r <= 6; r++) {
  const formulas = {
    C: `IFERROR(INDEX('价目表'!B2:B4,MATCH(A${r},'价目表'!A2:A4,0)),"缺货")`,
    D: `IFERROR(VLOOKUP(A${r},'价目表'!A2:C4,3,FALSE),0)`,
    E: `VLOOKUP(B${r},'折扣档位'!A2:B5,2,TRUE)`,
    F: `ROUND(B${r}*D${r}*(1-E${r}),2)`,
    G: `MATCH(A${r},'价目表'!A2:A4,0)`,
  };
  for (const [column, formula] of Object.entries(formulas))
    orders.getCell(`${column}${r}`).value = { formula };
  orders.getCell(`E${r}`).numFmt = '0%';
  orders.getCell(`F${r}`).numFmt = '#,##0.00';
}
orders.getCell('F7').value = { formula: 'SUM(F2:F6)' };
orders.getCell('A9').value = '批量有效报价';
orders.getCell('F9').value = { formula: 'COUNTIFS(B2:B6,">=10",D2:D6,">0")' };
orders.getCell('A10').value = 'A 系列数量';
orders.getCell('F10').value = { formula: 'SUMIF(A2:A6,"A-*",B2:B6)' };
book.views = [{ x: 0, y: 0, width: 12000, height: 24000, activeTab: 2 }];
await mkdir(path.dirname(filename), { recursive: true });
await book.xlsx.writeFile(filename);
console.log(filename);

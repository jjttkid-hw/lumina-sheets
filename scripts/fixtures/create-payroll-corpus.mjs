import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const filename = process.argv[2] ?? 'artifacts/payroll-corpus/wps-payroll-input.xlsx';
const book = new ExcelJS.Workbook();
book.creator = 'Lumina synthetic payroll acceptance';
book.created = new Date('2026-10-05T00:00:00Z');
book.modified = book.created;
book.calcProperties.fullCalcOnLoad = true;
function sheet(name, rows) {
  const ws = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  rows.forEach((row) => ws.addRow(row));
  ws.columns.forEach((column) => {
    column.width = 18;
  });
  ws.getRow(1).font = { bold: true };
  ws.pageSetup = { paperSize: 9, orientation: 'landscape' };
  return ws;
}
sheet('参数', [
  ['参数', '数值'],
  ['演示雇主缴费比例', 0.12],
  ['期初现金', 50000],
]);
const payroll = sheet('工资明细', [
  [
    '员工编号',
    '部门',
    '基本工资',
    '出勤比例',
    '奖金调整',
    '报销',
    '扣款',
    '应发工资',
    '实付员工',
    '雇主缴费',
    '现金成本',
  ],
  ['DEMO-001', '研发', 10000, 1, 1200, 245.67, 500],
  ['DEMO-002', '销售', 8000, 0.5, 0, 0, 320],
  ['DEMO-003', '研发', 6400, 0.875, 500, 88.88, 400],
  ['DEMO-004', '运营', 7500, 1, -100, 0, 450],
  ['合计'],
]);
for (let r = 2; r <= 5; r++) {
  for (const [column, formula] of Object.entries({
    H: `ROUND(C${r}*D${r}+E${r},2)`,
    I: `ROUND(H${r}+F${r}-G${r},2)`,
    J: `ROUND(H${r}*'参数'!$B$2,2)`,
    K: `ROUND(H${r}+F${r}+J${r},2)`,
  }))
    payroll.getCell(`${column}${r}`).value = { formula };
  payroll.getCell(`D${r}`).numFmt = '0.0%';
}
for (const column of ['C', 'E', 'F', 'G', 'H', 'I', 'J', 'K'])
  payroll.getCell(`${column}6`).value = { formula: `SUM(${column}2:${column}5)` };
for (const column of ['C', 'E', 'F', 'G', 'H', 'I', 'J', 'K'])
  for (let r = 2; r <= 6; r++) payroll.getCell(`${column}${r}`).numFmt = '#,##0.00';
const departments = sheet('部门汇总', [
  ['部门', '人数', '应发工资', '实付员工', '现金成本'],
  ['研发'],
  ['销售'],
  ['运营'],
  ['合计'],
]);
for (let r = 2; r <= 4; r++) {
  departments.getCell(`B${r}`).value = { formula: `COUNTIF('工资明细'!B2:B5,A${r})` };
  for (const [column, source] of [
    ['C', 'H'],
    ['D', 'I'],
    ['E', 'K'],
  ])
    departments.getCell(`${column}${r}`).value = {
      formula: `SUMIF('工资明细'!B2:B5,A${r},'工资明细'!${source}2:${source}5)`,
    };
}
for (const column of ['B', 'C', 'D', 'E'])
  departments.getCell(`${column}5`).value = { formula: `SUM(${column}2:${column}4)` };
sheet('现金核对', [
  ['指标', '金额'],
  ['期初现金', { formula: "'参数'!B3" }],
  ['现金成本', { formula: "'工资明细'!K6" }],
  ['期末现金', { formula: 'ROUND(B2-B3,2)' }],
  ['部门成本差额', { formula: "ROUND('部门汇总'!E5-B3,2)" }],
  ['报销合计', { formula: "'工资明细'!F6" }],
  ['出勤折算基本工资', { formula: "SUMPRODUCT('工资明细'!C2:C5,'工资明细'!D2:D5)" }],
  ['员工平均实付', { formula: "AVERAGE('工资明细'!I2:I5)" }],
  ['最高实付', { formula: "MAX('工资明细'!I2:I5)" }],
  ['最低实付', { formula: "MIN('工资明细'!I2:I5)" }],
  ['有奖金员工', { formula: 'COUNTIFS(\'工资明细\'!E2:E5,">0",\'工资明细\'!D2:D5,">=0.8")' }],
  [
    '研发报销',
    { formula: "SUMIFS('工资明细'!F2:F5,'工资明细'!B2:B5,\"研发\",'工资明细'!F2:F5,\">0\")" },
  ],
]);
book.views = [{ activeTab: 3 }];
await mkdir(path.dirname(filename), { recursive: true });
await book.xlsx.writeFile(filename);
console.log(filename);

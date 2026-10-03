import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const filename = process.argv[2] ?? 'artifacts/business-corpus/wps-business-input.xlsx';
const book = new ExcelJS.Workbook();
book.creator = 'Lumina synthetic business acceptance';
book.created = new Date('2026-10-03T00:00:00Z');
book.modified = book.created;
book.calcProperties.fullCalcOnLoad = true;
function sheet(name, rows) {
  const ws = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  rows.forEach((row) => ws.addRow(row));
  ws.columns.forEach((column) => {
    column.width = 18;
  });
  ws.getRow(1).font = { bold: true, color: { argb: 'FF23644D' } };
  ws.pageSetup = { paperSize: 9, orientation: 'landscape' };
  return ws;
}
const ar = sheet('应收账款', [
  ['单号', '客户', '开票金额', '已收金额', '未收金额', '状态', '开票日', '账期天数'],
  ['000001', '华东演示客户', 1200.5, 200.5, null, '未结清', 45292, 30],
  ['000002', '华南演示客户', 3000, 3000, null, '已结清', 45323, 60],
  ['000003', '华东演示客户', 800.25, 0, null, '未结清', 45351, 45],
  ['000004', '跨行\n演示客户😀', 500, 700, null, '预收', 45352.5, 15],
  ['合计'],
]);
for (let row = 2; row <= 5; row++) {
  ar.getCell(`E${row}`).value = { formula: `ROUND(C${row}-D${row},2)` };
  ar.getCell(`G${row}`).numFmt = 'yyyy-mm-dd';
  ar.getCell(`C${row}`).numFmt = '#,##0.00';
  ar.getCell(`D${row}`).numFmt = '#,##0.00';
  ar.getCell(`E${row}`).numFmt = '#,##0.00';
}
ar.getCell('E6').value = { formula: 'SUM(E2:E5)' };
ar.getCell('B8').value = '华东未收';
ar.getCell('E8').value = { formula: 'SUMIFS(E2:E5,B2:B5,"华东演示客户",F2:F5,"未结清")' };
ar.getCell('B9').value = '未结清单数';
ar.getCell('E9').value = { formula: 'COUNTIF(F2:F5,"未结清")' };
const stock = sheet('库存', [
  ['物料编号', '物料', '期初', '入库', '出库', '结存', '单价', '库存金额', '安全库存', '补货提示'],
  ['SKU-001', '演示组件 A', 10, 8, 12, null, 12.5, null, 8],
  ['SKU-002', '演示组件 B', 20, 5, 3, null, 8.25, null, 10],
  ['SKU-003', '演示组件 C', 0, 100, 40, null, 3.2, null, 25],
  ['合计'],
]);
for (let row = 2; row <= 4; row++) {
  stock.getCell(`F${row}`).value = { formula: `C${row}+D${row}-E${row}` };
  stock.getCell(`H${row}`).value = { formula: `ROUND(F${row}*G${row},2)` };
  stock.getCell(`J${row}`).value = { formula: `IF(F${row}<I${row},"补货","充足")` };
  stock.getCell(`H${row}`).numFmt = '#,##0.00';
}
stock.getCell('H5').value = { formula: 'SUMPRODUCT(F2:F4,G2:G4)' };
const expenses = sheet('项目费用', [
  ['项目', '部门', '金额', '审批'],
  ['项目甲', '研发', 123.45, '通过'],
  ['项目甲', '销售', 200, '通过'],
  ['项目乙', '研发', 50, '待审'],
  ['项目乙', '研发', 99.99, '通过'],
  ['通过合计', null, { formula: 'SUMIF(D2:D5,"通过",C2:C5)' }],
  ['研发通过', null, { formula: 'SUMIFS(C2:C5,B2:B5,"研发",D2:D5,"通过")' }],
  ['库存占用', null, { formula: "'库存'!H5" }],
  ['应收余额', null, { formula: "'应收账款'!E6" }],
  ['净占用', null, { formula: 'C8+C9-C6' }],
]);
expenses.getCell('D2').dataValidation = {
  type: 'list',
  allowBlank: false,
  formulae: ['"通过,待审,拒绝"'],
  showErrorMessage: true,
  errorStyle: 'stop',
  error: '请选择通过、待审或拒绝',
};
await mkdir(path.dirname(filename), { recursive: true });
await book.xlsx.writeFile(filename);
console.log(filename);

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createBlankWorkbook } from '../src/lib/seed';
import { planStructureEdit } from '../src/lib/structure-edit';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { createEvaluator } from '../src/lib/engine';
import { checkValue } from '../src/lib/data-validation';
import type { Workbook } from '../src/lib/types';

function orderWorkbook(): Workbook {
  const book = createBlankWorkbook('订单结构往返');
  const sheet = book.sheets[0];
  sheet.name = '订单 明细';
  sheet.rowCount = 30;
  sheet.colCount = 8;
  sheet.columnWidths = { 0: 112, 1: 84, 2: 98, 3: 126 };
  sheet.frozenRows = 1;
  sheet.cells = {
    A1: { value: '产品' },
    B1: { value: '数量' },
    C1: { value: '单价' },
    D1: { value: '金额' },
    A2: { value: '订阅' },
    B2: { value: 2 },
    C2: { value: 10 },
    D2: { value: '=B2*C2' },
    A3: { value: '服务' },
    B3: { value: 3 },
    C3: { value: 20 },
    D3: { value: '=B3*C3' },
    A8: { value: '订单说明' },
  };
  sheet.merges = [{ start: { row: 7, col: 0 }, end: { row: 7, col: 1 } }];
  sheet.printSettings = {
    paperSize: 'A3',
    orientation: 'landscape',
    repeatRows: 1,
    repeatColumns: 0,
    margins: { top: 36, right: 36, bottom: 36, left: 36 },
    rowBreaks: [10],
    columnBreaks: [5],
  };
  sheet.dataValidations = [
    {
      id: 'quantity',
      kind: 'whole',
      operator: 'between',
      min: 1,
      max: 100,
      allowBlank: false,
      message: '数量为 1 到 100',
      range: { start: { row: 1, col: 1 }, end: { row: 5, col: 1 } },
    },
  ];
  book.sheets.push({
    id: 'summary',
    name: '汇总',
    rowCount: 30,
    colCount: 8,
    cells: { A1: { value: "=SUM('订单 明细'!D2:D3)" }, B1: { value: "='订单 明细'!$B$2" } },
  });
  return book;
}
function edit(
  book: Workbook,
  axis: 'row' | 'column',
  kind: 'insert' | 'delete',
  index: number,
  count = 1,
): Workbook {
  return {
    ...book,
    sheets: planStructureEdit(book, book.activeSheetId, { axis, kind, index, count }).sheets,
  };
}

describe('structural edits across the real XLSX boundary', () => {
  it('retains moved rules, print positions, merges and cross-sheet formula results after insertion', async () => {
    const original = orderWorkbook();
    const candidate = edit(edit(original, 'row', 'insert', 1, 2), 'column', 'insert', 1);
    const source = candidate.sheets[0];
    expect(source.cells.E4.value).toBe('=C4*D4');
    expect(candidate.sheets[1].cells.A1.value).toBe("=SUM('订单 明细'!E4:E5)");
    const bytes = await workbookToXlsx(candidate);
    const decoded = new ExcelJS.Workbook();
    await decoded.xlsx.load(bytes, { ignoreNodes: ['dataValidations'] });
    expect(decoded.getWorksheet('订单 明细')!.getCell('E4').value).toEqual({
      formula: 'C4*D4',
      result: 20,
    });
    expect(decoded.getWorksheet('汇总')!.getCell('A1').value).toEqual({
      formula: "SUM('订单 明细'!E4:E5)",
      result: 80,
    });
    const restored = await workbookFromXlsx(bytes);
    const sheet = restored.sheets[0],
      summary = restored.sheets[1],
      evaluate = createEvaluator(restored);
    expect(sheet.merges).toEqual(source.merges);
    expect(sheet.merges).toEqual([{ start: { row: 9, col: 0 }, end: { row: 9, col: 2 } }]);
    expect(sheet.printSettings).toMatchObject({
      rowBreaks: [12],
      columnBreaks: [6],
      repeatRows: 1,
      paperSize: 'A3',
    });
    expect(sheet.frozenRows).toBe(1);
    expect(sheet.columnWidths?.[2]).toBe(84);
    expect(sheet.dataValidations).toHaveLength(1);
    expect(sheet.dataValidations![0]).toMatchObject({
      kind: 'whole',
      min: 1,
      max: 100,
      allowBlank: false,
      range: { start: { row: 3, col: 2 }, end: { row: 7, col: 2 } },
      message: '数量为 1 到 100',
    });
    expect(checkValue(sheet.id, 'C4', 101, sheet.dataValidations!)[0].code).toBe('OUT_OF_RANGE');
    expect(evaluate(sheet, 'E4')).toBe(20);
    expect(evaluate(sheet, 'E5')).toBe(60);
    expect(evaluate(summary, 'A1')).toBe(80);
    expect(evaluate(summary, 'B1')).toBe(2);
    expect(original.sheets[0].cells.D2.value).toBe('=B2*C2');
  });

  it('exports deleted-target formulas with real #REF! cached errors and preserves surviving metadata', async () => {
    const candidate = edit(orderWorkbook(), 'column', 'delete', 1);
    const source = candidate.sheets[0];
    expect(source.cells.C2.value).toBe('=#REF!*B2');
    expect(source.dataValidations).toEqual([]);
    expect(source.merges).toEqual([]);
    const bytes = await workbookToXlsx(candidate);
    const decoded = new ExcelJS.Workbook();
    await decoded.xlsx.load(bytes);
    expect(decoded.getWorksheet('订单 明细')!.getCell('C2').value).toEqual({
      formula: '#REF!*B2',
      result: { error: '#REF!' },
    });
    expect(decoded.getWorksheet('汇总')!.getCell('B1').value).toMatchObject({
      result: { error: '#REF!' },
    });
    const restored = await workbookFromXlsx(bytes);
    const evaluate = createEvaluator(restored);
    expect(restored.sheets[0].dataValidations).toEqual([]);
    expect(restored.sheets[0].merges).toEqual([]);
    expect(restored.sheets[0].printSettings).toMatchObject({ rowBreaks: [10], columnBreaks: [4] });
    expect(restored.sheets[0].cells.C2.value).toBe('=#REF!*B2');
    expect(evaluate(restored.sheets[0], 'C2')).toBe('#REF!');
    expect(evaluate(restored.sheets[1], 'B1')).toBe('#REF!');
  });
});

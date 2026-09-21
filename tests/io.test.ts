import { describe, expect, it } from 'vitest';
import {
  csvToWorkbook,
  IMPORT_LIMITS,
  parseCsv,
  serializeCsv,
  validateWorkbook,
  workbookFromXlsx,
  workbookToXlsx,
} from '../src/lib/io';
import { createBlankWorkbook, createDemoWorkbook } from '../src/lib/seed';
import { evaluateCell } from '../src/lib/engine';
import ExcelJS from 'exceljs';

describe('CSV interoperability and safety', () => {
  it('reads BOM, quoted separators, embedded newlines and escaped quotes', () => {
    expect(parseCsv('\uFEFF名称,备注,金额\r\n"云,服务","第一行\n第二行 ""完成""",120\r\n')).toEqual(
      [
        ['名称', '备注', '金额'],
        ['云,服务', '第一行\n第二行 "完成"', '120'],
      ],
    );
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(() => parseCsv('"未结束')).toThrow('未闭合');
  });
  it('neutralizes formula injection while preserving numeric negative values', () => {
    const csv = serializeCsv([
      ['=WEBSERVICE("url")', '+cmd', '-cmd', '@SUM(A1)', ' safe', -42, 'a,b'],
    ]);
    expect(parseCsv(csv)[0]).toEqual([
      '\'=WEBSERVICE("url")',
      "'+cmd",
      "'-cmd",
      "'@SUM(A1)",
      ' safe',
      '-42',
      'a,b',
    ]);
  });
  it('preserves leading-zero and large identifiers and imports useful numbers', () => {
    const book = csvToWorkbook('编号,金额\n00123,123.5\n1234567890123456789,-42');
    expect(book.sheets[0].cells.A2.value).toBe('00123');
    expect(book.sheets[0].cells.B2.value).toBe(123.5);
    expect(book.sheets[0].cells.A3.value).toBe('1234567890123456789');
    expect(book.sheets[0].cells.B3.value).toBe(-42);
  });
});

describe('workbook validation', () => {
  it.each(['a1', '$A1', 'A$1', '$A$1'])(
    'rejects conflicting aliases %s rather than silently replacing A1',
    (alias) => {
      const book = createBlankWorkbook();
      book.sheets[0].cells = { A1: { value: 'original' }, [alias]: { value: 'other' } };
      const before = structuredClone(book);
      expect(() => validateWorkbook(book)).toThrow('单元格地址重复');
      expect(book).toEqual(before);
      book.sheets[0].cells[alias].value = 'original';
      expect(() => validateWorkbook(book)).toThrow('单元格地址重复');
    },
  );
  it('normalizes unambiguous address aliases and preserves formula evaluation', () => {
    const book = createBlankWorkbook();
    book.sheets[0].cells = { $a$1: { value: 3 }, b1: { value: '=A1*2' } };
    const result = validateWorkbook(book);
    expect(result.sheets[0].cells).toEqual({ A1: { value: 3 }, B1: { value: '=A1*2' } });
    expect(evaluateCell(result.sheets[0], 'B1', result)).toBe(6);
    expect(book.sheets[0].cells.A1).toBeUndefined();
  });
  it('rejects duplicate sheet identities without detaching rules or guessing the active sheet', () => {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    sheet.dataValidations = [
      {
        id: 'required',
        sheetId: sheet.id,
        kind: 'list',
        values: ['yes'],
        range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      },
    ];
    book.sheets.push({ ...structuredClone(sheet), name: 'Second' });
    const before = structuredClone(book);
    expect(() => validateWorkbook(book)).toThrow('工作表 ID 不能重复');
    expect(book).toEqual(before);
  });
  it('generates missing sheet IDs while preserving supplied identities and active sheet', () => {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    book.sheets.unshift({ ...structuredClone(sheet), id: '', name: 'Missing' });
    const result = validateWorkbook(book);
    expect(result.sheets[0].id).toBeTruthy();
    expect(result.sheets[0].id).not.toBe(sheet.id);
    expect(result.sheets[1].id).toBe(sheet.id);
    expect(result.activeSheetId).toBe(sheet.id);
    expect(book.sheets[0].id).toBe('');
  });
  it('isolates sparse row and column visibility and rejects invalid metadata', () => {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    sheet.rowHeights = { 2: 36 };
    sheet.hiddenRows = [4, 1];
    sheet.hiddenColumns = [2];
    const result = validateWorkbook(book).sheets[0];
    expect(result.rowHeights).toEqual({ 2: 36 });
    expect(result.hiddenRows).toEqual([1, 4]);
    result.hiddenRows!.push(6);
    result.rowHeights![2] = 48;
    expect(sheet.hiddenRows).toEqual([4, 1]);
    expect(sheet.rowHeights).toEqual({ 2: 36 });
    for (const invalid of [[2, 2], [-1], [sheet.rowCount]]) {
      sheet.hiddenRows = invalid;
      expect(() => validateWorkbook(book)).toThrow('隐藏行');
    }
    sheet.hiddenRows = [];
    for (const invalid of [{ 2: 0 }, { 2: 601 }, { 100: 36 }] as Record<number, number>[]) {
      sheet.rowHeights = invalid;
      expect(() => validateWorkbook(book)).toThrow('行高');
    }
  });
  it('validates demo data and strips untrusted style properties', () => {
    const book = createDemoWorkbook();
    (book.sheets[0].cells.A1.style as unknown as Record<string, unknown>).background =
      'url(javascript:alert(1))';
    const result = validateWorkbook(book);
    expect(result.sheets).toHaveLength(3);
    expect(result.sheets[0].cells.A1.style?.background).toBeUndefined();
  });
  it('rejects malformed cells, dimensions and empty workbooks', () => {
    expect(() => validateWorkbook({ sheets: [] })).toThrow();
    const book = createDemoWorkbook();
    book.sheets[0].cells.A0 = { value: 1 };
    expect(() => validateWorkbook(book)).toThrow();
    delete book.sheets[0].cells.A0;
    book.sheets[0].rowCount = Number.POSITIVE_INFINITY;
    expect(() => validateWorkbook(book)).toThrow();
  });
  it('bounds rendered dimensions while allowing sparse large workbooks', () => {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    sheet.rowCount = IMPORT_LIMITS.rows;
    sheet.colCount = IMPORT_LIMITS.columns;
    expect(validateWorkbook(book).sheets[0].rowCount).toBe(100000);
    sheet.rowCount++;
    expect(() => validateWorkbook(book)).toThrow('100,000 行和 256 列');
    sheet.rowCount--;
    sheet.colCount++;
    expect(() => validateWorkbook(book)).toThrow('100,000 行和 256 列');
    expect(() => csvToWorkbook(Array(257).fill('header').join(','))).toThrow('256 列');
  });
  it('rejects oversized, overlapping and invalid merge regions before rendering', () => {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    sheet.colCount = 128;
    sheet.merges = [{ start: { row: 0, col: 0 }, end: { row: 99, col: 100 } }];
    expect(() => validateWorkbook(book)).toThrow('10,000');
    sheet.merges = [
      { start: { row: 0, col: 0 }, end: { row: 2, col: 2 } },
      { start: { row: 2, col: 2 }, end: { row: 3, col: 3 } },
    ];
    expect(() => validateWorkbook(book)).toThrow('重叠');
    sheet.merges = [{ start: { row: 5, col: 0 }, end: { row: 3, col: 2 } }];
    expect(() => validateWorkbook(book)).toThrow('范围无效');
    sheet.merges = [{ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } }];
    expect(validateWorkbook(book).sheets[0].merges).toEqual(sheet.merges);
    sheet.rowCount = 100000;
    expect(() => validateWorkbook(book)).toThrow('布局最多');
  });
  it('bounds frozen rows and preserves exact valid sheet names', () => {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    sheet.name = ' 月度目标 ';
    expect(validateWorkbook(book).sheets[0].name).toBe(' 月度目标 ');
    sheet.frozenRows = 21;
    expect(() => validateWorkbook(book)).toThrow('20 行');
    sheet.frozenRows = 1;
    for (const name of ['X'.repeat(32), '预算/2026', "'名称", 'history']) {
      sheet.name = name;
      expect(() => validateWorkbook(book)).toThrow('名称');
    }
  });
});

describe('XLSX interoperability', () => {
  it('round trips sparse hidden rows, hidden columns and row heights', async () => {
    const source = createBlankWorkbook();
    const sheet = source.sheets[0];
    sheet.cells.A1 = { value: 'visible' };
    sheet.rowHeights = { 1: 27, 7: 48 };
    sheet.hiddenRows = [2, 6];
    sheet.hiddenColumns = [1, 4];
    const buffer = await workbookToXlsx(source);
    const check = new ExcelJS.Workbook();
    await check.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const ws = check.worksheets[0];
    expect(ws.getRow(2).height).toBeCloseTo((27 * 72) / 96, 6);
    expect(ws.getRow(3).hidden).toBe(true);
    expect(ws.getRow(7).hidden).toBe(true);
    expect(ws.getColumn(2).hidden).toBe(true);
    expect(ws.getColumn(5).hidden).toBe(true);
    const restored = await workbookFromXlsx(buffer);
    expect(restored.sheets[0].rowHeights?.[1]).toBeCloseTo(27, 6);
    expect(restored.sheets[0].rowHeights?.[7]).toBeCloseTo(48, 6);
    expect(restored.sheets[0].hiddenRows).toEqual([2, 6]);
    expect(restored.sheets[0].hiddenColumns).toEqual([1, 4]);
  });

  it('keeps blank hidden metadata outside stored cells and rejects overlarge row heights', async () => {
    const source = createBlankWorkbook();
    const sheet = source.sheets[0];
    sheet.rowCount = 500;
    sheet.colCount = 40;
    sheet.hiddenRows = [499];
    sheet.hiddenColumns = [39];
    sheet.rowHeights = { 400: 60 };
    const restored = (await workbookFromXlsx(await workbookToXlsx(source))).sheets[0];
    expect(restored.rowCount).toBe(500);
    expect(restored.colCount).toBe(40);
    expect(restored.hiddenRows).toEqual([499]);
    expect(restored.hiddenColumns).toEqual([39]);
    expect(restored.rowHeights).toEqual({ 400: 60 });
    expect(Object.keys(restored.cells)).toHaveLength(0);
    const raw = new ExcelJS.Workbook();
    raw.addWorksheet('Data').getRow(2).height = 451;
    const bytes = await raw.xlsx.writeBuffer();
    await expect(workbookFromXlsx(bytes as unknown as ArrayBuffer)).rejects.toThrow('行高');
  });
  it('round trips multiple sheets, formulas, styles, widths and frozen rows', async () => {
    const source = createDemoWorkbook();
    const buffer = await workbookToXlsx(source);
    const result = await workbookFromXlsx(buffer, source.name);
    expect(result.sheets.map((s) => s.name)).toEqual(source.sheets.map((s) => s.name));
    expect(result.sheets[0].cells.F2.value).toBe('=D2-E2');
    expect(result.sheets[0].cells.G2.style?.format).toBe('percent');
    expect(result.sheets[0].cells.A1.style?.bold).toBe(true);
    expect(result.sheets[0].frozenRows).toBe(1);
    expect(evaluateCell(result.sheets[1], 'C2', result)).toBe(434000);
  });
  it('rejects incompatible sheet names rather than silently breaking formula references', async () => {
    const book = createDemoWorkbook();
    book.sheets[0].name = '含非法/符号';
    await expect(workbookToXlsx(book)).rejects.toThrow('名称');
  });
  it('preserves quoted sheet references containing apostrophes and spaces', async () => {
    const book = createDemoWorkbook();
    book.sheets[0].name = " O'Brien ";
    book.sheets[1].cells.C2.value = "=' O''Brien '!D2";
    const result = await workbookFromXlsx(await workbookToXlsx(book));
    expect(result.sheets[0].name).toBe(" O'Brien ");
    expect(evaluateCell(result.sheets[1], 'C2', result)).toBe(186000);
  });
});

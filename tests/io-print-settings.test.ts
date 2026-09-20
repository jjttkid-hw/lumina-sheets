import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createBlankWorkbook } from '../src/lib/seed';
import { validateWorkbook, workbookToXlsx, workbookFromXlsx } from '../src/lib/io';
import { checkValue } from '../src/lib/data-validation';

describe('persisted report settings at file boundaries', () => {
  it('preserves validated print and input rules through JSON sanitation without aliasing', () => {
    const book = createBlankWorkbook();
    book.sheets[0].printSettings = { paperSize: 'A3', repeatRows: 1, rowBreaks: [10] };
    book.sheets[0].dataValidations = [
      {
        id: 'count',
        kind: 'whole',
        operator: 'greaterThan',
        value: 0,
        range: { start: { row: 1, col: 1 }, end: { row: 10, col: 1 } },
      },
    ];
    const result = validateWorkbook(JSON.parse(JSON.stringify(book)));
    expect(result.sheets[0].printSettings).toEqual(book.sheets[0].printSettings);
    expect(result.sheets[0].dataValidations?.[0]).toMatchObject(book.sheets[0].dataValidations[0]);
    result.sheets[0].printSettings!.rowBreaks![0] = 20;
    result.sheets[0].dataValidations![0].range.end.row = 20;
    expect(book.sheets[0].printSettings.rowBreaks).toEqual([10]);
    expect(book.sheets[0].dataValidations[0].range.end.row).toBe(10);
  });

  it.each([
    ['A4', 9],
    ['A3', 8],
    ['Letter', 1],
  ] as const)(
    'writes %s paper, inches, print titles and explicit row breaks to actual XLSX',
    async (paperSize, code) => {
      const book = createBlankWorkbook();
      book.sheets[0].cells.A1 = { value: '标题' };
      book.sheets[0].cells.C20 = { value: '结束' };
      book.sheets[0].printSettings = {
        paperSize,
        orientation: 'portrait',
        repeatRows: 2,
        repeatColumns: 2,
        margins: { top: 36, right: 18, bottom: 72, left: 54 },
        rowBreaks: [10],
      };
      const raw = new ExcelJS.Workbook();
      await raw.xlsx.load((await workbookToXlsx(book)) as unknown as ExcelJS.Buffer);
      const page = raw.worksheets[0].pageSetup;
      expect(page.paperSize).toBe(code);
      expect(page.orientation).toBe('portrait');
      expect(page.margins).toMatchObject({ top: 0.5, right: 0.25, bottom: 1, left: 0.75 });
      expect(page.printTitlesRow).toBe('1:2');
      expect(page.printTitlesColumn).toBe('A:B');
      // ExcelJS does not restore parsed rowBreaks to its worksheet model, so inspect
      // the XLSX XML rather than claiming a round trip for that unsupported field.
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(await workbookToXlsx(book));
      const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
      expect(xml).toMatch(/<brk[^>]+id="10"[^>]+man="1"/);
    },
  );

  it('round trips both page-break axes and input rules without materializing empty ranges', async () => {
    const book = createBlankWorkbook();
    book.sheets[0].printSettings = {
      paperSize: 'Letter',
      repeatRows: 1,
      rowBreaks: [10],
      columnBreaks: [2],
    };
    book.sheets[0].dataValidations = [
      {
        id: 'state',
        kind: 'list',
        values: ['完成'],
        range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      },
    ];
    const restored = (await workbookFromXlsx(await workbookToXlsx(book))).sheets[0];
    expect(restored.printSettings).toMatchObject(book.sheets[0].printSettings);
    expect(restored.dataValidations?.[0]).toMatchObject({ kind: 'list', values: ['完成'] });
    expect(Object.keys(restored.cells)).toHaveLength(0);
    expect(checkValue(restored.id, 'A1', '未完成', restored.dataValidations!)).toHaveLength(1);
  });

  it('covers sparse print metadata beyond the stored dimensions on both axes', async () => {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    sheet.rowCount = 500;
    sheet.colCount = 30;
    sheet.cells.A1 = { value: 'only stored cell' };
    sheet.printSettings = {
      repeatRows: 150,
      repeatColumns: 18,
      rowBreaks: [200],
      columnBreaks: [20],
    };
    const restored = (await workbookFromXlsx(await workbookToXlsx(book))).sheets[0];
    expect(restored.rowCount).toBe(201);
    expect(restored.colCount).toBe(21);
    expect(restored.printSettings).toMatchObject(sheet.printSettings);
    expect(Object.keys(restored.cells)).toEqual(['A1']);
    const second = (
      await workbookFromXlsx(
        await workbookToXlsx({ ...book, sheets: [restored], activeSheetId: restored.id }),
      )
    ).sheets[0];
    expect(second.printSettings).toEqual(restored.printSettings);
  });

  it('covers repeated titles without needing a stored cell or manual break', async () => {
    const book = createBlankWorkbook();
    book.sheets[0].rowCount = 200;
    book.sheets[0].colCount = 30;
    book.sheets[0].printSettings = { repeatRows: 150, repeatColumns: 20 };
    const restored = (await workbookFromXlsx(await workbookToXlsx(book))).sheets[0];
    expect(restored.rowCount).toBe(150);
    expect(restored.colCount).toBe(20);
    expect(Object.keys(restored.cells)).toHaveLength(0);
  });

  it('keeps a quota-boundary validation range compact and expands only logical dimensions', async () => {
    const book = createBlankWorkbook();
    book.sheets[0].dataValidations = [
      {
        id: 'q',
        kind: 'whole',
        operator: 'greaterThan',
        value: 0,
        range: { start: { row: 1, col: 0 }, end: { row: 99999, col: 255 } },
      },
    ];
    const restored = (await workbookFromXlsx(await workbookToXlsx(book))).sheets[0];
    expect(restored.dataValidations).toHaveLength(1);
    expect(restored.dataValidations![0].range.end).toEqual({ row: 99999, col: 255 });
    expect(restored.rowCount).toBe(100000);
    expect(restored.colCount).toBe(256);
    expect(Object.keys(restored.cells)).toHaveLength(0);
  });

  it.each([
    { row: 999999, col: 0 },
    { row: 0, col: 256 },
  ])('rejects metadata outside import quotas without clamping %j', async (end) => {
    const book = createBlankWorkbook();
    book.sheets[0].dataValidations = [
      {
        id: 'wide',
        kind: 'whole',
        operator: 'greaterThan',
        value: 0,
        range: { start: { row: 0, col: 0 }, end },
      },
    ];
    const bytes = await workbookToXlsx(book);
    await expect(workbookFromXlsx(bytes)).rejects.toThrow('100,000 行和 256 列');
  });

  it('refuses unrepresentable typed lists rather than changing the allowed values', async () => {
    const book = createBlankWorkbook();
    book.sheets[0].dataValidations = [
      {
        id: 'q',
        kind: 'list',
        values: [1, true],
        range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      },
    ];
    await expect(workbookToXlsx(book)).rejects.toThrow('文本');
  });
});

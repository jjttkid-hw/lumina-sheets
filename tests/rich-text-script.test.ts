import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromXlsx, workbookToXlsx, validateWorkbook } from '../src/lib/io';
import { copyRichText } from '../src/lib/rich-text';
import { formatTextRange } from '../src/lib/rich-text-edit';
import { createBlankWorkbook } from '../src/lib/seed';
import { layoutRichText, drawRichTextLine, richTextMetrics } from '../src/lib/canvas/rich-text';
import type { Cell, RichTextStyle } from '../src/lib/types';

describe('superscript and subscript rich text', () => {
  it('imports actual shared strings with family/charset and round trips script semantics', async () => {
    const excel = new ExcelJS.Workbook(),
      sheet = excel.addWorksheet('Science');
    sheet.getCell('A1').value = {
      richText: [
        { text: 'H', font: { name: 'Arial', size: 20, family: 2, charset: 134 } },
        { text: '2', font: { size: 20, vertAlign: 'subscript' } },
        // OOXML ST_VerticalAlignRun includes baseline; ExcelJS types omit it.
        { text: 'O + x', font: { vertAlign: 'baseline' as 'superscript' } },
        { text: '2', font: { size: 20, vertAlign: 'superscript' } },
      ],
    };
    const imported = await workbookFromXlsx(new Uint8Array(await excel.xlsx.writeBuffer()).buffer);
    const cell = imported.sheets[0].cells.A1;
    expect(cell.value).toBe('H2O + x2');
    expect(cell.richText?.[0].style).toMatchObject({
      fontFamily: 'Arial',
      fontFamilyClass: 2,
      charset: 134,
    });
    expect(cell.richText?.map((run) => run.style?.verticalAlign)).toEqual([
      undefined,
      'subscript',
      'baseline',
      'superscript',
    ]);
    const bytes = await workbookToXlsx(imported);
    expect((await workbookFromXlsx(bytes)).sheets[0].cells.A1).toEqual(cell);
    const external = new ExcelJS.Workbook();
    await external.xlsx.load(bytes);
    expect(external.worksheets[0].getCell('A1').value).toEqual(sheet.getCell('A1').value);
  });
  it('validates all new fields, retains zero codes and isolates JSON/format edits', () => {
    const book = createBlankWorkbook();
    book.sheets[0].cells.A1 = {
      value: 'x2',
      richText: [
        { text: 'x' },
        { text: '2', style: { verticalAlign: 'superscript', fontFamilyClass: 0, charset: 0 } },
      ],
    };
    const next = validateWorkbook(book);
    expect(next.sheets[0].cells.A1.richText).toEqual(book.sheets[0].cells.A1.richText);
    const edited = formatTextRange(next.sheets[0].cells.A1, 1, 2, { verticalAlign: 'baseline' });
    expect(edited.richText?.[1].style).toEqual({
      verticalAlign: 'baseline',
      fontFamilyClass: 0,
      charset: 0,
    });
    expect(book.sheets[0].cells.A1.richText?.[1].style?.verticalAlign).toBe('superscript');
    for (const style of [
      { verticalAlign: 'super' },
      { verticalAlign: null },
      { fontFamilyClass: 6 },
      { fontFamilyClass: -1 },
      { charset: 256 },
      { charset: 1.5 },
      { charset: '134' },
    ])
      expect(() => copyRichText([{ text: 'x', style }], 'x')).toThrow();
  });
  it('uses the same script size for measuring/drawing and reserves shifted line height for PDF', () => {
    const drawn: { text: string; y: number; font: string }[] = [];
    const context = {
      font: '',
      fillStyle: '',
      textBaseline: '',
      textAlign: '',
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      measureText(text: string) {
        return { width: (Number(/([\d.]+)px/.exec(this.font)![1]) * text.length) / 2 };
      },
      fillText(text: string, _x: number, y: number) {
        drawn.push({ text, y, font: this.font });
      },
    };
    const cell: Cell = {
      value: 'x23',
      style: { fontSize: 20 },
      richText: [
        { text: 'x' },
        { text: '2', style: { verticalAlign: 'superscript', underline: true } },
        { text: '3', style: { verticalAlign: 'subscript', strike: true } },
      ],
    };
    const ctx = context as unknown as CanvasRenderingContext2D;
    const line = layoutRichText(ctx, cell)[0];
    expect(line.width).toBe(23);
    expect(line.height).toBeCloseTo(30.2);
    drawRichTextLine(ctx, line, 0, 50, 'left');
    expect(drawn.map((call) => call.y)).toEqual([50, 44, 56]);
    expect(drawn[1].font).toContain('13px');
    expect(context.fillRect.mock.calls).toEqual([
      [10, 50.5, 6.5, 1],
      [16.5, 56, 6.5, 1],
    ]);
    expect(layoutRichText(ctx, cell, 0.75, 200)[0].height).toBeCloseTo(line.height * 0.75);
    expect(
      layoutRichText(ctx, cell, 1, 16.5).map((line) =>
        line.segments.map((run) => run.text).join(''),
      ),
    ).toEqual(['x2', '3']);
    expect(richTextMetrics({ verticalAlign: 'baseline', fontSize: 20 } as RichTextStyle).size).toBe(
      20,
    );
  });
});

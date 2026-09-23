import { describe, expect, it, vi } from 'vitest';
import { copyRichText, replaceCellText } from '../src/lib/rich-text';
import { layoutRichText, drawRichTextLine } from '../src/lib/canvas/rich-text';
import { createBlankWorkbook } from '../src/lib/seed';
import { validateWorkbook, workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { planWorkspaceCellChanges } from '../src/lib/workspace-edit';
import { planStructureEdit } from '../src/lib/structure-edit';
import { planWorkbookRowSort } from '../src/lib/workbook-sort';
import { evaluateCell } from '../src/lib/engine';
import {
  readXlsxArchive,
  writeXlsxArchive,
  xmlChild,
  xmlChildren,
  xmlElement,
  xmlText,
} from '../src/lib/xlsx-archive';
import type { Cell, RichTextRun } from '../src/lib/types';
import ExcelJS from 'exceljs';

const runs: RichTextRun[] = [
  { text: '销售', style: { bold: true, color: '#ff0000', fontSize: 18, fontFamily: 'Arial' } },
  { text: ' & <增长>\n', style: { bold: false, italic: true, underline: true, strike: true } },
  { text: '😀', style: { italic: false, underline: false, strike: false } },
];
const cell: Cell = {
  value: runs.map((r) => r.text).join(''),
  richText: runs,
  style: { bold: true },
};
function fixture() {
  const book = createBlankWorkbook();
  book.sheets[0].frozenRows = 0;
  book.sheets[0].cells = {
    A1: structuredClone(cell),
    A2: { value: 'z' },
    B1: { value: '=LEN(A1)' },
  };
  return book;
}
describe('rich text preservation', () => {
  it('isolates validated runs, preserves JSON and rejects inconsistent, invalid or oversized content', () => {
    const book = fixture(),
      copy = validateWorkbook(book);
    expect(copy.sheets[0].cells.A1.richText).toEqual(runs);
    copy.sheets[0].cells.A1.richText![0].style!.bold = false;
    expect(book.sheets[0].cells.A1.richText![0].style!.bold).toBe(true);
    expect(copyRichText(undefined, 1)).toBeUndefined();
    for (const input of [
      [],
      [{ text: 'wrong' }],
      [{ text: cell.value, style: { fontSize: Infinity } }],
      [{ text: cell.value, style: { color: 'red' } }],
      [{ text: cell.value, style: { background: '#ff0000' } }],
      [{ text: cell.value, style: { fontFamily: 'a\nb' } }],
      [{ text: 'x'.repeat(32768) }],
    ])
      expect(() => copyRichText(input, cell.value)).toThrow();
    expect(() => copyRichText([{ text: '=1' }], '=1')).toThrow();
    expect(() => copyRichText([{ text: '1' }], 1)).toThrow();
    expect(copyRichText([{ text: '', style: { bold: true } }], '')).toHaveLength(1);
  });
  it('edits text explicitly, preserves equal text and moves rich runs through structure/sort planners', () => {
    expect(replaceCellText(cell, cell.value).richText).toEqual(runs);
    expect(replaceCellText(cell, 'new').richText).toBeUndefined();
    const book = fixture(),
      sheet = book.sheets[0];
    expect(() =>
      planWorkspaceCellChanges(book, sheet.id, [
        { key: 'A1', cell: { ...cell, value: 'mismatch' } },
      ]),
    ).toThrow('一致');
    const edit = planWorkspaceCellChanges(book, sheet.id, [
      { key: 'A1', cell: replaceCellText(cell, 'new') },
    ]);
    expect(edit?.sheet.cells.A1.richText).toBeUndefined();
    const structure = planStructureEdit(book, sheet.id, {
      axis: 'row',
      kind: 'insert',
      index: 0,
      count: 1,
    });
    expect(structure.sheets[0].cells.A2.richText).toEqual(runs);
    sheet.cells.C1 = { value: 2 };
    sheet.cells.C2 = { value: 1 };
    const sorted = planWorkbookRowSort(book, sheet.id, {
      startRow: 0,
      rowCount: 2,
      keys: [{ column: 2, direction: 'asc' }],
    });
    expect(sorted.changes.find((c) => c.cell?.richText)?.cell?.richText).toEqual(runs);
  });
  it('moves distinct inline formatting even when sorted cell text and outer styles are equal', () => {
    const book = fixture(),
      sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: 'same', richText: [{ text: 'same', style: { bold: true } }] },
      A2: { value: 'same', richText: [{ text: 'same', style: { italic: true } }] },
      B1: { value: 2 },
      B2: { value: 1 },
    };
    const plan = planWorkbookRowSort(book, sheet.id, {
      startRow: 0,
      rowCount: 2,
      keys: [{ column: 1, direction: 'asc' }],
    });
    const moved = plan.changes.find((change) => change.key === 'A1')!.cell!;
    expect(moved.richText![0].style).toEqual({ italic: true });
    moved.richText![0].style!.italic = false;
    expect(sheet.cells.A2.richText![0].style!.italic).toBe(true);
  });
  it('round trips actual inline XML and rich hyperlink labels without executing text', async () => {
    const book = fixture();
    book.sheets[0].cells.A1.hyperlink = { target: 'https://example.com', tooltip: 'hint' };
    const before = structuredClone(book);
    const bytes = await workbookToXlsx(book);
    const restored = await workbookFromXlsx(bytes);
    expect(restored.sheets[0].cells.A1).toEqual({
      ...cell,
      hyperlink: book.sheets[0].cells.A1.hyperlink,
    });
    expect(evaluateCell(restored.sheets[0], 'B1', restored)).toBe(String(cell.value).length);
    expect(book).toEqual(before);
    const second = await workbookFromXlsx(await workbookToXlsx(restored));
    expect(second.sheets[0].cells.A1).toEqual(restored.sheets[0].cells.A1);
    const archive = await readXlsxArchive(bytes);
    const data = xmlChild(archive.sheets[0].xml, 'sheetData')!;
    const a1 = xmlChildren(xmlChildren(data, 'row')[0], 'c')[0];
    expect(a1.attributes.t).toBe('inlineStr');
    expect(xmlChildren(xmlChild(a1, 'is')!, 'r').map((r) => xmlText(xmlChild(r, 't')!))).toEqual(
      runs.map((r) => r.text),
    );
  });
  it('imports shared strings written by ExcelJS and exports equivalent font runs', async () => {
    const excel = new ExcelJS.Workbook(),
      sheet = excel.addWorksheet('Rich');
    sheet.getCell('A1').value = {
      richText: [
        {
          text: 'hello',
          font: { bold: true, color: { argb: 'FF123456' }, name: 'Arial', size: 16 },
        },
        { text: ' world', font: { italic: true } },
      ],
    };
    const book = await workbookFromXlsx(new Uint8Array(await excel.xlsx.writeBuffer()).buffer);
    expect(book.sheets[0].cells.A1.richText).toEqual([
      { text: 'hello', style: { bold: true, color: '#123456', fontFamily: 'Arial', fontSize: 16 } },
      { text: ' world', style: { italic: true } },
    ]);
    const out = new ExcelJS.Workbook();
    await out.xlsx.load(await workbookToXlsx(book));
    expect(out.worksheets[0].getCell('A1').value).toEqual(sheet.getCell('A1').value);
  });
  it('rejects unsupported fonts rather than silently dropping theme or unsupported outline formatting', async () => {
    const bytes = await workbookToXlsx(fixture());
    for (const property of [
      xmlElement('outline', { val: '1' }),
      xmlElement('color', { theme: '1' }),
    ]) {
      const archive = await readXlsxArchive(bytes);
      const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
      const run = xmlChildren(xmlChild(xmlChildren(row, 'c')[0], 'is')!, 'r')[0];
      const props = xmlChild(run, 'rPr')!;
      props.children = [property];
      await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toThrow('富文本');
    }
  });
  it('keeps empty rich runs and refuses merged follower metadata loss', async () => {
    const book = fixture();
    book.sheets[0].cells.A1 = { value: '', richText: [{ text: '', style: { bold: true } }] };
    expect(
      (await workbookFromXlsx(await workbookToXlsx(book))).sheets[0].cells.A1.richText,
    ).toEqual(book.sheets[0].cells.A1.richText);
    book.sheets[0].cells.B1 = book.sheets[0].cells.A1;
    book.sheets[0].merges = [{ start: { row: 0, col: 0 }, end: { row: 0, col: 1 } }];
    await expect(workbookToXlsx(book)).rejects.toThrow('非主格');
  });
});

describe('rich Canvas layout', () => {
  function context() {
    return {
      font: '',
      fillStyle: '',
      textAlign: '',
      textBaseline: '',
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      fillRect: vi.fn(),
      measureText(text: string) {
        return {
          width:
            (Array.from(text).length * Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 12)) / 2,
        };
      },
    };
  }
  it('measures mixed sizes and draws aligned runs with explicit false overrides', () => {
    const ctx = context(),
      canvas = ctx as unknown as CanvasRenderingContext2D;
    const sample: Cell = {
      value: 'abcd',
      style: { bold: true, underline: true },
      richText: [
        { text: 'ab', style: { fontSize: 20, color: '#ff0000' } },
        { text: 'cd', style: { bold: false, underline: false, strike: true } },
      ],
    };
    const line = layoutRichText(canvas, sample)[0];
    expect(line.width).toBe(32);
    expect(line.height).toBe(28);
    drawRichTextLine(canvas, line, 100, 20, 'right');
    expect(ctx.fillText.mock.calls).toEqual([
      ['ab', 68, 20],
      ['cd', 88, 20],
    ]);
    expect(ctx.fillRect.mock.calls).toEqual([
      [68, 30, 20, 1],
      [88, 20, 12, 1],
    ]);
    expect(ctx.font).not.toContain('bold');
    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.restore).toHaveBeenCalledOnce();
  });

  it('uses the cell color as the default for runs without an inline color', () => {
    const ctx = context(),
      canvas = ctx as unknown as CanvasRenderingContext2D;
    const line = layoutRichText(canvas, {
      value: 'plain',
      style: { color: '#123456' },
      richText: [{ text: 'plain' }],
    })[0];
    drawRichTextLine(canvas, line, 0, 10, 'left', 1, '#123456');
    expect(ctx.fillStyle).toBe('#123456');
  });
  it('wraps by measured width, preserves newlines and Unicode, and refuses too-wide glyphs', () => {
    const ctx = context() as unknown as CanvasRenderingContext2D;
    const sample: Cell = {
      value: 'ab😀\ncd',
      richText: [{ text: 'ab', style: { fontSize: 20 } }, { text: '😀\ncd' }],
    };
    const lines = layoutRichText(ctx, sample, 1, 20);
    expect(lines.map((line) => line.segments.map((s) => s.text).join(''))).toEqual([
      'ab',
      '😀',
      'cd',
    ]);
    expect(lines.every((line) => line.width <= 20)).toBe(true);
    expect(() => layoutRichText(ctx, sample, 1, 5)).toThrow('列宽');
  });
});

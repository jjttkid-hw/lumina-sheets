import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import { copyPrintSettings, validatePrintSettings } from '../src/lib/print-settings';
import { planPdfPages, workbookToPdf } from '../src/lib/report-pdf';
import type { PrintSettings } from '../src/lib/types';

function fixture() {
  const workbook = createBlankWorkbook('打印验证');
  const sheet = workbook.sheets[0];
  sheet.cells = { A1: { value: '页首' }, F10: { value: '最后一格' } };
  sheet.rowCount = 10;
  sheet.colCount = 6;
  return { workbook, sheet };
}

describe('persisted print settings', () => {
  it('validates and deeply copies settings without retaining mutable input', () => {
    const original: PrintSettings = {
      paperSize: 'A3',
      orientation: 'portrait',
      margins: { top: 12, right: 13, bottom: 14, left: 15 },
      repeatRows: 1,
      repeatColumns: 1,
      rowBreaks: [4, 8],
      columnBreaks: [3],
    };
    const copied = copyPrintSettings(original, { rowCount: 10, colCount: 6 })!;
    expect(copied).toEqual(original);
    expect(copied).not.toBe(original);
    original.margins!.left = 100;
    original.rowBreaks!.push(9);
    expect(copied.margins!.left).toBe(15);
    expect(copied.rowBreaks).toEqual([4, 8]);
    expect(copyPrintSettings(undefined)).toBeUndefined();
    expect(JSON.parse(JSON.stringify(copied))).toEqual(copied);
  });

  it.each([
    null,
    [],
    { paperSize: 'Legal' },
    { orientation: 'upside-down' },
    { margins: { top: 1, right: 2, bottom: 3 } },
    { margins: { top: -1, right: 2, bottom: 3, left: 4 } },
    { margins: { top: Infinity, right: 2, bottom: 3, left: 4 } },
    { repeatRows: -1 },
    { repeatColumns: 1.1 },
    { rowBreaks: [0] },
    { rowBreaks: [2, 2] },
    { rowBreaks: [3, 2] },
    { columnBreaks: [Infinity] },
    { rowBreaks: '2' },
    { printArea: 'A1:C3' },
  ])('rejects invalid settings %j', (value) => {
    expect(() => validatePrintSettings(value)).toThrow();
  });

  it('strictly validates worksheet extents, repeat boundaries, and break-count limits', () => {
    expect(() => validatePrintSettings({ repeatRows: 11 }, { rowCount: 10, colCount: 6 })).toThrow(
      '重复标题行数',
    );
    expect(() => validatePrintSettings({ rowBreaks: [10] }, { rowCount: 10, colCount: 6 })).toThrow(
      '分页位置',
    );
    expect(() => validatePrintSettings({ repeatRows: 2, rowBreaks: [2] })).toThrow('重复标题之后');
    expect(() => validatePrintSettings({ columnBreaks: [2], repeatColumns: 3 })).toThrow(
      '重复标题之后',
    );
    expect(() =>
      validatePrintSettings({ rowBreaks: Array.from({ length: 1001 }, (_, i) => i + 1) }),
    ).toThrow('最多 1000');
    expect(() => validatePrintSettings({}, { rowCount: 0, colCount: 6 })).toThrow('工作表行数');
  });
});

describe('print settings PDF planning', () => {
  it.each([
    ['A4', 'portrait', 595.28, 841.89],
    ['A4', 'landscape', 841.89, 595.28],
    ['A3', 'portrait', 841.89, 1190.55],
    ['A3', 'landscape', 1190.55, 841.89],
    ['Letter', 'portrait', 612, 792],
    ['Letter', 'landscape', 792, 612],
  ] as const)('uses %s %s dimensions', (paperSize, orientation, width, height) => {
    const { sheet } = fixture();
    sheet.printSettings = { paperSize, orientation };
    expect(planPdfPages(sheet)).toMatchObject({ width, height });
  });

  it('applies explicit export overrides field by field without changing persisted settings', () => {
    const { sheet } = fixture();
    sheet.printSettings = {
      paperSize: 'A3',
      orientation: 'portrait',
      rowBreaks: [4],
      repeatRows: 1,
      margins: { top: 11, right: 12, bottom: 13, left: 14 },
    };
    const before = structuredClone(sheet.printSettings);
    const layout = planPdfPages(sheet, {
      paperSize: 'Letter',
      orientation: 'landscape',
      rowBreaks: [],
      margins: { top: 21, right: 22, bottom: 23, left: 24 },
    });
    expect(layout).toMatchObject({
      width: 792,
      height: 612,
      margins: { top: 21, right: 22, bottom: 23, left: 24 },
    });
    expect(layout.pages).toHaveLength(1);
    expect(sheet.printSettings).toEqual(before);
  });

  it('forces both-axis boundaries and repeats titles without omitting any coordinate', () => {
    const { sheet } = fixture();
    sheet.printSettings = { repeatRows: 1, repeatColumns: 1, rowBreaks: [4, 7], columnBreaks: [3] };
    const layout = planPdfPages(sheet);
    expect(layout.pages).toHaveLength(6);
    expect(layout.pages[0]).toMatchObject({ rows: [0, 1, 2, 3], columns: [0, 1, 2] });
    expect(layout.pages[3]).toMatchObject({ rows: [0, 4, 5, 6], columns: [0, 3, 4, 5] });
    expect(layout.pages[5]).toMatchObject({ rows: [0, 7, 8, 9], columns: [0, 3, 4, 5] });
    const covered = new Set(
      layout.pages.flatMap((page) =>
        page.rows.flatMap((row) => page.columns.map((col) => `${row}:${col}`)),
      ),
    );
    expect(covered.size).toBe(60);
  });

  it('still automatically paginates overlarge manual segments and respects margins', () => {
    const { sheet } = fixture();
    sheet.cells = { F40: { value: '最后' } };
    sheet.rowCount = 40;
    sheet.printSettings = {
      rowBreaks: [35],
      margins: { top: 100, right: 80, bottom: 90, left: 70 },
    };
    const layout = planPdfPages(sheet);
    expect(layout.pages.length).toBeGreaterThan(2);
    for (const page of layout.pages) {
      expect(page.rows.reduce((sum, row) => sum + layout.rowHeights[row], 0)).toBeLessThanOrEqual(
        layout.height - 100 - 90 - 60,
      );
      expect(
        page.columns.reduce((sum, col) => sum + layout.columnWidths[col], 0),
      ).toBeLessThanOrEqual(layout.width - 80 - 70);
      expect(!(page.rows.includes(34) && page.rows.includes(35))).toBe(true);
    }
    expect(layout.pages.some((page) => page.rows.includes(39))).toBe(true);
  });

  it('rejects explicit breaks through merges while allowing merge-edge boundaries', () => {
    const { sheet } = fixture();
    sheet.cells = { A1: { value: '页首' }, F10: { value: '最后' } };
    sheet.merges = [{ start: { row: 2, col: 1 }, end: { row: 4, col: 3 } }];
    expect(() => planPdfPages(sheet, { rowBreaks: [3] })).toThrow('跨越合并区域');
    expect(() => planPdfPages(sheet, { columnBreaks: [2] })).toThrow('跨越合并区域');
    expect(() => planPdfPages(sheet, { repeatRows: 3 })).toThrow('重复标题边界');
    const layout = planPdfPages(sheet, { rowBreaks: [2, 5], columnBreaks: [1, 4] });
    expect(layout.pages).toHaveLength(9);
    const mergePage = layout.pages.find(
      (page) => page.rows.includes(2) && page.columns.includes(1),
    )!;
    expect(mergePage.rows).toEqual(expect.arrayContaining([2, 3, 4]));
    expect(mergePage.columns).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it('does not clamp explicit repeats/breaks or allow margins/page counts to overflow', () => {
    const { sheet } = fixture();
    expect(() => planPdfPages(sheet, { repeatRows: 11 })).toThrow('重复标题行数');
    expect(() => planPdfPages(sheet, { rowBreaks: [10] })).toThrow('分页位置');
    expect(() => planPdfPages(sheet, { rowBreaks: [1] })).toThrow('重复标题之后');
    expect(() =>
      planPdfPages(sheet, { margins: { top: 400, right: 28, bottom: 200, left: 28 } }),
    ).toThrow('可用空间');
    expect(() => planPdfPages(sheet, { rowBreaks: [2, 4, 6, 8], maxPages: 2 })).toThrow('页上限');
    expect(() => planPdfPages(sheet, { rowBreaks: [4], columnBreaks: [3], maxPages: 3 })).toThrow(
      '页上限',
    );
  });
});

describe('actual PDF drawing uses the planned paper and margins', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('draws at configured offsets and encodes the selected paper size', async () => {
    const { workbook, sheet } = fixture();
    sheet.printSettings = {
      paperSize: 'Letter',
      orientation: 'portrait',
      margins: { top: 42, right: 33, bottom: 45, left: 31 },
      repeatRows: 1,
      rowBreaks: [5],
    };
    const rectangles: number[][] = [];
    const texts: { value: string; x: number; y: number }[] = [];
    const context = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      textAlign: '',
      textBaseline: '',
      scale: vi.fn(),
      fillRect: (...args: number[]) => rectangles.push(args),
      strokeRect: vi.fn(),
      measureText: (text: string) => ({ width: [...text].length * 5 }),
      fillText: (value: string, x: number, y: number) => texts.push({ value, x, y }),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback: (blob: Blob) => void) =>
        callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })),
    };
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() }, createElement: () => canvas });
    const pdf = new TextDecoder().decode(await workbookToPdf(workbook, { pixelRatio: 1 }));
    expect(pdf).toContain('/MediaBox [0 0 612 792]');
    expect(pdf).toContain('/Count 2');
    expect(rectangles).toContainEqual([0, 0, 612, 792]);
    expect(rectangles).toContainEqual([31, 82, 78, 24]);
    expect(texts).toContainEqual({ value: `${workbook.name} · ${sheet.name}`, x: 31, y: 42 });
    expect(texts).toContainEqual({ value: '2 / 2', x: 579, y: 739 });
    expect(texts.some((text) => text.value === '最后一格')).toBe(true);
  });
});

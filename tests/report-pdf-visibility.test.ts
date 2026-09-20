import { afterEach, describe, expect, it, vi } from 'vitest';
import { planPdfPages, workbookToPdf } from '../src/lib/report-pdf';
import { createBlankWorkbook } from '../src/lib/seed';

function fixture() {
  const workbook = createBlankWorkbook('可见内容报表');
  const sheet = workbook.sheets[0];
  sheet.frozenRows = 0;
  return { workbook, sheet };
}

function stubCanvas() {
  const fillText = vi.fn();
  const measureText = vi.fn((text: string) => ({ width: Array.from(text).length * 4 }));
  const context = {
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText,
    measureText,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })),
    ),
  };
  vi.stubGlobal('document', {
    fonts: { ready: Promise.resolve() },
    createElement: vi.fn((name: string) => {
      if (name !== 'canvas') throw new Error(`Unexpected element: ${name}`);
      return canvas;
    }),
  });
  return { fillText, measureText, canvas };
}

afterEach(() => vi.unstubAllGlobals());

describe('PDF hidden-axis page planning', () => {
  it('keeps original visible coordinates and assigns zero size to hidden axes', () => {
    const { sheet } = fixture();
    sheet.cells = { A1: { value: '标题' }, E6: { value: '末尾' } };
    sheet.hiddenRows = [1, 3];
    sheet.hiddenColumns = [0, 2];
    sheet.rowHeights = { 1: 600, 2: 80, 3: 600 };
    sheet.columnWidths = { 0: 2000, 2: 2000 };
    const layout = planPdfPages(sheet);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].rows).toEqual([0, 2, 4, 5]);
    expect(layout.pages[0].columns).toEqual([1, 3, 4]);
    expect(layout.rowHeights).toEqual([24, 0, 60, 0, 24, 24]);
    expect(layout.columnWidths[0]).toBe(0);
    expect(layout.columnWidths[2]).toBe(0);
  });

  it('repeats only visible original title rows and columns', () => {
    const { sheet } = fixture();
    sheet.cells = { T40: { value: '末尾' } };
    sheet.hiddenRows = [0, 2];
    sheet.hiddenColumns = [0, 2];
    const layout = planPdfPages(sheet, { repeatRows: 3, repeatColumns: 3 });
    expect(layout.pages.length).toBeGreaterThan(3);
    for (const page of layout.pages) {
      expect(page.rows[0]).toBe(1);
      expect(page.columns[0]).toBe(1);
      expect(page.rows).not.toContain(0);
      expect(page.rows).not.toContain(2);
      expect(page.columns).not.toContain(0);
      expect(page.columns).not.toContain(2);
    }
  });

  it('maps manual breaks inside hidden runs to the next visible coordinate without empty pages', () => {
    const { sheet } = fixture();
    sheet.cells = { F6: { value: '末尾' } };
    sheet.hiddenRows = [1, 2];
    sheet.hiddenColumns = [1, 2];
    const layout = planPdfPages(sheet, { rowBreaks: [1, 2, 3], columnBreaks: [1, 2, 3] });
    expect(layout.pages).toHaveLength(4);
    expect(layout.pages.map((page) => [page.rows, page.columns])).toEqual([
      [[0], [0]],
      [[0], [3, 4, 5]],
      [[3, 4, 5], [0]],
      [
        [3, 4, 5],
        [3, 4, 5],
      ],
    ]);
  });

  it('keeps each surviving portion of a partially hidden merge on one page', () => {
    const { sheet } = fixture();
    sheet.cells = { I9: { value: '末尾' } };
    sheet.merges = [{ start: { row: 2, col: 2 }, end: { row: 6, col: 6 } }];
    sheet.hiddenRows = [3, 5];
    sheet.hiddenColumns = [3, 5];
    const layout = planPdfPages(sheet, { rowBreaks: [2, 7], columnBreaks: [2, 7] });
    for (const page of layout.pages) {
      if (page.rows.some((row) => [2, 4, 6].includes(row)))
        expect(page.rows).toEqual(expect.arrayContaining([2, 4, 6]));
      if (page.columns.some((col) => [2, 4, 6].includes(col)))
        expect(page.columns).toEqual(expect.arrayContaining([2, 4, 6]));
      expect(page.rows).not.toContain(3);
      expect(page.rows).not.toContain(5);
      expect(page.columns).not.toContain(3);
      expect(page.columns).not.toContain(5);
    }
  });

  it('ignores fully hidden merges when protecting page and repeated-title boundaries', () => {
    const { sheet } = fixture();
    sheet.cells = { A1: { value: '标题' }, Z20: { value: '末尾' } };
    sheet.merges = [{ start: { row: 1, col: 0 }, end: { row: 10, col: 20 } }];
    sheet.hiddenRows = Array.from({ length: 10 }, (_, index) => index + 1);
    const layout = planPdfPages(sheet, { repeatRows: 3, columnBreaks: [5] });
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(layout.pages.every((page) => page.rows[0] === 0)).toBe(true);
    expect(layout.pages.every((page) => page.rows.every((row) => row === 0 || row > 10))).toBe(
      true,
    );
    expect(layout.pages.some((page) => page.columns.includes(25))).toBe(true);
  });

  it.each(['rows', 'columns'] as const)(
    'rejects an empty printable extent when all %s are hidden',
    (axis) => {
      const { sheet } = fixture();
      sheet.cells = { C3: { value: '已隐藏' } };
      if (axis === 'rows') sheet.hiddenRows = [0, 1, 2];
      else sheet.hiddenColumns = [0, 1, 2];
      expect(() => planPdfPages(sheet)).toThrow('没有可打印');
    },
  );

  it('applies used-area limits before visibility reduction', () => {
    const { sheet } = fixture();
    sheet.cells = { J10: { value: '末尾' } };
    sheet.hiddenRows = Array.from({ length: 9 }, (_, index) => index);
    sheet.hiddenColumns = Array.from({ length: 9 }, (_, index) => index);
    expect(() => planPdfPages(sheet, { maxRows: 2 })).toThrow('超过导出上限');
    expect(() => planPdfPages(sheet, { maxColumns: 2 })).toThrow('超过导出上限');
    expect(() => planPdfPages(sheet, { maxCells: 20 })).toThrow('超过导出上限');
  });

  it('accepts a one-pixel row height as 0.75 PDF points', () => {
    const { sheet } = fixture();
    sheet.cells = { A1: { value: '' } };
    sheet.rowHeights = { 0: 1 };
    const layout = planPdfPages(sheet);
    expect(layout.rowHeights).toEqual([0.75]);
    expect(layout.pages[0].rows).toEqual([0]);
  });
});

describe('PDF visible-cell raster export', () => {
  it('omits hidden ordinary values but evaluates visible formulas that reference them', async () => {
    const { workbook, sheet } = fixture();
    sheet.cells = {
      A1: { value: '可见标题' },
      B1: { value: '隐藏列文本' },
      A2: { value: 321 },
      C2: { value: '隐藏行文本' },
      A3: { value: '=A2*2' },
    };
    sheet.hiddenRows = [1];
    sheet.hiddenColumns = [1];
    const { fillText } = stubCanvas();
    const progress = vi.fn();
    const output = await workbookToPdf(workbook, { onProgress: progress });
    const texts = fillText.mock.calls.map(([text]) => text);
    expect(texts).toContain('可见标题');
    expect(texts).toContain('642');
    expect(texts).not.toContain('321');
    expect(texts).not.toContain('隐藏列文本');
    expect(texts).not.toContain('隐藏行文本');
    expect(new TextDecoder().decode(output.slice(0, 8))).toBe('%PDF-1.4');
    expect(progress.mock.calls).toEqual([[1, 1]]);
  });

  it('draws a hidden merge anchor once in its surviving visible rectangle', async () => {
    const { workbook, sheet } = fixture();
    sheet.cells = { A1: { value: '合并锚点' }, D4: { value: '末尾' } };
    sheet.merges = [{ start: { row: 0, col: 0 }, end: { row: 2, col: 2 } }];
    sheet.hiddenRows = [0];
    sheet.hiddenColumns = [0];
    const { fillText } = stubCanvas();
    await workbookToPdf(workbook);
    const calls = fillText.mock.calls.filter(([text]) => text === '合并锚点');
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(1)).toEqual([32, 72]);
  });

  it('skips text measurement for hidden ordinary cells and wholly hidden merges', async () => {
    const { workbook, sheet } = fixture();
    const hiddenText = '隐'.repeat(20_000);
    sheet.cells = {
      A1: { value: '可见' },
      B1: { value: hiddenText },
      A2: { value: hiddenText },
      C2: { value: hiddenText },
      E4: { value: '末尾' },
    };
    sheet.hiddenRows = [1, 2];
    sheet.hiddenColumns = [1];
    sheet.merges = [{ start: { row: 1, col: 2 }, end: { row: 2, col: 3 } }];
    const { fillText, measureText } = stubCanvas();
    await expect(workbookToPdf(workbook)).resolves.toBeInstanceOf(ArrayBuffer);
    expect(fillText.mock.calls.some(([text]) => String(text).includes('隐'))).toBe(false);
    expect(measureText.mock.calls.some(([text]) => text.includes('隐'))).toBe(false);
  });
});

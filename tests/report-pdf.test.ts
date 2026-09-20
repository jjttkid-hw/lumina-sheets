import { describe, expect, it } from 'vitest';
import { createBlankWorkbook, createDemoWorkbook } from '../src/lib/seed';
import { assembleJpegPdf, planPdfPages, workbookToPdf } from '../src/lib/report-pdf';

describe('client-side PDF grid pagination', () => {
  it('paginates both axes and repeats designated leading rows and columns', () => {
    const sheet = createBlankWorkbook().sheets[0];
    sheet.cells = { A1: { value: '标题' }, T90: { value: '最后一格不可丢失' } };
    const layout = planPdfPages(sheet, { repeatRows: 1, repeatColumns: 1 });
    expect(layout.pages.length).toBeGreaterThan(4);
    expect(layout.pages.every((page) => page.rows[0] === 0 && page.columns[0] === 0)).toBe(true);
    const coordinates = new Set(
      layout.pages.flatMap((page) =>
        page.rows.flatMap((row) => page.columns.map((column) => `${row}:${column}`)),
      ),
    );
    expect(coordinates.size).toBe(90 * 20);
    expect(coordinates.has('89:19')).toBe(true);
    for (const page of layout.pages) {
      expect(
        page.columns.reduce((sum, col) => sum + layout.columnWidths[col], 0),
      ).toBeLessThanOrEqual(layout.width - 56);
      expect(page.rows.reduce((sum, row) => sum + layout.rowHeights[row], 0)).toBeLessThanOrEqual(
        layout.height - 116,
      );
    }
  });

  it('keeps basic merged cells together at horizontal and vertical page breaks', () => {
    const sheet = createBlankWorkbook().sheets[0];
    sheet.cells = { A1: { value: '报表' }, L25: { value: '末尾' } };
    sheet.merges = [
      { start: { row: 1, col: 8 }, end: { row: 1, col: 10 } },
      { start: { row: 18, col: 0 }, end: { row: 20, col: 0 } },
    ];
    const layout = planPdfPages(sheet);
    for (const page of layout.pages) {
      if (page.columns.some((col) => col >= 8 && col <= 10))
        expect(page.columns).toEqual(expect.arrayContaining([8, 9, 10]));
      if (page.rows.some((row) => row >= 18 && row <= 20))
        expect(page.rows).toEqual(expect.arrayContaining([18, 19, 20]));
    }
  });

  it('rejects every size limit instead of silently truncating cell values or used area', async () => {
    const workbook = createDemoWorkbook();
    await expect(workbookToPdf(workbook, { maxRows: 4, maxColumns: 6 })).rejects.toThrow(
      '未导出任何截断内容',
    );
    expect(() => planPdfPages(workbook.sheets[0], { maxCells: 10 })).toThrow('上限');
    const sheet = createBlankWorkbook().sheets[0];
    sheet.cells = { T90: { value: 1 } };
    expect(() => planPdfPages(sheet, { maxPages: 1 })).toThrow('页上限');
    sheet.columnWidths = { 0: 2000 };
    expect(() => planPdfPages(sheet)).toThrow('超过单页空间');
  });

  it('rejects merges larger than a page and merges crossing repeated title boundaries', () => {
    const sheet = createBlankWorkbook().sheets[0];
    sheet.cells = { A1: { value: '标题' } };
    sheet.merges = [{ start: { row: 0, col: 0 }, end: { row: 0, col: 15 } }];
    expect(() => planPdfPages(sheet)).toThrow('超过单页空间');
    sheet.merges = [{ start: { row: 0, col: 0 }, end: { row: 2, col: 0 } }];
    expect(() => planPdfPages(sheet, { repeatRows: 1 })).toThrow('重复标题边界');
  });

  it('uses measured heights so wrapped content moves intact to the next page', () => {
    const sheet = createBlankWorkbook().sheets[0];
    sheet.cells = { A5: { value: '长文本' } };
    const layout = planPdfPages(sheet, {}, [100, 100, 100, 100, 100]);
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[1].rows).toEqual([0, 4]);
    expect(() => planPdfPages(sheet, {}, [100, 100, 100, 100, 600])).toThrow('超过单页空间');
  });

  it('does not export a partially loaded paged data source as a complete report', () => {
    const sheet = createBlankWorkbook().sheets[0];
    sheet.dataSource = { kind: 'paged', totalRows: 100_000, pageSize: 100 };
    expect(() => planPdfPages(sheet)).toThrow('完整加载');
  });

  it('supports cancellation before any browser resources are allocated', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      workbookToPdf(createDemoWorkbook(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('binary-safe JPEG PDF assembly', () => {
  it('writes correct byte offsets and stream lengths without encoding JPEG bytes as text', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0, 0x81, 0xfe, 13, 10, 0xff, 0xd9]);
    const bytes = new Uint8Array(
      assembleJpegPdf([{ bytes: jpeg, pixelWidth: 2, pixelHeight: 3 }], 595.28, 841.89),
    );
    const latin = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    expect(latin.startsWith('%PDF-1.4')).toBe(true);
    expect(latin).toContain('/Filter /DCTDecode /Length 9');
    expect(latin).toContain('/MediaBox [0 0 595.28 841.89]');
    const xrefStart = Number(/startxref\n(\d+)/.exec(latin)![1]);
    expect(latin.slice(xrefStart, xrefStart + 4)).toBe('xref');
    const offsets = Array.from(latin.matchAll(/^(\d{10}) 00000 n /gm), (match) => Number(match[1]));
    offsets.forEach((offset, index) =>
      expect(latin.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj`)),
    );
    const streamAt = latin.indexOf('stream\n') + 7;
    expect(bytes.slice(streamAt, streamAt + jpeg.length)).toEqual(jpeg);
  });
  it('rejects missing pages and images that are not JPEGs', () => {
    expect(() => assembleJpegPdf([], 595, 842)).toThrow('至少需要一页');
    expect(() =>
      assembleJpegPdf(
        [{ bytes: new Uint8Array([1, 2, 3]), pixelWidth: 1, pixelHeight: 1 }],
        595,
        842,
      ),
    ).toThrow('JPEG');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { arrayDataSource, workbookFromReportData } from '../src/lib/report-data';
import { validateWorkbook, workbookFromXlsx, workbookToXlsx, parseCsv } from '../src/lib/io';
import { workbookCsvBlob } from '../src/lib/io-stream';
import { reportDataCsvBlob } from '../src/lib/report-data-export';
import { planPdfPages } from '../src/lib/report-pdf';

describe('complete bounded report snapshots', () => {
  it('reads all pages sequentially, preserves primitive values and exports static XLSX', async () => {
    const rows = [[0, false, '001'], [1, true, '中文'], []];
    const source = arrayDataSource(rows, { columnCount: 3 });
    const fetch = vi.spyOn(source, 'fetchPage');
    const progress = vi.fn();
    const book = await workbookFromReportData(source, {
      pageSize: 2,
      name: '完整报表',
      onProgress: progress,
    });
    expect(fetch.mock.calls.map(([offset, limit]) => [offset, limit])).toEqual([
      [0, 2],
      [2, 1],
    ]);
    expect(progress.mock.calls).toEqual([
      [2, 3],
      [3, 3],
    ]);
    const sheet = book.sheets[0];
    expect(sheet.dataSource).toEqual({ kind: 'static', totalRows: 3 });
    expect([sheet.rowCount, sheet.colCount]).toEqual([3, 3]);
    expect(sheet.cells).toMatchObject({
      A1: { value: 0 },
      B1: { value: false },
      C1: { value: '001' },
    });
    expect(sheet.cells.A3).toBeUndefined();
    rows[0][0] = 99;
    expect(sheet.cells.A1.value).toBe(0);
    expect(validateWorkbook(book).sheets[0].dataSource).toEqual(sheet.dataSource);
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[0].cells).toMatchObject(sheet.cells);
  });

  it.each([
    { rows: [[1], [], []], columns: 3 },
    { rows: [[], []], columns: 2 },
    { rows: [[1], []], columns: 1 },
    { rows: [[0, false]], columns: 2 },
  ])('preserves complete source bounds in static CSV and PDF (%#)', async ({ rows, columns }) => {
    const source = arrayDataSource(rows, { columnCount: columns });
    const book = await workbookFromReportData(source);
    const before = structuredClone(book);
    const direct = await (await reportDataCsvBlob(source)).text();
    const materialized = await (await workbookCsvBlob(book)).text();
    expect(materialized).toBe(direct);
    expect(parseCsv(materialized)).toHaveLength(rows.length);
    const layout = planPdfPages(book.sheets[0]);
    const coordinates = new Set(
      layout.pages.flatMap((page) =>
        page.rows.flatMap((row) => page.columns.map((col) => `${row}:${col}`)),
      ),
    );
    expect(coordinates.size).toBe(rows.length * columns);
    expect(book).toEqual(before);
  });

  it('retains blank trailing source extent through real XLSX encoding and decoding without dense allocation', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => (i === 0 ? [7] : []));
    const book = await workbookFromReportData(arrayDataSource(rows, { columnCount: 18 }));
    const output = await workbookFromXlsx(await workbookToXlsx(book));
    expect(output.sheets[0].rowCount).toBe(120);
    expect(output.sheets[0].colCount).toBe(18);
    expect(output.sheets[0].cells.R120?.value).toBe('');
    expect(Object.keys(book.sheets[0].cells)).toHaveLength(2);
    expect(Object.keys(output.sheets[0].cells)).toHaveLength(2);
    expect(await (await workbookCsvBlob(output)).text()).toBe(
      await (await workbookCsvBlob(book)).text(),
    );
  });

  it('accepts unknown totals only after a short page proves the end', async () => {
    const fetchPage = vi.fn(async (offset: number) => ({
      rows: offset === 0 ? [[1], [2]] : [[3]],
    }));
    const book = await workbookFromReportData({ columnCount: 1, fetchPage }, { pageSize: 2 });
    expect(book.sheets[0].dataSource?.totalRows).toBe(3);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('rejects an unproven full page at the scan ceiling instead of returning truncated data', async () => {
    const fetchPage = vi.fn(async () => ({ rows: [[1], [2]] }));
    await expect(
      workbookFromReportData({ columnCount: 1, fetchPage }, { maxRows: 2 }),
    ).rejects.toThrow('完整性');
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it.each([
    { columnCount: 257 },
    { maxRows: 0 },
    { maxRows: 100001 },
    { maxCells: 100001 },
    { maxCells: 1, columnCount: 2 },
    { pageSize: 1.5 },
    { name: '' },
  ])('rejects invalid capacity/settings before fetching (%#)', async (args) => {
    const fetchPage = vi.fn();
    const { columnCount = 1, ...options } = args;
    await expect(workbookFromReportData({ columnCount, fetchPage }, options)).rejects.toThrow();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('rejects a known oversized source before allocating rows or fetching', async () => {
    const fetchPage = vi.fn();
    await expect(
      workbookFromReportData({ columnCount: 20, rowCount: 6000, fetchPage }),
    ).rejects.toThrow('容量');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it.each(['missing', 'changed', 'oversized'] as const)(
    'rejects inconsistent sources: %s',
    async (kind) => {
      const source = {
        columnCount: 1,
        rowCount: 4,
        fetchPage: vi.fn(async (offset: number) => {
          if (offset === 0)
            return { rows: [[1], [2]], totalRows: kind === 'oversized' ? 100001 : 4 };
          return {
            rows: kind === 'missing' ? [[3]] : [[3], [4]],
            totalRows: kind === 'changed' ? 5 : 4,
          };
        }),
      };
      await expect(workbookFromReportData(source, { pageSize: 2 })).rejects.toThrow();
    },
  );

  it('rejects a late total smaller than the rows already read', async () => {
    const source = {
      columnCount: 1,
      fetchPage: async (offset: number) =>
        offset === 0 ? { rows: [[1], [2]] } : { rows: [], totalRows: 1 },
    };
    await expect(workbookFromReportData(source, { pageSize: 2 })).rejects.toThrow('总行数');
  });

  it('creates an empty static sheet without fetching a known empty source', async () => {
    const fetchPage = vi.fn();
    const book = await workbookFromReportData({ columnCount: 3, rowCount: 0, fetchPage });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(book.sheets[0]).toMatchObject({
      rowCount: 1,
      colCount: 3,
      cells: {},
      dataSource: { kind: 'static', totalRows: 0 },
    });
  });

  it('does not promote raw formula-like source text into executable formulas', async () => {
    await expect(workbookFromReportData(arrayDataSource([['=1+1']]))).rejects.toThrow('原始文本');
    const book = await workbookFromReportData(
      arrayDataSource([['+plain'], ['-plain'], ['@plain']]),
    );
    expect(book.sheets[0].cells.A1.value).toBe('+plain');
  });

  it('cancels even when the source ignores the signal and consumes late failure', async () => {
    let reject!: (error: Error) => void;
    const wait = new Promise<never>((_resolve, fail) => {
      reject = fail;
    });
    const fetchPage = vi.fn(() => wait);
    const controller = new AbortController();
    const result = workbookFromReportData(
      { columnCount: 1, fetchPage },
      { signal: controller.signal },
    );
    await Promise.resolve();
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    reject(Error('late'));
  });

  it.each([0, 1])('rejects cancellation in final progress for %s rows', async (count) => {
    const controller = new AbortController();
    await expect(
      workbookFromReportData(arrayDataSource(count ? [[1]] : []), {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('isolates a returned page while yielding to host tasks', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => [i]);
    const source = {
      columnCount: 1,
      rowCount: 40,
      fetchPage: async () => ({ rows, totalRows: 40 }),
    };
    const result = workbookFromReportData(source, { pageSize: 40 });
    setTimeout(() => {
      rows[39][0] = 999;
    }, 0);
    const book = await result;
    expect(book.sheets[0].cells.A40.value).toBe(39);
  });

  it('limits retained text and cancels during cooperative row copying', async () => {
    const source = arrayDataSource(Array.from({ length: 250 }, () => ['x'.repeat(32767)]));
    await expect(workbookFromReportData(source)).rejects.toThrow('文本超过容量');
    const controller = new AbortController();
    const result = workbookFromReportData(source, { signal: controller.signal });
    setTimeout(() => controller.abort(), 0);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});

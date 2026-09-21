import { describe, expect, it, vi } from 'vitest';
import {
  iterateReportCsvChunks,
  reportDataCsvBlob,
  reportDataCsvReadableStream,
} from '../src/lib/report-data-export';

describe('paged CSV text capacity', () => {
  it('rejects a default oversized page before emitting bytes or progress', async () => {
    const onProgress = vi.fn();
    const fetchPage = vi.fn(async () => ({ rows: [Array(245).fill('x'.repeat(32767))] }));
    const iterator = iterateReportCsvChunks(
      { columnCount: 245, rowCount: 1, fetchPage },
      { onProgress },
    );
    const result = await iterator.next().then(
      () => 'unexpected output',
      (error: Error) => error.message,
    );
    expect(result).toContain('maxPageTextUnits');
    expect(onProgress).not.toHaveBeenCalled();
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it('counts UTF-16 units across all cells and rows and rejects the whole page', async () => {
    const source = {
      columnCount: 2,
      rowCount: 2,
      fetchPage: async () => ({ rows: [['😀', 'a'], ['b']] }),
    };
    await expect(reportDataCsvBlob(source, { maxPageTextUnits: 3 })).rejects.toThrow(
      'maxPageTextUnits',
    );
    expect(
      await (await reportDataCsvBlob(source, { maxPageTextUnits: 4, includeBom: false })).text(),
    ).toBe('😀,a\r\nb,\r\n');
  });

  it('resets the budget for each page so reducing pageSize exports all rows', async () => {
    const fetchPage = vi.fn(async (offset: number, limit: number) => ({
      rows: Array.from({ length: limit }, (_, i) => [`R${offset + i}`]),
    }));
    const source = { columnCount: 1, rowCount: 3, fetchPage };
    await expect(reportDataCsvBlob(source, { maxPageTextUnits: 2 })).rejects.toThrow(
      'maxPageTextUnits',
    );
    expect(
      await (
        await reportDataCsvBlob(source, { pageSize: 1, maxPageTextUnits: 2, includeBom: false })
      ).text(),
    ).toBe('R0\r\nR1\r\nR2\r\n');
    expect(fetchPage.mock.calls.slice(1).map((call) => call.slice(0, 2))).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });

  it('errors the stream after a later oversized page instead of marking partial output complete', async () => {
    const onProgress = vi.fn();
    const fetchPage = vi.fn(async (offset: number) => ({ rows: [[offset === 0 ? 'ok' : 'long']] }));
    const reader = reportDataCsvReadableStream(
      { columnCount: 1, rowCount: 3, fetchPage },
      { pageSize: 1, maxPageTextUnits: 2, onProgress },
    ).getReader();
    const closed = reader.closed.catch((error) => error);
    expect((await reader.read()).done).toBe(false);
    await expect(reader.read()).rejects.toThrow('maxPageTextUnits');
    expect(await closed).toBeInstanceOf(RangeError);
    expect(onProgress.mock.calls).toEqual([[1, 3]]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 32_000_001])(
    'rejects invalid text budget %s before fetching',
    async (maxPageTextUnits) => {
      const fetchPage = vi.fn(async () => ({ rows: [] }));
      await expect(
        reportDataCsvBlob({ columnCount: 1, rowCount: 0, fetchPage }, { maxPageTextUnits }),
      ).rejects.toThrow('文本上限');
      expect(fetchPage).not.toHaveBeenCalled();
    },
  );
});

import { describe, expect, it, vi } from 'vitest';
import { ReportChunkCache } from '../src/lib/report-data';

describe('viewport page payload budgets', () => {
  it('bounds default requests for very wide sources without dropping columns or rows', async () => {
    const fetchPage = vi.fn(async (offset: number, limit: number) => ({
      rows: Array.from({ length: limit }, (_, i) => [offset + i]),
    }));
    const cache = new ReportChunkCache({ columnCount: 16_384, fetchPage });
    expect(cache.pageSize).toBe(6);
    expect((await cache.getRow(7))?.[0]).toBe(7);
    expect(fetchPage.mock.calls[0].slice(0, 2)).toEqual([6, 6]);
    expect(cache.columnCount).toBe(16_384);
    cache.dispose();
  });

  it('uses the effective page size at page boundaries and at the source tail', async () => {
    const fetchPage = vi.fn(async (offset: number, limit: number) => ({
      rows: Array.from({ length: limit }, (_, i) => [offset + i, false, '']),
      totalRows: 5,
    }));
    const cache = new ReportChunkCache(
      { columnCount: 3, rowCount: 5, fetchPage },
      { pageSize: 20, maxPageCells: 7, maxPages: 3 },
    );
    await cache.ensureRange(0, 4);
    expect(fetchPage.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [0, 2],
      [2, 2],
      [4, 1],
    ]);
    expect(Array.from({ length: 5 }, (_, row) => cache.read(row, 0))).toEqual([0, 1, 2, 3, 4]);
    expect(cache.read(4, 1)).toBe(false);
    cache.dispose();
  });

  it('rejects over-budget text atomically, preserving cached pages and total before retry', async () => {
    let broken = true;
    const fetchPage = vi.fn(async (offset: number) =>
      offset === 0
        ? { rows: [['safe']] }
        : { rows: [[broken ? '😀abc' : '😀ab']], totalRows: broken ? 3 : 2 },
    );
    const cache = new ReportChunkCache(
      { columnCount: 1, rowCount: 2, fetchPage },
      { pageSize: 1, maxPages: 2, maxPageTextUnits: 4 },
    );
    await cache.getPage(0);
    await expect(cache.getPage(1)).rejects.toThrow('maxPageTextUnits');
    expect(cache.rowCount).toBe(2);
    expect(cache.size).toBe(1);
    expect(cache.read(0, 0)).toBe('safe');
    expect(cache.read(1, 0)).toBeUndefined();
    expect(cache.errorAt(1)).toBeInstanceOf(RangeError);
    expect(cache.loading).toBe(0);
    broken = false;
    expect((await cache.getPage(1)).rows).toEqual([['😀ab']]);
    expect(cache.errorAt(1)).toBeUndefined();
    cache.clear();
    expect(cache.size).toBe(0);
    await cache.getPage(1);
    cache.dispose();
  });

  it('counts text across cells and rows, and releases the request slot after a capacity error', async () => {
    const fetchPage = vi.fn(async (offset: number) => ({
      rows:
        offset === 0
          ? [
              ['aa', 'b'],
              ['cc', 'd'],
            ]
          : [
              [0, false],
              ['', 'ok'],
            ],
    }));
    const cache = new ReportChunkCache(
      { columnCount: 2, fetchPage },
      { pageSize: 2, maxPages: 1, maxPageTextUnits: 5 },
    );
    const oversized = cache.getPage(0).catch((error) => error);
    const queued = cache.getPage(1);
    expect(await oversized).toBeInstanceOf(RangeError);
    expect((await queued).rows).toEqual([
      [0, false],
      ['', 'ok'],
    ]);
    expect(cache.size).toBe(1);
    expect(cache.loading).toBe(0);
    cache.dispose();
  });

  it.each([
    { maxPageCells: 0 },
    { maxPageCells: 1.5 },
    { maxPageCells: 1_000_001 },
    { maxPageTextUnits: 0 },
    { maxPageTextUnits: NaN },
    { maxPageTextUnits: 32_000_001 },
    { maxPageCells: 1 },
  ])('rejects invalid or less-than-one-row budgets before fetching: %j', (options) => {
    const fetchPage = vi.fn();
    expect(() => new ReportChunkCache({ columnCount: 2, fetchPage }, options)).toThrow(RangeError);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

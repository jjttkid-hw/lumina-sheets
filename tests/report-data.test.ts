import { describe, expect, it, vi } from 'vitest';
import {
  ReportChunkCache,
  arrayDataSource,
  restDataSource,
  hydrateSheetPage,
  type ReportDataSource,
  type ReportPage,
} from '../src/lib/report-data';
import { createBlankWorkbook } from '../src/lib/seed';

describe('paged report data binding', () => {
  it('loads viewport-sized pages and evicts least recently used pages', async () => {
    const calls: number[] = [];
    const source: ReportDataSource = {
      rowCount: 1_000_000,
      columnCount: 3,
      fetchPage: async (offset, limit) => {
        calls.push(offset);
        return {
          totalRows: 1_000_000,
          rows: Array.from({ length: limit }, (_, i) => [offset + i, `R${offset + i}`, true]),
        };
      },
    };
    const cache = new ReportChunkCache(source, { pageSize: 4, maxPages: 2 });
    expect((await cache.getRow(5))?.[1]).toBe('R5');
    await cache.getPage(1);
    await cache.getPage(2);
    expect(cache.size).toBe(2);
    expect(calls).toEqual([4, 8]);
  });

  it('keeps cached data outside the workbook and loads only the requested viewport', async () => {
    const calls: number[] = [];
    const source: ReportDataSource = {
      rowCount: 1_000_000,
      columnCount: 2,
      fetchPage: async (offset, limit) => {
        calls.push(offset);
        return { rows: Array.from({ length: limit }, (_, i) => [offset + i, false]) };
      },
    };
    const cache = new ReportChunkCache(source, { pageSize: 64, maxPages: 3 });
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(listener);
    expect(cache.peekRow(250_003)).toBeUndefined();
    expect(calls).toEqual([]);
    await cache.ensureRange(250_003, 250_085);
    expect(calls).toEqual([249_984, 250_048]);
    expect(cache.read(250_085, 0)).toBe(250_085);
    expect(cache.read(250_085, 1)).toBe(false);
    expect(cache.rowCount).toBe(1_000_000);
    expect(cache.size).toBe(2);
    expect(cache.loading).toBe(0);
    expect(listener).toHaveBeenCalled();
    const priorCalls = listener.mock.calls.length;
    unsubscribe();
    cache.clear();
    expect(listener).toHaveBeenCalledTimes(priorCalls);
  });

  it('refreshes LRU access from synchronous Canvas reads', async () => {
    const fetchPage = vi.fn(async (offset: number) => ({ rows: [[offset]] }));
    const cache = new ReportChunkCache({ columnCount: 1, fetchPage }, { pageSize: 1, maxPages: 2 });
    await cache.getPage(0);
    await cache.getPage(1);
    expect(cache.read(0, 0)).toBe(0);
    await cache.getPage(2);
    expect(cache.peekRow(1)).toBeUndefined();
    expect(cache.peekRow(0)).toEqual([0]);
    expect(cache.size).toBe(2);
    await cache.getPage(1);
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });

  it('deduplicates requests without letting one caller cancel another', async () => {
    const gate = deferred<ReportPage>();
    let receivedSignal: AbortSignal | undefined;
    const fetchPage = vi.fn((_offset: number, _limit: number, signal?: AbortSignal) => {
      receivedSignal = signal;
      return gate.promise;
    });
    const cache = new ReportChunkCache({ columnCount: 1, fetchPage });
    const controller = new AbortController();
    const cancelled = cache.getPage(0, controller.signal);
    const surviving = cache.getPage(0);
    const rejection = expect(cancelled).rejects.toHaveProperty('name', 'AbortError');
    await Promise.resolve();
    controller.abort();
    await rejection;
    expect(receivedSignal?.aborted).toBe(false);
    gate.resolve({ rows: [[42]], totalRows: 1 });
    expect((await surviving).rows).toEqual([[42]]);
    expect(cache.read(0, 0)).toBe(42);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('cancels the underlying request when every subscriber leaves and allows immediate retry', async () => {
    let receivedSignal: AbortSignal | undefined;
    const oldPage = deferred<ReportPage>();
    const fetchPage = vi
      .fn()
      .mockImplementationOnce((_o: number, _l: number, signal?: AbortSignal) => {
        receivedSignal = signal;
        return oldPage.promise;
      })
      .mockResolvedValue({ rows: [[2]], totalRows: 1 });
    const cache = new ReportChunkCache({ columnCount: 1, fetchPage });
    const controller = new AbortController();
    const cancelled = cache.getPage(0, controller.signal);
    const rejection = expect(cancelled).rejects.toHaveProperty('name', 'AbortError');
    await Promise.resolve();
    controller.abort();
    await rejection;
    expect(receivedSignal?.aborted).toBe(true);
    expect(cache.loading).toBe(0);
    expect(cache.errorAt(0)).toBeUndefined();
    await cache.getPage(0);
    oldPage.resolve({ rows: [[1]], totalRows: 1 });
    await Promise.resolve();
    expect(cache.read(0, 0)).toBe(2);
  });

  it('clear prevents stale responses from entering a newer generation or deleting its request', async () => {
    const oldPage = deferred<ReportPage>();
    const newPage = deferred<ReportPage>();
    const fetchPage = vi
      .fn()
      .mockReturnValueOnce(oldPage.promise)
      .mockReturnValueOnce(newPage.promise);
    const cache = new ReportChunkCache({ columnCount: 1, fetchPage });
    const stale = cache.getPage(0);
    const rejection = expect(stale).rejects.toHaveProperty('name', 'AbortError');
    await Promise.resolve();
    cache.clear();
    const current = cache.getPage(0);
    await rejection;
    expect(cache.loading).toBe(1);
    oldPage.resolve({ rows: [[1]], totalRows: 1 });
    await Promise.resolve();
    expect(cache.peekRow(0)).toBeUndefined();
    expect(cache.loading).toBe(1);
    newPage.resolve({ rows: [[2]], totalRows: 1 });
    await current;
    expect(cache.read(0, 0)).toBe(2);
    expect(cache.loading).toBe(0);
  });

  it('records bounded errors and retries failed pages on demand', async () => {
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ rows: [['online']] });
    const cache = new ReportChunkCache({ columnCount: 1, fetchPage });
    await expect(cache.getRow(0)).rejects.toThrow('offline');
    expect(cache.errorAt(0)?.message).toBe('offline');
    expect(cache.size).toBe(0);
    expect(cache.loading).toBe(0);
    expect(await cache.getRow(0)).toEqual(['online']);
    expect(cache.errorAt(0)).toBeUndefined();
  });

  it('rejects invalid coordinates and oversized viewport ranges before loading', async () => {
    const fetchPage = vi.fn(async () => ({ rows: [] }));
    const cache = new ReportChunkCache({ columnCount: 2, fetchPage }, { pageSize: 4, maxPages: 2 });
    for (const row of [-1, 0.5, NaN, 1_048_576])
      await expect(cache.getRow(row)).rejects.toBeInstanceOf(RangeError);
    expect(() => cache.read(0, 2)).toThrow(RangeError);
    await expect(cache.ensureRange(0, 8)).rejects.toThrow('缓存页数');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [[null]] },
    { rows: [[Infinity]] },
    { rows: [[{}]] },
    { rows: [['x'.repeat(32768)]] },
    { rows: [[1, 2]] },
    { rows: 'wrong' },
    { rows: [[1]], totalRows: 0 },
    { rows: [[1]], totalRows: 1.5 },
    { rows: [[1], [2], [3]] },
  ])('rejects malformed page data: %j', async (page) => {
    const cache = new ReportChunkCache(
      { columnCount: 1, fetchPage: async () => page as ReportPage },
      { pageSize: 2 },
    );
    await expect(cache.getPage(0)).rejects.toBeInstanceOf(Error);
    expect(cache.size).toBe(0);
    expect(cache.errorAt(0)).toBeInstanceOf(Error);
  });

  it.each(['source', 'response', 'cached'])(
    'rejects short interior pages with a total from %s and permits retry',
    async (kind) => {
      let incomplete = true;
      const fetchPage = vi.fn(async (offset: number, limit: number) => ({
        rows: Array.from({ length: incomplete && offset === 4 ? 1 : limit }, (_, i) => [
          offset + i,
        ]),
        ...(kind !== 'source' && offset === 0 ? { totalRows: 10 } : {}),
        ...(kind === 'response' && offset === 4 ? { totalRows: 10 } : {}),
      }));
      const cache = new ReportChunkCache(
        { columnCount: 1, fetchPage, ...(kind === 'source' ? { rowCount: 10 } : {}) },
        { pageSize: 4 },
      );
      if (kind === 'cached') await cache.getPage(0);
      const size = cache.size;
      await expect(cache.getPage(1)).rejects.toThrow('缺行');
      expect(cache.size).toBe(size);
      expect(cache.peekRow(4)).toBeUndefined();
      expect(cache.loading).toBe(0);
      expect(cache.errorAt(4)?.message).toContain('缺行');
      incomplete = false;
      expect((await cache.getPage(1)).rows).toEqual([[4], [5], [6], [7]]);
      expect(cache.errorAt(4)).toBeUndefined();
      cache.dispose();
    },
  );

  it('does not commit a new total when its response has missing rows', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ rows: [[1]], totalRows: 10 })
      .mockResolvedValueOnce({ rows: [[1], [2]], totalRows: 2 });
    const cache = new ReportChunkCache({ columnCount: 1, fetchPage }, { pageSize: 4 });
    await expect(cache.getPage(0)).rejects.toThrow('缺行');
    expect(cache.rowCount).toBeUndefined();
    expect(cache.size).toBe(0);
    await cache.getPage(0);
    expect(cache.rowCount).toBe(2);
    expect(cache.read(1, 0)).toBe(2);
    cache.dispose();
  });

  it('keeps unknown-total short pages and explicit shrink beyond the requested offset valid', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ rows: [[1]] })
      .mockResolvedValueOnce({ rows: [], totalRows: 2 });
    const cache = new ReportChunkCache({ columnCount: 1, fetchPage }, { pageSize: 4 });
    await cache.getPage(0);
    expect(cache.rowCount).toBeUndefined();
    await cache.getPage(2);
    expect(cache.rowCount).toBe(2);
    cache.dispose();
  });

  it('handles a partial final page and never fetches beyond the known end', async () => {
    const fetchPage = vi.fn(async (_offset: number, limit: number) => ({
      rows: [[5]].slice(0, limit),
      totalRows: 5,
    }));
    const cache = new ReportChunkCache({ rowCount: 5, columnCount: 1, fetchPage }, { pageSize: 4 });
    expect(await cache.getRow(4)).toEqual([5]);
    expect(fetchPage.mock.calls[0][1]).toBe(1);
    expect(await cache.getRow(5)).toBeUndefined();
    await cache.ensureRange(5, 20);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('dispose cancels pending work and rejects future requests', async () => {
    const cache = new ReportChunkCache({ columnCount: 1, fetchPage: () => new Promise(() => {}) });
    const pending = cache.getPage(0);
    const rejection = expect(pending).rejects.toHaveProperty('name', 'AbortError');
    cache.dispose();
    await rejection;
    expect(cache.loading).toBe(0);
    await expect(cache.getPage(0)).rejects.toThrow('销毁');
  });

  it('hydrates a sparse sheet while preserving logical dimensions', async () => {
    const book = createBlankWorkbook();
    const source: ReportDataSource = {
      columnCount: 2,
      fetchPage: async () => ({
        totalRows: 1_000_000,
        rows: [
          ['header', 'value'],
          ['a', 42],
        ],
      }),
    };
    const sheet = await hydrateSheetPage(book.sheets[0], source, 10, 2);
    expect(sheet.cells.A11.value).toBe('header');
    expect(sheet.cells.B12.value).toBe(42);
    expect(sheet.rowCount).toBe(1_000_000);
    expect(sheet.dataSource?.kind).toBe('paged');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('data source adapters', () => {
  it('copies only requested array rows and preserves literal values', async () => {
    const rows = [
      ['=SUM(A1:A3)', 0, false],
      ['0021', 42, true],
    ];
    const source = arrayDataSource(rows);
    expect(source.rowCount).toBe(2);
    expect(source.columnCount).toBe(3);
    const page = await source.fetchPage(1, 1);
    expect(page).toEqual({ rows: [['0021', 42, true]], totalRows: 2 });
    expect(page.rows[0]).not.toBe(rows[1]);
    const empty = arrayDataSource([], { columnCount: 3 });
    expect(await empty.fetchPage(0, 10)).toEqual({ rows: [], totalRows: 0 });
  });

  it('REST adapter is lazy, uses the supplied URL and passes cancellation and HTTP options', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ rows: [[42]], totalRows: 21 }), { status: 200 }),
    );
    const source = restDataSource('https://example.test/reports?team=sales', {
      columnCount: 1,
      rowCount: 21,
      fetcher,
      headers: { 'X-Report': 'sales' },
      credentials: 'omit',
    });
    expect(fetcher).not.toHaveBeenCalled();
    const controller = new AbortController();
    expect(await source.fetchPage(20, 1, controller.signal)).toEqual({
      rows: [[42]],
      totalRows: 21,
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe('https://example.test/reports?team=sales&offset=20&limit=1');
    expect(init.signal).toBe(controller.signal);
    expect(init.credentials).toBe('omit');
    expect(new Headers(init.headers).get('Accept')).toBe('application/json');
    expect(new Headers(init.headers).get('X-Report')).toBe('sales');
  });

  it('REST adapter rejects HTTP and payload failures without caching them', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('offline', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: [[false]] })));
    const cache = new ReportChunkCache(
      restDataSource('https://example.test/reports', { columnCount: 1, fetcher }),
    );
    await expect(cache.getPage(0)).rejects.toThrow('HTTP 503');
    expect((await cache.getPage(0)).rows).toEqual([[false]]);
    expect(() => restDataSource('', { columnCount: 1, fetcher })).toThrow('URL');
    expect(() => restDataSource('file:///tmp/data.json', { columnCount: 1, fetcher })).toThrow(
      'HTTP',
    );
  });

  it('pre-aborted calls never contact the data source', async () => {
    const fetcher = vi.fn();
    const source = restDataSource('https://example.test/reports', { columnCount: 1, fetcher });
    const controller = new AbortController();
    controller.abort();
    await expect(source.fetchPage(0, 1, controller.signal)).rejects.toHaveProperty(
      'name',
      'AbortError',
    );
    expect(fetcher).not.toHaveBeenCalled();
    await expect(arrayDataSource([[1]]).fetchPage(0, 1, controller.signal)).rejects.toHaveProperty(
      'name',
      'AbortError',
    );
  });
});

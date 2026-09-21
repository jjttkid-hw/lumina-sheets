import { describe, expect, it, vi } from 'vitest';
import { ReportChunkCache, type ReportPage } from '../src/lib/report-data';

function deferred() {
  let resolve!: (page: ReportPage) => void;
  const promise = new Promise<ReportPage>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('paged cache extent transitions', () => {
  it('invalidates old pages on shrink and reloads the boundary page with its new limit', async () => {
    let total = 8;
    const fetchPage = vi.fn(async (offset: number, limit: number) => ({
      rows: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => [
        `${total}:${offset + i}`,
      ]),
      totalRows: total,
    }));
    const cache = new ReportChunkCache({ columnCount: 1, rowCount: 8, fetchPage }, { pageSize: 4 });
    await cache.getPage(0);
    total = 2;
    await cache.getPage(1);
    expect(cache.rowCount).toBe(2);
    expect(cache.peekRow(0)).toBeUndefined();
    expect(cache.size).toBe(0);
    expect((await cache.getPage(0)).rows).toEqual([['2:0'], ['2:1']]);
    expect(fetchPage.mock.calls.at(-1)).toEqual([0, 2, expect.any(AbortSignal)]);
    cache.dispose();
  });

  it('invalidates a short cached final page when the source grows', async () => {
    let total = 6;
    const fetchPage = vi.fn(async (offset: number, limit: number) => ({
      rows: Array.from({ length: Math.min(limit, total - offset) }, (_, i) => [offset + i]),
      totalRows: total,
    }));
    const cache = new ReportChunkCache({ columnCount: 1, rowCount: 6, fetchPage }, { pageSize: 4 });
    await cache.getPage(1);
    total = 10;
    await cache.getPage(0);
    expect(cache.peekRow(4)).toBeUndefined();
    expect(await cache.getRow(7)).toEqual([7]);
    expect(cache.rowCount).toBe(10);
    cache.dispose();
  });

  it('cancels pending old extents promptly and ignores sources that respond after cancellation', async () => {
    const old = deferred();
    let received: AbortSignal | undefined;
    const fetchPage = vi.fn(async (offset: number, _limit: number, signal?: AbortSignal) => {
      if (offset === 4) {
        received = signal;
        return old.promise;
      }
      return { rows: [[1], [2]], totalRows: 2 };
    });
    const cache = new ReportChunkCache({ columnCount: 1, rowCount: 8, fetchPage }, { pageSize: 4 });
    const pending = cache.getPage(1).catch((error) => error);
    await Promise.resolve();
    await cache.getPage(0);
    expect(received?.aborted).toBe(true);
    expect(await pending).toMatchObject({ name: 'AbortError' });
    expect(cache.loading).toBe(0);
    old.resolve({ rows: [[4], [5], [6], [7]], totalRows: 8 });
    await Promise.resolve();
    expect(cache.rowCount).toBe(2);
    expect(cache.error).toBeUndefined();
    expect(cache.read(0, 0)).toBe(1);
    cache.dispose();
  });

  it('retains other pages for an unchanged total', async () => {
    const cache = new ReportChunkCache(
      {
        columnCount: 1,
        rowCount: 4,
        fetchPage: async (offset, limit) => ({
          rows: Array.from({ length: limit }, (_, i) => [offset + i]),
          totalRows: 4,
        }),
      },
      { pageSize: 2 },
    );
    await cache.getPage(0);
    await cache.getPage(1);
    expect(cache.size).toBe(2);
    expect(cache.peekRow(0)).toEqual([0]);
    cache.dispose();
  });

  it('does not cache a response requested at the old short tail after growth', async () => {
    const fetchPage = vi.fn(async (offset: number, limit: number) => ({
      rows: Array.from({ length: limit }, (_, i) => [offset + i]),
      totalRows: 8,
    }));
    const cache = new ReportChunkCache({ columnCount: 1, rowCount: 6, fetchPage }, { pageSize: 4 });
    expect((await cache.getPage(1)).rows).toEqual([[4], [5]]);
    expect(cache.size).toBe(0);
    expect(await cache.getRow(7)).toEqual([7]);
    expect(fetchPage.mock.calls.map((call) => call[1])).toEqual([2, 4]);
    cache.dispose();
  });

  it('removes incompatible unknown-total pages when the total is discovered', async () => {
    const fetchPage = vi.fn(async (offset: number) =>
      offset === 0 ? { rows: [[0]] } : { rows: [[4], [5]], totalRows: 6 },
    );
    const cache = new ReportChunkCache({ columnCount: 1, fetchPage }, { pageSize: 4 });
    await cache.getPage(0);
    await cache.getPage(1);
    expect(cache.peekRow(0)).toBeUndefined();
    expect(cache.peekRow(5)).toEqual([5]);
    cache.dispose();
  });

  it('clears previous page errors when an extent change is accepted', async () => {
    const cache = new ReportChunkCache(
      {
        columnCount: 1,
        rowCount: 8,
        fetchPage: async (offset) => {
          if (offset === 4) throw new Error('old page failure');
          return { rows: [[0], [1]], totalRows: 2 };
        },
      },
      { pageSize: 4 },
    );
    await expect(cache.getPage(1)).rejects.toThrow('old page failure');
    await cache.getPage(0);
    expect(cache.error).toBeUndefined();
    expect(cache.read(1, 0)).toBe(1);
    cache.dispose();
  });

  it.each(['clear', 'dispose'] as const)(
    'honors %s reentry from a cancelled source',
    async (action) => {
      const old = deferred();
      let cache!: ReportChunkCache;
      cache = new ReportChunkCache(
        {
          columnCount: 1,
          rowCount: 8,
          fetchPage: async (offset, _limit, signal) => {
            if (offset === 4) {
              signal?.addEventListener('abort', () => cache[action](), { once: true });
              return old.promise;
            }
            return { rows: [[0], [1]], totalRows: 2 };
          },
        },
        { pageSize: 4 },
      );
      const pending = cache.getPage(1).catch((error) => error);
      await Promise.resolve();
      await expect(cache.getPage(0)).rejects.toMatchObject({ name: 'AbortError' });
      expect(await pending).toMatchObject({ name: 'AbortError' });
      expect(cache.size).toBe(0);
      expect(cache.loading).toBe(0);
      expect(cache.error).toBeUndefined();
      old.resolve({ rows: [[4], [5], [6], [7]], totalRows: 8 });
      cache.dispose();
    },
  );

  it('keeps a replacement request started by an old request abort listener', async () => {
    const old = deferred();
    const replacement = deferred();
    let fresh: Promise<ReportPage> | undefined;
    let cache!: ReportChunkCache;
    let calls = 0;
    cache = new ReportChunkCache(
      {
        columnCount: 1,
        rowCount: 8,
        fetchPage: async (offset, _limit, signal) => {
          if (offset === 4) {
            if (++calls > 1) return replacement.promise;
            signal?.addEventListener(
              'abort',
              () => {
                fresh = cache.getPage(1);
              },
              { once: true },
            );
            return old.promise;
          }
          return { rows: [[0], [1], [2], [3]], totalRows: 10 };
        },
      },
      { pageSize: 4 },
    );
    const pending = cache.getPage(1).catch((error) => error);
    await Promise.resolve();
    await cache.getPage(0);
    expect(await pending).toMatchObject({ name: 'AbortError' });
    expect(cache.loading).toBe(1);
    replacement.resolve({ rows: [[40], [50], [60], [70]], totalRows: 10 });
    await fresh;
    old.resolve({ rows: [[4], [5], [6], [7]], totalRows: 8 });
    await Promise.resolve();
    expect(cache.rowCount).toBe(10);
    expect(cache.read(4, 0)).toBe(40);
    expect(cache.loading).toBe(0);
    cache.dispose();
  });

  it.each(['clear', 'dispose'] as const)(
    'rejects a completed page invalidated by a ready subscriber calling %s',
    async (action) => {
      const source = {
        columnCount: 1,
        rowCount: 1,
        fetchPage: vi.fn(async () => ({ rows: [[42]] })),
      };
      const cache = new ReportChunkCache(source, { pageSize: 1 });
      let invalidated = false;
      cache.subscribe(() => {
        if (!invalidated && cache.size === 1 && cache.loading === 0) {
          invalidated = true;
          cache[action]();
        }
      });
      await expect(cache.getRow(0)).rejects.toMatchObject({ name: 'AbortError' });
      expect(invalidated).toBe(true);
      expect(cache.peekRow(0)).toBeUndefined();
      expect(cache.error).toBeUndefined();
      cache.dispose();
    },
  );

  it('keeps a replacement started by a ready subscriber and rejects the old consumer', async () => {
    let calls = 0;
    const cache = new ReportChunkCache(
      { columnCount: 1, rowCount: 1, fetchPage: async () => ({ rows: [[++calls]] }) },
      { pageSize: 1 },
    );
    let replaced = false;
    let replacement: Promise<ReportPage> | undefined;
    cache.subscribe(() => {
      if (!replaced && cache.size && !cache.loading) {
        replaced = true;
        cache.clear();
        replacement = cache.getPage(0);
      }
    });
    await expect(cache.getPage(0)).rejects.toMatchObject({ name: 'AbortError' });
    expect((await replacement)?.rows).toEqual([[2]]);
    expect(cache.read(0, 0)).toBe(2);
    expect(cache.loading).toBe(0);
    cache.dispose();
  });

  it.each(['clear', 'dispose'] as const)(
    'rejects a failed page as cancelled when its error subscriber calls %s',
    async (action) => {
      const cache = new ReportChunkCache(
        {
          columnCount: 1,
          rowCount: 1,
          fetchPage: async () => {
            throw new Error('old failure');
          },
        },
        { pageSize: 1 },
      );
      let invalidated = false;
      cache.subscribe(() => {
        if (!invalidated && cache.error && !cache.loading) {
          invalidated = true;
          cache[action]();
        }
      });
      await expect(cache.getPage(0)).rejects.toMatchObject({ name: 'AbortError' });
      expect(cache.error).toBeUndefined();
      cache.dispose();
    },
  );

  it('cancels all shared consumers invalidated by the ready notification', async () => {
    const page = deferred();
    const fetchPage = vi.fn(() => page.promise);
    const cache = new ReportChunkCache({ columnCount: 1, rowCount: 1, fetchPage }, { pageSize: 1 });
    cache.subscribe(() => {
      if (cache.size && !cache.loading) cache.clear();
    });
    const first = cache.getPage(0).catch((error) => error);
    const second = cache.getRow(0).catch((error) => error);
    page.resolve({ rows: [[42]] });
    expect(await first).toMatchObject({ name: 'AbortError' });
    expect(await second).toMatchObject({ name: 'AbortError' });
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(cache.loading).toBe(0);
    cache.dispose();
  });

  it('does not commit a payload that clears the cache during validation', async () => {
    let cache!: ReportChunkCache;
    cache = new ReportChunkCache(
      {
        columnCount: 1,
        rowCount: 4,
        fetchPage: async () => ({
          rows: [[1]],
          get totalRows() {
            cache.clear();
            return 1;
          },
        }),
      },
      { pageSize: 4 },
    );
    await expect(cache.getPage(0)).rejects.toMatchObject({ name: 'AbortError' });
    expect(cache.rowCount).toBe(4);
    expect(cache.size).toBe(0);
    expect(cache.error).toBeUndefined();
    cache.dispose();
  });
});

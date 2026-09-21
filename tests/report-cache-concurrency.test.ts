import { describe, expect, it, vi } from 'vitest';
import { ReportChunkCache, type ReportPage } from '../src/lib/report-data';

function setup() {
  const requests = new Map<
    number,
    { resolve: (page: ReportPage) => void; reject: (error: Error) => void }
  >();
  const fetchPage = vi.fn(
    (offset: number) =>
      new Promise<ReportPage>((resolve, reject) => {
        requests.set(offset, { resolve, reject });
      }),
  );
  const cache = new ReportChunkCache(
    { columnCount: 1, rowCount: 20, fetchPage },
    { pageSize: 1, maxPages: 2 },
  );
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { cache, fetchPage, requests, tick };
}

describe('paged cache request backpressure', () => {
  it('queues distinct pages in order and shares queued requests', async () => {
    const { cache, fetchPage, requests, tick } = setup();
    const pages = Array.from({ length: 5 }, (_, index) => cache.getPage(index));
    const shared = cache.getPage(3);
    await tick();
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 1]);
    expect(cache.loading).toBe(5);
    for (let index = 0; index < 5; index++) {
      requests.get(index)!.resolve({ rows: [[index]] });
      expect((await pages[index]).rows).toEqual([[index]]);
      await tick();
      expect(fetchPage.mock.calls.length).toBe(Math.min(5, index + 3));
    }
    expect((await shared).rows).toEqual([[3]]);
    expect(cache.size).toBe(2);
    expect(cache.loading).toBe(0);
    cache.dispose();
  });

  it('removes a cancelled queued page without starting its source request', async () => {
    const { cache, fetchPage, requests, tick } = setup();
    const first = cache.getPage(0),
      second = cache.getPage(1);
    const abort = new AbortController();
    const queued = cache.getPage(2, abort.signal).catch((error) => error);
    const last = cache.getPage(3);
    await tick();
    abort.abort();
    expect(await queued).toMatchObject({ name: 'AbortError' });
    requests.get(0)!.resolve({ rows: [[0]] });
    await first;
    await tick();
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 1, 3]);
    requests.get(1)!.resolve({ rows: [[1]] });
    requests.get(3)!.resolve({ rows: [[3]] });
    await Promise.all([second, last]);
    cache.dispose();
  });

  it.each(['clear', 'dispose'] as const)(
    'cancels active and queued pages on %s even if source ignores abort',
    async (action) => {
      const { cache, fetchPage, requests, tick } = setup();
      const pages = Array.from({ length: 5 }, (_, index) =>
        cache.getPage(index).catch((error) => error),
      );
      await tick();
      cache[action]();
      for (const page of pages) expect(await page).toMatchObject({ name: 'AbortError' });
      expect(fetchPage).toHaveBeenCalledTimes(2);
      for (const request of requests.values()) request.resolve({ rows: [[99]] });
      await tick();
      expect(cache.size).toBe(0);
      expect(cache.loading).toBe(0);
      cache.dispose();
    },
  );

  it('releases cancelled active waits without waiting for an uncooperative source', async () => {
    const { cache, fetchPage, requests, tick } = setup();
    const abort = new AbortController();
    const first = cache.getPage(0, abort.signal).catch((error) => error);
    const second = cache.getPage(1),
      third = cache.getPage(2);
    await tick();
    expect(requests.has(2)).toBe(false);
    abort.abort();
    expect(await first).toMatchObject({ name: 'AbortError' });
    await tick();
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 1, 2]);
    requests.get(0)!.resolve({ rows: [[99]] });
    requests.get(1)!.resolve({ rows: [[1]] });
    requests.get(2)!.resolve({ rows: [[2]] });
    await Promise.all([second, third]);
    expect(cache.peekRow(0)).toBeUndefined();
    cache.dispose();
  });

  it('releases a failed request slot so the next page can load', async () => {
    const { cache, requests, tick } = setup();
    const first = cache.getPage(0).catch((error) => error);
    const second = cache.getPage(1),
      third = cache.getPage(2);
    await tick();
    requests.get(0)!.reject(new Error('offline'));
    expect(await first).toMatchObject({ message: 'offline' });
    await tick();
    expect(requests.has(2)).toBe(true);
    requests.get(1)!.resolve({ rows: [[1]] });
    requests.get(2)!.resolve({ rows: [[2]] });
    await Promise.all([second, third]);
    cache.dispose();
  });
});

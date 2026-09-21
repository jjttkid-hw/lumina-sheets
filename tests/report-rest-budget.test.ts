import { describe, expect, it, vi } from 'vitest';
import { ReportChunkCache, restDataSource } from '../src/lib/report-data';

const encode = (text: string) => new TextEncoder().encode(text);
function streamed(chunks: Uint8Array[], headers?: HeadersInit) {
  const cancel = vi.fn(async () => {});
  let index = 0;
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++]);
    else controller.close();
  });
  const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
    headers,
  });
  return { response, pull, cancel };
}
describe('REST response byte budget', () => {
  it.each<HeadersInit | undefined>([
    undefined,
    { 'Content-Length': '1' },
    { 'Content-Encoding': 'gzip', 'Content-Length': '2' },
  ])(
    'counts delivered bytes regardless of headers %j and stops before later chunks',
    async (headers) => {
      const { response, pull, cancel } = streamed(
        [encode('{"rows":'), encode('[[12345]]}'), encode('unused')],
        headers,
      );
      const source = restDataSource('https://example.test/data', {
        columnCount: 1,
        maxResponseBytes: 12,
        fetcher: vi.fn(async () => response),
      });
      await expect(source.fetchPage(0, 1)).rejects.toThrow('maxResponseBytes');
      expect(pull).toHaveBeenCalledTimes(2);
      expect(cancel).toHaveBeenCalledOnce();
      expect(response.body!.locked).toBe(false);
    },
  );
  it('decodes split UTF-8 and a BOM at the exact byte budget', async () => {
    const bytes = encode('\uFEFF' + JSON.stringify({ rows: [['中文😀']], totalRows: 1 }));
    const fetcher = vi.fn(
      async () => streamed([...bytes].map((byte) => new Uint8Array([byte]))).response,
    );
    const source = restDataSource('https://example.test/data', {
      columnCount: 1,
      maxResponseBytes: bytes.length,
      fetcher,
    });
    expect(await source.fetchPage(0, 1)).toEqual({ rows: [['中文😀']], totalRows: 1 });
    const tooSmall = restDataSource('https://example.test/data', {
      columnCount: 1,
      maxResponseBytes: bytes.length - 1,
      fetcher,
    });
    await expect(tooSmall.fetchPage(0, 1)).rejects.toThrow('maxResponseBytes');
  });
  it('keeps cache retryable and resets the byte budget on every request', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('x'.repeat(41)))
      .mockImplementation(async () => new Response('{"rows":[[1]]}'));
    const cache = new ReportChunkCache(
      restDataSource('https://example.test/data', {
        columnCount: 1,
        maxResponseBytes: 40,
        fetcher,
      }),
      { pageSize: 1 },
    );
    await expect(cache.getPage(0)).rejects.toThrow('maxResponseBytes');
    expect(cache.size).toBe(0);
    expect(await cache.getRow(0)).toEqual([1]);
    expect(await cache.getRow(1)).toEqual([1]);
    expect(cache.error).toBeUndefined();
    cache.dispose();
  });
  it('allows cancellation during continuously available small chunks', async () => {
    const abort = new AbortController();
    const { response, pull, cancel } = streamed(Array.from({ length: 1000 }, () => encode(' ')));
    const source = restDataSource('https://example.test/data', {
      columnCount: 1,
      fetcher: vi.fn(async () => response),
    });
    setTimeout(() => abort.abort(), 0);
    await expect(source.fetchPage(0, 1, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pull.mock.calls.length).toBeLessThan(1000);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body!.locked).toBe(false);
  });
  it.each([0, -1, NaN, Infinity, 1.5, 64 * 1024 * 1024 + 1])(
    'rejects invalid byte budget %s without fetching',
    (maxResponseBytes) => {
      const fetcher = vi.fn();
      expect(() =>
        restDataSource('https://example.test/data', { columnCount: 1, maxResponseBytes, fetcher }),
      ).toThrow('字节上限');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(['', '{broken'])('releases the reader when JSON decoding fails for %j', async (text) => {
    const response = new Response(text);
    const source = restDataSource('https://example.test/data', {
      columnCount: 1,
      fetcher: vi.fn(async () => response),
    });
    await expect(source.fetchPage(0, 1)).rejects.toBeInstanceOf(SyntaxError);
    expect(response.body!.locked).toBe(false);
  });
});

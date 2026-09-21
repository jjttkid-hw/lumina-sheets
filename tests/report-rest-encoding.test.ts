import { describe, expect, it, vi } from 'vitest';
import { ReportChunkCache, restDataSource } from '../src/lib/report-data';

const encode = (value: string) => new TextEncoder().encode(value);
function response(chunks: Uint8Array[]) {
  let index = 0;
  const cancel = vi.fn(async () => {});
  const result = new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (index < chunks.length) controller.enqueue(chunks[index++]);
          else controller.close();
        },
        cancel,
      },
      { highWaterMark: 0 },
    ),
  );
  return { result, cancel };
}

describe('REST UTF-8 integrity', () => {
  it.each([[0xff], [0x80], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]])(
    'rejects invalid string bytes %j without replacing them with text',
    async (...invalid) => {
      const { result, cancel } = response([
        encode('{"rows":[["'),
        new Uint8Array(invalid),
        encode('"]]}'),
      ]);
      const source = restDataSource('https://example.test/data', {
        columnCount: 1,
        fetcher: vi.fn(async () => result),
      });
      const outcome = await source.fetchPage(0, 1).then(
        () => 'unexpected success',
        (error: Error) => error.message,
      );
      expect(outcome).toContain('UTF-8');
      expect(cancel).toHaveBeenCalledOnce();
      expect(result.body!.locked).toBe(false);
    },
  );

  it('rejects an incomplete trailing sequence at end of stream and releases the reader', async () => {
    const { result } = response([encode('{"rows":[["'), new Uint8Array([0xe4, 0xb8])]);
    const source = restDataSource('https://example.test/data', {
      columnCount: 1,
      fetcher: vi.fn(async () => result),
    });
    await expect(source.fetchPage(0, 1)).rejects.toThrow('UTF-8');
    expect(result.body!.locked).toBe(false);
  });

  it('keeps valid replacement characters, BOM and split multibyte text literal', async () => {
    const text = '中文😀�';
    const bytes = encode('\uFEFF' + JSON.stringify({ rows: [[text]] }));
    const { result } = response([...bytes].map((byte) => new Uint8Array([byte])));
    const source = restDataSource('https://example.test/data', {
      columnCount: 1,
      fetcher: vi.fn(async () => result),
    });
    expect(await source.fetchPage(0, 1)).toEqual({ rows: [[text]] });
  });

  it('preserves successful cache pages and retries a damaged response without stale errors', async () => {
    let damaged = true;
    const source = restDataSource('https://example.test/data', {
      columnCount: 1,
      rowCount: 2,
      fetcher: vi.fn(async (url) => {
        const offset = Number(new URL(String(url)).searchParams.get('offset'));
        if (offset === 1 && damaged)
          return response([encode('{"rows":[["'), new Uint8Array([0xff]), encode('"]]}')]).result;
        return new Response(JSON.stringify({ rows: [[offset === 0 ? 'original' : 'restored']] }));
      }),
    });
    const cache = new ReportChunkCache(source, { pageSize: 1 });
    await cache.getPage(0);
    await expect(cache.getPage(1)).rejects.toThrow('UTF-8');
    expect(cache.read(0, 0)).toBe('original');
    expect(cache.size).toBe(1);
    expect(cache.rowCount).toBe(2);
    damaged = false;
    expect(await cache.getRow(1)).toEqual(['restored']);
    expect(cache.error).toBeUndefined();
    cache.dispose();
  });
});

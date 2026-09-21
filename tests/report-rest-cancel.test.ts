import { describe, expect, it, vi } from 'vitest';
import { restDataSource } from '../src/lib/report-data';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('REST response cancellation ownership', () => {
  it('discards a late response without parsing when fetch ignores cancellation', async () => {
    const pending = deferred<Response>();
    const abort = new AbortController();
    const source = restDataSource('https://example.test/data', {
      columnCount: 1,
      fetcher: vi.fn(() => pending.promise),
    });
    const result = source.fetchPage(0, 1, abort.signal).catch((error) => error);
    abort.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    const cancel = vi.fn(async () => {});
    const response = new Response(new ReadableStream({ cancel }));
    const json = vi.spyOn(response, 'json');
    pending.resolve(response);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(json).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels an in-progress body read without waiting for an uncooperative producer', async () => {
    const abort = new AbortController();
    const started = deferred<void>();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull() {
            started.resolve();
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
    );
    const source = restDataSource('https://example.test/data', {
      columnCount: 1,
      fetcher: vi.fn(async () => response),
    });
    const result = source.fetchPage(0, 1, abort.signal).catch((error) => error);
    await started.promise;
    abort.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body!.locked).toBe(false);
  });

  it.each(['resolve', 'reject', 'pending'])(
    'releases an HTTP error body without waiting for %s cancellation',
    async (mode) => {
      const cancel = vi.fn(() =>
        mode === 'pending'
          ? new Promise<void>(() => {})
          : mode === 'reject'
            ? Promise.reject(new Error('cleanup failed'))
            : Promise.resolve(),
      );
      const response = new Response(new ReadableStream({ cancel }), { status: 503 });
      const source = restDataSource('https://example.test/data', {
        columnCount: 1,
        fetcher: vi.fn(async () => response),
      });
      await expect(source.fetchPage(0, 1)).rejects.toThrow('HTTP 503');
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
});

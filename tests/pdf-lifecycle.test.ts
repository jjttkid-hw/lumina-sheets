import { afterEach, describe, expect, it, vi } from 'vitest';
import { workbookToPdf } from '../src/lib/report-pdf';
import { createBlankWorkbook } from '../src/lib/seed';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(fonts: Promise<unknown> = Promise.resolve()) {
  const book = createBlankWorkbook();
  book.sheets[0].cells = { A1: { value: 'report' } };
  const context = {
    scale: vi.fn(),
    measureText: vi.fn(() => ({ width: 12 })),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' })),
    ),
  };
  const create = vi.fn(() => canvas);
  vi.stubGlobal('document', { fonts: { ready: fonts }, createElement: create });
  return { book, context, canvas, create };
}
async function settledSoon(promise: Promise<unknown>) {
  return Promise.race([
    promise.then(
      () => 'resolved',
      (error) => error,
    ),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 40)),
  ]);
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PDF asynchronous resource lifecycle', () => {
  it('rejects invalid resolution before waiting for fonts or allocating resources', async () => {
    const { book, create } = fixture(new Promise(() => {}));
    const result = await settledSoon(workbookToPdf(book, { pixelRatio: 0 }));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('pixelRatio');
    expect(create).not.toHaveBeenCalled();
  });

  it('removes cancellation listeners after successful export', async () => {
    const { book, canvas } = fixture();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const output = await workbookToPdf(book, { signal: controller.signal });
    expect(new TextDecoder().decode(output.slice(0, 8))).toBe('%PDF-1.4');
    const listeners = add.mock.calls.filter(([type]) => type === 'abort').map((call) => call[1]);
    expect(listeners).toHaveLength(3);
    for (const listener of listeners)
      expect(
        remove.mock.calls.some(([type, callback]) => type === 'abort' && callback === listener),
      ).toBe(true);
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
  });

  it.each(['throw', 'null', 'wrong-type'] as const)(
    'cleans up an encoding failure (%s)',
    async (kind) => {
      const { book, canvas } = fixture();
      canvas.toBlob.mockImplementation((done) => {
        if (kind === 'throw') throw Error('encoder failure');
        done(kind === 'null' ? null : new Blob([], { type: 'image/png' }));
      });
      const progress = vi.fn();
      await expect(workbookToPdf(book, { onProgress: progress })).rejects.toThrow();
      expect(progress).not.toHaveBeenCalled();
      expect([canvas.width, canvas.height]).toEqual([1, 1]);
    },
  );

  it('honors final progress cancellation and releases the canvas', async () => {
    const { book, canvas } = fixture();
    const controller = new AbortController();
    await expect(
      workbookToPdf(book, {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
  });
  it('cancels while fonts are pending without allocating a canvas, even after late failure', async () => {
    const fonts = deferred<void>();
    const { book, create } = fixture(fonts.promise);
    const controller = new AbortController();
    const result = workbookToPdf(book, { signal: controller.signal });
    const observed = settledSoon(result);
    controller.abort();
    expect(await observed).toMatchObject({ name: 'AbortError' });
    fonts.reject(new Error('late font failure'));
    await Promise.resolve();
    expect(create).not.toHaveBeenCalled();
  });

  it('cancels a pending JPEG callback and ignores its late result', async () => {
    const { book, canvas } = fixture();
    const started = deferred<void>();
    let callback!: BlobCallback;
    canvas.toBlob.mockImplementation((done) => {
      callback = done;
      started.resolve();
    });
    const controller = new AbortController(),
      progress = vi.fn();
    const result = workbookToPdf(book, { signal: controller.signal, onProgress: progress });
    await started.promise;
    const observed = settledSoon(result);
    controller.abort();
    expect(await observed).toMatchObject({ name: 'AbortError' });
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
    callback(null);
    await Promise.resolve();
    expect(progress).not.toHaveBeenCalled();
  });

  it('cancels pending encoded byte reads without reporting a completed page', async () => {
    const { book, canvas } = fixture();
    const bytes = deferred<ArrayBuffer>(),
      started = deferred<void>();
    canvas.toBlob.mockImplementation((done) =>
      done({
        type: 'image/jpeg',
        arrayBuffer: () => {
          started.resolve();
          return bytes.promise;
        },
      } as Blob),
    );
    const controller = new AbortController(),
      progress = vi.fn();
    const result = workbookToPdf(book, { signal: controller.signal, onProgress: progress });
    await started.promise;
    const observed = settledSoon(result);
    controller.abort();
    expect(await observed).toMatchObject({ name: 'AbortError' });
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
    bytes.reject(new Error('late byte failure'));
    await Promise.resolve();
    expect(progress).not.toHaveBeenCalled();
  });

  it('releases the canvas if text measurement fails before page encoding', async () => {
    const { book, canvas, context } = fixture();
    context.measureText.mockImplementation(() => {
      throw Error('measurement failed');
    });
    await expect(workbookToPdf(book)).rejects.toThrow('measurement failed');
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
    expect(canvas.toBlob).not.toHaveBeenCalled();
  });

  it('releases the canvas when the drawing context is unavailable', async () => {
    const { book, canvas } = fixture();
    canvas.getContext.mockReturnValue(null as never);
    await expect(workbookToPdf(book)).rejects.toThrow('Canvas');
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
  });
});

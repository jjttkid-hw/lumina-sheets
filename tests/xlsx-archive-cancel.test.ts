import JSZip from 'jszip';
import Excel from 'exceljs';
import { afterEach, expect, it, vi } from 'vitest';
import { readXlsxArchive } from '../src/lib/xlsx-archive';

afterEach(() => vi.restoreAllMocks());
it('does not open an already cancelled ZIP', async () => {
  const controller = new AbortController();
  controller.abort();
  const load = vi.spyOn(JSZip, 'loadAsync');
  await expect(readXlsxArchive(new ArrayBuffer(0), controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(load).not.toHaveBeenCalled();
});
it('pauses active entry output, removes cancellation listeners and never starts the next entry', async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const callbacks: Record<string, (...args: any[]) => void> = {};
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stream = {
    on: (event: string, callback: (...args: any[]) => void) => {
      callbacks[event] = callback;
    },
    pause: vi.fn(),
    resume: () => {
      callbacks.data(new Uint8Array([1, 2]));
      started();
    },
  };
  const next = vi.fn();
  const file = (name: string, internalStream: unknown) => ({
    name,
    dir: false,
    _data: { uncompressedSize: 2 },
    internalStream,
  });
  vi.spyOn(JSZip, 'loadAsync').mockResolvedValue({
    files: {
      first: file('first.bin', () => stream),
      next: file('next.bin', next),
    },
  } as unknown as JSZip);
  const pending = readXlsxArchive(new ArrayBuffer(0), controller.signal).catch((error) => error);
  await ready;
  controller.abort();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const outcome = await Promise.race([pending, Promise.resolve('still waiting')]);
  callbacks.error(Error('late stream failure'));
  callbacks.data(new Uint8Array([3]));
  callbacks.end();
  await pending;
  expect(outcome).toMatchObject({ name: 'AbortError' });
  expect(stream.pause).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(next).not.toHaveBeenCalled();
});
it('consumes late ZIP directory rejection after cancellation', async () => {
  let reject!: (error: Error) => void;
  vi.spyOn(JSZip, 'loadAsync').mockReturnValue(
    new Promise<JSZip>((_, fail) => {
      reject = fail;
    }),
  );
  const controller = new AbortController();
  const pending = readXlsxArchive(new ArrayBuffer(0), controller.signal).catch((error) => error);
  controller.abort();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const outcome = await Promise.race([pending, Promise.resolve('still waiting')]);
  reject(Error('late ZIP error'));
  await pending;
  expect(outcome).toMatchObject({ name: 'AbortError' });
});
it('reads an actual XLSX with a live signal and leaves no abort listeners behind', async () => {
  const book = new Excel.Workbook();
  book.addWorksheet('Data').getCell('A1').value = '完整';
  const bytes = (await book.xlsx.writeBuffer()) as ArrayBuffer;
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, 'addEventListener');
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const archive = await readXlsxArchive(bytes, controller.signal);
  expect(archive.sheets[0].name).toBe('Data');
  expect(add).toHaveBeenCalled();
  expect(remove.mock.calls.length).toBe(add.mock.calls.length);
  controller.abort();
  expect(archive.sheets).toHaveLength(1);
});

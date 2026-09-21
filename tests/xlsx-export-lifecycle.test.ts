import Excel from 'exceljs';
import { afterEach, expect, it, vi } from 'vitest';
import { exportWorkbook } from '../src/lib/io';
import { createBlankWorkbook } from '../src/lib/seed';
import { LuminaSpreadsheet } from '../src/sdk';

vi.mock('react-dom/client', () => ({ createRoot: () => ({ render() {}, unmount() {} }) }));
class Host {
  className = '';
  classList = { add() {} };
}
let instance: LuminaSpreadsheet | undefined;
afterEach(() => {
  instance?.destroy();
  instance = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function encodingGate() {
  let resolve!: (value: ArrayBuffer) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ArrayBuffer>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  let started!: () => void;
  const ready = new Promise<void>((yes) => {
    started = yes;
  });
  vi.spyOn(Object.getPrototypeOf(new Excel.Workbook().xlsx), 'writeBuffer').mockImplementation(
    () => {
      started();
      return promise;
    },
  );
  const createElement = vi.fn();
  vi.stubGlobal('document', { createElement });
  return { ready, resolve, reject, createElement };
}
async function observedSoon(promise: Promise<unknown>) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve('still waiting for encoder'), 50)),
  ]);
}

it.each(['success', 'failure'] as const)(
  'cancels XLSX encoding wait and ignores late %s',
  async (late) => {
    const gate = encodingGate();
    const controller = new AbortController();
    const progress = vi.fn();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = exportWorkbook(createBlankWorkbook(), 'xlsx', {
      signal: controller.signal,
      onProgress: progress,
    }).catch((error) => error);
    await gate.ready;
    controller.abort();
    const result = await observedSoon(pending);
    if (late === 'success') gate.resolve(new ArrayBuffer(0));
    else gate.reject(Error('late encoder failure'));
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result).toMatchObject({ name: 'AbortError' });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(progress).not.toHaveBeenCalled();
    expect(gate.createElement).not.toHaveBeenCalled();
  },
);

it.each(['destroy', 'load', 'signal'] as const)('ends SDK XLSX wait on %s', async (action) => {
  const gate = encodingGate();
  vi.stubGlobal('HTMLElement', Host);
  instance = new LuminaSpreadsheet(new Host() as unknown as HTMLElement);
  const controller = new AbortController();
  const progress = vi.fn();
  const pending = instance
    .export('xlsx', { signal: controller.signal, onProgress: progress })
    .catch((error) => error);
  await gate.ready;
  if (action === 'destroy') instance.destroy();
  else if (action === 'load') instance.load(createBlankWorkbook('replacement'));
  else controller.abort();
  const result = await observedSoon(pending);
  gate.resolve(new ArrayBuffer(0));
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(result).toMatchObject({ code: 'EXPORT_CANCELLED' });
  expect(progress).not.toHaveBeenCalled();
  expect(gate.createElement).not.toHaveBeenCalled();
  if (action === 'load') expect(instance.toJSON().name).toBe('replacement');
});

it('preserves encoder failures before cancellation and removes wait listeners', async () => {
  const gate = encodingGate();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const error = Error('encoding failed');
  const pending = exportWorkbook(createBlankWorkbook(), 'xlsx', {
    signal: controller.signal,
  }).catch((error) => error);
  await gate.ready;
  gate.reject(error);
  expect(await pending).toBe(error);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(gate.createElement).not.toHaveBeenCalled();
});

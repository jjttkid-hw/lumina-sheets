import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { CalculationTransferSender } from '../src/lib/calculation-transfer';
import type { CalculationTransfer } from '../src/lib/calculation-transfer';
import { calculateSync, createCalculationRuntime } from '../src/lib/calculation';
import type { CalculationRequest, CalculationMessage } from '../src/lib/calculation';
import { createBlankWorkbook } from '../src/lib/seed';

let folder: string;
const workers: Worker[] = [];
const runtimes: ReturnType<typeof createCalculationRuntime>[] = [];
afterEach(() => {
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.unstubAllGlobals();
});
beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'lumina-real-worker-'));
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir: folder,
      emptyOutDir: false,
      minify: true,
      lib: {
        entry: path.resolve('src/lib/calculation.worker.ts'),
        formats: ['es'],
        fileName: () => 'calculation.mjs',
      },
    },
  });
  // Only the Web Worker transport is adapted; the actual production handler,
  // protocol receiver and evaluator execute in a separate Node isolate.
  await writeFile(
    path.join(folder, 'bridge.mjs'),
    `
    import { parentPort } from 'node:worker_threads';
    globalThis.self = { postMessage: message => parentPort.postMessage(message) };
    await import('./calculation.mjs');
    parentPort.on('message', data => self.onmessage({ data }));
  `,
  );
}, 30000);
afterAll(async () => {
  await Promise.all(workers.map((worker) => worker.terminate()));
  if (folder) await rm(folder, { recursive: true, force: true });
});
function start() {
  const worker = new Worker(path.join(folder, 'bridge.mjs'));
  workers.push(worker);
  const waiting = new Map<
    number,
    {
      resolve: (message: CalculationMessage) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  worker.on('message', (message: CalculationMessage & { id: number }) => {
    const item = waiting.get(message.id);
    if (!item) return;
    waiting.delete(message.id);
    clearTimeout(item.timer);
    item.resolve(message);
  });
  const fail = (error: Error) => {
    for (const item of waiting.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    waiting.clear();
  };
  worker.on('error', fail);
  worker.on('exit', (code) => fail(new Error(`Worker exited ${code}`)));
  function send(message: CalculationTransfer | (CalculationRequest & { id: number })) {
    return new Promise<CalculationMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(message.id);
        reject(new Error('Worker test timeout'));
      }, 5000);
      waiting.set(message.id, { resolve, reject, timer });
      try {
        worker.postMessage(message);
      } catch (error) {
        clearTimeout(timer);
        waiting.delete(message.id);
        reject(error);
      }
    });
  }
  return { worker, send };
}
function fixture() {
  const book = createBlankWorkbook();
  const input = book.sheets[0];
  input.name = 'Input';
  input.cells = { A1: { value: 3 }, A2: { value: 4 } };
  book.sheets.push({
    ...input,
    id: 'result',
    name: 'Result',
    cells: {
      B1: { value: '=SUM(Input!A1:A2)' },
      B2: { value: '=B1*2' },
      B3: { value: '=NPV(0.1,Input!A1:A2)' },
    },
  });
  const request: CalculationRequest = {
    type: 'calculate',
    revision: 1,
    workbook: book,
    targets: ['B1', 'B2', 'B3'].map((key) => ({ sheetId: 'result', key })),
  };
  return request;
}
function check(result: CalculationMessage, request: CalculationRequest) {
  expect(result.type).toBe('calculated');
  expect(result.revision).toBe(request.revision);
  if (result.type === 'calculated') expect(result.values).toEqual(calculateSync(request).values);
}
describe('real isolated calculation thread', () => {
  it('keeps non-finite literals as catchable errors in a real calculation thread', async () => {
    const { send } = start();
    const sender = new CalculationTransferSender();
    const workbook = createBlankWorkbook();
    const sheet = workbook.sheets[0];
    sheet.cells = {
      A1: { value: '=1e999' },
      B1: { value: '=IFERROR(A1,42)' },
      C1: { value: '=IF(FALSE,1e999,7)' },
    };
    const request: CalculationRequest = {
      type: 'calculate',
      revision: 1,
      workbook,
      targets: ['A1', 'B1', 'C1'].map((key) => ({ sheetId: sheet.id, key })),
    };
    const result = await send(sender.prepare(request, 1));
    expect(result.type).toBe('calculated');
    if (result.type === 'calculated')
      expect(result.values).toEqual({
        [`${sheet.id}:A1`]: '#NUM!',
        [`${sheet.id}:B1`]: 42,
        [`${sheet.id}:C1`]: 7,
      });
  });
  it('matches synchronous paged errors across static, paged and restored source transitions', async () => {
    const { send } = start();
    const sender = new CalculationTransferSender();
    const first = fixture();
    check(await send(sender.prepare(first, 1)), first);
    sender.commit(first, 1);
    const [input, output] = first.workbook.sheets;
    const paged: CalculationRequest = {
      ...first,
      revision: 2,
      workbook: {
        ...first.workbook,
        sheets: [{ ...input, dataSource: { kind: 'paged', totalRows: 1000 } }, output],
      },
    };
    const message = sender.prepare(paged, 2);
    expect(message.sheets).toHaveLength(1);
    const result = await send(message);
    check(result, paged);
    if (result.type === 'calculated')
      expect(Object.values(result.values)).toEqual(['#N/A', '#N/A', '#N/A']);
    sender.commit(paged, 2);
    const restored = { ...first, revision: 3 };
    check(await send(sender.prepare(restored, 3)), restored);
    sender.commit(restored, 3);
    // Exercise a first full sync too, with paging already present.
    sender.reset();
    check(await send(sender.prepare({ ...paged, revision: 4 }, 4)), { ...paged, revision: 4 });
  });
  it('runs the production latest queue through real threads, cancellation and disposal', async () => {
    const posted: CalculationTransfer[] = [];
    class ThreadTransport {
      onmessage: ((event: { data: CalculationMessage }) => void) | null = null;
      onerror: ((event: { message: string }) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      thread = new Worker(path.join(folder, 'bridge.mjs'));
      constructor() {
        workers.push(this.thread);
        this.thread.on('message', (data) => this.onmessage?.({ data }));
        this.thread.on('error', (error) => this.onerror?.({ message: error.message }));
        this.thread.on('messageerror', () => this.onmessageerror?.());
      }
      postMessage(message: CalculationTransfer) {
        posted.push(structuredClone(message));
        this.thread.postMessage(message);
      }
      terminate() {
        void this.thread.terminate();
      }
    }
    // Adapt only the host transport. Both runtime scheduling and the compiled
    // production calculation handler run unchanged; this is not browser QA.
    vi.stubGlobal('window', {});
    vi.stubGlobal('Worker', ThreadTransport);
    const runtime = createCalculationRuntime({ queueMode: 'latest', reuseSheets: true });
    runtimes.push(runtime);
    const request = fixture();
    const abort = new AbortController();
    const cancelled = runtime
      .calculate(request.workbook, request.targets, 1, abort.signal)
      .catch((error: Error) => error);
    abort.abort();
    const superseded: Promise<unknown>[] = [];
    for (let revision = 2; revision < 100; revision++) {
      superseded.push(
        runtime
          .calculate(request.workbook, request.targets, revision)
          .catch((error: Error) => error),
      );
    }
    const latest = structuredClone(request);
    latest.revision = 100;
    latest.workbook.sheets[0].cells.A1.value = 500;
    const result = runtime.calculate(latest.workbook, latest.targets, latest.revision);
    // No worker response can dispatch between these synchronous submissions.
    expect(posted.map((message) => message.revision)).toEqual([1]);
    expect(await cancelled).toMatchObject({ name: 'AbortError' });
    for (const error of await Promise.all(superseded))
      expect(error).toMatchObject({ name: 'AbortError' });
    check(await result, latest);
    expect(posted.map((message) => message.revision)).toEqual([1, 100]);
    expect(posted[1].baseId).toBe(posted[0].id);
    expect(posted[1].sheetPatches?.[0].cells).toHaveLength(1);
    const pending = runtime
      .calculate(latest.workbook, latest.targets, 101)
      .catch((error: Error) => error);
    runtime.dispose();
    expect(await pending).toMatchObject({ message: 'CalculationRuntime is disposed' });
    await expect(runtime.calculate(latest.workbook, latest.targets, 102)).rejects.toThrow(
      'CalculationRuntime is disposed',
    );
  });

  it('preserves postMessage snapshots and applies queued patches in FIFO order', async () => {
    const { send } = start();
    const sender = new CalculationTransferSender();
    const first = fixture();
    const wire = sender.prepare(first, 1);
    const pending = send(wire);
    sender.commit(first, 1);
    wire.sheets[0].cells.A1.value = 99999;
    check(await pending, first);
    const responses: Promise<void>[] = [];
    for (let id = 2; id <= 31; id++) {
      const request = fixture();
      request.workbook.id = first.workbook.id;
      request.workbook.sheets[0].id = first.workbook.sheets[0].id;
      request.revision = id;
      request.workbook.sheets[0].cells.A1.value = id;
      const message = sender.prepare(request, id);
      expect(message.sheetPatches?.[0].cells).toHaveLength(1);
      responses.push(send(message).then((result) => check(result, request)));
      sender.commit(request, id);
    }
    await Promise.all(responses);
  });
  it('rejects a wrong base without contaminating the next valid patch', async () => {
    const { send } = start();
    const sender = new CalculationTransferSender();
    const request = fixture();
    check(await send(sender.prepare(request, 1)), request);
    sender.commit(request, 1);
    const next = structuredClone(request);
    next.revision = 3;
    next.workbook.sheets[0].cells.A2.value = 15;
    const message = sender.prepare(next, 3);
    expect(await send({ ...message, id: 2, baseId: 900 })).toMatchObject({
      type: 'error',
      id: 2,
      message: 'Calculation snapshot base mismatch',
    });
    check(await send(message), next);
  });
  it('requires full synchronization in a new thread and accepts legacy full requests', async () => {
    const original = start();
    const sender = new CalculationTransferSender();
    const request = fixture();
    check(await original.send(sender.prepare(request, 1)), request);
    sender.commit(request, 1);
    await original.worker.terminate();
    const replacement = start();
    expect(await replacement.send(sender.prepare(request, 2))).toMatchObject({ type: 'error' });
    sender.reset();
    check(await replacement.send(sender.prepare(request, 3)), request);
    check(await replacement.send({ ...request, id: 4 }), request);
  });
});

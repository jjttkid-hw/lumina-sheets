import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateSync,
  createCalculationRuntime,
  type CalculationRequest,
  type CalculationResponse,
  type CalculationMessage,
  type CalculationRuntimeOptions,
} from '../src/lib/calculation';
import { CalculationTransferReceiver } from '../src/lib/calculation-transfer';
import { createBlankWorkbook } from '../src/lib/seed';

type Request = CalculationRequest & { id: number };
class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: { data: CalculationMessage & { id: number } }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: Request[] = [];
  receiver = new CalculationTransferReceiver();
  postMessage = vi.fn((request: Request) => this.messages.push(structuredClone(request)));
  terminate = vi.fn();
  constructor() {
    ControlledWorker.instances.push(this);
  }
  reply(index = 0) {
    const request = this.messages[index];
    const decoded =
      (request as unknown as { type?: string }).type === 'calculate-sheets'
        ? this.receiver.receive(
            request as unknown as Parameters<CalculationTransferReceiver['receive']>[0],
          )
        : request;
    this.onmessage?.({ data: { ...calculateSync(decoded), id: request.id } });
  }
}

const runtimes: ReturnType<typeof createCalculationRuntime>[] = [];
beforeEach(() => {
  ControlledWorker.instances = [];
  vi.stubGlobal('window', {});
  vi.stubGlobal('Worker', ControlledWorker);
});
afterEach(() => {
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(latest = true, options: CalculationRuntimeOptions = {}) {
  const runtime = createCalculationRuntime({ queueMode: latest ? 'latest' : 'all', ...options });
  runtimes.push(runtime);
  const worker = ControlledWorker.instances.at(-1)!;
  const book = createBlankWorkbook();
  book.sheets[0].cells = { A1: { value: 2 }, B1: { value: '=A1*2' } };
  const targets = [{ sheetId: book.sheets[0].id, key: 'B1' }];
  const value = (result: CalculationResponse) => result.values[`${book.sheets[0].id}:B1`];
  return { runtime, worker, book, targets, value };
}
const outcome = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value, error: undefined }),
    (error: Error) => ({ value: undefined, error }),
  );

describe('bounded workspace calculation queue', () => {
  it('posts only the first and latest of 100 edits, without reading discarded workbooks', async () => {
    const { runtime, worker, book, targets, value } = setup();
    const first = runtime.calculate(book, targets, 1);
    const discarded = [];
    for (let revision = 2; revision < 100; revision++) {
      const obsolete = new Proxy(book, {
        ownKeys() {
          throw new Error('obsolete workbook cloned');
        },
      });
      discarded.push(outcome(runtime.calculate(obsolete, targets, revision)));
    }
    const lastBook = structuredClone(book);
    lastBook.sheets[0].cells.A1.value = 50;
    const last = runtime.calculate(lastBook, targets, 100);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    for (const result of await Promise.all(discarded))
      expect(result.error?.name).toBe('AbortError');
    worker.reply(0);
    expect(value(await first)).toBe(4);
    expect(worker.messages.map((item) => item.revision)).toEqual([1, 100]);
    worker.reply(1);
    expect(value(await last)).toBe(100);
  });

  it('keeps the running slot occupied after abort and skips cancelled queued work', async () => {
    const { runtime, worker, book, targets } = setup();
    const running = new AbortController(),
      queued = new AbortController();
    const first = outcome(runtime.calculate(book, targets, 1, running.signal));
    const second = outcome(runtime.calculate(book, targets, 2, queued.signal));
    running.abort();
    queued.abort();
    expect((await first).error?.name).toBe('AbortError');
    expect((await second).error?.name).toBe('AbortError');
    const last = runtime.calculate(book, targets, 3);
    expect(worker.messages).toHaveLength(1);
    worker.reply(0);
    expect(worker.messages.map((item) => item.revision)).toEqual([1, 3]);
    worker.reply(1);
    expect((await last).revision).toBe(3);
  });

  it('does not dispatch an already cancelled request and removes listeners on completion', async () => {
    const { runtime, worker, book, targets } = setup();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(runtime.calculate(book, targets, 1, cancelled.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(worker.messages).toHaveLength(0);
    const active = new AbortController();
    const remove = vi.spyOn(active.signal, 'removeEventListener');
    const request = runtime.calculate(book, targets, 2, active.signal);
    worker.reply();
    await request;
    expect(remove).toHaveBeenCalledOnce();
    active.abort();
    expect(worker.messages).toHaveLength(1);
  });

  it('cleans listeners for superseded and aborted requests', async () => {
    const { runtime, worker, book, targets } = setup();
    const first = runtime.calculate(book, targets, 1);
    const secondController = new AbortController(),
      thirdController = new AbortController();
    const removeSecond = vi.spyOn(secondController.signal, 'removeEventListener');
    const removeThird = vi.spyOn(thirdController.signal, 'removeEventListener');
    const second = outcome(runtime.calculate(book, targets, 2, secondController.signal));
    const third = outcome(runtime.calculate(book, targets, 3, thirdController.signal));
    thirdController.abort();
    expect((await second).error?.name).toBe('AbortError');
    expect((await third).error?.name).toBe('AbortError');
    expect(removeSecond).toHaveBeenCalledOnce();
    expect(removeThird).toHaveBeenCalledOnce();
    worker.reply();
    await first;
    expect(worker.messages).toHaveLength(1);
  });

  it('ignores unknown, premature queued, and duplicate responses', async () => {
    const { runtime, worker, book, targets } = setup();
    const first = runtime.calculate(book, targets, 1);
    const second = runtime.calculate(book, targets, 2);
    const completed = vi.fn();
    void second.then(completed);
    const result = calculateSync(worker.messages[0]);
    worker.onmessage?.({ data: { ...result, id: 999 } });
    worker.onmessage?.({ data: { ...result, id: 2, revision: 2 } });
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    expect(worker.messages).toHaveLength(1);
    worker.reply(0);
    await first;
    worker.reply(0);
    expect(worker.messages).toHaveLength(2);
    worker.reply(1);
    await second;
    expect(completed).toHaveBeenCalledOnce();
  });

  it.each(['revision', 'error'] as const)(
    'rejects a %s failure and continues with the newest request',
    async (failure) => {
      const { runtime, worker, book, targets } = setup();
      const first = outcome(runtime.calculate(book, targets, 1));
      const second = runtime.calculate(book, targets, 2);
      worker.onmessage?.({
        data:
          failure === 'error'
            ? { type: 'error', revision: 1, message: 'evaluation failed', id: 1 }
            : { ...calculateSync(worker.messages[0]), revision: 99, id: 1 },
      });
      expect((await first).error?.message).toContain(
        failure === 'error' ? 'evaluation failed' : 'revision mismatch',
      );
      expect(worker.messages).toHaveLength(2);
      worker.reply(1);
      expect((await second).revision).toBe(2);
    },
  );

  it.each(['error', 'messageerror'] as const)(
    'rejects all pending work on Worker %s, then restarts on the next request',
    async (kind) => {
      const { runtime, worker, book, targets, value } = setup();
      const first = outcome(runtime.calculate(book, targets, 1));
      const second = outcome(runtime.calculate(book, targets, 2));
      if (kind === 'error') worker.onerror?.({ message: 'worker crashed' });
      else worker.onmessageerror?.();
      expect((await first).error).toBeInstanceOf(Error);
      expect((await second).error).toBeInstanceOf(Error);
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(worker.onmessage).toBeNull();
      expect(ControlledWorker.instances).toHaveLength(1);
      const next = runtime.calculate(book, targets, 3);
      const replacement = ControlledWorker.instances[1];
      expect(replacement.messages.map((message) => message.revision)).toEqual([3]);
      replacement.reply();
      expect(value(await next)).toBe(4);
      expect(worker.messages).toHaveLength(1);
    },
  );

  it('keeps failed restarts off the main thread and retries only for a new caller', async () => {
    const { runtime, worker, book, targets } = setup(true, { reuseSheets: true });
    const first = outcome(runtime.calculate(book, targets, 1));
    const lateError = worker.onerror!;
    worker.onerror?.({ message: 'crash' });
    expect((await first).error?.message).toBe('crash');
    const unread = new Proxy(book, {
      get() {
        throw new Error('must not synchronously evaluate');
      },
    });
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('worker resource unavailable');
        }
      },
    );
    await expect(runtime.calculate(unread, targets, 2)).rejects.toThrow('could not restart');
    await expect(runtime.calculate(unread, targets, 3)).rejects.toThrow('could not restart');
    vi.stubGlobal('Worker', ControlledWorker);
    const next = runtime.calculate(book, targets, 4);
    const replacement = ControlledWorker.instances[1];
    expect(replacement.messages[0]).toMatchObject({ baseId: null, revision: 4 });
    lateError({ message: 'stale crash' });
    expect(replacement.terminate).not.toHaveBeenCalled();
    replacement.reply();
    expect((await next).revision).toBe(4);
  });

  it('cleans up postMessage failures and permits subsequent requests', async () => {
    const { runtime, worker, book, targets } = setup();
    worker.postMessage.mockImplementationOnce(() => {
      throw new DOMException('Cannot clone', 'DataCloneError');
    });
    await expect(runtime.calculate(book, targets, 1)).rejects.toMatchObject({
      name: 'DataCloneError',
    });
    const next = runtime.calculate(book, targets, 2);
    worker.reply();
    expect((await next).revision).toBe(2);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
  });

  it('cleans a queued post failure after the running request finishes', async () => {
    const { runtime, worker, book, targets } = setup();
    const first = runtime.calculate(book, targets, 1);
    const queued = outcome(runtime.calculate(book, targets, 2));
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error('clone failed');
    });
    worker.reply();
    await first;
    expect((await queued).error?.message).toBe('clone failed');
    const next = runtime.calculate(book, targets, 3);
    worker.reply(1);
    expect((await next).revision).toBe(3);
  });

  it('dispose settles running and queued promises, detaches handlers and rejects later use', async () => {
    const { runtime, worker, book, targets } = setup();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const first = outcome(runtime.calculate(book, targets, 1, controller.signal));
    const second = outcome(runtime.calculate(book, targets, 2));
    const late = worker.onmessage!;
    runtime.dispose();
    runtime.dispose();
    expect((await first).error?.message).toContain('disposed');
    expect((await second).error?.message).toContain('disposed');
    expect(remove).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    late({ data: { ...calculateSync(worker.messages[0]), id: 1 } });
    expect(worker.messages).toHaveLength(1);
    await expect(runtime.calculate(book, targets, 3)).rejects.toThrow('disposed');
    expect(() => runtime.calculateSync(book, targets, 3)).toThrow('disposed');
  });

  it('preserves all-request mode with out-of-order responses and repeated revision numbers', async () => {
    const { runtime, worker, book, targets } = setup(false);
    const first = runtime.calculate(book, targets, 1);
    const second = runtime.calculate(book, targets, 1);
    expect(worker.messages).toHaveLength(2);
    worker.reply(1);
    expect((await second).revision).toBe(1);
    worker.reply(0);
    expect((await first).revision).toBe(1);
  });

  it('returns a rejected promise for synchronous request failures', async () => {
    const runtime = createCalculationRuntime({ useWorker: false });
    runtimes.push(runtime);
    const book = createBlankWorkbook();
    const sheetId = book.sheets[0].id;
    Object.defineProperty(book, 'sheets', {
      get() {
        throw new Error('source failed');
      },
    });
    let result!: Promise<CalculationResponse>;
    expect(() => {
      result = runtime.calculate(book, [{ sheetId, key: 'A1' }], 1);
    }).not.toThrow();
    await expect(result).rejects.toThrow('source failed');
  });

  it('runs the real worker handler with cloned messages through a cancelled-running/latest-queued transition', async () => {
    const { runtime, worker, book, targets, value } = setup(true, { reuseSheets: true });
    const scope = {
      onmessage: (_event: MessageEvent<Request>) => {},
      postMessage: (data: CalculationMessage & { id: number }) =>
        worker.onmessage?.({ data: structuredClone(data) }),
    };
    vi.stubGlobal('self', scope);
    await import('../src/lib/calculation.worker');
    const controller = new AbortController();
    const first = outcome(runtime.calculate(book, targets, 1, controller.signal));
    controller.abort();
    const next = structuredClone(book);
    next.sheets[0].cells.A1.value = 8;
    const latest = runtime.calculate(next, targets, 2);
    scope.onmessage({ data: worker.messages[0] } as MessageEvent<Request>);
    expect((await first).error?.name).toBe('AbortError');
    expect(worker.messages).toHaveLength(2);
    scope.onmessage({ data: worker.messages[1] } as MessageEvent<Request>);
    expect(value(await latest)).toBe(16);
  });
});

describe('calculation watchdog recovery', () => {
  beforeEach(() => vi.useFakeTimers());

  it('terminates at the default deadline and restarts lazily without replaying the timed-out request', async () => {
    const { runtime, worker, book, targets, value } = setup();
    const pending = outcome(runtime.calculate(book, targets, 1));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).error?.name).toBe('TimeoutError');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(ControlledWorker.instances).toHaveLength(1);
    const next = runtime.calculate(book, targets, 2);
    const replacement = ControlledWorker.instances[1];
    expect(replacement.messages.map((request) => request.revision)).toEqual([2]);
    replacement.reply();
    expect(value(await next)).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends only the newest unposted candidate to a fresh Worker with a fresh deadline', async () => {
    const { runtime, worker, book, targets } = setup(true, { timeoutMs: 100 });
    const first = outcome(runtime.calculate(book, targets, 1));
    await vi.advanceTimersByTimeAsync(80);
    const second = outcome(runtime.calculate(book, targets, 2));
    const third = runtime.calculate(book, targets, 3);
    expect((await second).error?.name).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(20);
    expect((await first).error?.name).toBe('TimeoutError');
    const replacement = ControlledWorker.instances[1];
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(replacement.messages.map((request) => request.revision)).toEqual([3]);
    await vi.advanceTimersByTimeAsync(99);
    expect(replacement.terminate).not.toHaveBeenCalled();
    replacement.reply();
    expect((await third).revision).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers a cancelled running slot and ignores callbacks from its terminated Worker', async () => {
    const { runtime, worker, book, targets } = setup(true, { timeoutMs: 100 });
    const controller = new AbortController();
    const first = outcome(runtime.calculate(book, targets, 1, controller.signal));
    const lateReply = worker.onmessage!,
      lateError = worker.onerror!,
      lateDecode = worker.onmessageerror!;
    controller.abort();
    expect((await first).error?.name).toBe('AbortError');
    expect(vi.getTimerCount()).toBe(1);
    const next = runtime.calculate(book, targets, 2);
    await vi.advanceTimersByTimeAsync(100);
    const replacement = ControlledWorker.instances[1];
    lateReply({ data: { ...calculateSync(worker.messages[0]), id: 1 } });
    lateError({ message: 'late crash' });
    lateDecode();
    expect(replacement.terminate).not.toHaveBeenCalled();
    replacement.reply();
    expect((await next).revision).toBe(2);
  });

  it('does not recreate a Worker for an aborted candidate or loop after a replacement also times out', async () => {
    const { runtime, worker, book, targets } = setup(true, { timeoutMs: 100 });
    const first = outcome(runtime.calculate(book, targets, 1));
    const second = outcome(runtime.calculate(book, targets, 2));
    await vi.advanceTimersByTimeAsync(200);
    expect((await first).error?.name).toBe('TimeoutError');
    expect((await second).error?.name).toBe('TimeoutError');
    expect(ControlledWorker.instances).toHaveLength(2);
    expect(worker.terminate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ControlledWorker.instances).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    const third = outcome(runtime.calculate(book, targets, 3));
    const controller = new AbortController();
    const fourth = outcome(runtime.calculate(book, targets, 4, controller.signal));
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect((await third).error?.name).toBe('TimeoutError');
    expect((await fourth).error?.name).toBe('AbortError');
    expect(ControlledWorker.instances).toHaveLength(3);
  });

  it('settles all posted requests when one deadline terminates their shared Worker', async () => {
    const { runtime, worker, book, targets } = setup(false, { timeoutMs: 100 });
    const first = outcome(runtime.calculate(book, targets, 1));
    await vi.advanceTimersByTimeAsync(60);
    const second = outcome(runtime.calculate(book, targets, 2));
    await vi.advanceTimersByTimeAsync(40);
    expect((await first).error?.name).toBe('TimeoutError');
    expect((await second).error?.name).toBe('TimeoutError');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves candidate cancellation across restart and cleans its listener exactly once', async () => {
    const { runtime, book, targets } = setup(true, { timeoutMs: 100 });
    const first = outcome(runtime.calculate(book, targets, 1));
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const next = outcome(runtime.calculate(book, targets, 2, controller.signal));
    await vi.advanceTimersByTimeAsync(100);
    expect((await first).error?.name).toBe('TimeoutError');
    expect(remove).not.toHaveBeenCalled();
    controller.abort();
    expect((await next).error?.name).toBe('AbortError');
    expect(remove).toHaveBeenCalledOnce();
    ControlledWorker.instances[1].reply();
    expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears timers on replies, post failures, Worker faults and disposal', async () => {
    const { runtime, worker, book, targets } = setup(false, { timeoutMs: 100 });
    const first = runtime.calculate(book, targets, 1);
    worker.reply();
    await first;
    expect(vi.getTimerCount()).toBe(0);
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error('clone failed');
    });
    await expect(runtime.calculate(book, targets, 2)).rejects.toThrow('clone failed');
    expect(vi.getTimerCount()).toBe(0);
    const failed = outcome(runtime.calculate(book, targets, 3));
    worker.onerror?.({ message: 'crash' });
    expect((await failed).error?.message).toBe('crash');
    expect(vi.getTimerCount()).toBe(0);
    const other = setup(true, { timeoutMs: 100 });
    const pending = outcome(other.runtime.calculate(other.book, other.targets, 4));
    other.runtime.dispose();
    expect((await pending).error?.message).toContain('disposed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ControlledWorker.instances).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears an aborted all-mode request timer when its reply arrives', async () => {
    const { runtime, worker, book, targets } = setup(false, { timeoutMs: 100 });
    const controller = new AbortController();
    const first = outcome(runtime.calculate(book, targets, 1, controller.signal));
    controller.abort();
    expect((await first).error?.name).toBe('AbortError');
    worker.reply();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it('rejects preserved work if Worker restart fails, without running it synchronously', async () => {
    const { runtime, book, targets } = setup(true, { timeoutMs: 100 });
    const first = outcome(runtime.calculate(book, targets, 1));
    const queuedBook = new Proxy(book, {
      get() {
        throw new Error('must not read on main thread');
      },
    });
    const second = outcome(runtime.calculate(queuedBook, targets, 2));
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('unavailable');
        }
      },
    );
    await vi.advanceTimersByTimeAsync(100);
    expect((await first).error?.name).toBe('TimeoutError');
    expect((await second).error?.message).toContain('could not start');
    await expect(runtime.calculate(queuedBook, targets, 3)).rejects.toThrow('could not restart');
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal('Worker', ControlledWorker);
    const next = runtime.calculate(book, targets, 4);
    ControlledWorker.instances[1].reply();
    expect((await next).revision).toBe(4);
  });

  it('can explicitly disable deadlines and does not arm timers for synchronous calculation', async () => {
    const { runtime, worker, book, targets } = setup(true, { timeoutMs: 0 });
    const pending = runtime.calculate(book, targets, 1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.reply();
    await pending;
    const sync = createCalculationRuntime({ useWorker: false, timeoutMs: 1 });
    runtimes.push(sync);
    await sync.calculate(book, targets, 2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([-1, 0.5, NaN, Infinity, 2_147_483_648])(
    'rejects invalid timeout %s before creating a Worker',
    (timeoutMs) => {
      expect(() => createCalculationRuntime({ timeoutMs })).toThrow(RangeError);
      expect(ControlledWorker.instances).toHaveLength(0);
    },
  );
});

describe('sheet-level calculation transfer reuse', () => {
  it('diffs the latest candidate against the last posted snapshot, skipping unsent edits', async () => {
    const { runtime, worker, book, targets, value } = setup(true, { reuseSheets: true });
    const first = runtime.calculate(book, targets, 1);
    const middle = structuredClone(book);
    middle.sheets[0].cells.A1.value = 20;
    middle.sheets[0].cells.C1 = { value: 'never posted' };
    const skipped = outcome(runtime.calculate(middle, targets, 2));
    const next = structuredClone(book);
    next.sheets[0].cells.A1.value = 7;
    const latest = runtime.calculate(next, targets, 3);
    expect((await skipped).error?.name).toBe('AbortError');
    worker.reply();
    await first;
    expect(worker.messages[1]).toMatchObject({
      baseId: 1,
      sheets: [],
      sheetPatches: [{ cells: [{ key: 'A1', cell: { value: 7 } }] }],
    });
    worker.reply(1);
    expect(value(await latest)).toBe(14);
  });
  it('restarts with a full snapshot after a failed patch post', async () => {
    const { runtime, worker, book, targets, value } = setup(true, { reuseSheets: true });
    const first = runtime.calculate(book, targets, 1);
    worker.reply();
    await first;
    const next = structuredClone(book);
    next.sheets[0].cells.A1.value = 11;
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error('clone failure');
    });
    await expect(runtime.calculate(next, targets, 2)).rejects.toThrow('clone failure');
    const retry = runtime.calculate(next, targets, 3);
    expect(worker.messages[1]).toMatchObject({ baseId: null, sheets: [{ id: book.sheets[0].id }] });
    worker.reply(1);
    expect(value(await retry)).toBe(22);
  });
  it('resets the base after an aborted running request returns a protocol error', async () => {
    const { runtime, worker, book, targets, value } = setup(true, { reuseSheets: true });
    const controller = new AbortController();
    const old = outcome(runtime.calculate(book, targets, 1, controller.signal));
    controller.abort();
    const latest = runtime.calculate(book, targets, 2);
    worker.onmessage?.({ data: { type: 'error', id: 1, revision: 1, message: 'bad base' } });
    expect(worker.messages[1]).toMatchObject({ baseId: null });
    worker.reply(1);
    expect((await old).error?.name).toBe('AbortError');
    expect(value(await latest)).toBe(4);
  });
  it('sends a complete snapshot to the new worker after timeout', async () => {
    vi.useFakeTimers();
    const { runtime, worker, book, targets, value } = setup(true, {
      reuseSheets: true,
      timeoutMs: 20,
    });
    const first = runtime.calculate(book, targets, 1);
    worker.reply();
    await first;
    const hung = outcome(runtime.calculate(book, targets, 2));
    const latest = runtime.calculate(book, targets, 3);
    await vi.advanceTimersByTimeAsync(20);
    expect((await hung).error?.name).toBe('TimeoutError');
    const replacement = ControlledWorker.instances.at(-1)!;
    expect(replacement).not.toBe(worker);
    expect(replacement.messages[0]).toMatchObject({
      baseId: null,
      sheets: [{ id: book.sheets[0].id }],
    });
    replacement.reply();
    expect(value(await latest)).toBe(4);
  });
  it('sends the first workbook then only changed immutable sheets', async () => {
    const { runtime, worker, book, targets, value } = setup();
    // This test uses the runtime directly with sheet reuse enabled.
    runtime.dispose();
    const reused = createCalculationRuntime({ queueMode: 'latest', reuseSheets: true });
    runtimes.push(reused);
    const nextWorker = ControlledWorker.instances.at(-1)!;
    const first = reused.calculate(book, targets, 1);
    expect(nextWorker.messages[0]).toMatchObject({
      type: 'calculate-sheets',
      baseId: null,
      sheets: [{ id: book.sheets[0].id }],
    });
    nextWorker.reply();
    await first;
    const next = structuredClone(book);
    next.updatedAt = 'next';
    next.sheets[0].cells.A1.value = 9;
    const second = reused.calculate(next, targets, 2);
    expect(nextWorker.messages[1]).toMatchObject({
      type: 'calculate-sheets',
      baseId: 1,
      sheets: [],
      sheetPatches: [{ sheetId: book.sheets[0].id, cells: [{ key: 'A1', cell: { value: 9 } }] }],
    });
    nextWorker.reply(1);
    expect(value(await second)).toBe(18);
  });
  it('transfers reordered replaced sheets and rejects an outstanding request on worker failure', async () => {
    const { book, targets } = setup();
    const reused = createCalculationRuntime({ queueMode: 'latest', reuseSheets: true });
    runtimes.push(reused);
    const worker = ControlledWorker.instances.at(-1)!;
    const first = reused.calculate(
      { ...book, sheets: [book.sheets[0], { ...book.sheets[0], id: 'second', name: 'Second' }] },
      targets,
      1,
    );
    worker.reply();
    await first;
    const next = structuredClone(book);
    next.sheets = [
      { ...next.sheets[0], id: 'second', name: 'Second' },
      { ...next.sheets[0], id: book.sheets[0].id },
    ];
    const second = reused.calculate(next, targets, 2);
    expect((worker.messages[1] as unknown as { sheets: unknown[] }).sheets).toHaveLength(0);
    worker.onerror?.({ message: 'boom' });
    await expect(second).rejects.toThrow('boom');
  });
});

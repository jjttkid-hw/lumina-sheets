import type { CellValue, Workbook } from './types';
import { createEvaluator } from './engine';
import { CalculationTransferSender } from './calculation-transfer';

export interface CalculationTarget {
  sheetId: string;
  key: string;
}

export interface CalculationRequest {
  type: 'calculate';
  revision: number;
  workbook: Workbook;
  targets: CalculationTarget[];
}

export interface CalculationResponse {
  type: 'calculated';
  revision: number;
  values: Record<string, CellValue>;
  elapsedMs: number;
}

export interface CalculationError {
  type: 'error';
  revision: number;
  message: string;
}

export type CalculationMessage = CalculationResponse | CalculationError;

export interface CalculationRuntimeOptions {
  /** Workers are enabled by default in the browser; set false for SSR/tests. */
  useWorker?: boolean;
  /** Latest mode holds at most one posted request and one unposted replacement.
   * Queued inputs must remain immutable until the returned promise settles. */
  queueMode?: 'all' | 'latest';
  /** Maximum posted-request lifetime in ms; defaults to 30 seconds. Zero disables it. */
  timeoutMs?: number;
  /** Reuse unchanged sheet values in the Worker. Workbooks/cells must be immutable. */
  reuseSheets?: boolean;
}

interface PendingCalculation {
  request: CalculationRequest;
  resolve: (result: CalculationResponse) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

function cancelled(message = 'Calculation cancelled'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/** Request IDs route replies; revisions verify the value source. In latest mode,
 * obsolete unposted work is replaced before cloning a workbook into the Worker. */
export class CalculationRuntime {
  private worker?: Worker;
  private requestId = 0;
  private pending = new Map<number, PendingCalculation>();
  private activeId?: number;
  private queuedId?: number;
  private disposed = false;
  private readonly latest: boolean;
  private readonly timeoutMs: number;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private restartRequired = false;
  private readonly transfer?: CalculationTransferSender;

  constructor(options: CalculationRuntimeOptions = {}) {
    if (options.reuseSheets) this.transfer = new CalculationTransferSender();
    this.latest = options.queueMode === 'latest';
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 0 || this.timeoutMs > 2_147_483_647)
      throw new RangeError('Calculation timeout must be an integer between 0 and 2147483647 ms');
    const canUseWorker =
      options.useWorker !== false && typeof Worker !== 'undefined' && typeof window !== 'undefined';
    if (canUseWorker) this.startWorker();
  }

  private startWorker(): boolean {
    try {
      const worker = new Worker(new URL('./calculation.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<CalculationMessage & { id?: number }>) => {
        if (this.worker !== worker) return;
        const message = event.data;
        const id = message?.id;
        if (typeof id !== 'number') return;
        const pending = this.pending.get(id);
        // A cancelled running request still owns the Worker slot until its reply.
        if (!pending && id !== this.activeId && !this.timers.has(id)) return;
        if (this.latest && id !== this.activeId) return;
        this.clearTimer(id);
        this.pending.delete(id);
        pending?.cleanup();
        if (id === this.activeId) this.activeId = undefined;
        // Aborted callers still need protocol failures to invalidate the base
        // before dispatching their queued successor.
        if (!pending && message.type !== 'calculated') this.transfer?.reset();
        if (pending) {
          if (message.revision !== pending.request.revision) {
            this.transfer?.reset();
            pending.reject(new Error('Calculation response revision mismatch'));
          } else if (message.type === 'error') {
            this.transfer?.reset();
            pending.reject(new Error(message.message));
          } else if (message.type === 'calculated') pending.resolve(message);
          else {
            this.transfer?.reset();
            pending.reject(new Error('Invalid calculation response'));
          }
        }
        this.drain();
      };
      worker.onerror = (event) => {
        if (this.worker === worker)
          this.workerFault(new Error(event.message || 'Calculation worker failed'));
      };
      worker.onmessageerror = () => {
        if (this.worker === worker)
          this.workerFault(new Error('Calculation worker response could not be read'));
      };
      return true;
    } catch {
      this.failWorker(new Error('Calculation worker could not start'));
      return false;
    }
  }

  calculate(
    workbook: Workbook,
    targets: CalculationTarget[],
    revision: number,
    signal?: AbortSignal,
  ): Promise<CalculationResponse> {
    if (this.disposed) return Promise.reject(new Error('CalculationRuntime is disposed'));
    if (signal?.aborted) return Promise.reject(cancelled());
    if (this.restartRequired) {
      if (!this.startWorker())
        return Promise.reject(new Error('Calculation worker could not restart'));
      this.restartRequired = false;
    }
    const request: CalculationRequest = { type: 'calculate', workbook, targets, revision };
    if (!this.worker) {
      try {
        return Promise.resolve(calculateSync(request));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    const id = ++this.requestId;
    return new Promise<CalculationResponse>((resolve, reject) => {
      const abort = () => this.rejectRequest(id, cancelled());
      const cleanup = () => signal?.removeEventListener('abort', abort);
      this.pending.set(id, { request, resolve, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      if (this.latest && this.activeId !== undefined) {
        if (this.queuedId !== undefined)
          this.rejectRequest(this.queuedId, cancelled('Calculation superseded'));
        this.queuedId = id;
      } else this.post(id);
    });
  }

  private rejectRequest(id: number, error: Error) {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    if (id === this.queuedId) this.queuedId = undefined;
    pending?.cleanup();
    pending?.reject(error);
  }

  private post(id: number) {
    const pending = this.pending.get(id);
    if (!pending || !this.worker) return;
    if (this.latest) this.activeId = id;
    try {
      const worker = this.worker;
      if (this.timeoutMs > 0) {
        this.timers.set(
          id,
          setTimeout(() => {
            if (this.worker === worker && this.timers.has(id)) this.timeoutWorker();
          }, this.timeoutMs),
        );
      }
      worker.postMessage(this.transfer?.prepare(pending.request, id) ?? { ...pending.request, id });
      this.transfer?.commit(pending.request, id);
    } catch (error) {
      this.transfer?.reset();
      this.clearTimer(id);
      this.rejectRequest(id, error instanceof Error ? error : new Error(String(error)));
      if (id === this.activeId) this.activeId = undefined;
      this.drain();
    }
  }

  private drain() {
    if (this.disposed || this.activeId !== undefined || this.queuedId === undefined) return;
    const id = this.queuedId;
    this.queuedId = undefined;
    this.post(id);
  }

  private clearTimer(id: number) {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
  }

  private timeoutWorker() {
    const error = new Error(`Calculation exceeded ${this.timeoutMs} ms`);
    error.name = 'TimeoutError';
    // A queued candidate has never run; preserve only that candidate, never replay
    // timed-out work. The old Worker must be terminated before a new one starts.
    const queuedId = this.queuedId;
    const queued = queuedId === undefined ? undefined : this.pending.get(queuedId);
    if (queuedId !== undefined) this.pending.delete(queuedId);
    this.failWorker(error);
    this.restartRequired = true;
    if (queued && queuedId !== undefined) {
      this.pending.set(queuedId, queued);
      if (this.startWorker()) {
        this.restartRequired = false;
        this.post(queuedId);
      }
    }
  }

  private workerFault(error: Error) {
    this.failWorker(error);
    // Only a new caller triggers recovery; never replay failed work or spin
    // on a broken worker resource. Keep bulk evaluation off the UI thread.
    this.restartRequired = true;
  }

  private failWorker(error: Error) {
    this.transfer?.reset();
    for (const id of this.timers.keys()) this.clearTimer(id);
    const worker = this.worker;
    this.worker = undefined;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    for (const id of this.pending.keys()) this.rejectRequest(id, error);
    this.activeId = undefined;
    this.queuedId = undefined;
  }

  /** Synchronous path for input latency and environments without Worker support. */
  calculateSync(
    workbook: Workbook,
    targets: CalculationTarget[],
    revision: number,
  ): CalculationResponse {
    if (this.disposed) throw new Error('CalculationRuntime is disposed');
    return calculateSync({ type: 'calculate', workbook, targets, revision });
  }

  dispose() {
    this.disposed = true;
    this.failWorker(new Error('CalculationRuntime is disposed'));
  }
}

export function createCalculationRuntime(options?: CalculationRuntimeOptions) {
  return new CalculationRuntime(options);
}

export function calculateSync(request: CalculationRequest): CalculationResponse {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const workbook = request.workbook;
  const byId = new Map(workbook.sheets.map((sheet) => [sheet.id, sheet]));
  const evaluator = createEvaluator(workbook, { revision: request.revision });
  const values: Record<string, CellValue> = {};
  for (const target of request.targets) {
    const sheet = byId.get(target.sheetId);
    if (!sheet) {
      values[`${target.sheetId}:${target.key}`] = '#REF!';
      continue;
    }
    values[`${target.sheetId}:${target.key}`] = evaluator(sheet, target.key);
  }
  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    type: 'calculated',
    revision: request.revision,
    values,
    elapsedMs: Math.max(0, ended - started),
  };
}

import type { CellValue, Sheet, Workbook } from './types';
import { createEvaluator } from './engine';

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
}

/**
 * Revision-aware calculation facade. A caller can issue several requests while
 * editing; stale responses are discarded before they reach the UI. The worker is
 * deliberately target based, so a viewport can request only visible formulas.
 */
export class CalculationRuntime {
  private worker?: Worker;
  private requestId = 0;
  private pending = new Map<
    number,
    {
      revision: number;
      resolve: (result: CalculationResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  private disposed = false;

  constructor(options: CalculationRuntimeOptions = {}) {
    const canUseWorker =
      options.useWorker !== false && typeof Worker !== 'undefined' && typeof window !== 'undefined';
    if (canUseWorker) {
      try {
        this.worker = new Worker(new URL('./calculation.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (event: MessageEvent<CalculationMessage & { id?: number }>) => {
          const id = event.data.id;
          if (typeof id !== 'number') return;
          const request = this.pending.get(id);
          if (!request) return;
          this.pending.delete(id);
          if (event.data.type === 'error') request.reject(new Error(event.data.message));
          else request.resolve(event.data);
        };
        this.worker.onerror = (event) => {
          const error = new Error(event.message || 'Calculation worker failed');
          for (const request of this.pending.values()) request.reject(error);
          this.pending.clear();
          this.worker?.terminate();
          this.worker = undefined;
        };
      } catch {
        this.worker = undefined;
      }
    }
  }

  calculate(
    workbook: Workbook,
    targets: CalculationTarget[],
    revision: number,
  ): Promise<CalculationResponse> {
    if (this.disposed) return Promise.reject(new Error('CalculationRuntime is disposed'));
    const request: CalculationRequest = { type: 'calculate', workbook, targets, revision };
    if (!this.worker) return Promise.resolve(calculateSync(request));
    const id = ++this.requestId;
    return new Promise<CalculationResponse>((resolve, reject) => {
      this.pending.set(id, { revision, resolve, reject });
      this.worker!.postMessage({ ...request, id });
    });
  }

  /** Synchronous path for input latency and environments without Worker support. */
  calculateSync(
    workbook: Workbook,
    targets: CalculationTarget[],
    revision: number,
  ): CalculationResponse {
    return calculateSync({ type: 'calculate', workbook, targets, revision });
  }

  dispose() {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = undefined;
    const error = new Error('CalculationRuntime is disposed');
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
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

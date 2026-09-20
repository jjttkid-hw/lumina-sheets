import type { LuminaPersistence, WorkbookPatch } from './persistence';
import type { Workbook } from './types';

type SaveAdapter = Pick<LuminaPersistence, 'putWorkbook' | 'queuePatch' | 'flush'>;
type SaveJob =
  | { kind: 'snapshot'; workbook: Workbook }
  | { kind: 'patches'; workbookId: string; patches: WorkbookPatch[] };

/**
 * Serializes workspace snapshots with patch journals. Inputs are captured when
 * queued, but patches only enter the adapter while their job is executing.
 * A failure retains the head job and blocks later writes until flush() retries.
 * Callers must observe returned promises; no save error is swallowed.
 */
export class WorkspaceSaveQueue {
  private jobs: SaveJob[] = [];
  private running?: Promise<void>;
  private failure?: { error: unknown };

  constructor(private readonly persistence: SaveAdapter) {}

  snapshot(workbook: Workbook): Promise<void> {
    try {
      this.jobs.push({ kind: 'snapshot', workbook: structuredClone(workbook) });
    } catch (error) {
      return Promise.reject(error);
    }
    return this.drain();
  }

  patches(workbookId: string, patches: WorkbookPatch[]): Promise<void> {
    try {
      this.jobs.push({ kind: 'patches', workbookId, patches: structuredClone(patches) });
    } catch (error) {
      return Promise.reject(error);
    }
    return this.drain();
  }

  /** Waits for all queued work, or retries a previously failed head job. */
  flush(): Promise<void> {
    if (!this.running) this.failure = undefined;
    return this.drain();
  }

  private drain(): Promise<void> {
    if (this.running) return this.running;
    if (this.failure) return Promise.reject(this.failure.error);
    if (!this.jobs.length) return Promise.resolve();
    // Start in a microtask so running is set before any adapter or host code
    // can synchronously reenter this coordinator.
    this.running = Promise.resolve().then(async () => {
      try {
        while (this.jobs.length) {
          const job = this.jobs[0];
          if (job.kind === 'snapshot') {
            await this.persistence.putWorkbook(job.workbook);
          } else {
            // Re-enqueue the complete batch on retry: an adapter flush can
            // remove its pending buffer before rejecting. Cell/sheet patches
            // assign values, so replaying an uncertain failed batch is safe.
            for (const patch of job.patches) this.persistence.queuePatch(job.workbookId, patch);
            await this.persistence.flush();
          }
          this.jobs.shift();
        }
      } catch (error) {
        this.failure = { error };
        throw error;
      } finally {
        this.running = undefined;
      }
    });
    return this.running;
  }
}

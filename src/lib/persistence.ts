import type { Cell, Comment, Revision, Workbook } from './types';
import { parseCellKey } from './engine';

/** A small, structured-cloneable edit. Keeping edits as patches means a keypress does not
 * stringify or rewrite an entire workbook. Patches are compacted into a workbook snapshot
 * periodically by LuminaPersistence.compact(). */
export interface CellPatch {
  kind: 'cell';
  sheetId: string;
  key: string;
  cell: Cell | null;
}

export interface SheetMetaPatch {
  kind: 'sheet-meta';
  sheetId: string;
  /** Only supplied properties are changed. */
  changes: Partial<
    Pick<
      import('./types').Sheet,
      | 'name'
      | 'rowCount'
      | 'colCount'
      | 'columnWidths'
      | 'rowHeights'
      | 'hiddenRows'
      | 'hiddenColumns'
      | 'frozenRows'
      | 'merges'
      | 'dataValidations'
    >
  >;
}

export type WorkbookPatch = CellPatch | SheetMetaPatch;

export interface PatchTransaction {
  forward: WorkbookPatch[];
  inverse: WorkbookPatch[];
  label?: string;
}

export interface HistoryResult {
  workbook: Workbook;
  transaction: PatchTransaction;
}

export interface QueuedPatch {
  id?: number;
  /** Stable edit identity for retries; absent on legacy journals. */
  operationId?: string;
  workbookId: string;
  seq: number;
  at: number;
  patch: WorkbookPatch;
}

export interface PersistenceOptions {
  /** Override the database name in tests or for an embedded application. */
  dbName?: string;
  /** localStorage-compatible source used for the one-time v1 migration. */
  storage?: StorageLike;
  /** Force the in-memory adapter. Useful for SSR and deterministic tests. */
  forceMemory?: boolean;
  /** Delay before queued patches are flushed. Defaults to 250 ms. */
  flushDelayMs?: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface PersistenceStats {
  pendingPatches: number;
  persistedPatches: number;
  lastFlushAt: number | null;
  backend: 'indexeddb' | 'memory';
}

const PREFIX = 'lumina.v1';
const DB_VERSION = 2;
const DEFAULT_DB = 'lumina.v2';
const DEFAULT_FLUSH_DELAY = 250;
const MAX_PATCHES_BEFORE_COMPACT = 500;

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Absence is empty; malformed present values must reach validation/recovery unchanged. */
function readMemoryList<T>(records: Map<string, T[]> | undefined, key: string): T[] {
  return clone(records?.has(key) ? records.get(key)! : []);
}
function readStoredList<T>(row: unknown, field: string): T[] {
  if (row === undefined) return [];
  const value =
    row && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, field)
      ? (row as Record<string, unknown>)[field]
      : row;
  return clone(value) as T[];
}

function defaultStorage(): StorageLike | undefined {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Access to localStorage may be denied in private/embedded contexts.
  }
  return undefined;
}

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function patchKey(record: QueuedPatch): string {
  if (record.operationId !== undefined)
    return JSON.stringify([record.workbookId, record.operationId]);
  return `${record.workbookId}:${record.seq}`;
}

function assertPatch(value: unknown): asserts value is WorkbookPatch {
  const object = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && !Array.isArray(item);
  if (!object(value) || typeof value.sheetId !== 'string' || !value.sheetId)
    throw new Error('Invalid workbook patch target');
  if (value.kind === 'cell') {
    if (
      typeof value.key !== 'string' ||
      !/^[A-Z]+[1-9]\d*$/.test(value.key) ||
      !parseCellKey(value.key) ||
      (value.cell !== null && (!object(value.cell) || !Object.hasOwn(value.cell, 'value')))
    )
      throw new Error('Invalid workbook patch cell');
  } else if (value.kind === 'sheet-meta') {
    if (!object(value.changes)) throw new Error('Invalid workbook patch metadata');
  } else throw new Error('Invalid workbook patch kind');
}

/** Replay an ordered batch without copying the same cell dictionary for every edit.
 * Inputs are immutable; each affected sheet/cell dictionary is copied at most once.
 * Metadata-only batches do not enumerate stored cells. */
export function applyWorkbookPatches(
  workbook: Workbook,
  patches: readonly WorkbookPatch[],
): Workbook {
  if (!patches.length) return workbook;
  for (const patch of patches) assertPatch(patch);
  const indexes = new Map(workbook.sheets.map((sheet, index) => [sheet.id, index]));
  let sheets: Workbook['sheets'] | undefined;
  const changedSheets = new Set<number>();
  const changedCells = new Set<number>();
  for (const patch of patches) {
    const index = indexes.get(patch.sheetId);
    if (index === undefined) continue;
    sheets ??= workbook.sheets.slice();
    if (!changedSheets.has(index)) {
      sheets[index] = { ...sheets[index] };
      changedSheets.add(index);
    }
    const sheet = sheets[index];
    if (patch.kind === 'cell') {
      if (!changedCells.has(index)) {
        sheet.cells = { ...sheet.cells };
        changedCells.add(index);
      }
      if (patch.cell === null) delete sheet.cells[patch.key];
      else sheet.cells[patch.key] = clone(patch.cell);
    } else Object.assign(sheet, clone(patch.changes));
  }
  return sheets ? { ...workbook, sheets } : workbook;
}

export function applyWorkbookPatch(workbook: Workbook, patch: WorkbookPatch): Workbook {
  return applyWorkbookPatches(workbook, [patch]);
}

function applyPatches(workbook: Workbook, patches: QueuedPatch[]): Workbook {
  // An in-flight write may already be visible in IndexedDB before its promise
  // settles. Deduplicate that edit by identity, not by a cross-page sequence.
  const ordered = [...new Map(patches.map((record) => [patchKey(record), record])).values()].sort(
    (a, b) =>
      a.seq - b.seq ||
      ((a.operationId ?? '') < (b.operationId ?? '')
        ? -1
        : (a.operationId ?? '') > (b.operationId ?? '')
          ? 1
          : 0),
  );
  return applyWorkbookPatches(
    workbook,
    ordered.map((record) => record.patch),
  );
}

/**
 * Bounded patch based undo/redo. Unlike storing Workbook snapshots this keeps history size
 * proportional to the edited cells. The inverse list is applied in reverse order so a paste
 * or multi-cell format operation remains atomic.
 */
export class PatchHistory {
  private readonly limit: number;
  private undoStack: PatchTransaction[] = [];
  private redoStack: PatchTransaction[] = [];

  constructor(limit = 100) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get size(): number {
    return this.undoStack.length;
  }

  push(transaction: PatchTransaction): void {
    if (!transaction.forward.length || !transaction.inverse.length) return;
    this.undoStack.push(clone(transaction));
    if (this.undoStack.length > this.limit)
      this.undoStack.splice(0, this.undoStack.length - this.limit);
    this.redoStack = [];
  }

  undo(workbook: Workbook): HistoryResult | null {
    const transaction = this.undoStack.at(-1);
    if (!transaction) return null;
    const next = applyWorkbookPatches(workbook, [...transaction.inverse].reverse());
    const result = { workbook: next, transaction: clone(transaction) };
    this.undoStack.pop();
    this.redoStack.push(transaction);
    return result;
  }

  redo(workbook: Workbook): HistoryResult | null {
    const transaction = this.redoStack.at(-1);
    if (!transaction) return null;
    const next = applyWorkbookPatches(workbook, transaction.forward);
    const result = { workbook: next, transaction: clone(transaction) };
    this.redoStack.pop();
    this.undoStack.push(transaction);
    return result;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

interface MemoryState {
  workbooks: Map<string, Workbook>;
  patches: Map<string, QueuedPatch[]>;
  revisions: Map<string, Revision[]>;
  comments: Map<string, Comment[]>;
}

function createMemoryState(): MemoryState {
  return { workbooks: new Map(), patches: new Map(), revisions: new Map(), comments: new Map() };
}

interface WorkbookRow {
  id: string;
  workbook: Workbook;
}
interface RevisionRow {
  key: string;
  workbookId: string;
  revisions: Revision[];
}
interface CommentRow {
  key: string;
  workbookId: string;
  comments: Comment[];
}
interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * Asynchronous workbook persistence.
 *
 * - IndexedDB stores structured objects, so regular edits enqueue tiny cell patches.
 * - A full snapshot is written on import/explicit save and after compaction, not per keypress.
 * - If IndexedDB is unavailable, the same API remains usable in memory and migrates the old
 *   localStorage snapshot when one is supplied.
 */
export class LuminaPersistence {
  private readonly dbName: string;
  private readonly flushDelayMs: number;
  private readonly storage?: StorageLike;
  private memory: MemoryState | null;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private hasOpenedDatabase = false;
  private pending: QueuedPatch[] = [];
  private flushing: QueuedPatch[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private snapshotTail: Promise<void> = Promise.resolve();
  // Seed local ordering from time; observed persisted sequences advance this floor.
  // This is not a cross-tab atomic sequence allocator.
  private seq = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  private persistedPatches = 0;
  private lastFlushAt: number | null = null;
  private migrationPromise: Promise<void> | null = null;

  constructor(options: PersistenceOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB;
    this.flushDelayMs = Math.max(0, options.flushDelayMs ?? DEFAULT_FLUSH_DELAY);
    this.storage = options.storage ?? defaultStorage();
    this.memory = options.forceMemory || !isIndexedDbAvailable() ? createMemoryState() : null;
  }

  get stats(): PersistenceStats {
    return {
      pendingPatches: this.pending.length + this.flushing.length,
      persistedPatches: this.persistedPatches,
      lastFlushAt: this.lastFlushAt,
      backend: this.memory ? 'memory' : 'indexeddb',
    };
  }

  /** Read raw recovery material without applying journals or running migration. */
  async readRecoveryStorage() {
    // Do not migrate, replay, flush or normalize damaged records on this rescue path.
    const result: { stores: Record<string, unknown>; warnings: string[]; pending: QueuedPatch[] } =
      {
        stores: {},
        warnings: [],
        pending: clone([...this.flushing, ...this.pending]),
      };
    const db = this.memory ? null : await this.openDb();
    const memory = this.memory;
    const names = ['workbooks', 'patches', 'comments', 'revisions'] as const;
    const reads = await Promise.allSettled(
      names.map(async (name) => {
        if (memory)
          return clone([...memory[name].entries()].map(([key, value]) => ({ key, value })));
        if (!db) throw new Error('No recovery backend');
        return this.request<unknown[]>(db.transaction(name).objectStore(name).getAll());
      }),
    );
    reads.forEach((read, index) => {
      if (read.status === 'fulfilled') result.stores[names[index]] = read.value;
      else result.warnings.push(`原始存储读取失败：${names[index]}`);
    });
    return { ...result, backend: memory ? ('memory' as const) : ('indexeddb' as const) };
  }

  /** Load all books and replay pending patches. The old localStorage format is migrated once. */
  async loadWorkbooks(): Promise<Workbook[]> {
    await this.migrateLegacy();
    const base = this.memory
      ? [...this.memory.workbooks.values()].map((book) => clone(book))
      : await this.idbGetAllWorkbooks();
    const allPatches = this.memory
      ? [...this.memory.patches.values()].flat()
      : await this.idbGetAllPatches();
    // Include edits waiting for the debounce timer so callers always observe their own writes.
    allPatches.push(...this.flushing, ...this.pending);
    this.observeSequences(allPatches);
    const byBook = new Map<string, QueuedPatch[]>();
    for (const patch of allPatches) {
      const list = byBook.get(patch.workbookId) ?? [];
      list.push(patch);
      byBook.set(patch.workbookId, list);
    }
    return base.map((book) => {
      // Retain malformed snapshots for validation/recovery instead of letting a
      // null entry prevent every other document from being read.
      if (!book || typeof book !== 'object' || typeof book.id !== 'string') return book;
      return applyPatches(book, byBook.get(book.id) ?? []);
    });
  }

  async loadWorkbook(workbookId: string): Promise<Workbook | null> {
    await this.migrateLegacy();
    const memoryBase = this.memory?.workbooks.get(workbookId);
    const base = this.memory
      ? memoryBase
        ? clone(memoryBase)
        : undefined
      : await this.idbGetWorkbook(workbookId);
    if (!base) return null;
    const patches = this.memory
      ? [...(this.memory.patches.get(workbookId) ?? [])]
      : await this.idbGetPatches(workbookId);
    patches.push(...this.flushing.filter((record) => record.workbookId === workbookId));
    patches.push(...this.pending.filter((record) => record.workbookId === workbookId));
    this.observeSequences(patches);
    return applyPatches(base, patches);
  }

  private observeSequences(patches: QueuedPatch[]): void {
    for (const record of patches) {
      if (!Number.isSafeInteger(record?.seq) || record.seq < 0)
        throw new Error('Invalid persisted journal sequence; retain storage for recovery');
      if (
        record.operationId !== undefined &&
        (typeof record.operationId !== 'string' || !record.operationId)
      )
        throw new Error('Invalid persisted journal identity; retain storage for recovery');
      this.seq = Math.max(this.seq, record.seq);
    }
  }

  /** Write a full snapshot for imports, initial migration or explicit backup. */
  async putWorkbook(workbook: Workbook): Promise<void> {
    return this.putWorkbooks([workbook]);
  }

  async putWorkbooks(workbooks: Workbook[]): Promise<void> {
    // Capture before the first await: later caller mutations or patches belong
    // after this snapshot, even if migration/opening the database is delayed.
    const copies = clone(workbooks);
    const cutoff = this.seq;
    const ids = new Set(copies.map((book) => book.id));
    if (ids.size !== copies.length) throw new Error('Snapshot workbook IDs must be unique');
    const activeFlush = this.flushPromise;
    const operation = this.snapshotTail.then(async () => {
      // A prior flush must settle before replacing its base. A failed flush
      // retains its records; a successful snapshot can supersede those records.
      await activeFlush?.catch(() => undefined);
      await this.migrateLegacy();
      const db = this.memory ? null : await this.openDb();
      if (db) {
        await this.transaction(db, ['workbooks', 'patches'], 'readwrite', (tx) => {
          const store = tx.objectStore('workbooks');
          for (const book of copies)
            store.put({ id: book.id, workbook: book } satisfies WorkbookRow);
          const request = tx.objectStore('patches').openCursor();
          request.onsuccess = () => {
            try {
              const cursor = request.result;
              if (!cursor) return;
              const record = cursor.value as QueuedPatch;
              if (ids.has(record.workbookId)) {
                // Never coerce malformed persisted sequences while deleting
                // journals: retain the snapshot and journal together for rescue.
                if (!Number.isSafeInteger(record.seq) || record.seq < 0)
                  throw new Error('Invalid persisted journal sequence');
                if (record.seq <= cutoff) cursor.delete();
              }
              cursor.continue();
            } catch {
              tx.abort();
            }
          };
        });
      } else {
        const memory = this.memory ?? createMemoryState();
        this.memory = memory;
        // All cloning completed before touching any stored workbook.
        for (const book of copies) {
          memory.workbooks.set(book.id, book);
          memory.patches.set(
            book.id,
            (memory.patches.get(book.id) ?? []).filter((record) => record.seq > cutoff),
          );
        }
      }
      // Commit acknowledged: retain every patch queued after this invocation.
      for (const id of ids) this.discardPending(id, cutoff);
    });
    this.snapshotTail = operation.catch(() => undefined);
    return operation;
  }

  /** Queue a tiny edit. It returns immediately; writes are coalesced into one transaction. */
  queuePatch(workbookId: string, patch: WorkbookPatch): void {
    assertPatch(patch);
    if (!Number.isSafeInteger(this.seq + 1))
      throw new Error('Journal sequence capacity exceeded; retain storage for recovery');
    const record: QueuedPatch = {
      operationId: crypto.randomUUID(),
      workbookId,
      patch: clone(patch),
      seq: ++this.seq,
      at: Date.now(),
    };
    this.pending.push(record);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush().catch(() => undefined), this.flushDelayMs);
    if (this.pending.length >= MAX_PATCHES_BEFORE_COMPACT) void this.flush().catch(() => undefined);
  }

  queueCellPatch(workbookId: string, sheetId: string, key: string, cell: Cell | null): void {
    this.queuePatch(workbookId, { kind: 'cell', sheetId, key, cell });
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushPromise) return this.flushPromise;
    if (!this.pending.length) return;
    // Defer execution until flushPromise is assigned. The memory path has no
    // await; an immediately invoked async function would clear the field in
    // finally before the assignment reinstated its already-resolved promise.
    const snapshots = this.snapshotTail;
    this.flushPromise = Promise.resolve().then(async () => {
      await snapshots;
      try {
        // queuePatch can auto-start a flush at 500 entries while its caller is
        // still enqueuing a larger batch. Drain every batch that arrives before
        // completion so the awaited promise cannot leave an unsaved tail.
        while (this.pending.length) {
          const batch = this.pending.splice(0);
          this.flushing = batch;
          if (this.memory) {
            for (const record of batch) {
              const list = this.memory.patches.get(record.workbookId) ?? [];
              list.push(record);
              this.memory.patches.set(record.workbookId, list);
            }
          } else {
            const db = await this.openDb();
            if (db) {
              await this.transaction(db, ['patches'], 'readwrite', (tx) => {
                const store = tx.objectStore('patches');
                for (const record of batch)
                  store.put({ ...record, id: undefined, key: patchKey(record) });
              });
            } else {
              // IndexedDB may become unavailable after construction (privacy mode, quota or a
              // browser policy). Continue with the in-memory adapter instead of dropping edits.
              const memory = this.memory ?? createMemoryState();
              this.memory = memory;
              for (const record of batch) {
                const list = memory.patches.get(record.workbookId) ?? [];
                list.push(record);
                memory.patches.set(record.workbookId, list);
              }
            }
          }
          this.persistedPatches += batch.length;
          this.lastFlushAt = Date.now();
          this.flushing = [];
        }
      } catch (error) {
        // Preserve original sequence numbers for an idempotent retry, ahead of
        // newer edits queued while the transaction was in flight.
        this.pending = [...this.flushing, ...this.pending];
        this.flushing = [];
        if (this.flushTimer) {
          clearTimeout(this.flushTimer);
          this.flushTimer = null;
        }
        throw error;
      } finally {
        this.flushPromise = null;
      }
    });
    return this.flushPromise;
  }

  /** Compact patches into the supplied current workbook and remove its journal. */
  async compact(workbook: Workbook): Promise<void> {
    // Capture the snapshot and journal cutoff before waiting. putWorkbook
    // serializes against active flushes and replaces only older target patches;
    // a subsequent flush persists edits queued after this invocation.
    await this.putWorkbook(workbook);
    await this.flush();
  }

  async saveRevisions(workbookId: string, revisions: Revision[]): Promise<void> {
    const value = clone(revisions.slice(0, 20));
    if (this.memory) {
      this.memory.revisions.set(workbookId, value);
      return;
    }
    const db = await this.openDb();
    if (!db) {
      const memory = this.memory ?? createMemoryState();
      this.memory = memory;
      memory.revisions.set(workbookId, value);
      return;
    }
    await this.transaction(db, ['revisions'], 'readwrite', (tx) => {
      tx.objectStore('revisions').put({
        key: workbookId,
        workbookId,
        revisions: value,
      } satisfies RevisionRow);
    });
  }

  async loadRevisions(workbookId: string): Promise<Revision[]> {
    if (this.memory) return readMemoryList(this.memory.revisions, workbookId);
    const db = await this.openDb();
    if (!db) {
      const fallbackMemory = (this as unknown as { memory: MemoryState | null }).memory;
      return readMemoryList(fallbackMemory?.revisions, workbookId);
    }
    const row = await this.request<RevisionRow | undefined>(
      db.transaction('revisions').objectStore('revisions').get(workbookId),
    );
    return readStoredList<Revision>(row, 'revisions');
  }

  async saveComments(workbookId: string, comments: Comment[]): Promise<void> {
    const value = clone(comments);
    if (this.memory) {
      this.memory.comments.set(workbookId, value);
      return;
    }
    const db = await this.openDb();
    if (!db) {
      const memory = this.memory ?? createMemoryState();
      this.memory = memory;
      memory.comments.set(workbookId, value);
      return;
    }
    await this.transaction(db, ['comments'], 'readwrite', (tx) => {
      tx.objectStore('comments').put({
        key: workbookId,
        workbookId,
        comments: value,
      } satisfies CommentRow);
    });
  }

  async loadComments(workbookId: string): Promise<Comment[]> {
    if (this.memory) return readMemoryList(this.memory.comments, workbookId);
    const db = await this.openDb();
    if (!db) {
      const fallbackMemory = (this as unknown as { memory: MemoryState | null }).memory;
      return readMemoryList(fallbackMemory?.comments, workbookId);
    }
    const row = await this.request<CommentRow | undefined>(
      db.transaction('comments').objectStore('comments').get(workbookId),
    );
    return readStoredList<Comment>(row, 'comments');
  }

  async close(): Promise<void> {
    let failure: unknown;
    try {
      await this.snapshotTail;
      await this.flush();
    } catch (error) {
      // Closing is still a resource-lifecycle operation after a failed save.
      // Preserve the error for the caller, but do not leave the connection
      // open and blocking another page's upgrade/retry.
      failure = error;
    } finally {
      const connection = this.dbPromise;
      if (connection) {
        try {
          const db = await connection;
          if (this.dbPromise === connection) this.dbPromise = null;
          db?.close();
        } catch (error) {
          if (failure === undefined) failure = error;
        }
      }
    }
    if (failure !== undefined) throw failure;
  }

  private discardPending(workbookId: string, cutoff: number): void {
    this.pending = this.pending.filter(
      (record) => record.workbookId !== workbookId || record.seq > cutoff,
    );
    if (!this.pending.length && this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async migrateLegacy(): Promise<void> {
    if (this.migrationPromise) return this.migrationPromise;
    this.migrationPromise = Promise.resolve()
      .then(async () => {
        if (!this.storage) return;
        let raw: string | null = null;
        try {
          raw = this.storage.getItem(`${PREFIX}.workbooks`);
        } catch {
          return;
        }
        if (!raw) return;
        let books: Workbook[];
        try {
          const value: unknown = JSON.parse(raw);
          if (!Array.isArray(value)) return;
          // Queue each ID once: multiple getKey requests queued before their puts
          // can all see an absent key within the same IndexedDB transaction.
          // Keep the first legacy snapshot, matching memory migration; raw storage
          // retains every version for explicit recovery selection.
          const seen = new Set<string>();
          books = (value as Workbook[]).filter((book) => {
            if (!book || typeof book.id !== 'string' || seen.has(book.id)) return false;
            seen.add(book.id);
            return true;
          });
        } catch {
          return;
        }
        // Do not repeatedly parse or write the legacy payload. The source remains as a recovery
        // backup until the user clears browser data. The marker lives in IndexedDB so a stale
        // localStorage snapshot can never overwrite edits after a browser restart.
        if (this.memory) {
          for (const book of books)
            if (book && typeof book.id === 'string' && !this.memory.workbooks.has(book.id))
              this.memory.workbooks.set(book.id, clone(book));
          for (const book of books)
            if (book && typeof book.id === 'string') this.migrateLegacyAuxiliary(book.id);
        } else {
          const db = await this.openDb();
          if (db) {
            const marker = await this.request<MetaRow | undefined>(
              db.transaction('meta').objectStore('meta').get('legacy-v1-migrated'),
            );
            if (marker?.value === true) return;
            await this.transaction(
              db,
              ['workbooks', 'revisions', 'comments', 'meta'],
              'readwrite',
              (tx) => {
                // Recheck after acquiring the write transaction: another page may
                // have completed migration since the optimistic read above.
                const meta = tx.objectStore('meta');
                const currentMarker = meta.get('legacy-v1-migrated');
                currentMarker.onsuccess = () => {
                  if (currentMarker.result?.value === true) return;
                  try {
                    const putIfAbsent = (store: IDBObjectStore, key: string, value: unknown) => {
                      const existing = store.getKey(key);
                      existing.onsuccess = () => {
                        if (existing.result !== undefined) return;
                        try {
                          store.put(value);
                        } catch {
                          tx.abort();
                        }
                      };
                    };
                    const store = tx.objectStore('workbooks');
                    for (const book of books)
                      if (book && typeof book.id === 'string')
                        putIfAbsent(store, book.id, {
                          id: book.id,
                          workbook: clone(book),
                        } satisfies WorkbookRow);
                    const revisions = tx.objectStore('revisions');
                    const comments = tx.objectStore('comments');
                    for (const book of books) {
                      if (!book || typeof book.id !== 'string') continue;
                      const oldRevisions = this.readLegacyList<Revision>(
                        `${PREFIX}.history.${book.id}`,
                      );
                      if (oldRevisions)
                        putIfAbsent(revisions, book.id, {
                          key: book.id,
                          workbookId: book.id,
                          revisions: oldRevisions.slice(0, 20),
                        } satisfies RevisionRow);
                      const oldComments = this.readLegacyList<Comment>(
                        `${PREFIX}.comments.${book.id}`,
                      );
                      if (oldComments)
                        putIfAbsent(comments, book.id, {
                          key: book.id,
                          workbookId: book.id,
                          comments: oldComments,
                        } satisfies CommentRow);
                    }
                    tx.objectStore('meta').put({
                      key: 'legacy-v1-migrated',
                      value: true,
                    } satisfies MetaRow);
                  } catch {
                    tx.abort();
                  }
                };
              },
            );
          } else {
            const memory = this.memory ?? createMemoryState();
            this.memory = memory;
            for (const book of books)
              if (book && typeof book.id === 'string' && !memory.workbooks.has(book.id))
                memory.workbooks.set(book.id, clone(book));
            for (const book of books)
              if (book && typeof book.id === 'string') this.migrateLegacyAuxiliary(book.id);
          }
        }
      })
      .catch((error) => {
        // Failed IndexedDB reads or transactions can be retried by the caller.
        // The microtask above ensures this cache is assigned before it is cleared.
        this.migrationPromise = null;
        throw error;
      });
    return this.migrationPromise;
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (this.memory) return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;
    const opening = new Promise<IDBDatabase | null>((resolve, reject) => {
      const release = () => {
        if (this.dbPromise === opening) this.dbPromise = null;
      };
      let abandoned = false;
      try {
        const request = indexedDB.open(this.dbName, DB_VERSION);
        request.onblocked = () => {
          if (abandoned) return;
          abandoned = true;
          reject(new Error('数据库升级被其他页面占用，请关闭其他 Lumina 页面后重试。'));
        };
        request.onupgradeneeded = () => {
          if (abandoned) {
            request.transaction?.abort();
            return;
          }
          const db = request.result;
          if (!db.objectStoreNames.contains('workbooks'))
            db.createObjectStore('workbooks', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('patches')) {
            const store = db.createObjectStore('patches', { keyPath: 'key' });
            store.createIndex('by-workbook', 'workbookId', { unique: false });
          }
          if (!db.objectStoreNames.contains('revisions'))
            db.createObjectStore('revisions', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('comments'))
            db.createObjectStore('comments', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('meta'))
            db.createObjectStore('meta', { keyPath: 'key' });
        };
        request.onerror = () => {
          if (abandoned) return;
          if (request.error?.name === 'VersionError') {
            reject(new Error('数据库已被较新版本升级，请更新或刷新 Lumina 后重试。'));
            return;
          }
          if (this.hasOpenedDatabase) {
            reject(new Error('数据库重新连接失败，请重试；原有数据未切换到内存存储。'));
            return;
          }
          this.memory = this.memory ?? createMemoryState();
          resolve(null);
        };
        request.onsuccess = () => {
          const db = request.result;
          if (abandoned) {
            db.close();
            return;
          }
          this.hasOpenedDatabase = true;
          db.onversionchange = () => {
            release();
            db.close();
          };
          db.onclose = release;
          resolve(db);
        };
      } catch {
        if (this.hasOpenedDatabase) {
          reject(new Error('数据库重新连接失败，请重试；原有数据未切换到内存存储。'));
          return;
        }
        this.memory = this.memory ?? createMemoryState();
        resolve(null);
      }
    });
    this.dbPromise = opening;
    // Also clear synchronous open failures, after the promise has been assigned.
    void opening.catch(() => {
      if (this.dbPromise === opening) this.dbPromise = null;
    });
    return opening;
  }

  private readLegacyList<T>(key: string): T[] | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(key);
      const value: unknown = raw ? JSON.parse(raw) : null;
      // Corrupt auxiliary containers must not abort workbook migration or be
      // persisted as lists. Keep the untouched legacy source available to recovery.
      return Array.isArray(value) ? (value as T[]) : null;
    } catch {
      return null;
    }
  }

  private migrateLegacyAuxiliary(workbookId: string): void {
    const revisions = this.readLegacyList<Revision>(`${PREFIX}.history.${workbookId}`);
    if (revisions && !this.memory?.revisions.has(workbookId))
      this.memory?.revisions.set(workbookId, clone(revisions.slice(0, 20)));
    const comments = this.readLegacyList<Comment>(`${PREFIX}.comments.${workbookId}`);
    if (comments && !this.memory?.comments.has(workbookId))
      this.memory?.comments.set(workbookId, clone(comments));
  }

  private async idbGetAllWorkbooks(): Promise<Workbook[]> {
    const db = await this.openDb();
    if (!db) return [];
    const rows = await this.request<WorkbookRow[]>(
      db.transaction('workbooks').objectStore('workbooks').getAll(),
    );
    return rows.map((row) =>
      clone(row && Object.prototype.hasOwnProperty.call(row, 'workbook') ? row.workbook : row),
    ) as Workbook[];
  }

  private async idbGetWorkbook(workbookId: string): Promise<Workbook | null> {
    const db = await this.openDb();
    if (!db) return null;
    const row = await this.request<WorkbookRow | undefined>(
      db.transaction('workbooks').objectStore('workbooks').get(workbookId),
    );
    return row ? clone(row.workbook) : null;
  }

  private async idbGetAllPatches(): Promise<QueuedPatch[]> {
    const db = await this.openDb();
    if (!db) return [];
    return this.request<QueuedPatch[]>(db.transaction('patches').objectStore('patches').getAll());
  }

  private async idbGetPatches(workbookId: string): Promise<QueuedPatch[]> {
    const db = await this.openDb();
    if (!db) return [];
    const store = db.transaction('patches').objectStore('patches');
    const index = store.index('by-workbook');
    return this.request<QueuedPatch[]>(index.getAll(workbookId));
  }

  private transaction(
    db: IDBDatabase,
    stores: string[],
    mode: IDBTransactionMode,
    setup: (tx: IDBTransaction) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction | undefined;
      try {
        tx = db.transaction(stores, mode);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx?.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx?.error ?? new Error('IndexedDB transaction aborted'));
        setup(tx);
      } catch (error) {
        // A synchronous setup/DataClone error after earlier puts must not let
        // the still-active transaction commit a partial snapshot batch.
        try {
          tx?.abort();
        } catch {
          // An already inactive transaction cannot be aborted again.
        }
        reject(error);
      }
    });
  }

  private request<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  }
}

let defaultPersistence: LuminaPersistence | null = null;

/** Shared browser instance for the app. Keeping it module-local avoids one DB connection per edit. */
export function getPersistence(options?: PersistenceOptions): LuminaPersistence {
  if (!defaultPersistence || options) defaultPersistence = new LuminaPersistence(options);
  return defaultPersistence;
}

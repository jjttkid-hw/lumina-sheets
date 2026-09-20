import type { Cell, Comment, Revision, Workbook } from './types';

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
  return `${record.workbookId}:${record.seq}`;
}

/** Apply a patch while rebuilding only the affected sheet/cell. This is used during startup
 * replay and by tests; the editor can keep its own immutable state and only enqueue the patch. */
export function applyWorkbookPatch(workbook: Workbook, patch: WorkbookPatch): Workbook {
  const sheetIndex = workbook.sheets.findIndex((sheet) => sheet.id === patch.sheetId);
  if (sheetIndex < 0) return workbook;
  const sourceSheet = workbook.sheets[sheetIndex];
  const cells = { ...sourceSheet.cells };
  const nextSheet = { ...sourceSheet, cells };
  if (patch.kind === 'cell') {
    if (patch.cell === null) delete cells[patch.key];
    else cells[patch.key] = clone(patch.cell);
  } else {
    Object.assign(nextSheet, clone(patch.changes));
  }
  const sheets = workbook.sheets.slice();
  sheets[sheetIndex] = nextSheet;
  return { ...workbook, sheets };
}

function applyPatches(workbook: Workbook, patches: QueuedPatch[]): Workbook {
  let next = workbook;
  for (const record of patches.sort((a, b) => a.seq - b.seq))
    next = applyWorkbookPatch(next, record.patch);
  return next;
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
    const transaction = this.undoStack.pop();
    if (!transaction) return null;
    let next = workbook;
    for (const patch of [...transaction.inverse].reverse()) next = applyWorkbookPatch(next, patch);
    this.redoStack.push(transaction);
    return { workbook: next, transaction };
  }

  redo(workbook: Workbook): HistoryResult | null {
    const transaction = this.redoStack.pop();
    if (!transaction) return null;
    let next = workbook;
    for (const patch of transaction.forward) next = applyWorkbookPatch(next, patch);
    this.undoStack.push(transaction);
    return { workbook: next, transaction };
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
  private pending: QueuedPatch[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  // Millisecond epoch makes journal keys unique across tabs/processes while preserving
  // deterministic ordering for patches emitted by this editor instance.
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
      pendingPatches: this.pending.length,
      persistedPatches: this.persistedPatches,
      lastFlushAt: this.lastFlushAt,
      backend: this.memory ? 'memory' : 'indexeddb',
    };
  }

  /** Load all books and replay pending patches. The old localStorage format is migrated once. */
  async loadWorkbooks(): Promise<Workbook[]> {
    await this.migrateLegacy();
    const base = this.memory
      ? [...this.memory.workbooks.values()]
      : await this.idbGetAllWorkbooks();
    const allPatches = this.memory
      ? [...this.memory.patches.values()].flat()
      : await this.idbGetAllPatches();
    // Include edits waiting for the debounce timer so callers always observe their own writes.
    allPatches.push(...this.pending);
    const byBook = new Map<string, QueuedPatch[]>();
    for (const patch of allPatches) {
      const list = byBook.get(patch.workbookId) ?? [];
      list.push(patch);
      byBook.set(patch.workbookId, list);
    }
    return base.map((book) => applyPatches(book, byBook.get(book.id) ?? []));
  }

  async loadWorkbook(workbookId: string): Promise<Workbook | null> {
    await this.migrateLegacy();
    const base = this.memory
      ? this.memory.workbooks.get(workbookId)
      : await this.idbGetWorkbook(workbookId);
    if (!base) return null;
    const patches = this.memory
      ? [...(this.memory.patches.get(workbookId) ?? [])]
      : await this.idbGetPatches(workbookId);
    patches.push(...this.pending.filter((record) => record.workbookId === workbookId));
    return applyPatches(base, patches);
  }

  /** Write a full snapshot for imports, initial migration or explicit backup. */
  async putWorkbook(workbook: Workbook): Promise<void> {
    await this.migrateLegacy();
    const book = clone(workbook);
    this.discardPending(book.id);
    if (this.memory) {
      this.memory.workbooks.set(book.id, book);
      this.memory.patches.delete(book.id);
      return;
    }
    const db = await this.openDb();
    if (!db) return this.putWorkbookInMemory(book);
    await this.transaction(db, ['workbooks', 'patches'], 'readwrite', (tx) => {
      tx.objectStore('workbooks').put({ id: book.id, workbook: book } satisfies WorkbookRow);
      const request = tx.objectStore('patches').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value = cursor.value as QueuedPatch;
        if (value.workbookId === book.id) cursor.delete();
        cursor.continue();
      };
    });
  }

  async putWorkbooks(workbooks: Workbook[]): Promise<void> {
    await this.migrateLegacy();
    for (const workbook of workbooks) this.discardPending(workbook.id);
    if (this.memory) {
      for (const book of workbooks) {
        const copy = clone(book);
        this.memory.workbooks.set(copy.id, copy);
        this.memory.patches.delete(copy.id);
      }
      return;
    }
    const db = await this.openDb();
    if (!db) {
      for (const book of workbooks) this.putWorkbookInMemory(clone(book));
      return;
    }
    await this.transaction(db, ['workbooks', 'patches'], 'readwrite', (tx) => {
      const store = tx.objectStore('workbooks');
      for (const workbook of workbooks)
        store.put({ id: workbook.id, workbook: clone(workbook) } satisfies WorkbookRow);
      // Base snapshots supersede all patches for these books.
      const ids = new Set(workbooks.map((book) => book.id));
      const request = tx.objectStore('patches').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (ids.has((cursor.value as QueuedPatch).workbookId)) cursor.delete();
        cursor.continue();
      };
    });
  }

  /** Queue a tiny edit. It returns immediately; writes are coalesced into one transaction. */
  queuePatch(workbookId: string, patch: WorkbookPatch): void {
    const record: QueuedPatch = {
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
    this.flushPromise = Promise.resolve().then(async () => {
      try {
        // queuePatch can auto-start a flush at 500 entries while its caller is
        // still enqueuing a larger batch. Drain every batch that arrives before
        // completion so the awaited promise cannot leave an unsaved tail.
        while (this.pending.length) {
          const batch = this.pending.splice(0);
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
        }
      } finally {
        this.flushPromise = null;
      }
    });
    return this.flushPromise;
  }

  /** Compact patches into the supplied current workbook and remove its journal. */
  async compact(workbook: Workbook): Promise<void> {
    await this.flush();
    await this.putWorkbook(workbook);
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
    if (this.memory) return clone(this.memory.revisions.get(workbookId) ?? []);
    const db = await this.openDb();
    if (!db) {
      const fallbackMemory = (this as unknown as { memory: MemoryState | null }).memory;
      return clone(fallbackMemory?.revisions.get(workbookId) ?? []);
    }
    const row = await this.request<RevisionRow | undefined>(
      db.transaction('revisions').objectStore('revisions').get(workbookId),
    );
    return clone(row?.revisions ?? []);
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
    if (this.memory) return clone(this.memory.comments.get(workbookId) ?? []);
    const db = await this.openDb();
    if (!db) {
      const fallbackMemory = (this as unknown as { memory: MemoryState | null }).memory;
      return clone(fallbackMemory?.comments.get(workbookId) ?? []);
    }
    const row = await this.request<CommentRow | undefined>(
      db.transaction('comments').objectStore('comments').get(workbookId),
    );
    return clone(row?.comments ?? []);
  }

  async close(): Promise<void> {
    await this.flush();
    if (this.dbPromise) (await this.dbPromise)?.close();
  }

  private putWorkbookInMemory(book: Workbook): void {
    // This path is only reached when indexedDB disappears during a session.
    if (!this.memory) return;
    this.memory.workbooks.set(book.id, clone(book));
    this.memory.patches.delete(book.id);
  }

  private discardPending(workbookId: string): void {
    if (!this.pending.some((record) => record.workbookId === workbookId)) return;
    this.pending = this.pending.filter((record) => record.workbookId !== workbookId);
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
          books = value as Workbook[];
        } catch {
          return;
        }
        // Do not repeatedly parse or write the legacy payload. The source remains as a recovery
        // backup until the user clears browser data. The marker lives in IndexedDB so a stale
        // localStorage snapshot can never overwrite edits after a browser restart.
        if (this.memory) {
          for (const book of books)
            if (book && typeof book.id === 'string')
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
                const store = tx.objectStore('workbooks');
                for (const book of books)
                  if (book && typeof book.id === 'string')
                    store.put({ id: book.id, workbook: clone(book) } satisfies WorkbookRow);
                const revisions = tx.objectStore('revisions');
                const comments = tx.objectStore('comments');
                for (const book of books) {
                  if (!book || typeof book.id !== 'string') continue;
                  const oldRevisions = this.readLegacy<Revision[]>(`${PREFIX}.history.${book.id}`);
                  if (oldRevisions)
                    revisions.put({
                      key: book.id,
                      workbookId: book.id,
                      revisions: oldRevisions.slice(0, 20),
                    } satisfies RevisionRow);
                  const oldComments = this.readLegacy<Comment[]>(`${PREFIX}.comments.${book.id}`);
                  if (oldComments)
                    comments.put({
                      key: book.id,
                      workbookId: book.id,
                      comments: oldComments,
                    } satisfies CommentRow);
                }
                tx.objectStore('meta').put({
                  key: 'legacy-v1-migrated',
                  value: true,
                } satisfies MetaRow);
              },
            );
          } else {
            const memory = this.memory ?? createMemoryState();
            this.memory = memory;
            for (const book of books)
              if (book && typeof book.id === 'string') memory.workbooks.set(book.id, clone(book));
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
    this.dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(this.dbName, DB_VERSION);
        request.onupgradeneeded = () => {
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
          this.memory = this.memory ?? createMemoryState();
          resolve(null);
        };
        request.onsuccess = () => resolve(request.result);
      } catch {
        this.memory = this.memory ?? createMemoryState();
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  private readLegacy<T>(key: string): T | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private migrateLegacyAuxiliary(workbookId: string): void {
    const revisions = this.readLegacy<Revision[]>(`${PREFIX}.history.${workbookId}`);
    if (revisions) this.memory?.revisions.set(workbookId, clone(revisions.slice(0, 20)));
    const comments = this.readLegacy<Comment[]>(`${PREFIX}.comments.${workbookId}`);
    if (comments) this.memory?.comments.set(workbookId, clone(comments));
  }

  private async idbGetAllWorkbooks(): Promise<Workbook[]> {
    const db = await this.openDb();
    if (!db) return [];
    const rows = await this.request<WorkbookRow[]>(
      db.transaction('workbooks').objectStore('workbooks').getAll(),
    );
    return rows.map((row) => clone(row.workbook));
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
      let tx: IDBTransaction;
      try {
        tx = db.transaction(stores, mode);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        setup(tx);
      } catch (error) {
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

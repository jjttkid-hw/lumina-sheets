import { describe, expect, it, vi } from 'vitest';
import {
  applyWorkbookPatch,
  applyWorkbookPatches,
  LuminaPersistence,
  PatchHistory,
  type WorkbookPatch,
  type QueuedPatch,
} from '../src/lib/persistence';
import { createBlankWorkbook } from '../src/lib/seed';
import { WorkspaceSaveQueue } from '../src/lib/workspace-save';
import type { Workbook } from '../src/lib/types';

const cell = (sheetId: string, key: string, value: number | null): WorkbookPatch => ({
  kind: 'cell',
  sheetId,
  key,
  cell: value === null ? null : { value },
});
const memory = () =>
  new LuminaPersistence({
    forceMemory: true,
    flushDelayMs: 60_000,
    storage: { getItem: () => null, setItem: () => {} },
  });

describe('batched journal replay', () => {
  it.each([
    { kind: 'unknown', changes: { name: 'silently renamed' } },
    { kind: 'cell', key: 'A1' },
    { kind: 'cell', key: '__proto__', cell: { value: 1 } },
    { kind: 'sheet-meta', changes: null },
    { kind: 'sheet-meta', changes: [] },
  ])('rejects malformed patch shape before changing a workbook: %s', (bad) => {
    const book = createBlankWorkbook();
    const before = structuredClone(book);
    expect(() =>
      applyWorkbookPatches(book, [
        cell(book.sheets[0].id, 'A1', 5),
        { ...bad, sheetId: book.sheets[0].id } as WorkbookPatch,
      ]),
    ).toThrow('Invalid workbook patch');
    expect(book).toEqual(before);
    const p = memory();
    expect(() =>
      p.queuePatch(book.id, { ...bad, sheetId: book.sheets[0].id } as WorkbookPatch),
    ).toThrow('Invalid workbook patch');
    expect(p.stats.pendingPatches).toBe(0);
  });
  it('retains distinct same-sequence edits and deduplicates retries by identity, including legacy records', async () => {
    const p = memory(),
      book = createBlankWorkbook();
    await p.putWorkbook(book);
    const record = (operationId: string | undefined, key: string, value: number) => ({
      operationId,
      workbookId: book.id,
      seq: 7,
      at: 0,
      patch: cell(book.sheets[0].id, key, value),
    });
    const journal = [
      record('b', 'B1', 2),
      record('a', 'A1', 1),
      record(undefined, 'C1', 3),
      record('a', 'A1', 1),
    ];
    (p as any).memory.patches.set(book.id, journal);
    expect((await p.loadWorkbook(book.id))!.sheets[0].cells).toEqual({
      A1: { value: 1 },
      B1: { value: 2 },
      C1: { value: 3 },
    });
    (p as any).memory.patches.set(book.id, [record('b', 'A1', 2), record('a', 'A1', 1)]);
    expect((await p.loadWorkbook(book.id))!.sheets[0].cells.A1.value).toBe(2);
    (p as any).memory.patches.get(book.id).reverse();
    expect((await p.loadWorkbooks())[0].sheets[0].cells.A1.value).toBe(2);
    await p.close();
  });
  it('writes distinct journal keys from separate adapters with identical sequences', async () => {
    const book = createBlankWorkbook();
    const rows = new Map<string, any>();
    const instances = [memory(), memory()];
    for (const [i, p] of instances.entries()) {
      const internal = p as any;
      internal.memory = null;
      internal.seq = 10;
      vi.spyOn(internal, 'openDb').mockResolvedValue({});
      vi.spyOn(internal, 'transaction').mockImplementation(
        async (_db, _stores, _mode, setup: any) => {
          setup({ objectStore: () => ({ put: (row: any) => rows.set(row.key, row) }) });
        },
      );
      p.queuePatch(book.id, cell(book.sheets[0].id, `A${i + 1}`, i));
      await p.flush();
    }
    expect(rows.size).toBe(2);
    expect(new Set([...rows.values()].map((row) => row.seq)).size).toBe(1);
    expect(new Set([...rows.values()].map((row) => row.operationId)).size).toBe(2);
    await Promise.all(instances.map((p) => p.close()));
  });
  it('matches sequential semantics across sheets, deletions, metadata and repeated addresses', () => {
    const book = createBlankWorkbook();
    const id = book.sheets[0].id;
    book.sheets.push({ ...structuredClone(book.sheets[0]), id: 'other' });
    const patches: WorkbookPatch[] = [
      cell(id, 'A1', 1),
      cell('other', 'B2', 2),
      cell(id, 'A1', null),
      { kind: 'sheet-meta', sheetId: id, changes: { rowCount: 500, hiddenRows: [3] } },
      cell(id, 'A1', 3),
      cell('missing', 'A1', 99),
      { kind: 'sheet-meta', sheetId: id, changes: { hiddenRows: [], frozenRows: 2 } },
      cell('other', 'B2', null),
      cell('other', 'C3', 5),
    ];
    const before = structuredClone(book),
      inputs = structuredClone(patches);
    const expected = patches.reduce(applyWorkbookPatch, book);
    const result = applyWorkbookPatches(book, patches);
    expect(result).toEqual(expected);
    expect(result.sheets[0]).toMatchObject({ rowCount: 500, hiddenRows: [], frozenRows: 2 });
    expect(result.sheets[0].cells.A1.value).toBe(3);
    expect(result.sheets[1].cells.B2).toBeUndefined();
    expect(book).toEqual(before);
    expect(patches).toEqual(inputs);
  });

  it('enumerates each affected cell dictionary once for 5000 patches, never an untouched sheet', () => {
    const book = createBlankWorkbook();
    let enumerations = 0;
    book.sheets[0].cells = new Proxy(
      { A1: { value: 'base' } },
      {
        ownKeys(target) {
          enumerations++;
          return Reflect.ownKeys(target);
        },
      },
    );
    const other = {
      ...book.sheets[0],
      id: 'untouched',
      cells: new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('untouched cells enumerated');
          },
        },
      ),
    };
    book.sheets.push(other);
    const result = applyWorkbookPatches(
      book,
      Array.from({ length: 5000 }, (_, i) => cell(book.sheets[0].id, `A${i + 1}`, i)),
    );
    expect(enumerations).toBe(1);
    expect(result.sheets[0].cells.A5000.value).toBe(4999);
    expect(result.sheets[1]).toBe(other);
    expect(book.sheets[0].cells.A1.value).toBe('base');
  });

  it('does not read any cells for metadata-only batches and returns the original for unknown sheets', () => {
    const book = createBlankWorkbook();
    const cells = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('enumeration');
        },
        get() {
          throw new Error('read');
        },
      },
    );
    book.sheets[0].cells = cells;
    const result = applyWorkbookPatches(book, [
      { kind: 'sheet-meta', sheetId: book.sheets[0].id, changes: { hiddenColumns: [2] } },
      { kind: 'sheet-meta', sheetId: book.sheets[0].id, changes: { rowCount: 1_048_576 } },
    ]);
    expect(result.sheets[0].cells).toBe(cells);
    expect(applyWorkbookPatches(book, [])).toBe(book);
    expect(applyWorkbookPatches(book, [cell('absent', 'A1', 1)])).toBe(book);
  });

  it('isolates changed cells and metadata from input patches and does not partially mutate on failure', () => {
    const book = createBlankWorkbook();
    const id = book.sheets[0].id;
    const input: WorkbookPatch[] = [
      { kind: 'cell', sheetId: id, key: 'A1', cell: { value: 2, style: { bold: true } } },
      { kind: 'sheet-meta', sheetId: id, changes: { hiddenRows: [2] } },
    ];
    const result = applyWorkbookPatches(book, input);
    result.sheets[0].cells.A1.style!.bold = false;
    result.sheets[0].hiddenRows!.push(5);
    expect(input[0]).toMatchObject({ cell: { style: { bold: true } } });
    expect(input[1]).toMatchObject({ changes: { hiddenRows: [2] } });
    const before = structuredClone(book);
    expect(() =>
      applyWorkbookPatches(book, [
        ...input,
        { kind: 'cell', sheetId: id, key: 'B1', cell: { value: (() => {}) as never } },
      ]),
    ).toThrow();
    expect(book).toEqual(before);
  });

  it.each([false, true])(
    'memory loads cannot mutate stored snapshots or unrelated cells (journal=%s)',
    async (journal) => {
      const persistence = memory(),
        book = createBlankWorkbook();
      book.sheets[0].cells.A1 = { value: 'stored', style: { bold: true } };
      book.sheets[0].printSettings = { paperSize: 'A4' };
      await persistence.putWorkbook(book);
      if (journal) {
        persistence.queuePatch(book.id, cell(book.sheets[0].id, 'B1', 42));
        await persistence.flush();
      }
      const first = (await persistence.loadWorkbook(book.id))!;
      first.name = 'mutated';
      first.sheets[0].cells.A1.style!.bold = false;
      first.sheets[0].printSettings!.paperSize = 'A3';
      first.sheets.push({ ...first.sheets[0], id: 'extra' });
      const all = await persistence.loadWorkbooks();
      expect(all[0].name).toBe(book.name);
      expect(all[0].sheets).toHaveLength(1);
      expect(all[0].sheets[0].cells.A1.style!.bold).toBe(true);
      expect(all[0].sheets[0].printSettings!.paperSize).toBe('A4');
      all[0].sheets[0].cells.A1.value = 'again';
      expect((await persistence.loadWorkbook(book.id))!.sheets[0].cells.A1.value).toBe('stored');
      expect(await persistence.loadWorkbook('absent')).toBeNull();
      await persistence.close();
    },
  );

  it('batch history reverses duplicate addresses, isolates returned transactions, and retains failed undo', () => {
    const book = createBlankWorkbook(),
      id = book.sheets[0].id;
    const history = new PatchHistory();
    const forward = [cell(id, 'A1', 1), cell(id, 'A1', 2)];
    history.push({ forward, inverse: [cell(id, 'A1', null), cell(id, 'A1', 1)] });
    const edited = applyWorkbookPatches(book, forward);
    const broken = {
      ...edited,
      sheets: [
        {
          ...edited.sheets[0],
          cells: new Proxy(
            {},
            {
              ownKeys() {
                throw new Error('copy failed');
              },
            },
          ),
        },
      ],
    };
    expect(() => history.undo(broken)).toThrow('copy failed');
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    const undone = history.undo(edited)!;
    expect(undone.workbook.sheets[0].cells.A1).toBeUndefined();
    undone.transaction.forward.length = 0;
    const redone = history.redo(undone.workbook)!;
    expect(redone.workbook.sheets[0].cells.A1.value).toBe(2);
    redone.transaction.inverse.length = 0;
    expect(history.undo(redone.workbook)!.workbook.sheets[0].cells.A1).toBeUndefined();
  });
});

function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Substitute only the IndexedDB boundary, retaining the real queue/flush/replay code.
function failingJournal(book: Workbook) {
  const persistence = memory();
  const internal = persistence as unknown as {
    memory: null;
    openDb(): Promise<IDBDatabase>;
    transaction(
      db: IDBDatabase,
      stores: string[],
      mode: string,
      setup: (tx: IDBTransaction) => void,
    ): Promise<void>;
    idbGetWorkbook(id: string): Promise<Workbook>;
    idbGetAllWorkbooks(): Promise<Workbook[]>;
    idbGetPatches(id: string): Promise<QueuedPatch[]>;
    idbGetAllPatches(): Promise<QueuedPatch[]>;
  };
  internal.memory = null;
  vi.spyOn(internal, 'openDb').mockResolvedValue({} as IDBDatabase);
  vi.spyOn(internal, 'idbGetWorkbook').mockImplementation(async () => structuredClone(book));
  vi.spyOn(internal, 'idbGetAllWorkbooks').mockImplementation(async () => [structuredClone(book)]);
  const saved = new Map<number, QueuedPatch>();
  vi.spyOn(internal, 'idbGetPatches').mockImplementation(async () =>
    structuredClone([...saved.values()]),
  );
  vi.spyOn(internal, 'idbGetAllPatches').mockImplementation(async () =>
    structuredClone([...saved.values()]),
  );
  const gate = deferred(),
    entered = deferred();
  let first = true;
  const batches: QueuedPatch[][] = [];
  const transaction = vi
    .spyOn(internal, 'transaction')
    .mockImplementation(async (_db, _stores, _mode, setup) => {
      const batch: QueuedPatch[] = [];
      setup({
        objectStore: () => ({ put: (record: QueuedPatch) => batch.push(structuredClone(record)) }),
      } as unknown as IDBTransaction);
      batches.push(batch);
      if (first) {
        first = false;
        entered.resolve();
        await gate.promise;
      }
      for (const record of batch) saved.set(record.seq, record);
    });
  return { persistence, gate, entered, batches, saved, transaction };
}

describe('journal write recovery', () => {
  it('rejects exhausted journal sequence capacity without enqueueing or overwriting records', async () => {
    const book = createBlankWorkbook();
    const { persistence, saved } = failingJournal(book);
    saved.set(Number.MAX_SAFE_INTEGER, {
      workbookId: book.id,
      seq: Number.MAX_SAFE_INTEGER,
      at: 0,
      patch: cell(book.sheets[0].id, 'A1', 10),
    });
    await persistence.loadWorkbooks();
    expect(() => persistence.queuePatch(book.id, cell(book.sheets[0].id, 'A1', 20))).toThrow(
      'capacity',
    );
    expect(persistence.stats.pendingPatches).toBe(0);
    expect((await persistence.loadWorkbook(book.id))!.sheets[0].cells.A1.value).toBe(10);
  });
  it.each(['single', 'all'] as const)(
    'orders new edits after observed stored sequences on %s reads even when the clock went backward',
    async (mode) => {
      const book = createBlankWorkbook();
      const { persistence, saved } = failingJournal(book);
      const future = Date.now() * 1000 + 1_000_000;
      saved.set(future, {
        workbookId: book.id,
        seq: future,
        at: 0,
        patch: cell(book.sheets[0].id, 'A1', 10),
      });
      if (mode === 'single') await persistence.loadWorkbook(book.id);
      else await persistence.loadWorkbooks();
      persistence.queuePatch(book.id, cell(book.sheets[0].id, 'A1', 20));
      expect((await persistence.loadWorkbook(book.id))!.sheets[0].cells.A1.value).toBe(20);
      expect((persistence as any).pending[0].seq).toBeGreaterThan(future);
      // No writes are necessary to verify replay; clear the delayed flush timer.
      clearTimeout((persistence as any).flushTimer);
    },
  );
  it('replays an unsorted persisted journal before pending edits by sequence', async () => {
    const book = createBlankWorkbook(),
      id = book.sheets[0].id;
    const { persistence, saved } = failingJournal(book);
    const record = (seq: number, value: number): QueuedPatch => ({
      seq,
      workbookId: book.id,
      at: 0,
      patch: cell(id, 'A1', value),
    });
    saved.set(3, record(3, 30));
    saved.set(1, record(1, 10));
    saved.set(2, record(2, 20));
    expect((await persistence.loadWorkbook(book.id))!.sheets[0].cells.A1.value).toBe(30);
    expect((await persistence.loadWorkbooks())[0].sheets[0].cells.A1.value).toBe(30);
  });

  it('keeps automatically flushed failures available for explicit retry', async () => {
    vi.useFakeTimers();
    const book = createBlankWorkbook(),
      id = book.sheets[0].id;
    const { persistence, gate, entered } = failingJournal(book);
    try {
      persistence.queuePatch(book.id, cell(id, 'A1', 12));
      await vi.advanceTimersByTimeAsync(60_000);
      await entered.promise;
      const rejected = expect(persistence.flush()).rejects.toThrow('unavailable');
      gate.reject(new Error('unavailable'));
      await rejected;
      expect(persistence.stats.pendingPatches).toBe(1);
      expect((await persistence.loadWorkbook(book.id))!.sheets[0].cells.A1.value).toBe(12);
      await persistence.flush();
      expect(persistence.stats.pendingPatches).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('cooperates with workspace retry replay without overwriting a newer queued edit', async () => {
    const book = createBlankWorkbook(),
      id = book.sheets[0].id;
    const { persistence, gate, entered } = failingJournal(book);
    const queue = new WorkspaceSaveQueue(persistence);
    const writing = queue.patches(book.id, [cell(id, 'A1', 1), cell(id, 'B1', 10)]);
    const rejected = expect(writing).rejects.toThrow('retry');
    queue.patches(book.id, [cell(id, 'A1', 2)]);
    await entered.promise;
    gate.reject(new Error('retry'));
    await rejected;
    expect(persistence.stats.pendingPatches).toBe(2);
    await queue.flush();
    expect((await persistence.loadWorkbook(book.id))!.sheets[0].cells).toMatchObject({
      A1: { value: 2 },
      B1: { value: 10 },
    });
    expect(persistence.stats.pendingPatches).toBe(0);
    // Workspace retry may replay assignments whose completion was uncertain;
    // replay is idempotent and later jobs remain later in the journal.
    await persistence.close();
  });

  it('retains the failed active batch ahead of newer edits and retries with the same journal identities', async () => {
    const book = createBlankWorkbook(),
      id = book.sheets[0].id;
    const { persistence, gate, entered, batches } = failingJournal(book);
    persistence.queuePatch(book.id, cell(id, 'A1', 1));
    const writing = persistence.flush();
    const rejected = expect(writing).rejects.toThrow('quota');
    await entered.promise;
    expect(persistence.stats.pendingPatches).toBe(1);
    expect((await persistence.loadWorkbook(book.id))!.sheets[0].cells.A1.value).toBe(1);
    persistence.queuePatch(book.id, cell(id, 'A1', 2));
    expect((await persistence.loadWorkbooks())[0].sheets[0].cells.A1.value).toBe(2);
    gate.reject(new Error('quota'));
    await rejected;
    expect(persistence.stats).toMatchObject({
      pendingPatches: 2,
      persistedPatches: 0,
      lastFlushAt: null,
    });
    expect((await persistence.loadWorkbook(book.id))!.sheets[0].cells.A1.value).toBe(2);
    await persistence.flush();
    expect(batches[1][0]).toEqual(batches[0][0]);
    expect(batches[1][0].seq).toBeLessThan(batches[1][1].seq);
    expect(persistence.stats).toMatchObject({ pendingPatches: 0, persistedPatches: 2 });
    expect((await persistence.loadWorkbook(book.id))!.sheets[0].cells.A1.value).toBe(2);
  });

  it('drains edits that arrive during a successful write and exposes the active batch until completion', async () => {
    const book = createBlankWorkbook(),
      id = book.sheets[0].id;
    const { persistence, gate, entered, batches } = failingJournal(book);
    persistence.queuePatch(book.id, cell(id, 'A1', 10));
    const writing = persistence.flush();
    await entered.promise;
    persistence.queuePatch(book.id, cell(id, 'B1', 20));
    expect(persistence.stats.pendingPatches).toBe(2);
    expect((await persistence.loadWorkbooks())[0].sheets[0].cells).toMatchObject({
      A1: { value: 10 },
      B1: { value: 20 },
    });
    gate.resolve();
    await writing;
    expect(batches).toHaveLength(2);
    expect(persistence.stats).toMatchObject({ pendingPatches: 0, persistedPatches: 2 });
    await persistence.flush();
  });
});

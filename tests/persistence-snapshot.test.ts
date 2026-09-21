import { describe, expect, it, vi } from 'vitest';
import { LuminaPersistence } from '../src/lib/persistence';
import { createBlankWorkbook } from '../src/lib/seed';
const memory = () =>
  new LuminaPersistence({
    forceMemory: true,
    flushDelayMs: 60000,
    storage: { getItem: () => null, setItem() {} },
  });
function deferred() {
  let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe('snapshot commit boundaries', () => {
  it('captures compaction input immediately and retains edits queued while it waits', async () => {
    const p = memory(),
      book = createBlankWorkbook(),
      other = createBlankWorkbook();
    await p.putWorkbooks([book, other]);
    p.queueCellPatch(book.id, book.sheets[0].id, 'A1', { value: 'before' });
    const snapshot = structuredClone(book);
    snapshot.sheets[0].cells.A1 = { value: 'snapshot' };
    const gate = deferred();
    (p as any).snapshotTail = gate.promise;
    const compacting = p.compact(snapshot);
    snapshot.name = 'late mutation';
    snapshot.sheets[0].cells.A1.value = 'late mutation';
    p.queueCellPatch(book.id, book.sheets[0].id, 'B1', { value: 'later' });
    p.queueCellPatch(other.id, other.sheets[0].id, 'A1', { value: 'other' });
    gate.resolve();
    await compacting;
    const result = (await p.loadWorkbook(book.id))!;
    expect(result.name).toBe(book.name);
    expect(result.sheets[0].cells).toEqual({ A1: { value: 'snapshot' }, B1: { value: 'later' } });
    expect((await p.loadWorkbook(other.id))!.sheets[0].cells.A1.value).toBe('other');
    expect(p.stats.pendingPatches).toBe(0);
    await p.close();
  });
  it('aborts an IndexedDB transaction if setup throws after an earlier write', async () => {
    const p = memory();
    const abort = vi.fn();
    const tx = { abort, error: null };
    const db = { transaction: () => tx };
    const write = vi.fn();
    await expect(
      (p as any).transaction(db, ['workbooks'], 'readwrite', () => {
        write();
        throw new Error('clone failed');
      }),
    ).rejects.toThrow('clone failed');
    expect(write).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
    await p.close();
  });
  it('deletes only the replaced workbook journal up to the captured sequence on commit', async () => {
    const p = memory(),
      book = createBlankWorkbook(),
      other = createBlankWorkbook();
    await p.putWorkbook(book);
    const internal = p as any,
      state = internal.memory;
    p.queueCellPatch(book.id, book.sheets[0].id, 'A1', { value: 1 });
    const cutoff = internal.seq;
    internal.memory = null;
    vi.spyOn(internal, 'openDb').mockResolvedValue({});
    const deleted: number[] = [],
      writes: unknown[] = [];
    const journal = [
      { workbookId: book.id, seq: cutoff },
      { workbookId: book.id, seq: cutoff + 1 },
      { workbookId: other.id, seq: cutoff - 1 },
    ];
    vi.spyOn(internal, 'transaction').mockImplementation(
      async (_db, _stores, _mode, setup: any) => {
        let index = 0;
        const request: any = { result: null, onsuccess: null };
        const next = () => {
          const record = journal[index++];
          request.result = record
            ? { value: record, delete: () => deleted.push(record.seq), continue: next }
            : null;
          request.onsuccess();
        };
        setup({
          objectStore: (name: string) =>
            name === 'workbooks'
              ? { put: (value: unknown) => writes.push(value) }
              : { openCursor: () => request },
        });
        next();
      },
    );
    await p.putWorkbook(book);
    expect(deleted).toEqual([cutoff]);
    expect(writes).toEqual([{ id: book.id, workbook: book }]);
    expect(p.stats.pendingPatches).toBe(0);
    internal.memory = state;
    await p.close();
  });
  it('waits for a queued snapshot before close completes', async () => {
    const p = memory(),
      book = createBlankWorkbook();
    const gate = deferred();
    (p as any).snapshotTail = gate.promise;
    const saving = p.putWorkbook(book);
    let closed = false;
    const closing = p.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    gate.resolve();
    await Promise.all([saving, closing]);
    expect((await p.loadWorkbook(book.id))!.id).toBe(book.id);
  });
  it('captures input at invocation and retains later patches while replacing earlier ones', async () => {
    const p = memory(),
      book = createBlankWorkbook(),
      id = book.sheets[0].id;
    await p.putWorkbook(book);
    p.queueCellPatch(book.id, id, 'A1', { value: 'before' });
    const snapshot = structuredClone(book);
    snapshot.sheets[0].cells.A1 = { value: 'snapshot' };
    const saving = p.putWorkbook(snapshot);
    snapshot.sheets[0].cells.A1.value = 'caller mutation';
    p.queueCellPatch(book.id, id, 'B1', { value: 'after' });
    const flushing = p.flush();
    await Promise.all([saving, flushing]);
    expect((await p.loadWorkbook(book.id))!.sheets[0].cells).toEqual({
      A1: { value: 'snapshot' },
      B1: { value: 'after' },
    });
    await p.close();
  });
  it('clones an entire batch before changing any workbook or pending journal', async () => {
    const p = memory(),
      book = createBlankWorkbook();
    await p.putWorkbook(book);
    p.queueCellPatch(book.id, book.sheets[0].id, 'A1', { value: 'keep' });
    const other = createBlankWorkbook();
    (other as any).unsupported = () => {};
    const changed = { ...book, name: 'should not commit' };
    await expect(p.putWorkbooks([changed, other])).rejects.toThrow();
    const result = await p.loadWorkbook(book.id);
    expect(result!.name).toBe(book.name);
    expect(result!.sheets[0].cells.A1.value).toBe('keep');
    expect(await p.loadWorkbook(other.id)).toBeNull();
    await p.close();
  });
  it('rejects duplicate snapshot IDs before making changes', async () => {
    const p = memory(),
      book = createBlankWorkbook();
    await expect(p.putWorkbooks([book, book])).rejects.toThrow('unique');
    expect(await p.loadWorkbooks()).toEqual([]);
    await p.close();
  });
  it('preserves pending edits when a snapshot transaction fails, then supersedes only older edits on retry', async () => {
    const p = memory(),
      book = createBlankWorkbook(),
      id = book.sheets[0].id;
    await p.putWorkbook(book);
    const internal = p as any;
    const state = internal.memory;
    internal.memory = null;
    vi.spyOn(internal, 'openDb').mockResolvedValue({});
    vi.spyOn(internal, 'idbGetWorkbook').mockImplementation(async () => structuredClone(book));
    vi.spyOn(internal, 'idbGetPatches').mockResolvedValue([]);
    const entered = deferred(),
      finish = deferred();
    const transaction = vi.spyOn(internal, 'transaction').mockImplementation(async () => {
      entered.resolve();
      await finish.promise;
    });
    p.queueCellPatch(book.id, id, 'A1', { value: 'pending' });
    const snapshot = structuredClone(book);
    snapshot.sheets[0].cells.A1 = { value: 'snapshot' };
    const saving = p.putWorkbook(snapshot);
    const rejected = expect(saving).rejects.toThrow('quota');
    await entered.promise;
    p.queueCellPatch(book.id, id, 'B1', { value: 'later' });
    finish.reject(new Error('quota'));
    await rejected;
    expect(p.stats.pendingPatches).toBe(2);
    expect((await p.loadWorkbook(book.id))!.sheets[0].cells).toEqual({
      A1: { value: 'pending' },
      B1: { value: 'later' },
    });
    transaction.mockRestore();
    internal.memory = state;
    const retry = p.putWorkbook(snapshot);
    p.queueCellPatch(book.id, id, 'C1', { value: 'newest' });
    await retry;
    await p.flush();
    expect((await p.loadWorkbook(book.id))!.sheets[0].cells).toEqual({
      A1: { value: 'snapshot' },
      C1: { value: 'newest' },
    });
    await p.close();
  });
  it('serializes overlapping snapshots with flushes without replaying obsolete edits', async () => {
    const p = memory(),
      book = createBlankWorkbook(),
      id = book.sheets[0].id;
    await p.putWorkbook(book);
    p.queueCellPatch(book.id, id, 'A1', { value: 1 });
    const firstFlush = p.flush();
    const first = p.putWorkbook({ ...book, name: 'first' });
    p.queueCellPatch(book.id, id, 'B1', { value: 2 });
    const secondFlush = p.flush();
    const second = p.putWorkbook({ ...book, name: 'second' });
    p.queueCellPatch(book.id, id, 'C1', { value: 3 });
    await Promise.all([firstFlush, first, secondFlush, second]);
    await p.flush();
    const result = await p.loadWorkbook(book.id);
    expect(result!.name).toBe('second');
    expect(result!.sheets[0].cells).toEqual({ C1: { value: 3 } });
    await p.close();
  });
});

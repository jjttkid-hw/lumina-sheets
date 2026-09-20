import { describe, expect, it, vi } from 'vitest';
import { LuminaPersistence, type WorkbookPatch } from '../src/lib/persistence';
import { createBlankWorkbook } from '../src/lib/seed';
import { cellKey } from '../src/lib/engine';
import { WorkspaceSaveQueue } from '../src/lib/workspace-save';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function patch(sheetId: string, value: number): WorkbookPatch {
  return { kind: 'cell', sheetId, key: 'A1', cell: { value } };
}
function memory() {
  return new LuminaPersistence({
    forceMemory: true,
    flushDelayMs: 60_000,
    storage: {
      getItem: () => null,
      setItem: () => undefined,
    },
  });
}

describe('workspace ordered saves', () => {
  it('does not expose patches to persistence while a snapshot is still pending', async () => {
    const gate = deferred();
    const adapter = {
      putWorkbook: vi.fn(() => gate.promise),
      queuePatch: vi.fn(),
      flush: vi.fn(async () => {}),
    };
    const queue = new WorkspaceSaveQueue(adapter),
      book = createBlankWorkbook();
    const snapshot = queue.snapshot(book);
    await tick();
    expect(adapter.putWorkbook).toHaveBeenCalledTimes(1);
    const edits = queue.patches(book.id, [patch(book.sheets[0].id, 5)]);
    expect(edits).toBe(snapshot);
    expect(adapter.queuePatch).not.toHaveBeenCalled();
    let resolved = false;
    void snapshot.then(() => {
      resolved = true;
    });
    await tick();
    expect(resolved).toBe(false);
    gate.resolve();
    await edits;
    expect(adapter.queuePatch).toHaveBeenCalledExactlyOnceWith(
      book.id,
      patch(book.sheets[0].id, 5),
    );
    expect(adapter.flush).toHaveBeenCalledTimes(1);
  });

  it('serializes patch → snapshot → patch and waits for each adapter flush', async () => {
    const firstFlush = deferred(),
      calls: string[] = [];
    let flushes = 0;
    const adapter = {
      putWorkbook: vi.fn(async () => {
        calls.push('snapshot');
      }),
      queuePatch: vi.fn((_id, item: WorkbookPatch) => {
        calls.push(`patch:${item.kind === 'cell' ? item.cell?.value : 'meta'}`);
      }),
      flush: vi.fn(async () => {
        calls.push('flush');
        if (++flushes === 1) await firstFlush.promise;
      }),
    };
    const queue = new WorkspaceSaveQueue(adapter),
      book = createBlankWorkbook(),
      id = book.sheets[0].id;
    const saving = queue.patches(book.id, [patch(id, 1)]);
    queue.snapshot(book);
    queue.patches(book.id, [patch(id, 3)]);
    await tick();
    expect(calls).toEqual(['patch:1', 'flush']);
    firstFlush.resolve();
    await saving;
    expect(calls).toEqual(['patch:1', 'flush', 'snapshot', 'patch:3', 'flush']);
    await queue.flush();
    expect(calls).toHaveLength(5);
  });

  it('retains a failed snapshot at the head and only explicit flush retries it', async () => {
    const failure = new Error('snapshot quota');
    const adapter = {
      putWorkbook: vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined),
      queuePatch: vi.fn(),
      flush: vi.fn(async () => {}),
    };
    const queue = new WorkspaceSaveQueue(adapter),
      book = createBlankWorkbook();
    const first = queue.snapshot(book);
    const next = queue.patches(book.id, [patch(book.sheets[0].id, 2)]);
    expect(next).toBe(first);
    await expect(first).rejects.toBe(failure);
    expect(adapter.queuePatch).not.toHaveBeenCalled();
    await expect(queue.patches(book.id, [patch(book.sheets[0].id, 3)])).rejects.toBe(failure);
    expect(adapter.putWorkbook).toHaveBeenCalledTimes(1);
    await queue.flush();
    expect(adapter.putWorkbook).toHaveBeenCalledTimes(2);
    expect(adapter.queuePatch.mock.calls.map(([, item]) => item.cell.value)).toEqual([2, 3]);
    await queue.flush();
    expect(adapter.putWorkbook).toHaveBeenCalledTimes(2);
    expect(adapter.queuePatch).toHaveBeenCalledTimes(2);
  });

  it('re-enqueues a failed patch batch on retry but never repeats an earlier successful job', async () => {
    const failure = new Error('patch transaction failed'),
      calls: string[] = [];
    let fail = true;
    const adapter = {
      putWorkbook: vi.fn(async (book) => {
        calls.push(`snapshot:${book.name}`);
      }),
      queuePatch: vi.fn((_id, item: WorkbookPatch) => {
        calls.push(`patch:${item.kind === 'cell' ? item.cell?.value : ''}`);
      }),
      flush: vi.fn(async () => {
        calls.push('flush');
        if (fail) {
          fail = false;
          throw failure;
        }
      }),
    };
    const queue = new WorkspaceSaveQueue(adapter),
      book = createBlankWorkbook('first');
    const saving = queue.snapshot(book);
    queue.patches(book.id, [patch(book.sheets[0].id, 2)]);
    queue.snapshot({ ...book, name: 'last' });
    await expect(saving).rejects.toBe(failure);
    expect(calls).toEqual(['snapshot:first', 'patch:2', 'flush']);
    await queue.flush();
    expect(calls).toEqual([
      'snapshot:first',
      'patch:2',
      'flush',
      'patch:2',
      'flush',
      'snapshot:last',
    ]);
  });

  it('captures snapshots and patch inputs at enqueue time, before an earlier job finishes', async () => {
    const gate = deferred(),
      saved: unknown[] = [],
      patched: unknown[] = [];
    let first = true;
    const adapter = {
      putWorkbook: vi.fn(async (book) => {
        if (first) {
          first = false;
          await gate.promise;
        }
        saved.push(structuredClone(book));
      }),
      queuePatch: vi.fn((_id, item) => {
        patched.push(structuredClone(item));
      }),
      flush: vi.fn(async () => {}),
    };
    const queue = new WorkspaceSaveQueue(adapter),
      book = createBlankWorkbook('captured');
    const saving = queue.snapshot(book);
    const edits = [patch(book.sheets[0].id, 5)];
    queue.patches(book.id, edits);
    book.name = 'mutated';
    book.sheets[0].cells.A1 = { value: 999 };
    (edits[0] as Extract<WorkbookPatch, { kind: 'cell' }>).cell!.value = 99;
    edits.length = 0;
    gate.resolve();
    await saving;
    expect(saved[0]).toMatchObject({ name: 'captured' });
    expect((saved[0] as typeof book).sheets[0].cells.A1).toBeUndefined();
    expect(patched).toEqual([patch(book.sheets[0].id, 5)]);
  });

  it('reports cloning failures without adding a job or blocking valid queued work', async () => {
    const adapter = {
      putWorkbook: vi.fn(async () => {}),
      queuePatch: vi.fn(),
      flush: vi.fn(async () => {}),
    };
    const queue = new WorkspaceSaveQueue(adapter),
      book = createBlankWorkbook();
    const invalid = { ...book, unsupported: () => {} };
    await expect(queue.snapshot(invalid)).rejects.toThrow();
    await queue.snapshot(book);
    expect(adapter.putWorkbook).toHaveBeenCalledTimes(1);
  });

  it('persists snapshot/patch ordering through the real memory adapter without losing later edits', async () => {
    const persistence = memory(),
      queue = new WorkspaceSaveQueue(persistence);
    const book = createBlankWorkbook('new'),
      sheetId = book.sheets[0].id;
    const saving = queue.snapshot(book);
    queue.patches(book.id, [patch(sheetId, 1)]);
    const renamed = structuredClone(book);
    renamed.name = 'renamed';
    renamed.sheets[0].cells.A1 = { value: 2 };
    queue.snapshot(renamed);
    queue.patches(book.id, [patch(sheetId, 3)]);
    await saving;
    const restored = await persistence.loadWorkbook(book.id);
    expect(restored?.name).toBe('renamed');
    expect(restored?.sheets[0].cells.A1.value).toBe(3);
    expect(persistence.stats.pendingPatches).toBe(0);
    await persistence.close();
  });

  it('recovers from a real-adapter flush rejection that consumed the pending batch', async () => {
    const persistence = memory(),
      book = createBlankWorkbook(),
      sheetId = book.sheets[0].id;
    let fail = true;
    const adapter = {
      putWorkbook: persistence.putWorkbook.bind(persistence),
      queuePatch: persistence.queuePatch.bind(persistence),
      flush: async () => {
        await persistence.flush();
        if (fail) {
          fail = false;
          throw new Error('uncertain completion');
        }
      },
    };
    const queue = new WorkspaceSaveQueue(adapter);
    await queue.snapshot(book);
    const writing = queue.patches(book.id, [patch(sheetId, 1)]);
    queue.patches(book.id, [patch(sheetId, 2)]);
    await expect(writing).rejects.toThrow('uncertain completion');
    expect((await persistence.loadWorkbook(book.id))?.sheets[0].cells.A1.value).toBe(1);
    await queue.flush();
    expect((await persistence.loadWorkbook(book.id))?.sheets[0].cells.A1.value).toBe(2);
    expect(persistence.stats.pendingPatches).toBe(0);
    await persistence.close();
  });

  it('fully flushes a real-adapter batch larger than its automatic-flush threshold', async () => {
    const persistence = memory(),
      queue = new WorkspaceSaveQueue(persistence);
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.rowCount = 601;
    await queue.snapshot(book);
    const patches: WorkbookPatch[] = Array.from({ length: 601 }, (_, row) => ({
      kind: 'cell',
      sheetId: sheet.id,
      key: cellKey(row, 0),
      cell: { value: row + 1 },
    }));
    await queue.patches(book.id, patches);
    expect(persistence.stats.pendingPatches).toBe(0);
    expect(persistence.stats.persistedPatches).toBe(601);
    const saved = (await persistence.loadWorkbook(book.id))!;
    expect(saved.sheets[0].cells.A601.value).toBe(601);
    saved.name = 'after large batch';
    const saving = queue.snapshot(saved);
    queue.patches(book.id, [patch(sheet.id, 999)]);
    await saving;
    const restored = (await persistence.loadWorkbook(book.id))!;
    expect(restored.name).toBe('after large batch');
    expect(restored.sheets[0].cells.A1.value).toBe(999);
    expect(restored.sheets[0].cells.A601.value).toBe(601);
    expect(persistence.stats.pendingPatches).toBe(0);
    await persistence.close();
  });
});

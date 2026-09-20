import { describe, expect, it, vi } from 'vitest';
import { cellKey } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import {
  LuminaPersistence,
  PatchHistory,
  applyWorkbookPatch,
  type StorageLike,
} from '../src/lib/persistence';
import type { Workbook } from '../src/lib/types';

function storage(
  initial: Record<string, string> = {},
): StorageLike & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
    removeItem: (key) => delete values[key],
  };
}

describe('LuminaPersistence', () => {
  it('queues cell patches without rewriting the workbook and replays them on load', async () => {
    const book = createBlankWorkbook();
    const persistence = new LuminaPersistence({ forceMemory: true, flushDelayMs: 60_000 });
    await persistence.putWorkbook(book);
    persistence.queueCellPatch(book.id, book.sheets[0].id, 'B2', { value: 42 });
    expect(persistence.stats.pendingPatches).toBe(1);
    await persistence.flush();
    const loaded = await persistence.loadWorkbook(book.id);
    expect(loaded?.sheets[0].cells.B2.value).toBe(42);
    expect(persistence.stats.pendingPatches).toBe(0);
    expect(persistence.stats.persistedPatches).toBe(1);
  });

  it('flushes later memory batches after a completed flush and a replacement snapshot', async () => {
    const book = createBlankWorkbook();
    const persistence = new LuminaPersistence({ forceMemory: true, flushDelayMs: 60_000 });
    await persistence.putWorkbook(book);
    const sheetId = book.sheets[0].id;
    persistence.queueCellPatch(book.id, sheetId, 'A1', { value: 1 });
    await persistence.flush();
    const replacement = structuredClone(book);
    replacement.name = 'snapshot';
    replacement.sheets[0].cells.A1 = { value: 2 };
    await persistence.putWorkbook(replacement);
    persistence.queueCellPatch(book.id, sheetId, 'A1', { value: 3 });
    await persistence.flush();
    expect(persistence.stats.pendingPatches).toBe(0);
    expect(persistence.stats.persistedPatches).toBe(2);
    const restored = await persistence.loadWorkbook(book.id);
    expect(restored?.name).toBe('snapshot');
    expect(restored?.sheets[0].cells.A1.value).toBe(3);
    persistence.queueCellPatch(book.id, sheetId, 'B1', { value: 4 });
    await persistence.flush();
    expect(persistence.stats.pendingPatches).toBe(0);
    expect(persistence.stats.persistedPatches).toBe(3);
    await persistence.close();
  });

  it('drains a large synchronously queued batch even when automatic flush already started', async () => {
    const book = createBlankWorkbook();
    const persistence = new LuminaPersistence({ forceMemory: true, flushDelayMs: 60_000 });
    await persistence.putWorkbook(book);
    for (let row = 0; row < 601; row++)
      persistence.queueCellPatch(book.id, book.sheets[0].id, cellKey(row, 0), { value: row });
    await persistence.flush();
    expect(persistence.stats.pendingPatches).toBe(0);
    expect(persistence.stats.persistedPatches).toBe(601);
    expect((await persistence.loadWorkbook(book.id))?.sheets[0].cells.A601.value).toBe(600);
    await persistence.close();
  });

  it('handles automatic timer and threshold flush failures while explicit flush still rejects', async () => {
    vi.useFakeTimers();
    const persistence = new LuminaPersistence({ forceMemory: true, flushDelayMs: 250 });
    const book = createBlankWorkbook();
    await persistence.putWorkbook(book);
    const failure = new Error('write failure');
    const flush = vi.spyOn(persistence, 'flush').mockRejectedValue(failure);
    try {
      persistence.queueCellPatch(book.id, book.sheets[0].id, 'A1', { value: 1 });
      await vi.advanceTimersByTimeAsync(250);
      for (let row = 1; row < 500; row++)
        persistence.queueCellPatch(book.id, book.sheets[0].id, cellKey(row, 0), { value: row });
      await Promise.resolve();
      expect(flush).toHaveBeenCalledTimes(2);
      await expect(persistence.flush()).rejects.toBe(failure);
    } finally {
      flush.mockRestore();
      await persistence.close();
      vi.useRealTimers();
    }
  });

  it('supports deletion and sheet metadata patches', () => {
    const book = createBlankWorkbook();
    const withCell = applyWorkbookPatch(book, {
      kind: 'cell',
      sheetId: book.sheets[0].id,
      key: 'A1',
      cell: { value: 'ok' },
    });
    const withMeta = applyWorkbookPatch(withCell, {
      kind: 'sheet-meta',
      sheetId: book.sheets[0].id,
      changes: { frozenRows: 2, columnWidths: { 0: 180 } },
    });
    expect(withMeta.sheets[0].cells.A1.value).toBe('ok');
    expect(withMeta.sheets[0].frozenRows).toBe(2);
    expect(withMeta.sheets[0].columnWidths?.[0]).toBe(180);
    const deleted = applyWorkbookPatch(withMeta, {
      kind: 'cell',
      sheetId: book.sheets[0].id,
      key: 'A1',
      cell: null,
    });
    expect(deleted.sheets[0].cells.A1).toBeUndefined();
  });

  it('migrates the legacy localStorage workbooks once', async () => {
    const book = createBlankWorkbook('legacy');
    const source = storage({ 'lumina.v1.workbooks': JSON.stringify([book]) });
    const persistence = new LuminaPersistence({ forceMemory: true, storage: source });
    const books = await persistence.loadWorkbooks();
    expect(books).toHaveLength(1);
    expect(books[0].name).toBe('legacy');
    expect((await persistence.loadWorkbook(book.id))?.name).toBe('legacy');
  });

  it('retries a failed legacy migration and caches the successful retry', async () => {
    const book = createBlankWorkbook('legacy');
    const source = storage({ 'lumina.v1.workbooks': JSON.stringify([book]) });
    const persistence = new LuminaPersistence({ forceMemory: true, storage: source });
    const adapter = persistence as unknown as {
      memory: null;
      openDb(): Promise<IDBDatabase>;
      request(): Promise<unknown>;
      transaction(): Promise<void>;
      idbGetAllWorkbooks(): Promise<Workbook[]>;
      idbGetAllPatches(): Promise<never[]>;
    };
    adapter.memory = null;
    const db = {
      transaction: () => ({ objectStore: () => ({ get: vi.fn() }) }),
    } as unknown as IDBDatabase;
    vi.spyOn(adapter, 'openDb').mockResolvedValue(db);
    const failure = new Error('temporary IndexedDB read failure');
    const markerRead = vi
      .spyOn(adapter, 'request')
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);
    const migrationWrite = vi.spyOn(adapter, 'transaction').mockResolvedValue(undefined);
    vi.spyOn(adapter, 'idbGetAllWorkbooks').mockResolvedValue([book]);
    vi.spyOn(adapter, 'idbGetAllPatches').mockResolvedValue([]);

    await Promise.all([
      expect(persistence.loadWorkbooks()).rejects.toBe(failure),
      expect(persistence.loadWorkbooks()).rejects.toBe(failure),
    ]);
    expect(markerRead).toHaveBeenCalledTimes(1);
    expect(migrationWrite).not.toHaveBeenCalled();

    expect(await persistence.loadWorkbooks()).toEqual([book]);
    expect(markerRead).toHaveBeenCalledTimes(2);
    expect(migrationWrite).toHaveBeenCalledTimes(1);
    expect(await persistence.loadWorkbooks()).toEqual([book]);
    expect(markerRead).toHaveBeenCalledTimes(2);
    expect(migrationWrite).toHaveBeenCalledTimes(1);
  });

  it('persists revisions and comments through the same async adapter', async () => {
    const book = createBlankWorkbook();
    const persistence = new LuminaPersistence({ forceMemory: true });
    const revision = {
      id: 'r1',
      name: 'checkpoint',
      createdAt: new Date().toISOString(),
      workbook: book,
    };
    await persistence.saveRevisions(book.id, [revision]);
    await persistence.saveComments(book.id, [
      {
        id: 'c1',
        sheetId: book.sheets[0].id,
        cell: 'A1',
        text: 'todo',
        createdAt: new Date().toISOString(),
        resolved: false,
      },
    ]);
    expect((await persistence.loadRevisions(book.id))[0].name).toBe('checkpoint');
    expect((await persistence.loadComments(book.id))[0].text).toBe('todo');
  });

  it('does not mutate the caller workbook while compacting', async () => {
    const book = createBlankWorkbook();
    const persistence = new LuminaPersistence({ forceMemory: true });
    await persistence.putWorkbook(book);
    persistence.queueCellPatch(book.id, book.sheets[0].id, 'C3', { value: 'x' });
    await persistence.compact({
      ...book,
      sheets: book.sheets.map((sheet) => ({
        ...sheet,
        cells: { ...sheet.cells, C3: { value: 'x' } },
      })),
    });
    expect(book.sheets[0].cells.C3).toBeUndefined();
    expect((await persistence.loadWorkbook(book.id))?.sheets[0].cells.C3.value).toBe('x');
  });

  it('keeps bounded patch undo/redo history without workbook snapshots', () => {
    const book = createBlankWorkbook();
    const sheetId = book.sheets[0].id;
    const history = new PatchHistory(2);
    const patch = { kind: 'cell' as const, sheetId, key: 'A1', cell: { value: 1 } };
    const inverse = { kind: 'cell' as const, sheetId, key: 'A1', cell: null };
    history.push({ forward: [patch], inverse: [inverse], label: 'edit' });
    const edited = applyWorkbookPatch(book, patch);
    expect(history.undo(edited)?.workbook.sheets[0].cells.A1).toBeUndefined();
    expect(history.redo(book)?.workbook.sheets[0].cells.A1.value).toBe(1);
    expect(history.canUndo).toBe(true);
  });
});

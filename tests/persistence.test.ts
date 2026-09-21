import { describe, expect, it, vi } from 'vitest';
import { cellKey } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import {
  LuminaPersistence,
  PatchHistory,
  applyWorkbookPatch,
  type SheetMetaPatch,
  type StorageLike,
} from '../src/lib/persistence';
import type { DataValidationRule } from '../src/lib/data-validation';
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
    expect(withMeta.sheets[0].cells).toBe(withCell.sheets[0].cells);
    expect(deleted.sheets[0].cells).not.toBe(withMeta.sheets[0].cells);
    expect(withMeta.sheets[0].cells.A1.value).toBe('ok');
  });

  it('applies rule metadata without reading or enumerating stored cells', () => {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    const cells = new Proxy(sheet.cells, {
      get() {
        throw new Error('Read cell store');
      },
      ownKeys() {
        throw new Error('Enumerated cell store');
      },
    });
    sheet.cells = cells;
    const other = { ...sheet, id: 'other' };
    book.sheets.push(other);
    const rules: DataValidationRule[] = [
      {
        id: 'required',
        kind: 'list',
        values: ['yes', false, 1],
        allowBlank: false,
        range: { start: { row: 0, col: 0 }, end: { row: 1_048_575, col: 16_383 } },
      },
    ];
    const edited = applyWorkbookPatch(book, {
      kind: 'sheet-meta',
      sheetId: sheet.id,
      changes: { dataValidations: rules },
    });
    expect(edited.sheets[0].cells).toBe(cells);
    expect(edited.sheets[1]).toBe(other);
    expect(edited.sheets[0].columnWidths).toBe(sheet.columnWidths);
    expect(sheet.dataValidations).toBeUndefined();
    expect(edited.sheets[0].dataValidations).toEqual(rules);
    expect(edited.sheets[0].dataValidations).not.toBe(rules);
    rules[0].range.end.row = 10;
    if (rules[0].kind === 'list') rules[0].values[0] = 'changed';
    expect(edited.sheets[0].dataValidations![0].range.end.row).toBe(1_048_575);
    expect(edited.sheets[0].dataValidations![0]).toMatchObject({ values: ['yes', false, 1] });
  });

  it('persists isolated rule patches through flush, load and compaction without changing values or layout', async () => {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    sheet.cells = { A1: { value: -5 }, B1: { value: '=A1*2' } };
    sheet.rowHeights = { 0: 40 };
    sheet.hiddenRows = [2];
    sheet.hiddenColumns = [3];
    sheet.merges = [{ start: { row: 4, col: 0 }, end: { row: 4, col: 1 } }];
    sheet.printSettings = { paperSize: 'A4', repeatRows: 1 };
    const before = structuredClone(book);
    const rules: DataValidationRule[] = [
      {
        id: 'choice',
        sheetId: sheet.id,
        kind: 'list',
        values: [1, '1', true],
        allowBlank: false,
        range: { start: { row: 0, col: 0 }, end: { row: 1_048_575, col: 0 } },
      },
    ];
    const expectedRules = structuredClone(rules);
    const patch: SheetMetaPatch = {
      kind: 'sheet-meta',
      sheetId: sheet.id,
      changes: { dataValidations: rules },
    };
    const persistence = new LuminaPersistence({ forceMemory: true, flushDelayMs: 60_000 });
    await persistence.putWorkbook(book);
    persistence.queuePatch(book.id, patch);
    rules[0].range.end.row = 4;
    if (rules[0].kind === 'list') rules[0].values[0] = 'changed';
    patch.changes.dataValidations = [];
    const pending = await persistence.loadWorkbook(book.id);
    expect(pending!.sheets[0].dataValidations).toEqual(expectedRules);
    await persistence.flush();
    expect(persistence.stats.pendingPatches).toBe(0);
    const loaded = (await persistence.loadWorkbooks())[0];
    expect(loaded).toEqual({
      ...before,
      sheets: [{ ...before.sheets[0], dataValidations: expectedRules }],
    });
    expect(book).toEqual(before);
    loaded.sheets[0].dataValidations![0].range.start.row = 3;
    const restored = (await persistence.loadWorkbook(book.id))!;
    expect(restored.sheets[0].dataValidations).toEqual(expectedRules);
    await persistence.compact(restored);
    const compacted = (await persistence.loadWorkbook(book.id))!;
    expect(compacted).toEqual(restored);
    expect(compacted.sheets[0].cells).toEqual(before.sheets[0].cells);
    expect(compacted.sheets[0].dataValidations).not.toBe(restored.sheets[0].dataValidations);
    persistence.queuePatch(book.id, {
      kind: 'sheet-meta',
      sheetId: sheet.id,
      changes: { dataValidations: [] },
    });
    await persistence.flush();
    const cleared = (await persistence.loadWorkbook(book.id))!;
    expect(cleared.sheets[0]).toEqual({ ...before.sheets[0], dataValidations: [] });
    await persistence.compact(cleared);
    expect((await persistence.loadWorkbook(book.id))!.sheets[0]).toEqual(cleared.sheets[0]);
    expect(persistence.stats.persistedPatches).toBe(2);
    await persistence.close();
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
  it('keeps the first legacy same-ID snapshot in memory and retains all raw versions', async () => {
    const first = createBlankWorkbook('first version');
    const second = { ...structuredClone(first), name: 'second version' };
    const raw = JSON.stringify([first, second]);
    const source = storage({ 'lumina.v1.workbooks': raw });
    const p = new LuminaPersistence({ forceMemory: true, storage: source });
    expect(await p.loadWorkbooks()).toEqual([first]);
    expect(source.values['lumina.v1.workbooks']).toBe(raw);
    await p.close();
  });
  it('preserves existing memory snapshots and auxiliary records during legacy migration', async () => {
    const old = createBlankWorkbook('旧副本');
    const added = createBlankWorkbook('仅旧版存在');
    const current = { ...old, name: '最新正文' };
    const source = storage({
      'lumina.v1.workbooks': JSON.stringify([old, added]),
      [`lumina.v1.history.${old.id}`]: '[{"id":"old-history"}]',
      [`lumina.v1.comments.${old.id}`]: '[{"id":"old-comment"}]',
    });
    const before = { ...source.values };
    const p = new LuminaPersistence({ forceMemory: true, storage: source });
    const memory = (p as any).memory;
    memory.workbooks.set(old.id, current);
    memory.revisions.set(old.id, []);
    memory.comments.set(old.id, []);
    expect(await p.loadWorkbooks()).toEqual([current, added]);
    expect(await p.loadRevisions(old.id)).toEqual([]);
    expect(await p.loadComments(old.id)).toEqual([]);
    expect(source.values).toEqual(before);
    await p.close();
  });
  it('checks each target key inside the migration write transaction before importing legacy data', async () => {
    const old = createBlankWorkbook('旧正文');
    const added = createBlankWorkbook('新迁入');
    const duplicate = { ...structuredClone(added), name: '同 ID 的另一版本' };
    const source = storage({
      'lumina.v1.workbooks': JSON.stringify([old, added, duplicate]),
      [`lumina.v1.history.${old.id}`]: '[{"id":"old-history"}]',
      [`lumina.v1.comments.${old.id}`]: '[{"id":"old-comment"}]',
      [`lumina.v1.comments.${added.id}`]: '[]',
    });
    const p = new LuminaPersistence({ forceMemory: true, storage: source });
    const adapter = p as any;
    adapter.memory = null;
    vi.spyOn(adapter, 'openDb').mockResolvedValue({
      transaction: () => ({ objectStore: () => ({ get() {} }) }),
    });
    vi.spyOn(adapter, 'request').mockResolvedValue(undefined);
    const writes: Array<{ store: string; value: any }> = [];
    const checked: string[] = [];
    vi.spyOn(adapter, 'transaction').mockImplementation(async (_db, stores, mode, setup: any) => {
      expect(stores).toEqual(['workbooks', 'revisions', 'comments', 'meta']);
      expect(mode).toBe('readwrite');
      const callbacks: (() => void)[] = [];
      setup({
        objectStore: (store: string) => ({
          get: () => {
            const request: any = { result: undefined };
            callbacks.push(() => request.onsuccess());
            return request;
          },
          getKey: (key: string) => {
            checked.push(`${store}:${key}`);
            const request: any = { result: key === old.id ? key : undefined };
            callbacks.push(() => request.onsuccess());
            return request;
          },
          put: (value: any) => writes.push({ store, value }),
        }),
      });
      expect(writes).toEqual([]);
      while (callbacks.length) callbacks.shift()!();
    });
    vi.spyOn(adapter, 'idbGetAllWorkbooks').mockResolvedValue([]);
    vi.spyOn(adapter, 'idbGetAllPatches').mockResolvedValue([]);
    await p.loadWorkbooks();
    expect(checked).toEqual(
      expect.arrayContaining([`workbooks:${old.id}`, `comments:${old.id}`, `revisions:${old.id}`]),
    );
    expect(writes.filter((w) => w.store !== 'meta')).toEqual([
      { store: 'workbooks', value: { id: added.id, workbook: added } },
      { store: 'comments', value: { key: added.id, workbookId: added.id, comments: [] } },
    ]);
    expect(source.values['lumina.v1.workbooks']).toBe(JSON.stringify([old, added, duplicate]));
    await p.close();
  });
  it.each(['{}', '"damaged"', '42', 'true'])(
    'preserves workbooks and raw backups when legacy auxiliary data is not a list: %s',
    async (raw) => {
      const book = createBlankWorkbook('legacy');
      const source = storage({
        'lumina.v1.workbooks': JSON.stringify([book]),
        [`lumina.v1.history.${book.id}`]: raw,
        [`lumina.v1.comments.${book.id}`]: raw,
      });
      const before = { ...source.values };
      const p = new LuminaPersistence({ forceMemory: true, storage: source });
      expect(await p.loadWorkbooks()).toEqual([book]);
      expect(await p.loadRevisions(book.id)).toEqual([]);
      expect(await p.loadComments(book.id)).toEqual([]);
      expect(source.values).toEqual(before);
      await p.close();
    },
  );

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
  it('skips migration when another page completes it before the write transaction starts', async () => {
    const book = createBlankWorkbook('deleted after other-page migration');
    const raw = JSON.stringify([book]);
    const source = storage({ 'lumina.v1.workbooks': raw });
    const p = new LuminaPersistence({ forceMemory: true, storage: source });
    const adapter = p as any;
    adapter.memory = null;
    vi.spyOn(adapter, 'openDb').mockResolvedValue({
      transaction: () => ({ objectStore: () => ({ get() {} }) }),
    });
    // Optimistic read precedes the other page's migration/deletion.
    vi.spyOn(adapter, 'request').mockResolvedValue(undefined);
    const put = vi.fn();
    const getKey = vi.fn();
    const abort = vi.fn();
    vi.spyOn(adapter, 'transaction').mockImplementation(async (_db, _stores, _mode, setup: any) => {
      let marker: any;
      setup({
        abort,
        objectStore: () => ({
          get: () => (marker = { result: { key: 'legacy-v1-migrated', value: true } }),
          getKey,
          put,
        }),
      });
      marker?.onsuccess();
    });
    vi.spyOn(adapter, 'idbGetAllWorkbooks').mockResolvedValue([]);
    vi.spyOn(adapter, 'idbGetAllPatches').mockResolvedValue([]);
    expect(await p.loadWorkbooks()).toEqual([]);
    expect(put).not.toHaveBeenCalled();
    expect(getKey).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(source.values['lumina.v1.workbooks']).toBe(raw);
    await p.close();
  });
  it('skips invalid auxiliary containers in the IndexedDB migration transaction', async () => {
    const book = createBlankWorkbook('legacy');
    const source = storage({
      'lumina.v1.workbooks': JSON.stringify([book]),
      [`lumina.v1.history.${book.id}`]: '{}',
      [`lumina.v1.comments.${book.id}`]: '"broken"',
    });
    const p = new LuminaPersistence({ forceMemory: true, storage: source });
    const adapter = p as any;
    adapter.memory = null;
    vi.spyOn(adapter, 'openDb').mockResolvedValue({
      transaction: () => ({ objectStore: () => ({ get() {} }) }),
    });
    vi.spyOn(adapter, 'request').mockResolvedValue(undefined);
    const writes: Array<{ store: string; value: unknown }> = [];
    vi.spyOn(adapter, 'transaction').mockImplementation(async (_db, _stores, _mode, setup: any) => {
      setup({
        objectStore: (store: string) => ({
          get: () => {
            const request: any = { result: undefined };
            queueMicrotask(() => request.onsuccess());
            return request;
          },
          getKey: () => {
            const request: any = { result: undefined };
            queueMicrotask(() => request.onsuccess());
            return request;
          },
          put: (value: unknown) => writes.push({ store, value }),
        }),
      });
    });
    vi.spyOn(adapter, 'idbGetAllWorkbooks').mockResolvedValue([book]);
    vi.spyOn(adapter, 'idbGetAllPatches').mockResolvedValue([]);
    expect(await p.loadWorkbooks()).toEqual([book]);
    expect(writes.map((item) => item.store).sort()).toEqual(['meta', 'workbooks']);
    expect(source.values[`lumina.v1.history.${book.id}`]).toBe('{}');
    await p.close();
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

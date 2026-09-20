import { describe, expect, it } from 'vitest';
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

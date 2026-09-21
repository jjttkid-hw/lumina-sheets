import { describe, expect, it } from 'vitest';
import { WorkspaceHistory } from '../src/lib/workspace-history';
import {
  applyWorkbookPatches,
  LuminaPersistence,
  type WorkbookPatch,
} from '../src/lib/persistence';
import { WorkspaceSaveQueue } from '../src/lib/workspace-save';
import { createBlankWorkbook } from '../src/lib/seed';

describe('workspace hybrid history', () => {
  it('captures only touched cells without enumerating or cloning other cells', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    let reads = 0;
    sheet.cells = new Proxy(
      { A1: { value: 7, style: { bold: true } } },
      {
        ownKeys() {
          throw new Error('full cell copy');
        },
        get(target, key, receiver) {
          if (key !== 'A1') throw new Error('unrelated cell read');
          reads++;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const history = new WorkspaceHistory();
    const edits: WorkbookPatch[] = [
      { kind: 'cell', sheetId: sheet.id, key: 'A1', cell: { value: 8 } },
    ];
    history.record(book, edits);
    expect(reads).toBe(1);
    edits[0] = { kind: 'cell', sheetId: sheet.id, key: 'A1', cell: { value: 999 } };
    const current = { ...book, sheets: [{ ...sheet, cells: { A1: { value: 8 } } }] };
    const undone = history.undo(current)!;
    expect(undone.workbook.sheets[0].cells.A1).toEqual({ value: 7, style: { bold: true } });
    undone.patches!.length = 0;
    expect(history.redo(undone.workbook)!.workbook.sheets[0].cells.A1.value).toBe(8);
  });

  it('reverses repeated addresses, dimensions, deletion and undefined metadata atomically', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells.A1 = { value: 'original' };
    const patches: WorkbookPatch[] = [
      { kind: 'cell', sheetId: sheet.id, key: 'A1', cell: null },
      { kind: 'cell', sheetId: sheet.id, key: 'A1', cell: { value: 2 } },
      { kind: 'cell', sheetId: sheet.id, key: 'B200', cell: { value: 'new' } },
      { kind: 'sheet-meta', sheetId: sheet.id, changes: { rowCount: 200, hiddenRows: [3] } },
      { kind: 'sheet-meta', sheetId: sheet.id, changes: { rowCount: 300, hiddenRows: [4] } },
    ];
    const history = new WorkspaceHistory();
    history.record(book, patches);
    const edited = applyWorkbookPatches(book, patches);
    const undo = history.undo(edited)!;
    expect(undo.workbook.sheets[0].cells).toEqual(sheet.cells);
    expect(undo.workbook.sheets[0].rowCount).toBe(sheet.rowCount);
    expect(undo.workbook.sheets[0].hiddenRows).toBeUndefined();
    expect(history.redo(undo.workbook)!.workbook).toEqual(edited);
  });

  it('supports interleaved structural snapshots and patches in both directions', () => {
    const original = createBlankWorkbook(),
      history = new WorkspaceHistory();
    history.record(original);
    const added = {
      ...original,
      sheets: [...original.sheets, { ...original.sheets[0], id: 'second', cells: {} }],
      activeSheetId: 'second',
    };
    const patch: WorkbookPatch = {
      kind: 'cell',
      sheetId: 'second',
      key: 'A1',
      cell: { value: 10 },
    };
    history.record(added, [patch]);
    const edited = applyWorkbookPatches(added, [patch]);
    const undoEdit = history.undo(edited)!;
    expect(undoEdit.patches).toBeDefined();
    expect(undoEdit.workbook.sheets[1].cells.A1).toBeUndefined();
    const undoAdd = history.undo(undoEdit.workbook)!;
    expect(undoAdd.patches).toBeUndefined();
    expect(undoAdd.workbook).toEqual(original);
    const redoAdd = history.redo(undoAdd.workbook)!;
    expect(redoAdd.workbook).toEqual(added);
    const redoEdit = history.redo(redoAdd.workbook)!;
    expect(redoEdit.workbook).toEqual(edited);
  });

  it('preserves untracked workbook metadata and active sheet on patch undo', () => {
    const book = createBlankWorkbook(),
      history = new WorkspaceHistory();
    const patch: WorkbookPatch = {
      kind: 'cell',
      sheetId: book.sheets[0].id,
      key: 'A1',
      cell: { value: 3 },
    };
    history.record(book, [patch]);
    const current = {
      ...applyWorkbookPatches(book, [patch]),
      starred: true,
      name: 'renamed',
      activeSheetId: 'other',
    };
    expect(history.undo(current)!.workbook).toMatchObject({
      starred: true,
      name: 'renamed',
      activeSheetId: 'other',
    });
  });

  it('bounds mixed history and retains redo on empty or invalid record', () => {
    const history = new WorkspaceHistory(2),
      book = createBlankWorkbook();
    history.record(book);
    history.record({ ...book, name: 'two' });
    history.record({ ...book, name: 'three' });
    const undone = history.undo({ ...book, name: 'four' })!;
    history.record(undone.workbook, []);
    expect(() =>
      history.record(book, [{ kind: 'cell', sheetId: 'missing', key: 'A1', cell: null }]),
    ).toThrow();
    expect(history.canRedo).toBe(true);
    expect(history.redo(undone.workbook)!.workbook.name).toBe('four');
    history.undo(book);
    history.undo(book);
    expect(history.canUndo).toBe(false);
    history.record(book);
    expect(history.canRedo).toBe(false);
    history.clear();
    expect(history.canUndo).toBe(false);
  });

  it('keeps history intact after wrong-workbook or failed replay', () => {
    const book = createBlankWorkbook(),
      history = new WorkspaceHistory();
    history.record(book, [
      { kind: 'cell', sheetId: book.sheets[0].id, key: 'A1', cell: { value: 1 } },
    ]);
    expect(() => history.undo({ ...book, id: 'other' })).toThrow();
    const broken = {
      ...book,
      sheets: [
        {
          ...book.sheets[0],
          cells: new Proxy(
            {},
            {
              ownKeys() {
                throw new Error('failure');
              },
            },
          ),
        },
      ],
    };
    expect(() => history.undo(broken)).toThrow('failure');
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it('persists patch undo/redo through the ordered save queue and reloads absent metadata', async () => {
    const persistence = new LuminaPersistence({
      forceMemory: true,
      storage: { getItem: () => null, setItem: () => {} },
      flushDelayMs: 60000,
    });
    const queue = new WorkspaceSaveQueue(persistence),
      history = new WorkspaceHistory(),
      book = createBlankWorkbook();
    await queue.snapshot(book);
    const patches: WorkbookPatch[] = [
      { kind: 'sheet-meta', sheetId: book.sheets[0].id, changes: { dataValidations: [] } },
      { kind: 'cell', sheetId: book.sheets[0].id, key: 'A1', cell: { value: 9 } },
    ];
    history.record(book, patches);
    await queue.patches(book.id, patches);
    const edited = applyWorkbookPatches(book, patches),
      undone = history.undo(edited)!;
    await queue.patches(book.id, undone.patches!);
    const restored = (await persistence.loadWorkbook(book.id))!;
    expect(restored.sheets[0].cells.A1).toBeUndefined();
    expect(restored.sheets[0].dataValidations).toBeUndefined();
    const redone = history.redo(undone.workbook)!;
    await queue.patches(book.id, redone.patches!);
    expect((await persistence.loadWorkbook(book.id))!.sheets[0].cells.A1.value).toBe(9);
    await persistence.close();
  });
});

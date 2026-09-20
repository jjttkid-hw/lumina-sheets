import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import type { Workbook } from '../src/lib/types';

const mounting = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => mounting) }));
import { LuminaSpreadsheet } from '../src/sdk';

class Host {
  className = 'structure-host';
  classList = { add: (name: string) => (this.className += ` ${name}`) };
}
const instances: LuminaSpreadsheet[] = [];
const make = (options: ConstructorParameters<typeof LuminaSpreadsheet>[1] = {}) => {
  const instance = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, options);
  instances.push(instance);
  return instance;
};
beforeEach(() => {
  vi.stubGlobal('HTMLElement', Host);
  vi.clearAllMocks();
});
afterEach(() => {
  instances.forEach((instance) => instance.destroy());
  instances.length = 0;
  vi.unstubAllGlobals();
});
function workbook(): Workbook {
  const book = createBlankWorkbook('结构测试');
  const sheet = book.sheets[0];
  sheet.name = '销售 明细';
  sheet.rowCount = 10;
  sheet.colCount = 6;
  sheet.columnWidths = {};
  sheet.cells = {
    A1: { value: '标题' },
    A2: { value: 2 },
    A3: { value: 3 },
    B2: { value: '=A2+$A$3' },
    C2: { value: '="A2"&A2' },
  };
  book.sheets.push({
    id: 'summary',
    name: '汇总',
    rowCount: 10,
    colCount: 6,
    cells: { A1: { value: "=SUM('销售 明细'!A2:A3)" }, B1: { value: "='销售 明细'!$A$3" } },
  });
  return book;
}
const sheetsOnly = (instance: LuminaSpreadsheet) => instance.toJSON().sheets;

describe('SDK structural editing', () => {
  it('inserts rows atomically, shifts cells and rewrites local/cross-sheet references without changing strings', () => {
    const instance = make({ workbook: workbook() });
    instance.insertRows(1, 2);
    expect(instance.activeSheetInfo.rowCount).toBe(12);
    expect(instance.getCell('A2')).toBeUndefined();
    expect(instance.getValue('A4')).toBe(2);
    expect(instance.getCell('B4')?.value).toBe('=A4+$A$5');
    expect(instance.getCell('C4')?.value).toBe('="A2"&A4');
    expect(instance.getValue('B4')).toBe(5);
    expect(instance.toJSON().sheets[1].cells.A1.value).toBe("=SUM('销售 明细'!A4:A5)");
    expect(instance.toJSON().sheets[1].cells.B1.value).toBe("='销售 明细'!$A$5");
  });

  it('deletes columns, shifts retained cells and produces reference errors for removed targets', () => {
    const book = workbook();
    book.sheets[0].cells.D2 = { value: '=A2+C2' };
    const instance = make({ workbook: book });
    instance.deleteColumns(0);
    expect(instance.activeSheetInfo.colCount).toBe(5);
    expect(instance.getCell('A2')?.value).toContain('#REF!');
    expect(instance.getValue('A2')).toBe('#REF!');
    expect(instance.getCell('B2')?.value).toBe('="A2"&#REF!');
    expect(instance.getCell('C2')?.value).toBe('=#REF!+B2');
    expect(instance.toJSON().sheets[1].cells.B1.value).toContain('#REF!');
    instance.undo();
    expect(sheetsOnly(instance)).toEqual(book.sheets);
  });

  it('supports insertion at the end and leaves unrelated references stable', () => {
    const instance = make({ workbook: workbook() });
    instance.insertRows(10);
    instance.insertColumns(6, 2);
    expect(instance.activeSheetInfo).toMatchObject({ rowCount: 11, colCount: 8 });
    expect(instance.getValue('B2')).toBe(5);
    expect(instance.getCell('B2')?.value).toBe('=A2+$A$3');
    expect(instance.toJSON().sheets[1].cells.A1.value).toBe("=SUM('销售 明细'!A2:A3)");
  });

  it('restores complete structures through undo/redo mixed with ordinary cell edits', () => {
    const instance = make({ workbook: workbook() });
    const original = sheetsOnly(instance);
    instance.setCell('A2', 7);
    const edited = sheetsOnly(instance);
    instance.insertRows(1);
    const inserted = sheetsOnly(instance);
    instance.setCell('A3', 9);
    const editedAfterInsert = sheetsOnly(instance);
    instance.deleteColumns(2);
    const deleted = sheetsOnly(instance);
    instance.undo();
    expect(sheetsOnly(instance)).toEqual(editedAfterInsert);
    instance.undo();
    expect(sheetsOnly(instance)).toEqual(inserted);
    instance.undo();
    expect(sheetsOnly(instance)).toEqual(edited);
    instance.undo();
    expect(sheetsOnly(instance)).toEqual(original);
    instance.redo();
    expect(sheetsOnly(instance)).toEqual(edited);
    instance.redo();
    expect(sheetsOnly(instance)).toEqual(inserted);
    instance.redo();
    expect(sheetsOnly(instance)).toEqual(editedAfterInsert);
    instance.redo();
    expect(sheetsOnly(instance)).toEqual(deleted);
  });

  it('moves selection, clamps a deleted range and restores prior selection with history', () => {
    const instance = make({ workbook: workbook() });
    const original = { row: 2, col: 2, endRow: 4, endCol: 3 };
    instance.select(original);
    instance.insertRows(1, 2);
    expect(instance.selectedRange).toEqual({ row: 4, col: 2, endRow: 6, endCol: 3 });
    instance.undo();
    expect(instance.selectedRange).toEqual(original);
    instance.redo();
    expect(instance.selectedRange.row).toBe(4);
    instance.deleteRows(4, 3);
    expect(instance.selectedRange.row).toBe(4);
    expect(instance.selectedRange.endRow ?? instance.selectedRange.row).toBe(4);
    instance.undo();
    expect(instance.selectedRange).toEqual({ row: 4, col: 2, endRow: 6, endCol: 3 });
  });

  it('moves metadata and conditional styling with the edited coordinates and fully restores it', () => {
    const book = workbook();
    const sheet = book.sheets[0];
    sheet.frozenRows = 2;
    sheet.columnWidths = { 0: 90, 1: 120, 3: 180 };
    sheet.merges = [{ start: { row: 4, col: 2 }, end: { row: 5, col: 3 } }];
    sheet.printSettings = { repeatRows: 2, repeatColumns: 1, rowBreaks: [7], columnBreaks: [4] };
    sheet.dataValidations = [
      {
        id: 'v',
        kind: 'whole',
        operator: 'greaterThan',
        value: 0,
        range: { start: { row: 2, col: 2 }, end: { row: 3, col: 2 } },
      },
    ];
    sheet.cells.C3 = { value: 5 };
    const instance = make({
      workbook: book,
      conditionalRules: [
        {
          range: { start: { row: 2, col: 2 }, end: { row: 3, col: 2 } },
          operator: 'greaterThan',
          value: 0,
          style: { background: '#112233' },
        },
      ],
    });
    const original = sheetsOnly(instance);
    instance.insertRows(1);
    instance.insertColumns(1);
    const shifted = instance.activeSheet;
    expect(shifted.frozenRows).toBe(3);
    expect(shifted.columnWidths).toMatchObject({ 0: 90, 2: 120, 4: 180 });
    expect(shifted.merges).toEqual([{ start: { row: 5, col: 3 }, end: { row: 6, col: 4 } }]);
    expect(shifted.printSettings).toMatchObject({
      repeatRows: 3,
      repeatColumns: 1,
      rowBreaks: [8],
      columnBreaks: [5],
    });
    expect(shifted.dataValidations?.[0].range).toEqual({
      start: { row: 3, col: 3 },
      end: { row: 4, col: 3 },
    });
    expect(instance.getConditionalRules()[0].range).toEqual({
      start: { row: 3, col: 3 },
      end: { row: 4, col: 3 },
    });
    const surface = instance.surface();
    expect(surface.props.getCell(surface.props.sheet, 'D4')?.style?.background).toBe('#112233');
    expect(surface.props.getCell(surface.props.sheet, 'C3')?.style?.background).not.toBe('#112233');
    instance.undo();
    instance.undo();
    expect(sheetsOnly(instance)).toEqual(original);
    expect(instance.getConditionalRules()[0].range).toEqual({
      start: { row: 2, col: 2 },
      end: { row: 3, col: 2 },
    });
    const restoredSurface = instance.surface();
    expect(
      restoredSurface.props.getCell(restoredSurface.props.sheet, 'C3')?.style?.background,
    ).toBe('#112233');
  });

  it('emits one isolated structure event and one subscription change per operation without cell patches', () => {
    const onChange = vi.fn(),
      onStructureChange = vi.fn();
    const instance = make({ workbook: workbook(), onChange, onStructureChange });
    const changed = vi.fn();
    instance.subscribe(changed);
    const id = instance.activeSheetInfo.id;
    instance.insertRows(1, 2);
    expect(onChange).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(onStructureChange).toHaveBeenLastCalledWith({
      sheetId: id,
      axis: 'row',
      kind: 'insert',
      index: 1,
      count: 2,
      phase: 'apply',
      affectedSheetIds: expect.arrayContaining([id, 'summary']),
    });
    const event = onStructureChange.mock.calls[0][0];
    event.affectedSheetIds.length = 0;
    instance.undo();
    expect(onStructureChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'undo',
        affectedSheetIds: expect.arrayContaining([id, 'summary']),
      }),
    );
    instance.redo();
    expect(onStructureChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'redo' }));
    expect(changed).toHaveBeenCalledTimes(3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('scopes formerly global conditions so only the edited sheet range moves', () => {
    const book = workbook();
    book.sheets[0].cells.C3 = { value: 5 };
    book.sheets[1].cells.C3 = { value: 8 };
    const condition = {
      range: { start: { row: 2, col: 2 }, end: { row: 2, col: 2 } },
      operator: 'greaterThan' as const,
      value: 0,
      style: { background: '#123456' },
    };
    const instance = make({ workbook: book, conditionalRules: [condition] });
    instance.insertRows(1);
    const rules = instance.getConditionalRules();
    expect(rules.find((rule) => rule.sheetId === book.activeSheetId)?.range).toEqual({
      start: { row: 3, col: 2 },
      end: { row: 3, col: 2 },
    });
    expect(rules.find((rule) => rule.sheetId === 'summary')?.range).toEqual(condition.range);
    rules[0].range.start.row = 99;
    expect(instance.getConditionalRules()[0].range.start.row).not.toBe(99);
    const surface = instance.surface();
    expect(surface.props.getCell(surface.props.workbook.sheets[1], 'C3')?.style?.background).toBe(
      '#123456',
    );
    instance.undo();
    expect(instance.getConditionalRules()).toEqual([condition]);
  });

  it('rejects invalid structure edits atomically without destroying redo or calculated caches', () => {
    const onStructureChange = vi.fn();
    const instance = make({ workbook: workbook(), onStructureChange });
    instance.setCell('A2', 7);
    instance.undo();
    instance.getValue('B2');
    const state = instance.toJSON(),
      revision = instance.snapshot(),
      stats = instance.calculationStats;
    const changed = vi.fn();
    instance.subscribe(changed);
    const invalid = [
      () => instance.insertRows(-1),
      () => instance.insertRows(11),
      () => instance.insertRows(1, 0),
      () => instance.insertRows(1, 1.5),
      () => instance.deleteRows(9, 2),
      () => instance.deleteRows(0, 10),
      () => instance.insertColumns(7),
      () => instance.deleteColumns(0, 6),
    ];
    for (const action of invalid)
      expect(action).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(instance.toJSON()).toEqual(state);
    expect(instance.snapshot()).toBe(revision);
    expect(instance.calculationStats).toEqual(stats);
    expect(changed).not.toHaveBeenCalled();
    expect(onStructureChange).not.toHaveBeenCalled();
    instance.redo();
    expect(instance.getValue('A2')).toBe(7);
  });

  it('bounds retained structural history to ten operations', () => {
    const instance = make({ workbook: workbook() });
    for (let i = 0; i < 12; i++) instance.insertRows(0);
    expect(instance.activeSheetInfo.rowCount).toBe(22);
    for (let i = 0; i < 20; i++) instance.undo();
    expect(instance.activeSheetInfo.rowCount).toBe(12);
    for (let i = 0; i < 20; i++) instance.redo();
    expect(instance.activeSheetInfo.rowCount).toBe(22);
  });

  it('rejects Excel size overflow without clearing the prior workbook or history', () => {
    const book = workbook();
    book.sheets[0].rowCount = 1_048_576;
    book.sheets[0].colCount = 16_384;
    const instance = make({ workbook: book });
    instance.setCell('A1', 'latest');
    const state = instance.toJSON();
    expect(() => instance.insertRows(1_048_576)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => instance.insertColumns(0)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(instance.toJSON()).toEqual(state);
    instance.undo();
    expect(instance.getValue('A1')).toBe('标题');
  });

  it('contains callback exceptions and preserves history when a callback edits again', () => {
    const onError = vi.fn();
    let instance!: LuminaSpreadsheet;
    let followup = true;
    instance = make({
      workbook: workbook(),
      onError,
      onStructureChange: () => {
        if (followup) {
          followup = false;
          instance.setCell('A1', 'callback edit');
        }
        throw new Error('host callback failure');
      },
    });
    expect(() => instance.insertRows(1)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'host callback failure' }),
    );
    expect(instance.getValue('A1')).toBe('callback edit');
    instance.undo();
    expect(instance.getValue('A1')).toBe('标题');
    instance.undo();
    expect(instance.activeSheetInfo.rowCount).toBe(10);
    instance.redo();
    expect(instance.activeSheetInfo.rowCount).toBe(11);
    instance.redo();
    expect(instance.getValue('A1')).toBe('callback edit');
  });

  it('keeps history coherent when an undo callback commits a new structural edit', () => {
    let instance!: LuminaSpreadsheet;
    let nested = false;
    instance = make({
      workbook: workbook(),
      onStructureChange: (event) => {
        if (event.phase === 'undo' && !nested) {
          nested = true;
          instance.insertColumns(0);
        }
      },
    });
    instance.insertRows(1);
    instance.undo();
    expect(instance.activeSheetInfo).toMatchObject({ rowCount: 10, colCount: 7 });
    instance.redo(); // A fresh edit in the callback invalidated the prior redo branch.
    expect(instance.activeSheetInfo).toMatchObject({ rowCount: 10, colCount: 7 });
    instance.undo();
    expect(instance.activeSheetInfo).toMatchObject({ rowCount: 10, colCount: 6 });
  });

  it.each(['load', 'destroy', 'undo'] as const)(
    'suppresses an obsolete structure event when a synchronous subscriber calls %s',
    (action) => {
      const onStructureChange = vi.fn(),
        onSelectionChange = vi.fn();
      const instance = make({ workbook: workbook(), onStructureChange, onSelectionChange });
      const replacement = createBlankWorkbook('replacement');
      let reacted = false;
      instance.subscribe(() => {
        if (reacted) return;
        reacted = true;
        if (action === 'load') instance.load(replacement);
        else if (action === 'destroy') instance.destroy();
        else instance.undo();
      });
      expect(() => instance.insertRows(1)).not.toThrow();
      expect(onStructureChange.mock.calls.some(([event]) => event.phase === 'apply')).toBe(false);
      if (action === 'undo') {
        expect(onStructureChange).toHaveBeenCalledTimes(1);
        expect(onStructureChange).toHaveBeenCalledWith(expect.objectContaining({ phase: 'undo' }));
        expect(instance.activeSheetInfo.rowCount).toBe(10);
        instance.redo();
        expect(instance.activeSheetInfo.rowCount).toBe(11);
        expect(onStructureChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ phase: 'redo' }),
        );
      } else {
        expect(onStructureChange).not.toHaveBeenCalled();
        expect(onSelectionChange).not.toHaveBeenCalled();
        if (action === 'load') {
          expect(instance.toJSON().name).toBe('replacement');
          instance.undo();
          expect(instance.toJSON().name).toBe('replacement');
        } else {
          expect(() => instance.activeSheetInfo).toThrowError(
            expect.objectContaining({ code: 'DESTROYED' }),
          );
        }
      }
    },
  );

  it('rejects edits on readonly and paged instances and after destroy', async () => {
    const readOnly = make({ workbook: workbook(), readOnly: true });
    const actions = (instance: LuminaSpreadsheet) => [
      () => instance.insertRows(0),
      () => instance.deleteRows(0),
      () => instance.insertColumns(0),
      () => instance.deleteColumns(0),
    ];
    actions(readOnly).forEach((action) =>
      expect(action).toThrowError(expect.objectContaining({ code: 'READ_ONLY' })),
    );
    const paged = make();
    await paged.bindData({
      columnCount: 2,
      rowCount: 2,
      fetchPage: async () => ({
        rows: [
          [1, 2],
          [3, 4],
        ],
        totalRows: 2,
      }),
    });
    actions(paged).forEach((action) =>
      expect(action).toThrowError(expect.objectContaining({ code: 'READ_ONLY' })),
    );
    readOnly.destroy();
    actions(readOnly).forEach((action) =>
      expect(action).toThrowError(expect.objectContaining({ code: 'DESTROYED' })),
    );
  });
});

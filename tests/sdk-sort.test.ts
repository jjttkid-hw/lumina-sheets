import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import type { Workbook } from '../src/lib/types';

const mounting = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => mounting) }));
import { LuminaSpreadsheet, type RowSortRequest } from '../src/sdk';

class Host {
  className = 'sort-host';
  classList = { add: (name: string) => (this.className += ` ${name}`) };
}
const instances: LuminaSpreadsheet[] = [];
function make(options: ConstructorParameters<typeof LuminaSpreadsheet>[1] = {}) {
  const instance = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, options);
  instances.push(instance);
  return instance;
}
function workbook(): Workbook {
  const book = createBlankWorkbook('排序测试');
  Object.assign(book.sheets[0], {
    name: 'Data',
    rowCount: 8,
    colCount: 8,
    frozenRows: 1,
    columnWidths: { 0: 120 },
    cells: {
      A1: { value: '表头' },
      A2: { value: 30 },
      B2: { value: 'third', style: { bold: true } },
      H2: { value: 'far-third' },
      A3: { value: 10 },
      B3: { value: 'first' },
      A4: { value: 20 },
      B4: { value: 'second' },
      H4: { value: 'far-second' },
      A5: { value: 'outside' },
    },
  });
  return book;
}
const ascending: RowSortRequest = {
  startRow: 1,
  rowCount: 3,
  keys: [{ column: 0, direction: 'asc' }],
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

describe('SDK atomic row sorting', () => {
  it('commits cross-sheet link targets before callbacks and undoes all sheets together', () => {
    const book = workbook(),
      other = createBlankWorkbook().sheets[0];
    other.name = 'Links';
    other.cells = { A1: { value: 'record', hyperlink: { target: '#Data!$A$2' } } };
    book.sheets.push(other);
    const observed: string[] = [];
    let instance: LuminaSpreadsheet;
    const onChange = vi.fn(() =>
      observed.push(instance.toJSON().sheets[1].cells.A1.hyperlink!.target),
    );
    instance = make({ workbook: book, onChange });
    instance.select({ row: 1, col: 0, endRow: 3, endCol: 2 });
    const selection = instance.selectedRange;
    const result = instance.sortRows(ascending);
    expect(result.changedCells).toBeGreaterThan(1);
    expect(observed).toEqual(['#Data!$A$4', '#Data!$A$4']);
    expect(instance.getValue('A2')).toBe(10);
    instance.undo();
    expect(instance.getValue('A2')).toBe(30);
    expect(instance.toJSON().sheets[1].cells.A1.hyperlink?.target).toBe('#Data!$A$2');
    instance.redo();
    expect(instance.getValue('A2')).toBe(10);
    expect(instance.toJSON().sheets[1].cells.A1.hyperlink?.target).toBe('#Data!$A$4');
    expect(instance.selectedRange).toEqual(selection);
    expect(onChange).toHaveBeenCalledTimes(6);
  });
  it('stops old multi-sheet notifications when a callback undoes the committed sort', () => {
    const book = workbook(),
      other = createBlankWorkbook().sheets[0];
    other.name = 'Links';
    other.cells = { A1: { value: 'record', hyperlink: { target: '#Data!A2' } } };
    book.sheets.push(other);
    let first = true,
      instance: LuminaSpreadsheet;
    const onChange = vi.fn(() => {
      if (first) {
        first = false;
        instance.undo();
      }
    });
    instance = make({ workbook: book, onChange });
    instance.sortRows(ascending);
    expect(instance.getValue('A2')).toBe(30);
    expect(instance.toJSON().sheets[1].cells.A1.hyperlink?.target).toBe('#Data!A2');
    expect(onChange).toHaveBeenCalledTimes(3);
  });
  it('restores links with identical labels through sort undo and redo', () => {
    const book = workbook();
    for (const row of [2, 3, 4])
      book.sheets[0].cells[`B${row}`] = {
        value: 'details',
        hyperlink: { target: `https://example.com/${row}`, tooltip: `row ${row}` },
      };
    const instance = make({ workbook: book });
    const result = instance.sortRows(ascending);
    expect(result.movedRows).toBe(3);
    expect(instance.getCell('B2')?.hyperlink).toEqual({
      target: 'https://example.com/3',
      tooltip: 'row 3',
    });
    instance.undo();
    expect(instance.getCell('B2')?.hyperlink?.target).toBe('https://example.com/2');
    instance.redo();
    expect(instance.getCell('B2')?.hyperlink?.target).toBe('https://example.com/3');
  });
  it('moves complete sparse rows and styles as one edit while preserving layout and selected range', () => {
    const book = workbook();
    book.sheets[0].rowHeights = { 1: 61 };
    book.sheets[0].hiddenColumns = [7];
    book.sheets[0].printSettings = { repeatRows: 1 };
    const onChange = vi.fn();
    const instance = make({ workbook: book, onChange });
    const original = instance.toJSON().sheets;
    const layout = instance.getSheetLayout();
    const selection = { row: 1, col: 0, endRow: 3, endCol: 1 };
    instance.select(selection);
    const listener = vi.fn();
    instance.subscribe(listener);
    const result = instance.sortRows(ascending);
    expect(result.movedRows).toBe(3);
    expect(result.changedCells).toBeGreaterThan(0);
    expect(instance.getValue('A2')).toBe(10);
    expect(instance.getValue('B3')).toBe('second');
    expect(instance.getCell('H2')).toBeUndefined();
    expect(instance.getValue('H3')).toBe('far-second');
    expect(instance.getValue('H4')).toBe('far-third');
    expect(instance.getCell('B4')?.style).toEqual({ bold: true });
    expect(instance.getValue('A1')).toBe('表头');
    expect(instance.getValue('A5')).toBe('outside');
    expect(instance.selectedRange).toEqual(selection);
    expect(instance.getSheetLayout()).toEqual(layout);
    expect(instance.getPrintSettings()).toEqual({ repeatRows: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].changes).toHaveLength(result.changedCells);
    expect(listener).toHaveBeenCalledTimes(1);
    const sorted = instance.toJSON().sheets;
    instance.undo();
    expect(instance.toJSON().sheets).toEqual(original);
    expect(instance.selectedRange).toEqual(selection);
    instance.redo();
    expect(instance.toJSON().sheets).toEqual(sorted);
    expect(instance.selectedRange).toEqual(selection);
  });

  it('sorts by precomputed formula results and translates moved relative formulas only', () => {
    const book = workbook();
    book.sheets[0].cells = {
      A1: { value: 5 },
      A2: { value: '=C2+$A$1' },
      C2: { value: 30 },
      A3: { value: '=C3+$A$1' },
      C3: { value: 10 },
      A4: { value: '=C4+$A$1' },
      C4: { value: 20 },
      F1: { value: '=A2' },
    };
    book.sheets.push({
      id: 'summary',
      name: 'Summary',
      rowCount: 8,
      colCount: 8,
      cells: { A1: { value: '=Data!A2' } },
    });
    const instance = make({ workbook: book });
    expect(instance.getValue('F1')).toBe(35);
    instance.sortRows(ascending);
    expect(instance.getValue('A2')).toBe(15);
    expect(instance.getValue('A3')).toBe(25);
    expect(instance.getValue('A4')).toBe(35);
    expect(instance.getCell('A2')?.value).toBe('=C2+$A$1');
    expect(instance.getCell('F1')?.value).toBe('=A2');
    expect(instance.getValue('F1')).toBe(15);
    expect(instance.toJSON().sheets[1].cells.A1.value).toBe('=Data!A2');
    instance.undo();
    expect(instance.getValue('F1')).toBe(35);
  });

  it('uses stable multi-key order and leaves excluded hidden rows in place regardless of filter', () => {
    const book = workbook();
    book.sheets[0].hiddenRows = [2];
    const instance = make({ workbook: book });
    instance.setFilter('unmatched');
    instance.sortRows(ascending);
    expect([instance.getValue('A2'), instance.getValue('A3'), instance.getValue('A4')]).toEqual([
      20, 10, 30,
    ]);
    expect(instance.getValue('B3')).toBe('first');
    expect(instance.filterText).toBe('unmatched');
    instance.sortRows({ ...ascending, includeHidden: true });
    expect([instance.getValue('A2'), instance.getValue('A3'), instance.getValue('A4')]).toEqual([
      10, 20, 30,
    ]);
    expect(instance.getSheetLayout().hiddenRows).toEqual([2]);
    const multi = workbook();
    multi.sheets[0].cells = {
      A2: { value: 'X' },
      B2: { value: 1 },
      C2: { value: 'first tie' },
      A3: { value: 'Y' },
      B3: { value: 2 },
      C3: { value: 'Y' },
      A4: { value: 'X' },
      B4: { value: 1 },
      C4: { value: 'second tie' },
      A5: { value: 'X' },
      B5: { value: 3 },
      C5: { value: 'largest' },
    };
    const sorted = make({ workbook: multi });
    sorted.sortRows({
      startRow: 1,
      rowCount: 4,
      keys: [
        { column: 0, direction: 'asc' },
        { column: 1, direction: 'desc' },
      ],
    });
    expect(['C2', 'C3', 'C4', 'C5'].map((key) => sorted.getValue(key))).toEqual([
      'largest',
      'first tie',
      'second tie',
      'Y',
    ]);
  });

  it('treats an already sorted range as a complete no-op and retains redo and formula caches', () => {
    const book = workbook();
    book.sheets[0].cells = {
      A2: { value: '=B2' },
      B2: { value: 1 },
      A3: { value: '=B3' },
      B3: { value: 2 },
      A4: { value: '=B4' },
      B4: { value: 3 },
    };
    const onChange = vi.fn();
    const instance = make({ workbook: book, onChange });
    instance.setCell('G1', 1);
    instance.undo();
    const stats = instance.calculationStats;
    const snapshot = instance.toJSON();
    const revision = instance.snapshot();
    onChange.mockClear();
    const changed = vi.fn();
    instance.subscribe(changed);
    expect(instance.sortRows(ascending)).toEqual({ movedRows: 0, changedCells: 0 });
    expect(instance.calculationStats).toEqual(stats);
    expect(instance.toJSON()).toEqual(snapshot);
    expect(instance.snapshot()).toBe(revision);
    expect(changed).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    instance.redo();
    expect(instance.getValue('G1')).toBe(1);
  });

  it('rejects target validation failures without changing any state or live calculation cache', () => {
    const book = workbook();
    book.sheets[0].cells = {
      A2: { value: '=B2' },
      B2: { value: 10 },
      A3: { value: '=B3' },
      B3: { value: 30 },
    };
    book.sheets[0].dataValidations = [
      {
        id: 'destination-limit',
        kind: 'whole',
        operator: 'lessThan',
        value: 20,
        range: { start: { row: 1, col: 0 }, end: { row: 1, col: 0 } },
      },
    ];
    const onChange = vi.fn();
    const instance = make({ workbook: book, onChange });
    instance.setCell('G1', 'history');
    instance.undo();
    const selected = { row: 1, col: 0, endRow: 2, endCol: 1 };
    instance.select(selected);
    onChange.mockClear();
    const before = instance.toJSON(),
      stats = instance.calculationStats,
      revision = instance.snapshot();
    expect(() =>
      instance.sortRows({ startRow: 1, rowCount: 2, keys: [{ column: 0, direction: 'desc' }] }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(instance.toJSON()).toEqual(before);
    expect(instance.calculationStats).toEqual(stats);
    expect(instance.snapshot()).toBe(revision);
    expect(instance.selectedRange).toEqual(selected);
    expect(onChange).not.toHaveBeenCalled();
    instance.redo();
    expect(instance.getValue('G1')).toBe('history');
  });

  it.each([
    null,
    { ...ascending, startRow: -1 },
    { ...ascending, rowCount: 100001 },
    { ...ascending, rowCount: 8 },
    { ...ascending, unknown: true },
    { ...ascending, includeHidden: 'yes' },
    { ...ascending, keys: [] },
    { ...ascending, keys: [{ column: 0, direction: 'down' }] },
    { ...ascending, keys: [{ column: 8, direction: 'asc' }] },
    { ...ascending, keys: [{ column: 0, direction: 'asc', unknown: true }] },
    {
      ...ascending,
      keys: [
        { column: 0, direction: 'asc' },
        { column: 0, direction: 'desc' },
      ],
    },
    { ...ascending, startRow: 0 },
  ])('rejects invalid sort requests atomically: %j', (invalid) => {
    const onChange = vi.fn();
    const instance = make({ workbook: workbook(), onChange });
    const snapshot = instance.toJSON(),
      stats = instance.calculationStats;
    expect(() => instance.sortRows(invalid as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(instance.toJSON()).toEqual(snapshot);
    expect(instance.calculationStats).toEqual(stats);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects intersecting merges and readonly, paged and destroyed instances', async () => {
    const merged = workbook();
    merged.sheets[0].merges = [{ start: { row: 2, col: 5 }, end: { row: 3, col: 6 } }];
    expect(() => make({ workbook: merged }).sortRows(ascending)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    const readonly = make({ workbook: workbook(), readOnly: true });
    expect(() => readonly.sortRows(ascending)).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY' }),
    );
    const paged = make();
    await paged.bindData({ columnCount: 2, rowCount: 0, fetchPage: async () => ({ rows: [] }) });
    expect(() => paged.sortRows(ascending)).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY' }),
    );
    const persisted = workbook();
    persisted.sheets[0].dataSource = { kind: 'paged' };
    expect(() => make({ workbook: persisted }).sortRows(ascending)).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY' }),
    );
    readonly.destroy();
    expect(() => readonly.sortRows(ascending)).toThrowError(
      expect.objectContaining({ code: 'DESTROYED' }),
    );
  });

  it.each(['select', 'load', 'undo'] as const)(
    'respects a reentrant onChange %s without restoring stale selection or data',
    (action) => {
      let instance!: LuminaSpreadsheet;
      let reentered = false;
      const selection = { row: 4, col: 2, endRow: 5, endCol: 3 };
      const replacement = workbook();
      replacement.name = 'replacement';
      instance = make({
        workbook: workbook(),
        onChange: () => {
          if (reentered) return;
          reentered = true;
          if (action === 'select') instance.select(selection);
          else if (action === 'load') instance.load(replacement);
          else instance.undo();
        },
      });
      instance.select({ row: 1, col: 0, endRow: 3, endCol: 1 });
      instance.sortRows(ascending);
      if (action === 'select') expect(instance.selectedRange).toEqual(selection);
      else if (action === 'load') {
        expect(instance.toJSON().name).toBe('replacement');
        expect(instance.selectedRange).toEqual({ row: 0, col: 0 });
      } else {
        expect(instance.getValue('A2')).toBe(30);
        expect(instance.selectedRange).toEqual({ row: 1, col: 0, endRow: 3, endCol: 1 });
        instance.redo();
        expect(instance.getValue('A2')).toBe(10);
      }
    },
  );
});

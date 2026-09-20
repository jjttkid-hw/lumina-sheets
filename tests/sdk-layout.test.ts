import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import type { Sheet } from '../src/lib/types';

const mounting = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => mounting) }));
import { LuminaSpreadsheet, type SheetLayout } from '../src/sdk';

class Host {
  className = 'layout-host';
  classList = { add: (name: string) => (this.className += ` ${name}`) };
}
const instances: LuminaSpreadsheet[] = [];
function make(options: ConstructorParameters<typeof LuminaSpreadsheet>[1] = {}) {
  const instance = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, options);
  instances.push(instance);
  return instance;
}
function workbook() {
  const book = createBlankWorkbook('布局测试');
  Object.assign(book.sheets[0], {
    rowCount: 20,
    colCount: 10,
    columnWidths: { 0: 120 },
    rowHeights: { 0: 40 },
    hiddenRows: [2],
    hiddenColumns: [3],
    frozenRows: 1,
    cells: { A1: { value: 10 }, B1: { value: '=A1*2' } },
  });
  book.sheets.push({ id: 'second', name: '另一表', rowCount: 10, colCount: 5, cells: {} });
  return book;
}
beforeEach(() => {
  vi.stubGlobal('HTMLElement', Host);
  vi.clearAllMocks();
});
afterEach(() => {
  instances.forEach((instance) => instance.destroy());
  instances.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SDK sparse layout API', () => {
  it('commits five layout fields in one isolated history transaction and event', () => {
    const onChange = vi.fn();
    const instance = make({ workbook: workbook(), onChange });
    const original = instance.getSheetLayout();
    const cells = instance.activeSheet.cells;
    const next: SheetLayout = {
      columnWidths: { 1: 88 },
      rowHeights: { 4: 51 },
      hiddenRows: [4, 5],
      hiddenColumns: [1, 2],
      frozenRows: 2,
    };
    const changed = vi.fn();
    instance.subscribe(changed);
    instance.setSheetLayout(next);
    expect(instance.getSheetLayout()).toEqual(next);
    next.rowHeights![4] = 99;
    next.hiddenRows!.push(6);
    expect(instance.getSheetLayout().rowHeights).toEqual({ 4: 51 });
    expect(instance.getSheetLayout().hiddenRows).toEqual([4, 5]);
    const result = instance.getSheetLayout();
    result.columnWidths![1] = 199;
    result.hiddenColumns!.push(4);
    expect(instance.getSheetLayout().columnWidths).toEqual({ 1: 88 });
    expect(instance.getSheetLayout().hiddenColumns).toEqual([1, 2]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      sheetId: instance.activeSheetInfo.id,
      changes: [],
    });
    instance.undo();
    expect(instance.getSheetLayout()).toEqual(original);
    instance.redo();
    expect(instance.getSheetLayout().rowHeights).toEqual({ 4: 51 });
    expect(instance.activeSheet.cells).toEqual(cells);
    expect(instance.getValue('B1')).toBe(20);
  });

  it('retains omitted fields and clears fields explicitly assigned undefined', () => {
    const instance = make({ workbook: workbook() });
    instance.setSheetLayout({ frozenRows: 3 });
    expect(instance.getSheetLayout()).toMatchObject({
      frozenRows: 3,
      rowHeights: { 0: 40 },
      hiddenRows: [2],
      hiddenColumns: [3],
    });
    instance.setSheetLayout({ rowHeights: undefined, hiddenRows: undefined });
    expect(instance.getSheetLayout().rowHeights).toBeUndefined();
    expect(instance.getSheetLayout().hiddenRows).toBeUndefined();
    expect(instance.getSheetLayout().hiddenColumns).toEqual([3]);
    instance.undo();
    expect(instance.getSheetLayout().rowHeights).toEqual({ 0: 40 });
    expect(instance.getSheetLayout().hiddenRows).toEqual([2]);
    expect(instance.getSheetLayout().frozenRows).toBe(3);
  });

  it('preserves redo and emits no history or notification for equivalent layouts', () => {
    const onChange = vi.fn();
    const instance = make({ workbook: workbook(), onChange });
    instance.setSheetLayout({ hiddenRows: [2, 3] });
    instance.setRowHeight(0, 60);
    instance.undo();
    const changed = vi.fn();
    instance.subscribe(changed);
    onChange.mockClear();
    const revision = instance.snapshot();
    instance.setSheetLayout({});
    instance.setSheetLayout({ hiddenRows: [3, 2], rowHeights: { 0: 40 } });
    instance.setColumnWidth(0, 120);
    instance.setRowsHidden(2, 2);
    instance.setRowsHidden(7, 3, false);
    expect(instance.snapshot()).toBe(revision);
    expect(changed).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    instance.redo();
    expect(instance.getSheetLayout().rowHeights).toEqual({ 0: 60 });
  });

  it.each([
    null,
    [],
    { cells: {} },
    { frozenRows: 21 },
    { frozenRows: null },
    { columnWidths: { 0: 31 } },
    { columnWidths: { 0: 2001 } },
    { columnWidths: { '01': 100 } },
    { rowHeights: { 20: 50 } },
    { rowHeights: { 0: 0 } },
    { rowHeights: { 0: Number.NaN } },
    { rowHeights: new Date() },
    { columnWidths: new Map([[0, 100]]) },
    { rowHeights: { [Symbol('unknown')]: 10 } },
    { hiddenRows: [2, 2] },
    { hiddenColumns: [10] },
    { hiddenRows: new Array(1) },
  ])('rejects an invalid batch atomically: %j', (invalid) => {
    const onChange = vi.fn();
    const instance = make({ workbook: workbook(), onChange });
    const before = instance.toJSON();
    expect(() => instance.setSheetLayout(invalid as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(instance.toJSON()).toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
    instance.undo();
    expect(instance.toJSON()).toEqual(before);
  });

  it('rejects all fields when even one proposed field fails validation', () => {
    const instance = make({ workbook: workbook() });
    const original = instance.getSheetLayout();
    expect(() =>
      instance.setSheetLayout({ frozenRows: 2, hiddenRows: [3], rowHeights: { 0: 601 } }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(instance.getSheetLayout()).toEqual(original);
    instance.undo();
    expect(instance.getSheetLayout()).toEqual(original);
  });

  it('reads sparse metadata without accessing the cell store', () => {
    const instance = make({ workbook: workbook() });
    // The public surface exposes the actual renderer sheet; install a throwing
    // getter after construction so a whole-sheet clone cannot pass this test.
    const surfaceSheet: Sheet = instance.surface().props.sheet;
    const cellStore = surfaceSheet.cells;
    Object.defineProperty(surfaceSheet, 'cells', {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error('layout getter accessed cells');
      },
    });
    try {
      expect(instance.getSheetLayout()).toEqual({
        columnWidths: { 0: 120 },
        rowHeights: { 0: 40 },
        hiddenRows: [2],
        hiddenColumns: [3],
        frozenRows: 1,
      });
    } finally {
      Object.defineProperty(surfaceSheet, 'cells', { configurable: true, value: cellStore });
    }
  });

  it('updates layout without enumerating cells or collapsing the selected range', () => {
    const instance = make({ workbook: workbook() });
    const selected = { row: 1, col: 1, endRow: 7, endCol: 6 };
    instance.select(selected);
    const sheet: Sheet = instance.surface().props.sheet;
    const cells = sheet.cells;
    sheet.cells = new Proxy(cells, {
      ownKeys: () => {
        throw new Error('layout setter enumerated cells');
      },
      get: () => {
        throw new Error('layout setter read a cell');
      },
    });
    try {
      instance.setSheetLayout({ hiddenRows: [3], frozenRows: 2, columnWidths: { 0: 90 } });
      expect(instance.getSheetLayout().hiddenRows).toEqual([3]);
      expect(instance.selectedRange).toEqual(selected);
      instance.undo();
      expect(instance.selectedRange).toEqual(selected);
      instance.redo();
      expect(instance.selectedRange).toEqual(selected);
    } finally {
      sheet.cells = cells;
    }
  });

  it.each(['load', 'undo'] as const)(
    'keeps coherent layout state when onChange reenters with %s',
    (action) => {
      let instance!: LuminaSpreadsheet;
      let reentered = false;
      const replacement = workbook();
      replacement.name = 'replacement';
      replacement.sheets[0].frozenRows = 4;
      instance = make({
        workbook: workbook(),
        onChange: () => {
          if (reentered) return;
          reentered = true;
          expect(instance.getSheetLayout().frozenRows).toBe(3);
          if (action === 'load') instance.load(replacement);
          else instance.undo();
        },
      });
      instance.setSheetLayout({ frozenRows: 3, hiddenRows: [5] });
      expect(instance.getSheetLayout().frozenRows).toBe(action === 'load' ? 4 : 1);
      expect(instance.getSheetLayout().hiddenRows).toEqual([2]);
      if (action === 'load') {
        instance.undo();
        expect(instance.toJSON().name).toBe('replacement');
        expect(instance.getSheetLayout().frozenRows).toBe(4);
      } else {
        instance.redo();
        expect(instance.getSheetLayout().frozenRows).toBe(3);
        expect(instance.getSheetLayout().hiddenRows).toEqual([5]);
      }
    },
  );

  it('does not overwrite a workbook loaded by a layout subscription', () => {
    const instance = make({ workbook: workbook() });
    const replacement = workbook();
    replacement.sheets[0].frozenRows = 4;
    let replaced = false;
    instance.subscribe(() => {
      if (replaced) return;
      replaced = true;
      instance.load(replacement);
    });
    instance.setSheetLayout({ frozenRows: 3 });
    expect(instance.getSheetLayout().frozenRows).toBe(4);
    instance.undo();
    expect(instance.getSheetLayout().frozenRows).toBe(4);
  });

  it('targets an inactive sheet and uses the same atomic layout history for convenience methods', () => {
    const instance = make({ workbook: workbook() });
    const first = instance.getSheetLayout();
    instance.setSheetLayout({ hiddenRows: [4], frozenRows: 2 }, 'second');
    instance.setColumnWidth(1, 32, 'second');
    instance.setRowHeight(2, 1, 'second');
    expect(instance.getSheetLayout('second')).toMatchObject({
      hiddenRows: [4],
      frozenRows: 2,
      columnWidths: { 1: 32 },
      rowHeights: { 2: 1 },
    });
    expect(instance.getSheetLayout()).toEqual(first);
    instance.undo();
    expect(instance.getSheetLayout('second').rowHeights).toBeUndefined();
    instance.undo();
    expect(instance.getSheetLayout('second').columnWidths).toBeUndefined();
    instance.undo();
    expect(instance.getSheetLayout('second').hiddenRows).toBeUndefined();
    expect(() => instance.getSheetLayout('missing')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    for (const [col, width] of [
      [-1, 100],
      [10, 100],
      [0, 31],
      [0, 2001],
      [0, Infinity],
    ])
      expect(() => instance.setColumnWidth(col, width)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
  });

  it('clears a million-row range by filtering stored hidden coordinates', () => {
    const book = workbook();
    book.sheets[0].rowCount = 1_048_576;
    book.sheets[0].hiddenRows = [2, 20, 1_048_575];
    const instance = make({ workbook: book });
    const remove = vi.spyOn(Set.prototype, 'delete');
    instance.setRowsHidden(0, 1_048_576, false);
    expect(instance.getSheetLayout().hiddenRows).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
    remove.mockRestore();
    instance.undo();
    expect(instance.getSheetLayout().hiddenRows).toEqual([2, 20, 1_048_575]);
  });

  it('enforces readonly, paged and destroyed guards while allowing metadata reads', async () => {
    const readonly = make({ workbook: workbook(), readOnly: true });
    expect(readonly.getSheetLayout().frozenRows).toBe(1);
    for (const action of [
      () => readonly.setSheetLayout({}),
      () => readonly.setColumnWidth(0, 100),
      () => readonly.setRowHeight(0, 40),
      () => readonly.setRowsHidden(0, 1),
      () => readonly.setColumnsHidden(0, 1),
    ])
      expect(action).toThrowError(expect.objectContaining({ code: 'READ_ONLY' }));
    const paged = make();
    await paged.bindData({ columnCount: 1, rowCount: 0, fetchPage: async () => ({ rows: [] }) });
    expect(paged.getSheetLayout().hiddenRows).toEqual([]);
    expect(() => paged.setSheetLayout({ frozenRows: 0 })).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY' }),
    );
    readonly.destroy();
    expect(() => readonly.getSheetLayout()).toThrowError(
      expect.objectContaining({ code: 'DESTROYED' }),
    );
    expect(() => readonly.setSheetLayout({})).toThrowError(
      expect.objectContaining({ code: 'DESTROYED' }),
    );
  });
});

describe('SDK local filter view state', () => {
  it('publishes a new paint version for layout changes without invalidating the filter source', () => {
    const instance = make({ workbook: workbook() });
    instance.setFilter('10');
    const before = instance.surface().props;
    instance.setSheetLayout({ hiddenRows: [], hiddenColumns: [] });
    const after = instance.surface().props;
    expect(after.renderVersion).toBeGreaterThan(before.renderVersion);
    expect(after.calculationVersion).toBe(before.calculationVersion);
    expect(after.sheet.hiddenRows).toEqual([]);
    instance.undo();
    const restored = instance.surface().props;
    expect(restored.renderVersion).toBeGreaterThan(after.renderVersion);
    expect(restored.calculationVersion).toBe(before.calculationVersion);
    expect(restored.sheet.hiddenRows).toEqual([2]);
  });

  it('keeps the calculation version stable for selection and layout but updates value edits and history', () => {
    const instance = make({ workbook: workbook() });
    const version = () => instance.surface().props.calculationVersion;
    const initial = version();
    instance.setFilter('10');
    instance.select({ row: 1, col: 2, endRow: 4, endCol: 3 });
    instance.setSheetLayout({ columnWidths: { 0: 160 }, hiddenRows: [2, 5] });
    instance.setRowHeight(0, 55);
    instance.undo();
    instance.redo();
    expect(version()).toBe(initial);
    instance.setCell('A1', 10, { bold: true });
    expect(version()).toBe(initial);
    instance.setCell('A1', 11);
    expect(version()).toBe(initial + 1);
    expect(instance.getValue('B1')).toBe(22);
    instance.undo();
    expect(version()).toBe(initial + 2);
    expect(instance.getValue('B1')).toBe(20);
    instance.redo();
    expect(version()).toBe(initial + 3);
    expect(instance.getValue('B1')).toBe(22);
    instance.setCells([{ key: 'A1', cell: null }]);
    expect(version()).toBe(initial + 4);
  });

  it('updates the calculation version when replacing or structurally editing the value source', async () => {
    const instance = make({ workbook: workbook() });
    const version = () => instance.surface().props.calculationVersion;
    let previous = version();
    instance.insertRows(1);
    expect(version()).toBeGreaterThan(previous);
    previous = version();
    instance.undo();
    expect(version()).toBeGreaterThan(previous);
    previous = version();
    instance.load(workbook());
    expect(version()).toBeGreaterThan(previous);
    previous = version();
    await instance.bindData({
      columnCount: 1,
      rowCount: 1,
      fetchPage: async () => ({ rows: [[7]], totalRows: 1 }),
    });
    expect(version()).toBeGreaterThan(previous);
    expect(instance.getValue('A1')).toBe(7);
    previous = version();
    instance.clearDataCache();
    expect(version()).toBeGreaterThan(previous);
  });

  it('forwards a trimmed filter without changing data, events, formula cache or edit history', () => {
    const onChange = vi.fn();
    const instance = make({ workbook: workbook(), onChange });
    instance.setCell('A1', 15);
    instance.undo();
    const before = instance.toJSON();
    expect(instance.getValue('B1')).toBe(20);
    const stats = instance.calculationStats;
    const listener = vi.fn();
    instance.subscribe(listener);
    onChange.mockClear();
    instance.setFilter('  SALES  ');
    expect(instance.filterText).toBe('SALES');
    expect(instance.surface().props.filter).toBe('SALES');
    expect(instance.toJSON()).toEqual(before);
    expect(instance.calculationStats).toEqual(stats);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    instance.setFilter('SALES');
    expect(listener).toHaveBeenCalledTimes(1);
    instance.redo();
    expect(instance.getValue('A1')).toBe(15);
    expect(instance.filterText).toBe('SALES');
    instance.setFilter(' ');
    expect(instance.filterText).toBe('');
  });

  it('allows static readonly filters, rejects invalid values and resets on load and bind', async () => {
    const instance = make({ readOnly: true });
    instance.setFilter('ok');
    expect(instance.filterText).toBe('ok');
    expect(() => instance.setFilter(3 as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    instance.load(workbook());
    expect(instance.filterText).toBe('');
    instance.setFilter('next');
    await instance.bindData({ columnCount: 1, rowCount: 0, fetchPage: async () => ({ rows: [] }) });
    expect(instance.filterText).toBe('');
    expect(instance.surface().props.filter).toBe('');
    expect(() => instance.setFilter('partial')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    instance.setFilter('');
    instance.destroy();
    expect(() => instance.setFilter('')).toThrowError(
      expect.objectContaining({ code: 'DESTROYED' }),
    );
    expect(() => instance.filterText).toThrowError(expect.objectContaining({ code: 'DESTROYED' }));
  });

  it('rejects filtering a persisted paged sheet even without an attached source', () => {
    const book = workbook();
    book.sheets[0].dataSource = { kind: 'paged', totalRows: 20, pageSize: 10 };
    const instance = make({ workbook: book });
    expect(() => instance.setFilter('missing pages')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });

  it('isolates render callbacks and suppresses a stale callback after a reentrant view change', () => {
    let instance!: LuminaSpreadsheet;
    const onError = vi.fn();
    const onRender = vi.fn(() => {
      instance.setFilter('reentered');
      throw new Error('host render failure');
    });
    instance = make({ onRender, onError });
    const oldSurface = instance.surface();
    const metrics = { drawMs: 1, paintedCells: 20, domNodes: 5 };
    expect(() => oldSurface.props.onRenderMetrics(metrics)).not.toThrow();
    expect(instance.filterText).toBe('reentered');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'host render failure' }),
    );
    oldSurface.props.onRenderMetrics(metrics);
    expect(onRender).toHaveBeenCalledTimes(1);
    const newSurface = instance.surface();
    instance.destroy();
    newSurface.props.onRenderMetrics(metrics);
    expect(onRender).toHaveBeenCalledTimes(1);
  });
});

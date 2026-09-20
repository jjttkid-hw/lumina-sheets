import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import type { ReportDataSource, ReportPage } from '../src/lib/report-data';
import type { Workbook } from '../src/lib/types';

const mounting = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => mounting) }));
import { LuminaSpreadsheet } from '../src/sdk';

class TestElement {
  className = 'customer-host';
  classList = {
    add: (name: string) => {
      this.className += ` ${name}`;
    },
  };
}
let instances: LuminaSpreadsheet[] = [];
const make = (options: ConstructorParameters<typeof LuminaSpreadsheet>[1] = {}) => {
  const host = new TestElement() as unknown as HTMLElement;
  const instance = new LuminaSpreadsheet(host, options);
  instances.push(instance);
  return { instance, host };
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubGlobal('HTMLElement', TestElement);
  vi.clearAllMocks();
});
afterEach(() => {
  instances.forEach((instance) => instance.destroy());
  instances = [];
  vi.unstubAllGlobals();
});

describe('embeddable SDK edit controller', () => {
  it('recalculates formula chains after edits, undo and redo', () => {
    const { instance } = make();
    instance.setCells([
      { key: 'A1', cell: { value: 3 } },
      { key: 'B1', cell: { value: '=A1*2' } },
      { key: 'C1', cell: { value: '=B1+1' } },
    ]);
    expect(instance.getValue('C1')).toBe(7);
    instance.setCell('$a$1', 5);
    expect(instance.getValue('c1')).toBe(11);
    instance.undo();
    expect(instance.getValue('C1')).toBe(7);
    instance.redo();
    expect(instance.getValue('C1')).toBe(11);
  });

  it('makes batches atomic, canonicalizes duplicate keys, and isolates input/event objects', () => {
    const onChange = vi.fn((event) => {
      if (event.changes[0]?.cell) event.changes[0].cell.value = 999;
    });
    const { instance } = make({ onChange });
    instance.setCell('A1', 1);
    expect(instance.getValue('A1')).toBe(1);
    expect(() =>
      instance.setCells([
        { key: 'A1', cell: { value: 2 } },
        { key: 'NOT A CELL', cell: { value: 3 } },
      ]),
    ).toThrow('无效地址');
    expect(instance.getValue('A1')).toBe(1);
    const cell = { value: 4, style: { bold: true } };
    instance.setCells([
      { key: 'a1', cell: { value: 2 } },
      { key: '$A$1', cell },
    ]);
    cell.value = 100;
    cell.style.bold = false;
    expect(instance.getValue('A1')).toBe(4);
    expect(instance.activeSheet.cells.A1.style?.bold).toBe(true);
    instance.undo();
    expect(instance.getValue('A1')).toBe(1);
    instance.redo();
    expect(instance.getValue('A1')).toBe(4);
    expect(onChange.mock.calls[1][0].changes).toHaveLength(1);
  });

  it('restores dimensions when undoing expanding edits and clears redo after a new edit', () => {
    const { instance } = make();
    const { rowCount, colCount } = instance.activeSheet;
    instance.setCell('XFD1048576', 42);
    expect(instance.activeSheet.rowCount).toBe(1_048_576);
    expect(instance.activeSheet.colCount).toBe(16_384);
    instance.undo();
    expect(instance.activeSheet.rowCount).toBe(rowCount);
    expect(instance.activeSheet.colCount).toBe(colCount);
    expect(instance.getValue('XFD1048576')).toBe('');
    instance.redo();
    expect(instance.getValue('XFD1048576')).toBe(42);
    instance.undo();
    instance.setCell('A1', 'new');
    instance.redo();
    expect(instance.getValue('XFD1048576')).toBe('');
  });

  it('preserves formatting for canonical addresses and tracks column geometry undo', () => {
    const { instance } = make();
    instance.setCell('A1', 1, { bold: true });
    instance.setCell('$a$1', 2);
    expect(instance.activeSheet.cells.A1.style?.bold).toBe(true);
    const oldWidth = instance.activeSheet.columnWidths?.[0];
    const sheet = instance.activeSheet;
    instance
      .surface()
      .props.onChange({ ...sheet, columnWidths: { ...sheet.columnWidths, 0: 234 } });
    expect(instance.activeSheet.columnWidths?.[0]).toBe(234);
    instance.undo();
    expect(instance.activeSheet.columnWidths?.[0]).toBe(oldWidth);
    instance.redo();
    expect(instance.activeSheet.columnWidths?.[0]).toBe(234);
    expect(instance.getValue('A1')).toBe(2);
  });

  it('isolates and tracks row heights and hidden axes through metadata undo', () => {
    const { instance } = make();
    const next = {
      ...instance.activeSheet,
      rowHeights: { 2: 40 },
      hiddenRows: [3],
      hiddenColumns: [2],
    };
    instance.surface().props.onChange(next);
    next.rowHeights[2] = 99;
    next.hiddenRows.push(4);
    expect(instance.activeSheet.rowHeights).toEqual({ 2: 40 });
    expect(instance.activeSheet.hiddenRows).toEqual([3]);
    expect(instance.activeSheet.hiddenColumns).toEqual([2]);
    instance.undo();
    expect(instance.activeSheet.rowHeights).toBeUndefined();
    expect(instance.activeSheet.hiddenRows).toBeUndefined();
    instance.redo();
    expect(instance.activeSheet.rowHeights).toEqual({ 2: 40 });
    expect(instance.activeSheet.hiddenRows).toEqual([3]);
    const invalid = instance.toJSON();
    invalid.sheets[0].hiddenColumns = [2, 2];
    expect(() => instance.load(invalid)).toThrow('隐藏列');
    expect(instance.activeSheet.hiddenColumns).toEqual([2]);
  });

  it('exposes atomic row/column visibility and height APIs with validation', () => {
    const { instance } = make();
    instance.setRowHeight(2, 42);
    instance.setRowsHidden(3, 2);
    instance.setColumnsHidden(1, 2);
    expect(instance.activeSheet.rowHeights).toEqual({ 2: 42 });
    expect(instance.activeSheet.hiddenRows).toEqual([3, 4]);
    expect(instance.activeSheet.hiddenColumns).toEqual([1, 2]);
    instance.undo();
    expect(instance.activeSheet.hiddenColumns).toBeUndefined();
    instance.redo();
    instance.setRowsHidden(3, 2, false);
    expect(instance.activeSheet.hiddenRows).toEqual([]);
    for (const action of [
      () => instance.setRowHeight(-1, 20),
      () => instance.setRowHeight(0, 601),
      () => instance.setRowsHidden(99, 2),
      () => instance.setColumnsHidden(15, 2),
      () => instance.setRowsHidden(0, 1, 'yes' as unknown as boolean),
    ])
      expect(action).toThrow();
  });

  it('readOnly rejects all editing paths and exposes isolated snapshots', () => {
    const workbook = createBlankWorkbook();
    workbook.sheets[0].cells.A1 = { value: 1 };
    const options = { workbook, readOnly: true };
    const { instance } = make(options);
    options.readOnly = false;
    workbook.sheets[0].cells.A1.value = 9;
    instance.activeSheet.cells.A1.value = 10;
    instance.toJSON().sheets[0].cells.A1.value = 11;
    expect(instance.getValue('A1')).toBe(1);
    expect(() => instance.setCell('A1', 2)).toThrow('只读');
    expect(() => instance.setCells([])).toThrow('只读');
    expect(() => instance.undo()).toThrow('只读');
    expect(() => instance.redo()).toThrow('只读');
    expect(() =>
      instance
        .surface()
        .props.onPatch(instance.activeSheet.id, [{ key: 'A1', cell: { value: 3 } }]),
    ).toThrow('只读');
    expect(() => instance.surface().props.onChange(instance.activeSheet)).toThrow('只读');
    expect(instance.surface().props.readOnly).toBe(true);
    instance.select({ row: 1, col: 1 });
    expect(instance.selectedRange).toEqual({ row: 1, col: 1 });
  });

  it('validates load atomically without imposing the file-import 100k-cell quota', () => {
    const { instance } = make();
    instance.setCell('A1', 'keep');
    const bad = instance.toJSON();
    bad.sheets[0].rowCount = 1_048_577;
    expect(() => instance.load(bad)).toThrow('尺寸');
    expect(instance.getValue('A1')).toBe('keep');
    const large = createBlankWorkbook();
    large.sheets[0].rowCount = 100_001;
    large.sheets[0].colCount = 1;
    large.sheets[0].columnWidths = {};
    for (let row = 1; row <= 100_001; row++) large.sheets[0].cells[`A${row}`] = { value: row };
    instance.load(large);
    expect(instance.getValue('A100001')).toBe(100_001);
    instance.undo();
    expect(instance.getValue('A100001')).toBe(100_001);
  });

  it.each([
    (book: Workbook) => {
      book.sheets[0].colCount = 16_385;
    },
    (book: Workbook) => {
      book.sheets[0].cells.A101 = { value: 1 };
      book.sheets[0].rowCount = 100;
    },
    (book: Workbook) => {
      book.sheets[0].cells.A1 = { value: Infinity };
    },
    (book: Workbook) => {
      book.activeSheetId = 'missing';
    },
    (book: Workbook) => {
      book.sheets.push({ ...book.sheets[0] });
    },
  ])('rejects invalid constructor snapshots before mounting', (mutate) => {
    const workbook = createBlankWorkbook();
    mutate(workbook);
    expect(() => make({ workbook })).toThrow();
    expect(mounting.render).not.toHaveBeenCalled();
  });

  it('contains callback errors so committed edits remain undoable', () => {
    const onError = vi.fn();
    const { instance } = make({
      onChange: () => {
        throw new Error('host failed');
      },
      onError,
    });
    expect(() => instance.setCell('A1', 2)).not.toThrow();
    expect(instance.getValue('A1')).toBe(2);
    instance.undo();
    expect(instance.getValue('A1')).toBe('');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'host failed' }));
  });

  it('keeps undo history coherent when a host change callback performs a new edit', () => {
    let addFollowup = false;
    const { instance } = make({
      onChange: () => {
        if (addFollowup) {
          addFollowup = false;
          instance.setCell('B1', 9);
        }
      },
    });
    instance.setCell('A1', 1);
    addFollowup = true;
    instance.undo();
    expect(instance.getValue('A1')).toBe('');
    expect(instance.getValue('B1')).toBe(9);
    instance.redo();
    expect(instance.getValue('A1')).toBe('');
    instance.undo();
    expect(instance.getValue('B1')).toBe('');
  });
});

describe('SDK paged source lifecycle', () => {
  it('exports every data source row as CSV without filling the viewport cache or workbook', async () => {
    const { instance } = make();
    const source: ReportDataSource = {
      rowCount: 300,
      columnCount: 1,
      fetchPage: vi.fn(async (offset, limit) => ({
        rows: Array.from({ length: limit }, (_, index) => [offset + index]),
        totalRows: 300,
      })),
    };
    await instance.bindData(source, { pageSize: 4, maxPages: 1 });
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => link), body: { append: vi.fn() } });
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report');
    await instance.export('csv');
    const blob = createUrl.mock.calls[0][0] as Blob;
    const text = await blob.text();
    expect(text).toContain('0\r\n1\r\n');
    expect(text).toMatch(/298\r\n299\r\n$/);
    expect(
      (source.fetchPage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]),
    ).toEqual([0, 0, 256]);
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(instance.activeSheet.cells).toEqual({});
    expect(instance.dataSourceStats?.cachedPages).toBe(1);
    await expect(instance.export('xlsx')).rejects.toThrow('完整 CSV');
    createUrl.mockRestore();
  });

  it('updates unknown dimensions from the first page and protects column boundaries', async () => {
    const { instance } = make();
    const gate = deferred<ReportPage>();
    const source: ReportDataSource = { columnCount: 2, fetchPage: () => gate.promise };
    const binding = instance.bindData(source, { pageSize: 4, maxPages: 1 });
    expect(instance.activeSheet.rowCount).toBe(1_048_576);
    gate.resolve({
      rows: [
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ],
      totalRows: 3,
    });
    await binding;
    expect(instance.activeSheet.rowCount).toBe(3);
    expect(instance.activeSheet.cells).toEqual({});
    expect(instance.getValue('B3')).toBe(3);
    expect(instance.getValue('C3')).toBe('');
    expect(instance.getValue('A4')).toBe('');
    expect(() => instance.setCell('A1', 5)).toThrow('只读');
    expect(() => instance.undo()).toThrow('只读');
  });

  it('does not refetch failed ranges on redraw, but permits explicit retry', async () => {
    const onError = vi.fn();
    const { instance } = make({ onError });
    const fetchPage = vi.fn(async (offset: number, limit: number) => ({
      rows: Array.from({ length: limit }, (_, index) => [offset + index]),
      totalRows: 100,
    }));
    await instance.bindData(
      { columnCount: 1, rowCount: 100, fetchPage },
      { pageSize: 4, maxPages: 1 },
    );
    fetchPage.mockRejectedValueOnce(new Error('offline'));
    const unsubscribe = instance.subscribe(() => instance.viewport({ firstRow: 40, lastRow: 43 }));
    instance.viewport({ firstRow: 40, lastRow: 43 });
    await tick();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    instance.viewport({ firstRow: 40, lastRow: 43 });
    await tick();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    instance.retryData();
    await tick();
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(instance.getValue('A41')).toBe(40);
    unsubscribe();
  });

  it('aborts stale viewport loads when the visible range moves', async () => {
    const { instance } = make();
    const signals: AbortSignal[] = [];
    const fetchPage = vi.fn(
      async (offset: number, limit: number, signal?: AbortSignal): Promise<ReportPage> => {
        if (offset === 0) return { rows: [[0], [1], [2], [3]], totalRows: 100 };
        signals.push(signal!);
        if (offset === 40) return new Promise(() => {});
        return { rows: Array.from({ length: limit }, (_, i) => [offset + i]), totalRows: 100 };
      },
    );
    await instance.bindData(
      { columnCount: 1, rowCount: 100, fetchPage },
      { pageSize: 4, maxPages: 1 },
    );
    instance.viewport({ firstRow: 40, lastRow: 43 });
    await Promise.resolve();
    instance.viewport({ firstRow: 80, lastRow: 83 });
    await tick();
    expect(signals[0].aborted).toBe(true);
    expect(instance.getValue('A81')).toBe(80);
    expect(instance.dataSourceStats?.cachedPages).toBe(1);
  });

  it('load isolates old responses and invalid sources do not clear current data', async () => {
    const { instance } = make();
    instance.setCell('A1', 'saved');
    expect(() =>
      instance.bindData({ columnCount: 0, fetchPage: async () => ({ rows: [] }) }),
    ).toThrow();
    expect(instance.getValue('A1')).toBe('saved');
    const gate = deferred<ReportPage>();
    const binding = instance.bindData({ columnCount: 1, fetchPage: () => gate.promise });
    const cancelled = expect(binding).rejects.toHaveProperty('name', 'AbortError');
    await Promise.resolve();
    const next = createBlankWorkbook();
    next.sheets[0].cells.A1 = { value: 'new book' };
    instance.load(next);
    await cancelled;
    gate.resolve({ rows: [[9]], totalRows: 1 });
    await tick();
    expect(instance.getValue('A1')).toBe('new book');
    expect(instance.dataSourceStats).toBeNull();
  });

  it('destroy releases cache and mounting and rejects future operations', async () => {
    const { instance, host } = make();
    const binding = instance.bindData({ columnCount: 1, fetchPage: () => new Promise(() => {}) });
    const cancelled = expect(binding).rejects.toHaveProperty('name', 'AbortError');
    instance.destroy();
    await cancelled;
    expect(host.className).toBe('customer-host');
    expect(mounting.unmount).toHaveBeenCalledTimes(1);
    expect(() => instance.setCell('A1', 1)).toThrow('销毁');
    expect(() => instance.undo()).toThrow('销毁');
    expect(() => instance.setConditionalRules([])).toThrow('销毁');
    expect(() => instance.getValue('A1')).toThrow('销毁');
    instance.destroy();
    expect(mounting.unmount).toHaveBeenCalledTimes(1);
  });
});

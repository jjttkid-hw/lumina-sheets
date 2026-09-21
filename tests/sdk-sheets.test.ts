import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import type { ReportPage } from '../src/lib/report-data';
const io = vi.hoisted(() => ({
  export: vi.fn(async (..._args: unknown[]) => {}),
  import: vi.fn(),
}));
vi.mock('../src/lib/io', async (original) => ({
  ...(await original<typeof import('../src/lib/io')>()),
  exportWorkbook: io.export,
  importFile: io.import,
}));
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render() {}, unmount() {} }) }));
import { LuminaSpreadsheet } from '../src/sdk';
class Host {
  className = '';
  classList = { add() {} };
}
const instances: LuminaSpreadsheet[] = [];
function book() {
  const value = createBlankWorkbook('sheets');
  value.sheets[0].name = 'Data';
  value.sheets[0].cells = { A1: { value: 3 }, B1: { value: '=A1*2' } };
  value.sheets.push({
    id: 'summary',
    name: 'Summary',
    rowCount: 20,
    colCount: 8,
    cells: { A1: { value: '=Data!A1*3' }, A2: { value: 'summary' } },
  });
  return value;
}
function make(options: ConstructorParameters<typeof LuminaSpreadsheet>[1] = {}) {
  const grid = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, {
    workbook: book(),
    ...options,
  });
  instances.push(grid);
  return grid;
}
beforeEach(() => {
  vi.stubGlobal('HTMLElement', Host);
  vi.clearAllMocks();
});
afterEach(() => {
  instances.splice(0).forEach((grid) => grid.destroy());
  vi.unstubAllGlobals();
});

describe('SDK active worksheet ownership', () => {
  it('applies page payload budgets through bindData and preserves data on invalid configuration', async () => {
    const grid = make();
    const before = grid.toJSON();
    const source = {
      rowCount: 4,
      columnCount: 2,
      fetchPage: vi.fn(async (offset: number, limit: number) => ({
        rows: Array.from({ length: limit }, (_, i) => [offset + i, 'ok']),
      })),
    };
    expect(() => grid.bindData(source, { maxPageCells: 1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(grid.toJSON()).toEqual(before);
    expect(source.fetchPage).not.toHaveBeenCalled();
    await grid.bindData(source, {
      pageSize: 100,
      maxPages: 2,
      maxPageCells: 4,
      maxPageTextUnits: 4,
    });
    expect(source.fetchPage.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [0, 2],
      [2, 2],
    ]);
    expect(grid.getValue('A4')).toBe(3);
    expect(grid.getValue('B4')).toBe('ok');
    expect(grid.toJSON().sheets[0].dataSource?.pageSize).toBe(2);
  });

  it('switches without rebuilding calculation or dropping redo; resets only view state', () => {
    const onActiveSheetChange = vi.fn(),
      onSelectionChange = vi.fn(),
      onChange = vi.fn();
    const grid = make({ onActiveSheetChange, onSelectionChange, onChange });
    const first = grid.activeSheetInfo.id;
    grid.setCell('A1', 4);
    grid.undo();
    expect(grid.getValue('B1')).toBe(6);
    const stats = grid.calculationStats,
      stamp = grid.toJSON().updatedAt;
    grid.setFilter('three');
    grid.select({ row: 2, col: 1, endRow: 3, endCol: 2 });
    onSelectionChange.mockClear();
    onChange.mockClear();
    grid.setActiveSheet('summary');
    expect(grid.calculationStats).toEqual(stats);
    expect(grid.toJSON().updatedAt).toBe(stamp);
    expect(grid.filterText).toBe('');
    expect(grid.selectedRange).toEqual({ row: 0, col: 0 });
    expect(grid.getValue('A1')).toBe(9);
    expect(onActiveSheetChange).toHaveBeenCalledWith({
      previousSheetId: first,
      sheetId: 'summary',
    });
    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith({ row: 0, col: 0 });
    expect(onChange).not.toHaveBeenCalled();
    grid.select({ row: 9, col: 2, endRow: 12, endCol: 4 });
    const selection = grid.selectedRange;
    grid.redo();
    expect(grid.getValue('A1')).toBe(12);
    expect(grid.selectedRange).toEqual(selection);
    grid.undo();
    expect(grid.getValue('A1')).toBe(9);
    expect(grid.selectedRange).toEqual(selection);
    grid.setActiveSheet(first);
    expect(grid.getValue('B1')).toBe(6);
  });
  it('preserves selection and suppresses unrelated selection events for inactive structure undo', () => {
    const onSelectionChange = vi.fn();
    const grid = make({ onSelectionChange });
    grid.insertRows(0);
    grid.setActiveSheet('summary');
    grid.select({ row: 8, col: 2, endRow: 10, endCol: 3 });
    onSelectionChange.mockClear();
    const selected = grid.selectedRange;
    grid.undo();
    expect(grid.getValue('A1')).toBe(9);
    expect(grid.selectedRange).toEqual(selected);
    grid.redo();
    expect(grid.getValue('A1')).toBe(9);
    expect(grid.selectedRange).toEqual(selected);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });
  it('rejects invalid targets and callbacks; equal switches do not notify or mutate', () => {
    const changed = vi.fn(),
      grid = make({ onActiveSheetChange: changed });
    grid.select({ row: 3, col: 1 });
    grid.setFilter('text');
    const revision = grid.snapshot(),
      before = grid.toJSON();
    for (const id of ['missing', '', null, 2])
      expect(() => grid.setActiveSheet(id as string)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
    grid.setActiveSheet(grid.activeSheetInfo.id);
    expect(grid.snapshot()).toBe(revision);
    expect(grid.toJSON()).toEqual(before);
    expect(grid.filterText).toBe('text');
    expect(changed).not.toHaveBeenCalled();
    expect(() => make({ onActiveSheetChange: 4 as never })).toThrow();
    grid.destroy();
    expect(() => grid.setActiveSheet('summary')).toThrowError(
      expect.objectContaining({ code: 'DESTROYED' }),
    );
    expect(() => grid.sheetInfos).toThrow();
  });
  it.each(['switch', 'load', 'destroy'] as const)(
    'suppresses stale notifications after subscriber %s',
    (action) => {
      const event = vi.fn(),
        selection = vi.fn();
      const grid = make({ onActiveSheetChange: event, onSelectionChange: selection });
      const first = grid.activeSheetInfo.id;
      let once = false;
      grid.subscribe(() => {
        if (once) return;
        once = true;
        if (action === 'switch') grid.setActiveSheet(first);
        else if (action === 'load') grid.load(book());
        else grid.destroy();
      });
      grid.setActiveSheet('summary');
      expect(event.mock.calls.some(([e]) => e.sheetId === 'summary')).toBe(false);
      expect(selection).toHaveBeenCalledTimes(action === 'switch' ? 1 : 0);
    },
  );
  it('does not emit the old A1 selection when a switch callback chooses another selection', () => {
    const selection = vi.fn();
    let grid!: LuminaSpreadsheet;
    grid = make({
      onSelectionChange: selection,
      onActiveSheetChange() {
        grid.select({ row: 4, col: 2 });
      },
    });
    grid.setActiveSheet('summary');
    expect(selection).toHaveBeenCalledExactlyOnceWith({ row: 4, col: 2 });
  });
  it('rejects old surface writes even after switching away and back, and ignores stale selection', () => {
    const grid = make(),
      initial = grid.activeSheetInfo.id,
      old = grid.surface().props;
    grid.setActiveSheet('summary');
    grid.setActiveSheet(initial);
    old.onSelect({ row: 5, col: 3 });
    expect(grid.selectedRange).toEqual({ row: 0, col: 0 });
    expect(() => old.onPatch!(initial, [{ key: 'A1', cell: { value: 99 } }])).toThrow();
    expect(() => old.onChange(grid.activeSheet)).toThrow();
    expect(grid.getValue('A1')).toBe(3);
    const current = grid.surface().props;
    expect(() => current.onPatch!('summary', [])).toThrow();
    current.onPatch!(initial, [{ key: 'A1', cell: { value: 7 } }]);
    expect(grid.getValue('B1')).toBe(14);
  });
  it('isolates metadata, allows readonly navigation and rejects edits of paged snapshots', async () => {
    const source = book();
    source.sheets[1].dataSource = { kind: 'paged' };
    const grid = make({ workbook: source });
    const infos = grid.sheetInfos;
    expect(infos[0]).not.toHaveProperty('cells');
    infos[0].name = 'mutated';
    expect(grid.activeSheetInfo.name).toBe('Data');
    expect(grid.sheetInfos[1].readOnly).toBe(true);
    grid.setActiveSheet('summary');
    expect(grid.activeSheetInfo.readOnly).toBe(true);
    expect(grid.surface().props.readOnly).toBe(true);
    expect(() => grid.setCell('A1', 8)).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY' }),
    );
    await expect(grid.export('csv')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    grid.setActiveSheet(source.activeSheetId);
    expect(grid.activeSheetInfo.readOnly).toBe(false);
    await expect(grid.export('xlsx')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const readonly = make({ readOnly: true });
    readonly.setActiveSheet('summary');
    expect(readonly.activeSheetInfo.id).toBe('summary');
    expect(() => readonly.setCell('A1', 2)).toThrow();
  });
  it('keeps late bound data isolated and exports the active static sheet, not the inactive source', async () => {
    let resolve!: (page: ReportPage) => void;
    const pending = new Promise<ReportPage>((yes) => {
      resolve = yes;
    });
    const fetchPage = vi.fn(() => pending);
    const grid = make(),
      first = grid.activeSheetInfo.id;
    const binding = grid.bindData({ columnCount: 1, fetchPage });
    const old = grid.surface().props;
    grid.setActiveSheet('summary');
    grid.select({ row: 12, col: 4 });
    old.onViewportChange?.({ firstRow: 40, lastRow: 60 });
    grid.surface().props.onViewportChange?.({ firstRow: 0, lastRow: 19 });
    resolve({ rows: [[11]], totalRows: 1 });
    await binding;
    expect(grid.selectedRange).toEqual({ row: 12, col: 4 });
    expect(grid.getValue('A2')).toBe('summary');
    expect(fetchPage).toHaveBeenCalledTimes(1);
    grid.setFilter('summary');
    expect(grid.filterText).toBe('summary');
    await grid.export('csv');
    expect(io.export).toHaveBeenCalledWith(
      expect.objectContaining({ activeSheetId: 'summary' }),
      'csv',
      expect.anything(),
    );
    await expect(grid.export('json')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    grid.setActiveSheet(first);
    expect(grid.getValue('A1')).toBe(11);
    expect(grid.dataSourceStats?.cachedPages).toBe(1);
  });
  it('keeps an explicitly started import alive across view switches', async () => {
    let resolve!: (value: ReturnType<typeof book>) => void;
    io.import.mockReturnValue(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    const grid = make();
    const importing = grid.import(new File(['{}'], 'book.json'));
    grid.setActiveSheet('summary');
    const incoming = book();
    incoming.name = 'incoming';
    resolve(incoming);
    await importing;
    expect(grid.toJSON().name).toBe('incoming');
    expect(grid.activeSheetInfo.name).toBe('Data');
  });
});

it('does not apply a pending switch to a workbook loaded by a cancellation subscriber', async () => {
  const grid = make();
  await grid.bindData(
    {
      columnCount: 1,
      rowCount: 100,
      fetchPage: async (offset) =>
        offset === 0 ? { rows: [[1]], totalRows: 100 } : new Promise(() => {}),
    },
    { pageSize: 1, maxPages: 1 },
  );
  grid.viewport({ firstRow: 40, lastRow: 40 });
  await Promise.resolve();
  let once = false;
  const replacement = createBlankWorkbook('replacement');
  grid.subscribe(() => {
    if (once) return;
    once = true;
    grid.load(replacement);
  });
  grid.setActiveSheet('summary');
  expect(grid.toJSON()).toEqual(replacement);
  expect(grid.activeSheetInfo.id).toBe(replacement.activeSheetId);
});

it.each(['load', 'destroy', 'rebind', 'viewport', 'switch'] as const)(
  'stops an old viewport after cancellation triggers %s',
  async (action) => {
    const grid = make();
    const fetchPage = vi.fn(async (offset: number): Promise<ReportPage> =>
      offset === 0 ? { rows: [[1]], totalRows: 100 } : new Promise(() => {}),
    );
    await grid.bindData({ columnCount: 1, rowCount: 100, fetchPage }, { pageSize: 1, maxPages: 1 });
    grid.viewport({ firstRow: 40, lastRow: 40 });
    await Promise.resolve();
    const nextFetch = vi.fn(async () => ({ rows: [[9]], totalRows: 100 }));
    let once = false,
      binding: Promise<void> | undefined;
    grid.subscribe(() => {
      if (once) return;
      once = true;
      if (action === 'load') grid.load(createBlankWorkbook('replacement'));
      else if (action === 'destroy') grid.destroy();
      else if (action === 'switch') grid.setActiveSheet('summary');
      else if (action === 'viewport') grid.viewport({ firstRow: 60, lastRow: 60 });
      else
        binding = grid.bindData(
          { columnCount: 1, rowCount: 100, fetchPage: nextFetch },
          { pageSize: 1, maxPages: 1 },
        );
    });
    expect(() => grid.viewport({ firstRow: 80, lastRow: 80 })).not.toThrow();
    if (binding) await binding;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchPage.mock.calls.some(([offset]) => offset === 80)).toBe(false);
    if (action === 'rebind') {
      expect(nextFetch).toHaveBeenCalledTimes(1);
      expect(grid.getValue('A1')).toBe(9);
    } else if (action === 'viewport') {
      expect(fetchPage.mock.calls.filter(([offset]) => offset === 60)).toHaveLength(1);
    } else if (action === 'switch') expect(grid.activeSheetInfo.id).toBe('summary');
  },
);

it('preserves a newer viewport requested from a switch cancellation notification', async () => {
  const grid = make(),
    first = grid.activeSheetInfo.id;
  const fetchPage = vi.fn(async (offset: number): Promise<ReportPage> =>
    offset === 0 ? { rows: [[1]], totalRows: 100 } : new Promise(() => {}),
  );
  await grid.bindData({ columnCount: 1, rowCount: 100, fetchPage }, { pageSize: 1, maxPages: 1 });
  grid.viewport({ firstRow: 40, lastRow: 40 });
  await Promise.resolve();
  let once = false;
  grid.subscribe(() => {
    if (once) return;
    once = true;
    grid.viewport({ firstRow: 60, lastRow: 60 });
  });
  grid.setActiveSheet('summary');
  // Cancellation releases its concurrency slot asynchronously before queued work starts.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(grid.activeSheetInfo.id).toBe(first);
  expect(fetchPage.mock.calls.some(([offset]) => offset === 60)).toBe(true);
});

it('recalculates cross-sheet paged formulas on arrival, eviction and retry, and snapshots CSV values', async () => {
  const grid = make();
  let finish!: (page: ReportPage) => void;
  const firstPage = new Promise<ReportPage>((resolve) => {
    finish = resolve;
  });
  const fetchPage = vi.fn(async (offset: number): Promise<ReportPage> =>
    offset === 0 ? firstPage : { rows: [[20]], totalRows: 100 },
  );
  const first = grid.activeSheetInfo.id;
  const binding = grid.bindData(
    { columnCount: 1, rowCount: 100, fetchPage },
    { pageSize: 1, maxPages: 1 },
  );
  grid.setActiveSheet('summary');
  expect(grid.getValue('A1')).toBe('#N/A');
  finish({ rows: [[11]], totalRows: 100 });
  await binding;
  expect(grid.getValue('A1')).toBe(33);
  await grid.export('csv');
  expect(io.export.mock.calls.at(-1)?.[0]).toMatchObject({
    sheets: expect.arrayContaining([
      expect.objectContaining({
        id: 'summary',
        cells: expect.objectContaining({ A1: expect.objectContaining({ value: '=Data!A1*3' }) }),
      }),
    ]),
  });
  expect(io.export.mock.calls.at(-1)?.[2]).toMatchObject({
    frozenCsvValues: new Map([['A1', 33]]),
  });
  expect(grid.getCell('A1')?.value).toBe('=Data!A1*3');
  grid.setActiveSheet(first);
  grid.viewport({ firstRow: 40, lastRow: 40 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  grid.setActiveSheet('summary');
  expect(grid.getValue('A1')).toBe('#N/A');
  grid.setActiveSheet(first);
  grid.viewport({ firstRow: 0, lastRow: 0 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  grid.setActiveSheet('summary');
  expect(grid.getValue('A1')).toBe(33);
  expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 40, 0]);
});

it('does not bind a different worksheet selected by an old source abort callback', async () => {
  const grid = make();
  const summary = grid.toJSON().sheets[1];
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const old = grid
    .bindData({
      columnCount: 1,
      rowCount: 1,
      fetchPage: async (_offset, _limit, signal) => {
        signal?.addEventListener('abort', () => grid.setActiveSheet('summary'), { once: true });
        started();
        return new Promise(() => {});
      },
    })
    .catch((error) => error);
  await ready;
  const fetchPage = vi.fn(async () => ({ rows: [[2]] }));
  await expect(grid.bindData({ columnCount: 1, rowCount: 1, fetchPage })).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(await old).toMatchObject({ name: 'AbortError' });
  expect(grid.activeSheet).toEqual(summary);
  expect(grid.dataSourceState.status).toBe('idle');
  expect(fetchPage).not.toHaveBeenCalled();
});

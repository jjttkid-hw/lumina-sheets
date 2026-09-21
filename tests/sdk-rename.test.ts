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
  const book = createBlankWorkbook('rename');
  book.sheets[0].name = 'Data';
  book.sheets[0].cells = { A1: { value: 3 }, B1: { value: '=Data!A1*2' } };
  book.sheets.push({
    id: 'summary',
    name: 'Summary',
    rowCount: 10,
    colCount: 6,
    cells: {
      A1: { value: '=Data!A1' },
      B1: { value: 'link', hyperlink: { target: '#Data!$A$1' } },
    },
  });
  return book;
}
describe('SDK worksheet rename', () => {
  it('commits references, metadata and one isolated event before callbacks; preserves view and mixed history', () => {
    const source = workbook(),
      before = structuredClone(source),
      onChange = vi.fn();
    const events: unknown[] = [];
    let instance!: LuminaSpreadsheet;
    instance = make({
      workbook: source,
      onChange,
      onSheetRename(event) {
        expect(instance.toJSON().sheets.find((s) => s.id === event.sheetId)?.name).toBe(event.name);
        expect(instance.getValue('B1')).toBe(6);
        events.push(structuredClone(event));
        event.affectedSheetIds.length = 0;
      },
    });
    instance.select({ row: 1, col: 1 });
    const changed = vi.fn();
    instance.subscribe(changed);
    instance.renameSheet("O'Brien 数据");
    expect(source).toEqual(before);
    const renamed = instance.toJSON().sheets;
    expect(renamed[1].cells.A1.value).toBe("='O''Brien 数据'!A1");
    expect(renamed[1].cells.B1.hyperlink?.target).toBe("#'O''Brien 数据'!$A$1");
    expect(instance.selectedRange).toEqual({ row: 1, col: 1 });
    expect(events[0]).toEqual({
      sheetId: source.activeSheetId,
      previousName: 'Data',
      name: "O'Brien 数据",
      affectedSheetIds: [source.activeSheetId, 'summary'],
      phase: 'apply',
    });
    expect(changed).toHaveBeenCalledTimes(1);
    instance.setCell('A1', 9);
    expect(instance.getValue('B1')).toBe(18);
    instance.undo();
    instance.undo();
    expect(instance.toJSON().sheets).toEqual(before.sheets);
    expect(events[1]).toMatchObject({
      phase: 'undo',
      previousName: "O'Brien 数据",
      name: 'Data',
      affectedSheetIds: [source.activeSheetId, 'summary'],
    });
    instance.redo();
    expect(instance.toJSON().sheets).toEqual(renamed);
    expect(events[2]).toMatchObject({ phase: 'redo', previousName: 'Data', name: "O'Brien 数据" });
    instance.redo();
    expect(instance.getValue('B1')).toBe(18);
    expect(onChange).toHaveBeenCalledTimes(3); // only cell edit/undo/redo
  });
  it('renames an inactive sheet without changing active sheet or selection', () => {
    const book = workbook();
    book.activeSheetId = 'summary';
    const instance = make({ workbook: book });
    expect(instance.getValue('A1')).toBe(3);
    instance.renameSheet('data', book.sheets[0].id);
    expect(instance.activeSheetInfo.name).toBe('Summary');
    expect(instance.getValue('A1')).toBe(3);
    expect(instance.getCell('A1')?.value).toBe("='data'!A1");
    instance.undo();
    expect(instance.activeSheetInfo.name).toBe('Summary');
    expect(instance.getCell('A1')?.value).toBe('=Data!A1');
  });
  it('keeps revision, caches and redo on equal names and invalid changes', () => {
    const onSheetRename = vi.fn(),
      instance = make({ workbook: workbook(), onSheetRename });
    instance.setCell('A1', 8);
    instance.undo();
    instance.getValue('B1');
    const snapshot = instance.toJSON(),
      revision = instance.snapshot(),
      stats = instance.calculationStats;
    for (const name of ['', 'History', 'summary', 'bad/name', 'x'.repeat(32), null])
      expect(() => instance.renameSheet(name as string)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
    expect(() => instance.renameSheet('Next', 'missing')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    instance.renameSheet('Data');
    expect(instance.toJSON()).toEqual(snapshot);
    expect(instance.snapshot()).toBe(revision);
    expect(instance.calculationStats).toEqual(stats);
    expect(onSheetRename).not.toHaveBeenCalled();
    instance.redo();
    expect(instance.getValue('A1')).toBe(8);
  });
  it.each(['undo', 'load', 'destroy'] as const)(
    'suppresses obsolete rename events after subscriber %s',
    (action) => {
      const onSheetRename = vi.fn(),
        instance = make({ workbook: workbook(), onSheetRename });
      let reacted = false;
      instance.subscribe(() => {
        if (reacted) return;
        reacted = true;
        if (action === 'undo') instance.undo();
        else if (action === 'load') instance.load(createBlankWorkbook('replacement'));
        else instance.destroy();
      });
      instance.renameSheet('Next');
      expect(onSheetRename.mock.calls.some(([event]) => event.phase === 'apply')).toBe(false);
      if (action === 'undo') {
        expect(instance.activeSheetInfo.name).toBe('Data');
        expect(onSheetRename).toHaveBeenCalledOnce();
        instance.redo();
        expect(instance.activeSheetInfo.name).toBe('Next');
      } else expect(onSheetRename).not.toHaveBeenCalled();
    },
  );
  it('keeps event reentry, exceptions and redo branches coherent', () => {
    const onError = vi.fn();
    let instance!: LuminaSpreadsheet;
    instance = make({
      workbook: workbook(),
      onError,
      onSheetRename(event) {
        if (event.phase === 'undo') instance.renameSheet('Branch');
        if (event.name === 'Next') throw new Error('host error');
      },
    });
    instance.renameSheet('Next');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'host error' }));
    instance.undo();
    expect(instance.activeSheetInfo.name).toBe('Branch');
    instance.redo();
    expect(instance.activeSheetInfo.name).toBe('Branch');
  });
  it('bounds snapshot history jointly with structural edits', () => {
    const instance = make({ workbook: workbook() });
    instance.renameSheet('Name0');
    const first = instance.toJSON().sheets;
    for (let i = 1; i <= 10; i++) {
      if (i % 2) instance.renameSheet(`Name${i}`);
      else instance.insertRows(0);
    }
    for (let i = 0; i < 20; i++) instance.undo();
    expect(instance.toJSON().sheets).toEqual(first);
    for (let i = 0; i < 20; i++) instance.redo();
    expect(instance.activeSheetInfo.name).toBe('Name9');
  });
  it('rejects readonly, paged, destroyed instances and non-function callbacks', async () => {
    expect(() => make({ onSheetRename: 123 as never })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    const readonly = make({ workbook: workbook(), readOnly: true });
    expect(() => readonly.renameSheet('Next')).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY' }),
    );
    const book = workbook();
    book.sheets[0].dataSource = { kind: 'paged' };
    const paged = make({ workbook: book });
    expect(() => paged.renameSheet('Next')).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY' }),
    );
    const bound = make();
    await bound.bindData({
      rowCount: 1,
      columnCount: 1,
      fetchPage: async () => ({ rows: [[1]], totalRows: 1 }),
    });
    expect(() => bound.renameSheet('Next')).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY' }),
    );
    readonly.destroy();
    expect(() => readonly.renameSheet('Next')).toThrowError(
      expect.objectContaining({ code: 'DESTROYED' }),
    );
  });
});

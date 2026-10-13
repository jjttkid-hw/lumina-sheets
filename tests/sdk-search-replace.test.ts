import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render() {}, unmount() {} }) }));
import { LuminaSpreadsheet } from '../src/sdk';
class Host {
  className = '';
  classList = { add() {} };
}
const instances: LuminaSpreadsheet[] = [];
function make(options: ConstructorParameters<typeof LuminaSpreadsheet>[1] = {}) {
  const workbook = createBlankWorkbook();
  workbook.sheets[0].cells = {
    A1: { value: 'old old' },
    A2: { value: 'old' },
    B1: { value: '=A2' },
  };
  const grid = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, {
    workbook,
    ...options,
  });
  instances.push(grid);
  return grid;
}
beforeEach(() => vi.stubGlobal('HTMLElement', Host));
afterEach(() => {
  instances.splice(0).forEach((g) => g.destroy());
  vi.unstubAllGlobals();
});
describe('SDK atomic search and replace', () => {
  it('commits once, updates dependencies, preserves selection and supports undo/redo', () => {
    const onChange = vi.fn(),
      grid = make({ onChange });
    grid.select({ row: 4, col: 4 });
    const selected = grid.selectedRange;
    expect(grid.replaceAll({ search: 'old', replacement: 'new' })).toEqual({
      matches: 3,
      changedCells: 2,
    });
    expect(grid.getValue('B1')).toBe('new');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(grid.selectedRange).toEqual(selected);
    grid.undo();
    expect(grid.getValue('A1')).toBe('old old');
    expect(grid.getValue('B1')).toBe('old');
    grid.redo();
    expect(grid.getValue('A1')).toBe('new new');
    const restored = make({ workbook: grid.toJSON() });
    expect(restored.findCells('new')).toHaveLength(3);
  });
  it('preserves redo and all state on overflow, invalid input and no-op', () => {
    const onChange = vi.fn(),
      grid = make({ onChange });
    grid.setCell('C1', 'saved');
    grid.undo();
    onChange.mockClear();
    const before = grid.toJSON(),
      revision = grid.snapshot();
    expect(() =>
      grid.replaceAll({ search: 'old', replacement: 'new', maxMatches: 2 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => grid.findCells('')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(grid.replaceAll({ search: 'old', replacement: 'old' }).changedCells).toBe(0);
    expect(grid.toJSON()).toEqual(before);
    expect(grid.snapshot()).toBe(revision);
    expect(onChange).not.toHaveBeenCalled();
    grid.redo();
    expect(grid.getValue('C1')).toBe('saved');
  });
  it('rejects the whole transaction on data validation failure', () => {
    const onChange = vi.fn(),
      grid = make({ onChange });
    grid.setDataValidation([
      {
        id: 'length',
        kind: 'textLength',
        operator: 'lessThanOrEqual',
        value: 3,
        allowBlank: true,
        range: { start: { row: 1, col: 0 }, end: { row: 1, col: 0 } },
      },
    ]);
    const before = grid.toJSON();
    onChange.mockClear();
    expect(() => grid.replaceAll({ search: 'old', replacement: 'long' })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(grid.toJSON()).toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('permits readonly find, rejects readonly replace, paged find and destroyed calls', async () => {
    const readonly = make({ readOnly: true });
    expect(readonly.findCells('old')).toHaveLength(3);
    expect(() => readonly.replaceAll({ search: 'old', replacement: 'new' })).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY' }),
    );
    const grid = make();
    await grid.bindData({
      rowCount: 2,
      columnCount: 1,
      fetchPage: async () => ({ rows: [['old'], ['old']] }),
    });
    expect(() => grid.findCells('old')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    grid.destroy();
    expect(() => grid.findCells('old')).toThrowError(
      expect.objectContaining({ code: 'DESTROYED' }),
    );
  });
});

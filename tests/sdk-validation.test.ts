import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import {
  DataValidationError,
  LuminaSpreadsheet,
  type DataValidationRule,
  type Workbook,
} from '../src/sdk';

const mounting = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => mounting) }));

class Host {
  className = '';
  classList = { add: (name: string) => (this.className += ` ${name}`) };
}
const instances: LuminaSpreadsheet[] = [];
function make(options: ConstructorParameters<typeof LuminaSpreadsheet>[1] = {}) {
  vi.stubGlobal('HTMLElement', Host);
  const instance = new LuminaSpreadsheet(new Host() as unknown as HTMLElement, options);
  instances.push(instance);
  return instance;
}
function whole(col = 0, max = 10): DataValidationRule {
  return {
    id: `whole-${col}`,
    kind: 'whole',
    range: { start: { row: 0, col }, end: { row: 9, col } },
    operator: 'between',
    min: 1,
    max,
    allowBlank: false,
    message: '请输入范围内整数',
  };
}
afterEach(() => {
  instances.forEach((instance) => instance.destroy());
  instances.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SDK data-validation integration', () => {
  it('strictly validates rule configuration without changing existing rules or history', () => {
    const onChange = vi.fn();
    const instance = make({ onChange });
    instance.setDataValidation([whole()]);
    const snapshot = instance.toJSON();
    const revision = instance.snapshot();
    onChange.mockClear();
    expect(() => instance.setDataValidation([{ ...whole(), max: '10' } as never])).toThrowError(
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        cause: expect.objectContaining({ code: 'INVALID_VALIDATION_RULE' }),
      }),
    );
    expect(instance.toJSON()).toEqual(snapshot);
    expect(instance.snapshot()).toBe(revision);
    expect(onChange).not.toHaveBeenCalled();
    instance.undo();
    expect(instance.getDataValidation()).toEqual([]);
  });

  it('isolates input/output rules and preserves them through JSON load and import', async () => {
    const instance = make();
    const input = [whole()];
    instance.setDataValidation(input);
    input[0].range.start.col = 7;
    const output = instance.getDataValidation();
    output[0].range.start.row = 7;
    expect(instance.getDataValidation()[0].range.start).toEqual({ row: 0, col: 0 });
    const encoded = JSON.stringify(instance.toJSON());
    const restored = make();
    restored.load(JSON.parse(encoded) as Workbook);
    expect(restored.getDataValidation()).toEqual(instance.getDataValidation());
    expect(() => restored.setCell('A1', 11)).toThrow(DataValidationError);
    const imported = make();
    await imported.import(new File([encoded], 'validation.json', { type: 'application/json' }));
    expect(imported.getDataValidation()).toEqual(instance.getDataValidation());
    expect(() => imported.setCell('A1', 11)).toThrow(DataValidationError);
  });

  it('evaluates every formula against the complete candidate batch regardless of edit order', () => {
    const instance = make();
    instance.setCell('A1', 20);
    instance.setDataValidation([whole(1, 10)]);
    instance.setCells([
      { key: 'B1', cell: { value: '=A1*2' } },
      { key: 'A1', cell: { value: 3 } },
    ]);
    expect(instance.getValue('B1')).toBe(6);
    expect(instance.validateCell('B1')).toEqual([]);
    // A deletion also shadows the old value during formula validation.
    instance.setCells([
      { key: 'B1', cell: { value: '=IF(A1="",1,A1*2)' } },
      { key: 'A1', cell: null },
    ]);
    expect(instance.getValue('B1')).toBe(1);
    expect(instance.getCell('A1')).toBeUndefined();
  });

  it('uses proposed edits when a validated formula reads across another sheet', () => {
    const workbook = createBlankWorkbook();
    workbook.sheets[0].name = 'Input';
    workbook.sheets[0].cells.A1 = { value: 2 };
    const second = {
      ...structuredClone(workbook.sheets[0]),
      id: 'derived',
      name: 'Derived',
      cells: { A1: { value: '=Input!A1*2' } },
    };
    workbook.sheets.push(second);
    const instance = make({ workbook });
    instance.setDataValidation([whole(1, 10)]);
    instance.setCells([
      { key: 'B1', cell: { value: '=Derived!A1+1' } },
      { key: 'A1', cell: { value: 4 } },
    ]);
    expect(instance.getValue('B1')).toBe(9);
    expect(() =>
      instance.setCells([
        { key: 'A1', cell: { value: 5 } },
        { key: 'B1', cell: { value: '=Derived!A1+1' } },
      ]),
    ).toThrow(DataValidationError);
    expect(instance.getValue('A1')).toBe(4);
    expect(instance.getValue('B1')).toBe(9);
  });

  it('rejects the whole batch without committing dimensions, events, revision or cache changes', () => {
    const onChange = vi.fn();
    const instance = make({ onChange });
    instance.setCells([
      { key: 'A1', cell: { value: 2 } },
      { key: 'B1', cell: { value: '=A1*2' } },
      { key: 'C1', cell: { value: '=B1+1' } },
    ]);
    instance.setDataValidation([whole(1, 10)]);
    expect(instance.getValue('C1')).toBe(5);
    const stats = instance.calculationStats;
    const snapshot = instance.toJSON();
    const revision = instance.snapshot();
    onChange.mockClear();
    let error: unknown;
    try {
      instance.setCells([
        { key: 'XFD1048576', cell: { value: 'must not expand' } },
        { key: 'A1', cell: { value: 7 } },
        { key: 'B1', cell: { value: '=A1*2' } },
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      failures: [{ key: 'B1', value: 14, code: 'OUT_OF_RANGE' }],
    });
    expect(instance.toJSON()).toEqual(snapshot);
    expect(instance.snapshot()).toBe(revision);
    expect(instance.calculationStats).toEqual(stats);
    expect(onChange).not.toHaveBeenCalled();
    expect(instance.getValue('C1')).toBe(5);
    expect(instance.calculationStats.formulaEvaluations).toBe(stats.formulaEvaluations);
    // Only the successful rule update is undone; the rejected edit added no history entry.
    instance.undo();
    expect(instance.getDataValidation()).toEqual([]);
    expect(instance.getValue('A1')).toBe(2);
  });

  it('keeps an existing redo transaction after rejecting another edit', () => {
    const instance = make();
    instance.setDataValidation([whole()]);
    instance.setCell('A1', 2);
    instance.setCell('A1', 3);
    instance.undo();
    expect(() => instance.setCell('A1', 30)).toThrow(DataValidationError);
    instance.redo();
    expect(instance.getValue('A1')).toBe(3);
  });

  it('rejects deletion and empty text when allowBlank is false', () => {
    const instance = make();
    instance.setCell('A1', 2);
    instance.setDataValidation([whole()]);
    expect(() => instance.setCells([{ key: 'A1', cell: null }])).toThrowError(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        failures: [expect.objectContaining({ code: 'BLANK_NOT_ALLOWED' })],
      }),
    );
    expect(() => instance.setCell('A1', '')).toThrow(DataValidationError);
    expect(instance.getValue('A1')).toBe(2);
  });

  it('restores previously invalid content with undo and redoes the accepted edit', () => {
    const instance = make();
    instance.setCell('A1', 99);
    instance.setDataValidation([whole()]);
    expect(instance.validateCell('A1')[0].code).toBe('OUT_OF_RANGE');
    instance.setCell('A1', 2);
    instance.undo();
    expect(instance.getValue('A1')).toBe(99);
    expect(instance.validateCell('A1')[0].code).toBe('OUT_OF_RANGE');
    instance.redo();
    expect(instance.getValue('A1')).toBe(2);
  });

  it('enforces the same validation through Canvas patches', () => {
    const instance = make();
    instance.setDataValidation([whole()]);
    const { onPatch } = instance.surface().props;
    const id = instance.activeSheetInfo.id;
    expect(() => onPatch(id, [{ key: 'A1', cell: { value: 11 } }])).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(instance.getCell('A1')).toBeUndefined();
    onPatch(id, [{ key: 'A1', cell: { value: 3 } }]);
    expect(instance.getValue('A1')).toBe(3);
  });

  it('reports existing or dependent invalid values explicitly without blocking unrelated direct edits', () => {
    const instance = make();
    instance.setCells([
      { key: 'A1', cell: { value: 3 } },
      { key: 'B1', cell: { value: '=A1*2' } },
    ]);
    instance.setDataValidation([whole(1, 10)]);
    expect(instance.validateCell('B1')).toEqual([]);
    instance.setCell('A1', 6);
    expect(instance.getValue('B1')).toBe(12);
    expect(instance.validateCell('$b$1')[0]).toMatchObject({
      key: 'B1',
      value: 12,
      code: 'OUT_OF_RANGE',
    });
    expect(() => instance.setCell('B1', '=A1*2')).toThrow(DataValidationError);
    expect(() => instance.validateCell('INVALID')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });

  it('respects readOnly, paged binding and destroyed lifecycle boundaries', async () => {
    const workbook = createBlankWorkbook();
    workbook.sheets[0].cells.A1 = { value: 20 };
    workbook.sheets[0].dataValidations = [whole()];
    const readOnly = make({ workbook, readOnly: true });
    expect(readOnly.validateCell('A1')[0].code).toBe('OUT_OF_RANGE');
    expect(() => readOnly.setDataValidation([])).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY' }),
    );
    const paged = make({ workbook });
    await paged.bindData({
      columnCount: 1,
      rowCount: 1,
      fetchPage: async () => ({ rows: [[20]], totalRows: 1 }),
    });
    expect(paged.getDataValidation()).toEqual([]);
    expect(() => paged.setDataValidation([whole()])).toThrowError(
      expect.objectContaining({ code: 'READ_ONLY' }),
    );
    readOnly.destroy();
    for (const action of [
      () => readOnly.getDataValidation(),
      () => readOnly.setDataValidation([]),
      () => readOnly.validateCell('A1'),
    ])
      expect(action).toThrowError(expect.objectContaining({ code: 'DESTROYED' }));
  });
});

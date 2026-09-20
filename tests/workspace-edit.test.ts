import { describe, expect, it } from 'vitest';
import { cellKey, createEvaluator } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import { IMPORT_LIMITS, validateWorkbook } from '../src/lib/io';
import { planWorkspaceCellChanges, WorkspaceEditError } from '../src/lib/workspace-edit';
import type { DataValidationRule } from '../src/lib/data-validation';
import type { Cell, Workbook } from '../src/lib/types';

function book(): Workbook {
  const workbook = createBlankWorkbook('工作区输入');
  Object.assign(workbook.sheets[0], {
    name: 'Input',
    rowCount: 10,
    colCount: 6,
    columnWidths: {},
    cells: {
      A2: { value: 3 },
      B2: { value: '=A2*2' },
      C2: { value: '保留', style: { bold: true } },
    },
  });
  return workbook;
}
function quantity(col = 1, max = 10): DataValidationRule {
  return {
    id: `quantity-${col}`,
    kind: 'whole',
    operator: 'between',
    min: 1,
    max,
    allowBlank: false,
    range: { start: { row: 1, col }, end: { row: 1, col } },
    message: '请输入范围内整数',
  };
}
function candidate(workbook: Workbook, sheet: Workbook['sheets'][number]): Workbook {
  return {
    ...workbook,
    sheets: workbook.sheets.map((current) => (current.id === sheet.id ? sheet : current)),
  };
}

describe('main workspace atomic cell edits', () => {
  it('plans edits and expansion without changing the workbook or retaining caller-owned cells', () => {
    const workbook = book(),
      sheet = workbook.sheets[0],
      before = structuredClone(workbook);
    const input = { value: '新增', style: { bold: true, background: '#abcdef' } };
    const dimensions = { rowCount: 12, colCount: 7 };
    const plan = planWorkspaceCellChanges(
      workbook,
      sheet.id,
      [{ key: 'G12', cell: input }],
      dimensions,
    )!;
    expect(plan.sheet.cells.G12).toEqual(input);
    expect(plan.sheet.rowCount).toBe(12);
    expect(plan.sheet.colCount).toBe(7);
    expect(workbook).toEqual(before);
    input.value = '外部修改';
    input.style.bold = false;
    dimensions.rowCount = 99;
    expect(plan.sheet.cells.G12.value).toBe('新增');
    expect(plan.sheet.cells.G12.style?.bold).toBe(true);
    expect(plan.sheet.rowCount).toBe(12);
    expect(plan.changes).toEqual([
      { key: 'G12', cell: { value: '新增', style: { bold: true, background: '#abcdef' } } },
    ]);
    expect(workbook).toEqual(before);
  });

  it('rejects a mixed batch before any cell, dimension, or live calculation state changes', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.dataValidations = [quantity()];
    const before = structuredClone(workbook);
    const evaluate = createEvaluator(workbook, { managedMutations: true });
    expect(evaluate(sheet, 'B2')).toBe(6);
    const stats = evaluate.stats;
    expect(() =>
      planWorkspaceCellChanges(workbook, sheet.id, [
        { key: 'G12', cell: { value: '不能部分提交' } },
        { key: 'A2', cell: { value: 8 } },
        { key: 'B2', cell: { value: 99 } },
      ]),
    ).toThrow(WorkspaceEditError);
    expect(workbook).toEqual(before);
    expect(evaluate.stats).toEqual(stats);
    expect(evaluate(sheet, 'B2')).toBe(6);
    expect(evaluate.stats.formulaEvaluations).toBe(stats.formulaEvaluations);
  });

  it('reports the rejected address and rule so the editor can preserve and explain the draft', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.dataValidations = [quantity()];
    expect(() =>
      planWorkspaceCellChanges(workbook, sheet.id, [{ key: '$b$2', cell: { value: 99 } }]),
    ).toThrowError(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        failures: [
          expect.objectContaining({
            key: 'B2',
            sheetId: sheet.id,
            ruleId: 'quantity-1',
            code: 'OUT_OF_RANGE',
            message: '请输入范围内整数',
            value: 99,
          }),
        ],
      }),
    );
  });

  it('checks formulas against all proposed cells regardless of patch order', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.cells.A2.value = 20;
    sheet.dataValidations = [quantity()];
    const plan = planWorkspaceCellChanges(workbook, sheet.id, [
      { key: 'B2', cell: { value: '=A2*2+1' } },
      { key: 'A2', cell: { value: 4 } },
    ])!;
    expect(createEvaluator(candidate(workbook, plan.sheet))(plan.sheet, 'B2')).toBe(9);
    expect(sheet.cells.A2.value).toBe(20);
    expect(() =>
      planWorkspaceCellChanges(workbook, sheet.id, [
        { key: 'B2', cell: { value: '=A2*2+1' } },
        { key: 'A2', cell: { value: 5 } },
      ]),
    ).toThrow(WorkspaceEditError);
  });

  it('validates a submitted formula whose text is unchanged but candidate result changes', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.dataValidations = [quantity()];
    const before = structuredClone(workbook);
    expect(() =>
      planWorkspaceCellChanges(workbook, sheet.id, [
        { key: 'B2', cell: { value: '=A2*2' } },
        { key: 'A2', cell: { value: 6 } },
      ]),
    ).toThrow(WorkspaceEditError);
    expect(workbook).toEqual(before);
    const plan = planWorkspaceCellChanges(workbook, sheet.id, [
      { key: 'B2', cell: { value: '=A2*2' } },
      { key: 'A2', cell: { value: 4 } },
    ])!;
    expect(createEvaluator(candidate(workbook, plan.sheet))(plan.sheet, 'B2')).toBe(8);
  });

  it('uses candidate changes throughout cross-sheet dependency chains', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    workbook.sheets.push({
      id: 'derived',
      name: 'Derived',
      rowCount: 10,
      colCount: 6,
      cells: { A1: { value: '=Input!A2*2' } },
    });
    sheet.dataValidations = [quantity()];
    const plan = planWorkspaceCellChanges(workbook, sheet.id, [
      { key: 'B2', cell: { value: '=Derived!A1+1' } },
      { key: 'A2', cell: { value: 4 } },
    ])!;
    expect(createEvaluator(candidate(workbook, plan.sheet))(plan.sheet, 'B2')).toBe(9);
    expect(() =>
      planWorkspaceCellChanges(workbook, sheet.id, [
        { key: 'A2', cell: { value: 5 } },
        { key: 'B2', cell: { value: '=Derived!A1+1' } },
      ]),
    ).toThrow(WorkspaceEditError);
  });

  it('shadows deleted cells while evaluating a formula in the same batch', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.cells.A2.value = 20;
    sheet.dataValidations = [quantity()];
    const plan = planWorkspaceCellChanges(workbook, sheet.id, [
      { key: 'B2', cell: { value: '=IF(A2="",1,A2*2)' } },
      { key: 'A2', cell: null },
    ])!;
    expect(plan.sheet.cells.A2).toBeUndefined();
    expect(createEvaluator(candidate(workbook, plan.sheet))(plan.sheet, 'B2')).toBe(1);
  });

  it.each([null, { value: '' }])('rejects clearing a required cell (%j) atomically', (cleared) => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.dataValidations = [quantity()];
    const before = structuredClone(workbook);
    expect(() =>
      planWorkspaceCellChanges(workbook, sheet.id, [
        { key: 'C2', cell: null },
        { key: 'B2', cell: cleared },
      ]),
    ).toThrow(WorkspaceEditError);
    expect(workbook).toEqual(before);
  });

  it('allows deletion when blanks are permitted and ignores rules for another sheet', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.dataValidations = [
      { ...quantity(), allowBlank: true },
      { ...quantity(0), sheetId: 'other' },
    ];
    const plan = planWorkspaceCellChanges(workbook, sheet.id, [
      { key: 'B2', cell: null },
      { key: 'A2', cell: { value: 99 } },
    ])!;
    expect(plan.sheet.cells.B2).toBeUndefined();
    expect(plan.sheet.cells.A2.value).toBe(99);
  });

  it('returns null for true no-ops without revalidating unrelated existing invalid values', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.dataValidations = [quantity(0, 1)];
    const before = structuredClone(workbook);
    expect(planWorkspaceCellChanges(workbook, sheet.id, [])).toBeNull();
    expect(
      planWorkspaceCellChanges(workbook, sheet.id, [
        { key: 'A2', cell: { value: 3 } },
        { key: 'F10', cell: null },
        { key: 'C2', cell: { value: '保留', style: { bold: true } } },
      ]),
    ).toBeNull();
    expect(workbook).toEqual(before);
    expect(
      planWorkspaceCellChanges(workbook, sheet.id, [{ key: 'D2', cell: { value: '无关编辑' } }])
        ?.sheet.cells.D2.value,
    ).toBe('无关编辑');
  });

  it('canonicalizes duplicate addresses and validates only the final proposed value', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.dataValidations = [quantity()];
    const plan = planWorkspaceCellChanges(workbook, sheet.id, [
      { key: 'b2', cell: { value: 99 } },
      { key: '$B$2', cell: { value: 5 } },
    ])!;
    expect(plan.changes).toEqual([{ key: 'B2', cell: { value: 5 } }]);
    expect(Object.hasOwn(plan.sheet.cells, '$B$2')).toBe(false);
    expect(Object.hasOwn(plan.sheet.cells, 'b2')).toBe(false);
    expect(() =>
      planWorkspaceCellChanges(workbook, sheet.id, [
        { key: 'b2', cell: { value: 5 } },
        { key: '$B$2', cell: { value: 99 } },
      ]),
    ).toThrow(WorkspaceEditError);
    expect(
      planWorkspaceCellChanges(workbook, sheet.id, [
        { key: 'a2', cell: { value: 100 } },
        { key: '$A$2', cell: { value: 3 } },
      ]),
    ).toBeNull();
  });

  it('does not expand the sheet for a distant write canceled by the final duplicate patch', () => {
    const workbook = book(),
      sheet = workbook.sheets[0],
      before = structuredClone(workbook);
    expect(
      planWorkspaceCellChanges(workbook, sheet.id, [
        { key: 'G12', cell: { value: '已取消' } },
        { key: '$g$12', cell: null },
      ]),
    ).toBeNull();
    const plan = planWorkspaceCellChanges(workbook, sheet.id, [
      { key: 'G12', cell: { value: '已取消' } },
      { key: '$g$12', cell: null },
      { key: 'A2', cell: { value: 4 } },
    ])!;
    expect(plan.sheet.rowCount).toBe(sheet.rowCount);
    expect(plan.sheet.colCount).toBe(sheet.colCount);
    expect(plan.dimensions).toBeUndefined();
    expect(plan.changes).toEqual([{ key: 'A2', cell: { value: 4 } }]);
    expect(workbook).toEqual(before);
  });

  it('enforces the stored-cell budget across sheets using the final batch size', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.rowCount = IMPORT_LIMITS.rows;
    sheet.cells = {};
    const other = {
      id: 'other',
      name: 'Other',
      rowCount: IMPORT_LIMITS.rows,
      colCount: 6,
      cells: {} as Record<string, Cell>,
    };
    for (let row = 0; row < IMPORT_LIMITS.cells / 2; row++) {
      sheet.cells[cellKey(row, 0)] = { value: row };
      other.cells[cellKey(row, 0)] = { value: row };
    }
    workbook.sheets.push(other);
    expect(() =>
      planWorkspaceCellChanges(workbook, sheet.id, [{ key: 'B1', cell: { value: '超额' } }]),
    ).toThrow(WorkspaceEditError);
    expect(sheet.cells.B1).toBeUndefined();
    expect(
      planWorkspaceCellChanges(workbook, sheet.id, [{ key: 'A1', cell: { value: '替换' } }])?.sheet
        .cells.A1.value,
    ).toBe('替换');
    const plan = planWorkspaceCellChanges(workbook, sheet.id, [
      { key: 'B1', cell: { value: '替换位置' } },
      { key: 'A1', cell: null },
    ])!;
    expect(Object.keys(plan.sheet.cells)).toHaveLength(IMPORT_LIMITS.cells / 2);
    expect(plan.sheet.cells.A1).toBeUndefined();
    expect(plan.sheet.cells.B1.value).toBe('替换位置');
  });

  it('expands sparse edits within workspace limits and keeps accepted workbooks importable', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    const key = cellKey(IMPORT_LIMITS.rows - 1, IMPORT_LIMITS.columns - 1);
    const plan = planWorkspaceCellChanges(workbook, sheet.id, [{ key, cell: { value: 42 } }])!;
    expect(plan.sheet.rowCount).toBe(IMPORT_LIMITS.rows);
    expect(plan.sheet.colCount).toBe(IMPORT_LIMITS.columns);
    expect(validateWorkbook(candidate(workbook, plan.sheet)).sheets[0].cells[key].value).toBe(42);
  });

  it('permits metadata-only growth and automatically expands an omitted dimension axis', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    const plan = planWorkspaceCellChanges(workbook, sheet.id, [], { rowCount: 12 })!;
    expect(plan.sheet.rowCount).toBe(12);
    expect(plan.sheet.colCount).toBe(6);
    expect(plan.changes).toEqual([]);
    expect(
      planWorkspaceCellChanges(workbook, sheet.id, [], {
        rowCount: sheet.rowCount,
        colCount: sheet.colCount,
      }),
    ).toBeNull();
    const wider = planWorkspaceCellChanges(
      workbook,
      sheet.id,
      [{ key: 'G12', cell: { value: 1 } }],
      { rowCount: 12 },
    )!;
    expect(wider.sheet.rowCount).toBe(12);
    expect(wider.sheet.colCount).toBe(7);
  });

  it('preserves the importable layout budget when expanding a sheet containing merges', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.rowCount = 1000;
    sheet.colCount = 100;
    sheet.merges = [{ start: { row: 0, col: 0 }, end: { row: 0, col: 1 } }];
    const before = structuredClone(workbook);
    const plan = planWorkspaceCellChanges(workbook, sheet.id, [
      { key: 'A1000', cell: { value: '边界内' } },
    ])!;
    expect(validateWorkbook(candidate(workbook, plan.sheet)).sheets[0].cells.A1000.value).toBe(
      '边界内',
    );
    expect(() =>
      planWorkspaceCellChanges(workbook, sheet.id, [{ key: 'A1001', cell: { value: '超出布局' } }]),
    ).toThrow(WorkspaceEditError);
    expect(workbook).toEqual(before);
  });

  it('rejects out-of-bounds, shrinking, or undersized explicit dimensions without mutation', () => {
    const workbook = book(),
      sheet = workbook.sheets[0],
      before = structuredClone(workbook);
    for (const dimensions of [
      { rowCount: 9 },
      { colCount: 5 },
      { rowCount: IMPORT_LIMITS.rows + 1 },
      { colCount: IMPORT_LIMITS.columns + 1 },
      { rowCount: 10.5 },
      { colCount: Number.NaN },
    ]) {
      expect(() => planWorkspaceCellChanges(workbook, sheet.id, [], dimensions)).toThrow(
        WorkspaceEditError,
      );
    }
    expect(() =>
      planWorkspaceCellChanges(workbook, sheet.id, [{ key: 'A12', cell: { value: 1 } }], {
        rowCount: 11,
      }),
    ).toThrow(WorkspaceEditError);
    for (const key of ['A100001', 'IW1', 'A0', 'NOT A CELL']) {
      expect(() =>
        planWorkspaceCellChanges(workbook, sheet.id, [{ key, cell: { value: 1 } }]),
      ).toThrow(WorkspaceEditError);
    }
    expect(workbook).toEqual(before);
  });

  it('accepts boundary-length text but rejects oversized formula-bar values and non-finite numbers', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    const accepted = '字'.repeat(32_767);
    expect(
      planWorkspaceCellChanges(workbook, sheet.id, [{ key: 'A1', cell: { value: accepted } }])
        ?.sheet.cells.A1.value,
    ).toBe(accepted);
    const before = structuredClone(workbook);
    for (const value of [
      '字'.repeat(32_768),
      '😀'.repeat(16_384),
      Number.NaN,
      Infinity,
      -Infinity,
    ]) {
      expect(() =>
        planWorkspaceCellChanges(workbook, sheet.id, [{ key: 'A1', cell: { value } }]),
      ).toThrow(WorkspaceEditError);
    }
    expect(workbook).toEqual(before);
  });

  it('rejects edits to missing and paged read-only sheets', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    expect(() =>
      planWorkspaceCellChanges(workbook, 'missing', [{ key: 'A1', cell: { value: 1 } }]),
    ).toThrow(WorkspaceEditError);
    sheet.dataSource = { kind: 'paged', totalRows: 1000, pageSize: 100 };
    const before = structuredClone(workbook);
    expect(() =>
      planWorkspaceCellChanges(workbook, sheet.id, [{ key: 'A1', cell: { value: 1 } }]),
    ).toThrow(WorkspaceEditError);
    expect(workbook).toEqual(before);
  });
});

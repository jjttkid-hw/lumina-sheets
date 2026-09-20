import { describe, expect, it } from 'vitest';
import { cellKey, createEvaluator } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import { planRowSort } from '../src/lib/row-sort';
import type { RowSortPlan, RowSortRequest } from '../src/lib/row-sort';
import { planWorkbookRowSort, WorkbookSortValidationError } from '../src/lib/workbook-sort';
import type { DataValidationRule } from '../src/lib/data-validation';
import type { Workbook } from '../src/lib/types';

function book(): Workbook {
  const workbook = createBlankWorkbook('工作区排序');
  Object.assign(workbook.sheets[0], {
    name: 'Data',
    rowCount: 10,
    colCount: 6,
    frozenRows: 1,
    cells: {
      A1: { value: '编号' },
      A2: { value: 30 },
      B2: { value: '=A2*2' },
      C2: { value: 'third', style: { bold: true } },
      A3: { value: 10 },
      B3: { value: '=A3*2' },
      C3: { value: 'first' },
      A4: { value: 20 },
      B4: { value: '=A4*2' },
      C4: { value: 'second' },
      E8: { value: '=SUM(A2:A4)' },
      F8: { value: '=A2' },
    },
  });
  return workbook;
}
const ascending: RowSortRequest = {
  startRow: 1,
  rowCount: 3,
  keys: [{ column: 0, direction: 'asc' }],
};
const range = (row: number, col: number, endRow = row) => ({
  start: { row, col },
  end: { row: endRow, col },
});
const lessThan = (id: string, row: number, col: number, value: number): DataValidationRule => ({
  id,
  range: range(row, col),
  kind: 'whole',
  operator: 'lessThan',
  value,
});
function apply(workbook: Workbook, plan: RowSortPlan) {
  const result = structuredClone(workbook);
  for (const { key, cell } of plan.changes) {
    if (cell) result.sheets[0].cells[key] = cell;
    else delete result.sheets[0].cells[key];
  }
  return result;
}

describe('workbook-wide atomic sort validation', () => {
  it('plans complete formula/style rows with passing rules and leaves every input unchanged', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.dataValidations = [
      lessThan('first-value', 1, 0, 15),
      lessThan('first-formula', 1, 1, 25),
      {
        id: 'other-sheet-only',
        sheetId: 'different',
        kind: 'list',
        values: ['impossible'],
        range: range(1, 0, 3),
      },
    ];
    const before = structuredClone(workbook);
    const evaluator = createEvaluator(workbook, { managedMutations: true });
    expect(evaluator(sheet, 'B2')).toBe(60);
    const stats = evaluator.stats;
    const plan = planWorkbookRowSort(workbook, sheet.id, ascending);
    const sorted = apply(workbook, plan),
      evaluate = createEvaluator(sorted);
    expect(plan.rowOrder).toEqual([2, 3, 1]);
    expect(sorted.sheets[0].cells.B2.value).toBe('=A2*2');
    expect(evaluate(sorted.sheets[0], 'B2')).toBe(20);
    expect(sorted.sheets[0].cells.C4.style).toEqual({ bold: true });
    expect(evaluator.stats).toEqual(stats);
    expect(workbook).toEqual(before);
    sorted.sheets[0].cells.C4.style!.bold = false;
    expect(workbook).toEqual(before);
  });

  it('validates a retained formula whose text has no patch but candidate result changes', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.dataValidations = [lessThan('last-formula-limit', 3, 1, 50)];
    const evaluate = createEvaluator(workbook);
    const rawPlan = planRowSort(sheet, ascending, (key) => evaluate(sheet, key));
    expect(rawPlan.changes.some(({ key }) => key === 'B4')).toBe(false);
    const before = structuredClone(workbook),
      stats = evaluate.stats;
    let error: unknown;
    try {
      planWorkbookRowSort(workbook, sheet.id, ascending);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(WorkbookSortValidationError);
    expect((error as WorkbookSortValidationError).failures).toEqual([
      expect.objectContaining({
        key: 'B4',
        value: 60,
        code: 'OUT_OF_RANGE',
        ruleId: 'last-formula-limit',
      }),
    ]);
    expect(workbook).toEqual(before);
    expect(evaluate.stats).toEqual(stats);
  });

  it('validates formulas against all candidate changes before returning any plan', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.cells.B2.value = '=A2+A3';
    sheet.cells.B3.value = '=A3+A4';
    sheet.cells.B4.value = '=A4+A5';
    sheet.cells.A5 = { value: 1 };
    sheet.dataValidations = [
      { id: 'complete-batch', range: range(1, 1), kind: 'whole', operator: 'equal', value: 30 },
    ];
    const plan = planWorkbookRowSort(workbook, sheet.id, ascending);
    const sorted = apply(workbook, plan);
    expect(createEvaluator(sorted)(sorted.sheets[0], 'B2')).toBe(30);
    sheet.dataValidations[0] = {
      id: 'not-intermediate',
      range: range(1, 1),
      kind: 'whole',
      operator: 'equal',
      value: 20,
    };
    expect(() => planWorkbookRowSort(workbook, sheet.id, ascending)).toThrow(
      WorkbookSortValidationError,
    );
  });

  it('evaluates cross-sheet dependencies using the candidate sheet, including added sparse cells', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.cells = { A2: { value: 20 }, A3: { value: 10 }, B3: { value: "='Summary'!$A$1" } };
    workbook.sheets.push({
      id: 'summary',
      name: 'Summary',
      rowCount: 10,
      colCount: 6,
      cells: { A1: { value: '=Data!A2*2' } },
    });
    sheet.dataValidations = [
      { id: 'cross-sheet-limit', kind: 'whole', operator: 'equal', value: 20, range: range(1, 1) },
    ];
    const sort = { ...ascending, rowCount: 2 };
    const plan = planWorkbookRowSort(workbook, sheet.id, sort);
    expect(plan.changes.find(({ key }) => key === 'B2')?.cell?.value).toBe("='Summary'!$A$1");
    const sorted = apply(workbook, plan);
    expect(createEvaluator(sorted)(sorted.sheets[0], 'B2')).toBe(20);
    sheet.dataValidations[0] = {
      id: 'cross-sheet-old-value',
      kind: 'whole',
      operator: 'equal',
      value: 40,
      range: range(1, 1),
    };
    expect(() => planWorkbookRowSort(workbook, sheet.id, sort)).toThrow(
      WorkbookSortValidationError,
    );
  });

  it('keeps hidden rows and outside totals at their coordinates without revalidating unrelated values', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.hiddenRows = [2];
    sheet.dataValidations = [
      lessThan('existing-hidden-invalid', 2, 0, 1),
      lessThan('outside-invalid', 7, 4, 1),
      {
        id: 'empty-unwritten',
        kind: 'list',
        allowBlank: false,
        values: ['required'],
        range: range(1, 5, 3),
      },
    ];
    const plan = planWorkbookRowSort(workbook, sheet.id, ascending);
    expect(plan.targetRows).toEqual([1, 3]);
    expect(plan.changes.some(({ key }) => key.endsWith('3') || key.endsWith('8'))).toBe(false);
    const sorted = apply(workbook, plan),
      evaluate = createEvaluator(sorted);
    expect(sorted.sheets[0].hiddenRows).toEqual([2]);
    expect(evaluate(sorted.sheets[0], 'E8')).toBe(60);
    expect(evaluate(sorted.sheets[0], 'F8')).toBe(20);
  });

  it('returns a no-op without revalidating existing invalid values or changing cache state', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    const sorted = apply(workbook, planWorkbookRowSort(workbook, sheet.id, ascending));
    sorted.sheets[0].dataValidations = [lessThan('existing', 1, 0, 1)];
    const evaluator = createEvaluator(sorted, { managedMutations: true });
    evaluator(sorted.sheets[0], 'B2');
    const stats = evaluator.stats,
      before = structuredClone(sorted);
    expect(planWorkbookRowSort(sorted, sheet.id, ascending)).toEqual({
      changes: [],
      rowOrder: [1, 2, 3],
      targetRows: [1, 2, 3],
      movedRows: 0,
    });
    expect(evaluator.stats).toEqual(stats);
    expect(sorted).toEqual(before);
  });

  it('reports required-value failures for candidate deletions without touching the original workbook', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.cells.D2 = { value: 'required' };
    sheet.dataValidations = [
      {
        id: 'required-destination',
        kind: 'list',
        values: ['required'],
        allowBlank: false,
        range: range(1, 3),
      },
    ];
    const before = structuredClone(workbook);
    expect(() => planWorkbookRowSort(workbook, sheet.id, ascending)).toThrow(
      WorkbookSortValidationError,
    );
    expect(workbook).toEqual(before);
    expect(() => planWorkbookRowSort(workbook, 'missing', ascending)).toThrow('找不到工作表');
  });

  it('uses cross-sheet calculated sort keys without warming an unrelated live evaluator', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.cells.A2.value = '=Summary!B2';
    sheet.cells.A3.value = '=Summary!B3';
    sheet.cells.A4.value = '=Summary!B4';
    workbook.sheets.push({
      id: 'summary',
      name: 'Summary',
      rowCount: 10,
      colCount: 6,
      cells: {
        B2: { value: 30 },
        B3: { value: 10 },
        B4: { value: 20 },
      },
    });
    const evaluator = createEvaluator(workbook, { managedMutations: true });
    evaluator(sheet, 'A2');
    const stats = evaluator.stats,
      before = structuredClone(workbook);
    const plan = planWorkbookRowSort(workbook, sheet.id, ascending);
    expect(plan.rowOrder).toEqual([2, 3, 1]);
    expect(plan.changes.find(({ key }) => key === 'C2')?.cell?.value).toBe('first');
    expect(evaluator.stats).toEqual(stats);
    expect(workbook).toEqual(before);
  });

  it('bounds reported failures while rejecting the whole candidate batch', () => {
    const workbook = book(),
      sheet = workbook.sheets[0];
    sheet.rowCount = 202;
    sheet.cells = {};
    for (let row = 1; row <= 200; row++) sheet.cells[cellKey(row, 0)] = { value: 201 - row };
    sheet.dataValidations = [
      {
        id: 'all-invalid',
        kind: 'whole',
        operator: 'greaterThan',
        value: 1000,
        range: range(1, 0, 200),
      },
    ];
    const before = structuredClone(workbook);
    let error: unknown;
    try {
      planWorkbookRowSort(workbook, sheet.id, { ...ascending, rowCount: 200 });
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(WorkbookSortValidationError);
    expect((error as WorkbookSortValidationError).failures).toHaveLength(100);
    expect((error as WorkbookSortValidationError).failures[0]).toMatchObject({
      key: 'A2',
      value: 1,
    });
    expect(workbook).toEqual(before);
  });
});

import { createEvaluator, parseCellKey } from './engine';
import type { DataValidationFailure } from './data-validation';
import { validateWorkbookCellChanges } from './workbook-validation';
import { planRowSort } from './row-sort';
import type { RowSortPlan, RowSortRequest } from './row-sort';
import type { Workbook } from './types';
import { rewriteSortedHyperlink } from './hyperlink-structure';

export interface WorkbookRowSortPlan extends RowSortPlan {
  relatedChanges?: Array<{ sheetId: string; changes: RowSortPlan['changes'] }>;
}

export class WorkbookSortValidationError extends Error {
  readonly failures: DataValidationFailure[];
  constructor(failures: DataValidationFailure[]) {
    super(
      failures.length
        ? `${failures[0].key}：${failures[0].message}`
        : '排序后的单元格不符合输入规则',
    );
    this.name = 'WorkbookSortValidationError';
    this.failures = structuredClone(failures);
  }
}

/** Plan and validate one complete candidate permutation without mutating data or live caches. */
export function planWorkbookRowSort(
  workbook: Workbook,
  sheetId: string,
  request: RowSortRequest,
): WorkbookRowSortPlan {
  if (typeof sheetId !== 'string' || !sheetId) throw new Error('行排序：必须提供工作表 ID');
  const sheet = workbook.sheets.find((item) => item.id === sheetId);
  if (!sheet) throw new Error('行排序：找不到工作表');
  const evaluate = createEvaluator(workbook, { managedMutations: true });
  const planned: WorkbookRowSortPlan = planRowSort(sheet, request, (key) => evaluate(sheet, key));
  if (planned.movedRows) {
    const rows = new Map(
      planned.rowOrder.map((source, index) => [source, planned.targetRows[index]]),
    );
    const patches = new Map(planned.changes.map((change) => [change.key, change.cell]));
    const related: NonNullable<WorkbookRowSortPlan['relatedChanges']> = [];
    let count = patches.size;
    for (const source of workbook.sheets) {
      const own = source.id === sheet.id;
      const changes: RowSortPlan['changes'] = [];
      const keys = own
        ? new Set([...Object.keys(source.cells), ...patches.keys()])
        : Object.keys(source.cells);
      for (const key of keys) {
        const cell = own && patches.has(key) ? patches.get(key) : source.cells[key];
        if (!cell?.hyperlink) continue;
        const target = rewriteSortedHyperlink(cell.hyperlink.target, source.name, sheet.name, rows);
        if (target === cell.hyperlink.target) continue;
        if (source.dataSource?.kind === 'paged')
          throw new Error('行排序：关联链接位于只读分页工作表，不能更新');
        const next = structuredClone({ ...cell, hyperlink: { ...cell.hyperlink, target } });
        if (!own || !patches.has(key)) count++;
        if (count > 100_000) throw new Error('行排序：最终变更超过 100,000 个单元格');
        if (own) patches.set(key, next);
        else changes.push({ key, cell: next });
      }
      if (changes.length) related.push({ sheetId: source.id, changes });
    }
    planned.changes = [...patches].map(([key, cell]) => ({ key, cell }));
    if (related.length) planned.relatedChanges = related;
  }
  if (planned.relatedChanges?.length) {
    const cells = { ...sheet.cells };
    for (const change of planned.changes) {
      if (change.cell) cells[change.key] = change.cell;
      else delete cells[change.key];
    }
    const candidate = {
      ...workbook,
      sheets: workbook.sheets.map((s) => (s.id === sheet.id ? { ...s, cells } : s)),
    };
    for (const group of planned.relatedChanges) {
      const failures = validateWorkbookCellChanges(candidate, group.sheetId, group.changes);
      if (failures.length) throw new WorkbookSortValidationError(failures);
    }
  }
  if (!planned.changes.length || !sheet.dataValidations?.length) return planned;

  const validationKeys = new Set(planned.changes.map(({ key }) => key));
  const moved = new Set(planned.targetRows.filter((row, index) => row !== planned.rowOrder[index]));
  for (const key in sheet.cells) {
    if (!Object.hasOwn(sheet.cells, key)) continue;
    const point = parseCellKey(key);
    if (point && moved.has(point.row)) validationKeys.add(key);
  }
  const failures = validateWorkbookCellChanges(workbook, sheetId, planned.changes, {
    validationKeys,
  });
  if (failures.length) throw new WorkbookSortValidationError(failures);
  return planned;
}

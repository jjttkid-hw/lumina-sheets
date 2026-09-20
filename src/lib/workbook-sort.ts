import { createEvaluator, parseCellKey } from './engine';
import type { DataValidationFailure } from './data-validation';
import { validateWorkbookCellChanges } from './workbook-validation';
import { planRowSort } from './row-sort';
import type { RowSortPlan, RowSortRequest } from './row-sort';
import type { Workbook } from './types';

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
): RowSortPlan {
  if (typeof sheetId !== 'string' || !sheetId) throw new Error('行排序：必须提供工作表 ID');
  const sheet = workbook.sheets.find((item) => item.id === sheetId);
  if (!sheet) throw new Error('行排序：找不到工作表');
  const evaluate = createEvaluator(workbook, { managedMutations: true });
  const planned = planRowSort(sheet, request, (key) => evaluate(sheet, key));
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

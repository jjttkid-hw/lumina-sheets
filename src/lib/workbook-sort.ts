import { createEvaluator, parseCellKey } from './engine';
import { checkValue } from './data-validation';
import type { DataValidationFailure } from './data-validation';
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

  const patches = new Map(planned.changes.map(({ key, cell }) => [key, cell]));
  const validationKeys = new Set(patches.keys());
  const moved = new Set(planned.targetRows.filter((row, index) => row !== planned.rowOrder[index]));
  for (const key in sheet.cells) {
    if (!Object.hasOwn(sheet.cells, key)) continue;
    const point = parseCellKey(key);
    if (point && moved.has(point.row)) validationKeys.add(key);
  }
  // Existing formulas can keep their raw text but compute differently after
  // their peer cells move. Every read sees all patches, including deletions.
  const cells = new Proxy(sheet.cells, {
    get: (target, key) =>
      typeof key === 'string' && patches.has(key)
        ? (patches.get(key) ?? undefined)
        : Reflect.get(target, key),
  });
  const candidate = { ...sheet, cells };
  const candidateBook = {
    ...workbook,
    sheets: workbook.sheets.map((item) => (item.id === sheetId ? candidate : item)),
  };
  const evaluateCandidate = createEvaluator(candidateBook, { managedMutations: true });
  const failures: DataValidationFailure[] = [];
  for (const key of validationKeys) {
    const point = parseCellKey(key)!;
    const matches = sheet.dataValidations.filter(
      (rule) =>
        (!rule.sheetId || rule.sheetId === sheetId) &&
        point.row >= rule.range.start.row &&
        point.row <= rule.range.end.row &&
        point.col >= rule.range.start.col &&
        point.col <= rule.range.end.col,
    );
    if (matches.length)
      failures.push(...checkValue(sheetId, key, evaluateCandidate(candidate, key), matches));
    if (failures.length >= 100) break;
  }
  if (failures.length) throw new WorkbookSortValidationError(failures.slice(0, 100));
  return planned;
}

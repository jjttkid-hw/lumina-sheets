import { createEvaluator, parseCellKey } from './engine';
import { checkValue, type DataValidationFailure } from './data-validation';
import type { Cell, Workbook } from './types';

export interface WorkbookValidationOptions {
  dimensions?: { rowCount?: number; colCount?: number };
  /** Overrides the default changed addresses, e.g. retained formulas in moved rows. */
  validationKeys?: Iterable<string>;
}

/**
 * Check a complete candidate batch without mutating cells or any live evaluator.
 * Callers own shape/address/rule normalization; this helper never scans stored
 * cells or expands rule ranges. Explicit validation keys replace the defaults.
 */
export function validateWorkbookCellChanges(
  workbook: Workbook,
  sheetId: string,
  changes: ReadonlyArray<{ key: string; cell: Cell | null }>,
  options: WorkbookValidationOptions = {},
): DataValidationFailure[] {
  const sheet = workbook.sheets.find((item) => item.id === sheetId);
  if (!sheet) throw new Error('找不到工作表');
  if (!sheet.dataValidations?.length) return [];
  const patches = new Map(changes.map(({ key, cell }) => [key, cell]));
  const cells = new Proxy(sheet.cells, {
    get: (target, key) =>
      typeof key === 'string' && patches.has(key)
        ? (patches.get(key) ?? undefined)
        : Reflect.get(target, key),
  });
  const candidate = {
    ...sheet,
    rowCount: options.dimensions?.rowCount ?? sheet.rowCount,
    colCount: options.dimensions?.colCount ?? sheet.colCount,
    cells,
  };
  const candidateBook = {
    ...workbook,
    sheets: workbook.sheets.map((item) => (item.id === sheetId ? candidate : item)),
  };
  const evaluate = createEvaluator(candidateBook, { managedMutations: true });
  const failures: DataValidationFailure[] = [];
  const seen = new Set<string>();
  for (const key of options.validationKeys ?? patches.keys()) {
    if (seen.has(key)) continue;
    seen.add(key);
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
      failures.push(...checkValue(sheetId, key, evaluate(candidate, key), matches));
    if (failures.length >= 100) return failures.slice(0, 100);
  }
  return failures;
}

import { checkValue, type DataValidationRule } from './data-validation';
import { parseCellKey } from './engine';
import type { CellValue } from './types';

export interface ValidationOptions {
  values: CellValue[];
  unsupportedFormulaCount: number;
}

function matchingRules(
  sheetId: string,
  key: string,
  rules: readonly DataValidationRule[],
): DataValidationRule[] {
  if (typeof sheetId !== 'string' || !sheetId) throw new TypeError('必须提供工作表 ID');
  const point = typeof key === 'string' ? parseCellKey(key) : null;
  if (!point) throw new RangeError('无效单元格地址');
  return rules.filter((rule) => {
    if (rule.sheetId !== undefined && rule.sheetId !== sheetId) return false;
    const { start, end } = rule.range;
    return (
      point.row >= start.row &&
      point.row <= end.row &&
      point.col >= start.col &&
      point.col <= end.col
    );
  });
}

/**
 * Derive literal choices for one cell from already validated rule definitions.
 * Only matching list values are indexed; ranges and stored cells are never scanned.
 */
export function getValidationOptions(
  sheetId: string,
  key: string,
  rules: readonly DataValidationRule[],
): ValidationOptions | null {
  const matching = matchingRules(sheetId, key, rules);
  const lists = matching.filter((rule) => rule.kind === 'list');
  if (!lists.length) return null;
  const memberships = lists.map((rule) => new Set(rule.values));
  const constraints = matching.filter((rule) => rule.kind !== 'list');
  const blankAllowed = matching.every((rule) => rule.allowBlank !== false);
  const seen = new Set<CellValue>();
  const values: CellValue[] = [];
  let unsupportedFormulaCount = 0;
  for (const value of lists[0].values) {
    if (seen.has(value)) continue;
    seen.add(value);
    // checkValue treats allowed blank as satisfying every rule, even when a
    // subsequent list omits it. It still must occur in the first list to appear.
    if (value === '') {
      if (blankAllowed) values.push(value);
      continue;
    }
    if (!memberships.every((membership) => membership.has(value))) continue;
    if (constraints.length && checkValue(sheetId, key, value, constraints).length) continue;
    // Canvas stores strings beginning with '=' as formulas. Offering one as a
    // literal would silently change its meaning, so report it instead.
    if (typeof value === 'string' && value.startsWith('=')) {
      unsupportedFormulaCount++;
      continue;
    }
    values.push(value);
  }
  return { values, unsupportedFormulaCount };
}

/** Validate one selected literal without deriving or checking every other candidate. */
export function isValidationOption(
  sheetId: string,
  key: string,
  value: CellValue,
  rules: readonly DataValidationRule[],
): boolean {
  const matching = matchingRules(sheetId, key, rules);
  const firstList = matching.find((rule) => rule.kind === 'list');
  if (!firstList || !firstList.values.includes(value)) return false;
  if (typeof value === 'string' && value.startsWith('=')) return false;
  return checkValue(sheetId, key, value, matching).length === 0;
}

/** Labels are presentation only; callers must retain the original typed value. */
export function validationOptionLabel(value: CellValue): string {
  return value === '' ? '空白' : typeof value === 'string' ? JSON.stringify(value) : String(value);
}

export function validationOptionType(value: CellValue): string {
  return typeof value === 'string' ? '文本' : typeof value === 'number' ? '数字' : '布尔';
}

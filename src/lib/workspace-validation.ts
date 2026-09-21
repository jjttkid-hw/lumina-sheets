import { copyDataValidationRules } from './data-validation';
import { cellKey, MAX_COLUMNS, MAX_ROWS, parseCellKey } from './engine';
import type { CellRange, Sheet, Workbook } from './types';

/** Canonical A1 label for an inclusive, zero-based rule range. */
export function validationRangeLabel(range: CellRange): string {
  const start = cellKey(range.start.row, range.start.col);
  const end = cellKey(range.end.row, range.end.col);
  return start === end ? start : `${start}:${end}`;
}

/** UI entry ranges must fit the current sheet; stored rules may extend beyond it. */
export function parseValidationRange(
  text: string,
  sheet: Pick<Sheet, 'rowCount' | 'colCount'>,
): CellRange {
  if (
    !Number.isSafeInteger(sheet.rowCount) ||
    sheet.rowCount < 1 ||
    sheet.rowCount > MAX_ROWS ||
    !Number.isSafeInteger(sheet.colCount) ||
    sheet.colCount < 1 ||
    sheet.colCount > MAX_COLUMNS
  )
    throw new RangeError('工作表行列尺寸无效');
  if (typeof text !== 'string') throw new TypeError('验证范围必须是 A1 或 A1:B10 形式的文本');
  const parts = text.trim().split(':');
  if (parts.length < 1 || parts.length > 2)
    throw new RangeError('验证范围须为单个单元格或矩形，例如 A1 或 A1:B10');
  const first = parseCellKey(parts[0].trim());
  const last = parts.length === 2 ? parseCellKey(parts[1].trim()) : first;
  if (!first || !last) throw new RangeError('验证范围须为单个单元格或矩形，不支持跨表或整行整列');
  const range = {
    start: { row: Math.min(first.row, last.row), col: Math.min(first.col, last.col) },
    end: { row: Math.max(first.row, last.row), col: Math.max(first.col, last.col) },
  };
  if (range.end.row >= sheet.rowCount || range.end.col >= sheet.colCount)
    throw new RangeError('验证范围超出当前工作表的行列尺寸');
  return range;
}

/**
 * Plan an atomic rule replacement without reading values or expanding ranges.
 * Rules retain IDs, sheet scopes, order and overlap; only allowBlank is defaulted
 * by the shared validator. Callers own persistence, history and committing the sheet.
 */
export function planWorkspaceValidationRules(
  workbook: Workbook,
  sheetId: string,
  input: unknown,
): Sheet | null {
  const sheet = workbook.sheets.find((candidate) => candidate.id === sheetId);
  if (!sheet) throw new Error('找不到工作表');
  if (sheet.dataSource?.kind === 'paged') throw new Error('分页数据源只读，不能设置验证规则');
  const rules = copyDataValidationRules(input);
  const current = copyDataValidationRules(sheet.dataValidations ?? []);
  if (JSON.stringify(rules) === JSON.stringify(current)) return null;
  return { ...sheet, dataValidations: rules };
}

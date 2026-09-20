import { cellKey, parseCellKey } from './engine';
import { IMPORT_LIMITS } from './io';
import { validateWorkbookCellChanges } from './workbook-validation';
import type { DataValidationFailure } from './data-validation';
import type { Cell, Sheet, Workbook } from './types';

export interface WorkspaceCellChange {
  key: string;
  cell: Cell | null;
}
export class WorkspaceEditError extends Error {
  readonly failures: DataValidationFailure[];
  constructor(
    message: string,
    readonly code: 'INVALID_ARGUMENT' | 'VALIDATION_FAILED' = 'INVALID_ARGUMENT',
    failures: DataValidationFailure[] = [],
  ) {
    super(message);
    this.name = 'WorkspaceEditError';
    this.failures = structuredClone(failures);
  }
}
const fail = (message: string): never => {
  throw new WorkspaceEditError(message);
};
const integer = (n: unknown, max: number): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 && n <= max;

/** Validate a complete edit before the workspace queues storage or changes history. */
export function planWorkspaceCellChanges(
  workbook: Workbook,
  sheetId: string,
  input: readonly WorkspaceCellChange[],
  dimensions?: { rowCount?: number; colCount?: number },
): {
  sheet: Sheet;
  changes: WorkspaceCellChange[];
  dimensions?: { rowCount: number; colCount: number };
} | null {
  const sheet = workbook.sheets.find((item) => item.id === sheetId);
  if (!sheet) return fail('找不到工作表');
  if (sheet.dataSource?.kind === 'paged') return fail('分页数据源只读，不能编辑');
  if (!Array.isArray(input) || input.length > IMPORT_LIMITS.cells)
    return fail('一次最多编辑 100,000 个单元格，请缩小范围');
  const after = {
    rowCount: dimensions?.rowCount ?? sheet.rowCount,
    colCount: dimensions?.colCount ?? sheet.colCount,
  };
  if (
    !integer(after.rowCount, IMPORT_LIMITS.rows) ||
    !integer(after.colCount, IMPORT_LIMITS.columns) ||
    after.rowCount < sheet.rowCount ||
    after.colCount < sheet.colCount
  )
    return fail('编辑范围须位于 100,000 行、256 列以内，不能缩小已有工作表');
  const normalized = new Map<string, Cell | null>();
  for (const change of input) {
    const point = change && typeof change.key === 'string' ? parseCellKey(change.key) : null;
    if (!point || point.row >= IMPORT_LIMITS.rows || point.col >= IMPORT_LIMITS.columns)
      return fail('单元格地址超出 100,000 行、256 列的工作空间范围');
    if (change.cell !== null) {
      const cell = change.cell;
      if (
        !cell ||
        !['string', 'number', 'boolean'].includes(typeof cell.value) ||
        (typeof cell.value === 'number' && !Number.isFinite(cell.value))
      )
        return fail('单元格值必须是文本、有限数字或布尔值');
      if (typeof cell.value === 'string' && cell.value.length > 32_767)
        return fail('单元格内容不能超过 32,767 个字符');
    }
    normalized.set(cellKey(point.row, point.col), change.cell && structuredClone(change.cell));
  }
  for (const [key, cell] of normalized) {
    if (!cell) continue;
    const point = parseCellKey(key)!;
    if (
      (dimensions?.rowCount !== undefined && point.row >= after.rowCount) ||
      (dimensions?.colCount !== undefined && point.col >= after.colCount)
    )
      return fail('单元格超出指定的工作表尺寸');
    after.rowCount = Math.max(after.rowCount, point.row + 1);
    after.colCount = Math.max(after.colCount, point.col + 1);
  }
  const changes = [...normalized].flatMap(([key, cell]) =>
    JSON.stringify(sheet.cells[key] ?? null) === JSON.stringify(cell) ? [] : [{ key, cell }],
  );
  const resized = after.rowCount !== sheet.rowCount || after.colCount !== sheet.colCount;
  if (!changes.length && !resized) return null;
  if (
    resized &&
    sheet.merges?.length &&
    after.rowCount * after.colCount > IMPORT_LIMITS.mergedSheetCells
  )
    return fail('含合并单元格的工作表布局最多支持 100,000 格，请先取消合并或缩小范围');
  let total = workbook.sheets.reduce((sum, item) => sum + Object.keys(item.cells).length, 0);
  for (const { key, cell } of changes) {
    if (sheet.cells[key] === undefined && cell !== null) total++;
    else if (sheet.cells[key] !== undefined && cell === null) total--;
  }
  if (total > IMPORT_LIMITS.cells)
    return fail('工作簿最多保存 100,000 个单元格，请清理数据或拆分工作簿');
  const failures = validateWorkbookCellChanges(
    workbook,
    sheetId,
    [...normalized].map(([key, cell]) => ({ key, cell })),
    { dimensions: after },
  );
  if (failures.length)
    throw new WorkspaceEditError(
      `${failures[0].key}：${failures[0].message}`,
      'VALIDATION_FAILED',
      failures,
    );
  const cells = { ...sheet.cells };
  for (const { key, cell } of changes) {
    if (cell === null) delete cells[key];
    else cells[key] = cell;
  }
  return {
    sheet: { ...sheet, ...after, cells },
    changes,
    ...(resized ? { dimensions: after } : {}),
  };
}

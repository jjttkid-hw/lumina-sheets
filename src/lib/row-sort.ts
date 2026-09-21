import { cellKey, MAX_COLUMNS, MAX_ROWS, parseCellKey, translateFormula } from './engine';
import { validateFormulaReferences } from './formula-structure';
import type { Cell, CellValue, Sheet } from './types';

export interface RowSortKey {
  column: number;
  direction: 'asc' | 'desc';
}
export interface RowSortRequest {
  startRow: number;
  rowCount: number;
  keys: RowSortKey[];
  includeHidden?: boolean;
}
export interface RowSortPlan {
  changes: Array<{ key: string; cell: Cell | null }>;
  /** Source row at each corresponding eligible target row. */
  rowOrder: number[];
  targetRows: number[];
  movedRows: number;
}
const MAX_SORT_ROWS = 100_000;
const MAX_SORT_PATCHES = 100_000;
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function fail(message: string): never {
  throw new Error(`行排序：${message}`);
}
function plainFields(value: unknown, allowed: string[], required: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail('参数必须为普通对象');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail('包含不支持的参数字段');
    if (!('value' in Object.getOwnPropertyDescriptor(value, key)!)) fail('参数不能使用访问器字段');
  }
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`缺少参数 ${key}`);
}
function integer(value: unknown, minimum: number, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  );
}
function compare(a: CellValue, b: CellValue): number {
  if (typeof a === typeof b) {
    if (typeof a === 'number') return a < (b as number) ? -1 : a > (b as number) ? 1 : 0;
    if (typeof a === 'boolean') return Number(a) - Number(b);
    return collator.compare(a as string, b as string);
  }
  const rank = (value: CellValue) =>
    typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2;
  return rank(a) - rank(b);
}
function sameCell(a: Cell | undefined, b: Cell | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.value !== b.value) return false;
  if (JSON.stringify(a.richText) !== JSON.stringify(b.richText)) return false;
  if (a.hyperlink?.target !== b.hyperlink?.target || a.hyperlink?.tooltip !== b.hyperlink?.tooltip)
    return false;
  if (!a.style || !b.style) return a.style === b.style;
  const keys = Object.keys(a.style) as Array<keyof NonNullable<Cell['style']>>;
  return (
    keys.length === Object.keys(b.style).length &&
    keys.every((key) => a.style![key] === b.style![key])
  );
}

/** Plans a stable sparse permutation; it never changes sheet data or metadata. */
export function planRowSort(
  sheet: Sheet,
  request: RowSortRequest,
  getValue: (key: string) => CellValue,
): RowSortPlan {
  plainFields(
    request,
    ['startRow', 'rowCount', 'keys', 'includeHidden'],
    ['startRow', 'rowCount', 'keys'],
  );
  if (!sheet || !integer(sheet.rowCount, 1, MAX_ROWS) || !integer(sheet.colCount, 1, MAX_COLUMNS))
    fail('工作表尺寸无效');
  if (
    !integer(request.startRow, 0, sheet.rowCount - 1) ||
    !integer(request.rowCount, 1, MAX_SORT_ROWS) ||
    request.startRow + request.rowCount > sheet.rowCount
  )
    fail('排序范围无效或超过 100,000 行');
  if (Object.hasOwn(request, 'includeHidden') && typeof request.includeHidden !== 'boolean')
    fail('includeHidden 必须为布尔值');
  if (!Array.isArray(request.keys) || request.keys.length < 1 || request.keys.length > 8)
    fail('排序键必须为 1 至 8 项');
  if (
    Reflect.ownKeys(request.keys).some(
      (key) =>
        typeof key !== 'string' ||
        (key !== 'length' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= request.keys.length)),
    )
  )
    fail('排序键数组包含额外字段');
  const seenColumns = new Set<number>();
  for (let index = 0; index < request.keys.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(request.keys, String(index));
    if (!descriptor || !('value' in descriptor)) fail('排序键数组不能稀疏或包含访问器');
    const key = descriptor.value as RowSortKey;
    plainFields(key, ['column', 'direction'], ['column', 'direction']);
    if (!integer(key.column, 0, sheet.colCount - 1) || !['asc', 'desc'].includes(key.direction))
      fail('排序列或方向无效');
    if (seenColumns.has(key.column)) fail('排序列不能重复');
    seenColumns.add(key.column);
  }
  if (typeof getValue !== 'function') fail('排序取值器无效');
  if (sheet.dataSource?.kind === 'paged') fail('分页数据源不能执行本地行排序');
  const endRow = request.startRow + request.rowCount - 1;
  if (request.startRow < (sheet.frozenRows ?? 0)) fail('排序范围不能与冻结前导行相交');
  if (
    (sheet.merges ?? []).some(
      (merge) =>
        Math.min(merge.start.row, merge.end.row) <= endRow &&
        Math.max(merge.start.row, merge.end.row) >= request.startRow,
    )
  )
    fail('排序行范围包含合并区域，请先取消合并');
  const hidden = new Set(request.includeHidden ? [] : (sheet.hiddenRows ?? []));
  const targetRows: number[] = [];
  for (let row = request.startRow; row <= endRow; row++) if (!hidden.has(row)) targetRows.push(row);
  const rowCells = new Map<number, Map<number, Cell>>();
  // Stored cells are the only column scan: a 16,384-column sheet need not be dense.
  for (const key in sheet.cells) {
    if (!Object.hasOwn(sheet.cells, key)) continue;
    const point = parseCellKey(key);
    if (!point || point.row < request.startRow || point.row > endRow || hidden.has(point.row))
      continue;
    if (key !== cellKey(point.row, point.col) || point.col >= sheet.colCount)
      fail('排序范围存在无效单元格坐标');
    const cell = sheet.cells[key];
    if (
      !cell ||
      !['number', 'string', 'boolean'].includes(typeof cell.value) ||
      (typeof cell.value === 'number' && !Number.isFinite(cell.value))
    )
      fail('排序范围存在无效单元格值');
    let cells = rowCells.get(point.row);
    if (!cells) rowCells.set(point.row, (cells = new Map()));
    cells.set(point.col, cell);
  }
  if (targetRows.length < 2)
    return { changes: [], rowOrder: [...targetRows], targetRows, movedRows: 0 };
  const sortable = targetRows.map((row, index) => ({
    row,
    index,
    values: request.keys.map((key) => {
      const value = getValue(cellKey(row, key.column));
      if (
        !['number', 'string', 'boolean'].includes(typeof value) ||
        (typeof value === 'number' && !Number.isFinite(value))
      )
        fail('排序取值器返回了无效值');
      return value;
    }),
  }));
  sortable.sort((a, b) => {
    for (let index = 0; index < request.keys.length; index++) {
      const left = a.values[index],
        right = b.values[index];
      if (left === '' || right === '') {
        if (left !== right) return left === '' ? 1 : -1;
        continue;
      }
      const result = compare(left, right);
      if (result) return request.keys[index].direction === 'asc' ? result : -result;
    }
    return a.index - b.index;
  });
  const rowOrder = sortable.map(({ row }) => row);
  const changes: RowSortPlan['changes'] = [];
  let movedRows = 0;
  for (let index = 0; index < targetRows.length; index++) {
    const target = targetRows[index],
      source = rowOrder[index];
    if (target === source) continue;
    movedRows++;
    const sourceCells = rowCells.get(source),
      previousCells = rowCells.get(target);
    const columns = new Set([...(sourceCells?.keys() ?? []), ...(previousCells?.keys() ?? [])]);
    for (const col of columns) {
      const cell = sourceCells?.get(col);
      let next: Cell | undefined;
      if (cell) {
        let value = cell.value;
        if (typeof value === 'string' && value.startsWith('=')) {
          try {
            validateFormulaReferences(value, sheet.name);
          } catch {
            fail('移动的公式包含不支持的引用语法');
          }
          value = translateFormula(value, target - source, 0);
          if (value.length > 32_767) fail('移动后的公式超过 32,767 个字符');
        }
        next = {
          ...cell,
          ...(cell.style ? { style: { ...cell.style } } : {}),
          ...(cell.hyperlink ? { hyperlink: { ...cell.hyperlink } } : {}),
          ...(cell.richText ? { richText: structuredClone(cell.richText) } : {}),
          value,
        };
      }
      if (sameCell(previousCells?.get(col), next)) continue;
      if (changes.length >= MAX_SORT_PATCHES) fail('最终变更超过 100,000 个单元格');
      changes.push({ key: cellKey(target, col), cell: next ?? null });
    }
  }
  return { changes, rowOrder, targetRows, movedRows };
}

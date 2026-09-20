import { ColumnMetrics, MergeIndex } from './geometry';
import type { MergeRect } from './geometry';
import { RowMetrics } from './row-metrics';
import { projectRange } from './projection';

export interface CellCoordinate {
  row: number;
  col: number;
}
export interface VisibleSelection {
  rows: number[];
  columns: number[];
  cells: Array<Array<CellCoordinate | null>>;
}
export interface VisibleFillCell extends CellCoordinate {
  sourceRow: number;
  sourceCol: number;
}

function limit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('可见单元格配额必须为正整数');
}
function bounds(range: MergeRect) {
  if (
    !Object.values(range).every((value) => Number.isSafeInteger(value) && value >= 0) ||
    range.top > range.bottom ||
    range.left > range.right
  )
    throw new Error('选区坐标无效');
}
function overLimit(max: number): never {
  throw new Error(`单次操作最多支持 ${max.toLocaleString()} 个可见单元格`);
}
const empty = (): VisibleSelection => ({ rows: [], columns: [], cells: [] });

function axes(rows: RowMetrics, columns: ColumnMetrics, range: MergeRect, max: number) {
  const projected = projectRange(rows, columns, range);
  if (!projected) return { rows: [], columns: [] };
  const visibleColumns: number[] = [];
  for (
    let col = projected.leftCol;
    col >= 0 && col <= projected.rightCol;
    col = columns.nextVisible(col + 1)
  ) {
    if (visibleColumns.length >= max) overLimit(max);
    visibleColumns.push(col);
  }
  const visibleRows: number[] = [];
  const rowLimit = Math.floor(max / visibleColumns.length);
  for (
    let index = projected.topIndex;
    index >= 0 && index <= projected.bottomIndex;
    index = rows.nextVisible(index + 1)
  ) {
    if (visibleRows.length >= rowLimit) overLimit(max);
    visibleRows.push(rows.row(index));
  }
  return { rows: visibleRows, columns: visibleColumns };
}

function matrix(rowAxis: number[], columnAxis: number[], merges: MergeIndex, rejectMerges = false) {
  const seen = new Set<string>();
  return rowAxis.map((row) =>
    columnAxis.map((col): CellCoordinate | null => {
      const merge = merges.at(row, col);
      if (!merge) return { row, col };
      if (rejectMerges) throw new Error('操作范围包含可见合并单元格，请先取消合并');
      const key = `${merge.top}:${merge.left}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return { row: merge.top, col: merge.left };
    }),
  );
}

/** Only visible positions count toward the quota; merge values occur once. */
export function visibleSelection(
  rows: RowMetrics,
  columns: ColumnMetrics,
  merges: MergeIndex,
  range: MergeRect,
  maxCells = 100_000,
): VisibleSelection {
  limit(maxCells);
  bounds(range);
  let effective = range;
  if (range.top === range.bottom && range.left === range.right)
    effective = merges.at(range.top, range.left) ?? range;
  const selected = axes(rows, columns, effective, maxCells);
  if (!selected.rows.length || !selected.columns.length) return empty();
  return { ...selected, cells: matrix(selected.rows, selected.columns, merges) };
}

/** Plan the entire paste before callers mutate any cell; never grow the sheet. */
export function visiblePasteTarget(
  rows: RowMetrics,
  columns: ColumnMetrics,
  merges: MergeIndex,
  start: CellCoordinate,
  height: number,
  width: number,
  maxCells = 100_000,
): VisibleSelection {
  limit(maxCells);
  if (![height, width].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new Error('粘贴行列数必须为正整数');
  if (height > Math.floor(maxCells / width)) overLimit(maxCells);
  bounds({ top: start.row, bottom: start.row, left: start.col, right: start.col });
  const merge = merges.at(start.row, start.col);
  const projection = merge ? projectRange(rows, columns, merge) : null;
  if (merge && !projection) throw new Error('粘贴起点的合并区域没有可见单元格');
  let index = projection?.topIndex ?? rows.nextVisible(rows.indexAtOrAfter(start.row));
  let col = projection?.leftCol ?? columns.nextVisible(start.col);
  const rowAxis: number[] = [],
    columnAxis: number[] = [];
  for (let count = 0; count < height && index >= 0; count++, index = rows.nextVisible(index + 1))
    rowAxis.push(rows.row(index));
  for (let count = 0; count < width && col >= 0; count++, col = columns.nextVisible(col + 1))
    columnAxis.push(col);
  if (rowAxis.length !== height || columnAxis.length !== width)
    throw new Error('剩余可见行列不足，无法完整粘贴');
  return {
    rows: rowAxis,
    columns: columnAxis,
    cells: matrix(rowAxis, columnAxis, merges, height * width > 1),
  };
}

/** Target is the complete expanded drag rectangle, including the source. */
export function visibleFillPlan(
  rows: RowMetrics,
  columns: ColumnMetrics,
  merges: MergeIndex,
  source: MergeRect,
  target: MergeRect,
  maxCells = 100_000,
): VisibleFillCell[] {
  limit(maxCells);
  bounds(source);
  bounds(target);
  if (
    target.top > source.top ||
    target.bottom < source.bottom ||
    target.left > source.left ||
    target.right < source.right
  )
    throw new Error('填充目标必须包含原始选区');
  const sourceAxes = axes(rows, columns, source, maxCells);
  if (!sourceAxes.rows.length || !sourceAxes.columns.length)
    throw new Error('源选区没有可见单元格');
  const targetAxes = axes(rows, columns, target, maxCells);
  if (!targetAxes.rows.length || !targetAxes.columns.length)
    throw new Error('填充目标没有可见单元格');
  // Checking every visible position also rejects merges whose original anchors
  // were filtered out, without expanding any hidden logical rows.
  for (const row of targetAxes.rows)
    for (const col of targetAxes.columns)
      if (merges.at(row, col)) throw new Error('填充范围包含可见合并单元格，请先取消合并');
  const rowOrigin = targetAxes.rows.indexOf(sourceAxes.rows[0]);
  const colOrigin = targetAxes.columns.indexOf(sourceAxes.columns[0]);
  const modulo = (value: number, length: number) => ((value % length) + length) % length;
  const plan: VisibleFillCell[] = [];
  targetAxes.rows.forEach((row, ri) =>
    targetAxes.columns.forEach((col, ci) => {
      if (row >= source.top && row <= source.bottom && col >= source.left && col <= source.right)
        return;
      plan.push({
        row,
        col,
        sourceRow: sourceAxes.rows[modulo(ri - rowOrigin, sourceAxes.rows.length)],
        sourceCol: sourceAxes.columns[modulo(ci - colOrigin, sourceAxes.columns.length)],
      });
    }),
  );
  return plan;
}

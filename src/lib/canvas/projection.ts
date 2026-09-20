import { ColumnMetrics, MergeIndex, HEADER_HEIGHT } from './geometry';
import type { MergeRect } from './geometry';
import { RowMetrics } from './row-metrics';

export interface RangeProjection {
  topIndex: number;
  bottomIndex: number;
  leftCol: number;
  rightCol: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Project original coordinates onto the ascending filtered, visible axes. */
export function projectRange(
  rows: RowMetrics,
  columns: ColumnMetrics,
  range: MergeRect,
): RangeProjection | null {
  const topIndex = rows.nextVisible(rows.indexAtOrAfter(range.top));
  const bottomIndex = rows.nextVisible(rows.indexAtOrAfter(range.bottom + 1) - 1, -1);
  const leftCol = columns.nextVisible(range.left);
  const rightCol = columns.previousVisible(range.right);
  if (topIndex < 0 || bottomIndex < topIndex || leftCol < 0 || rightCol < leftCol) return null;
  if (
    rows.row(topIndex) > range.bottom ||
    rows.row(bottomIndex) < range.top ||
    leftCol > range.right ||
    rightCol < range.left
  )
    return null;
  const x = columns.offsets[leftCol],
    y = rows.offset(topIndex);
  return {
    topIndex,
    bottomIndex,
    leftCol,
    rightCol,
    x,
    y,
    width: columns.offsets[rightCol + 1] - x,
    height: rows.offset(bottomIndex + 1) - y,
  };
}

/** The logical anchor is independent of whether its own row/column is visible. */
export function projectCell(
  rows: RowMetrics,
  columns: ColumnMetrics,
  merges: MergeIndex,
  row: number,
  col: number,
) {
  const merge = merges.at(row, col);
  const range = merge ?? { top: row, bottom: row, left: col, right: col };
  const projection = projectRange(rows, columns, range);
  return projection ? { row: range.top, col: range.left, range, projection } : null;
}

/** Preserve a visible merge's hidden anchor before seeking a nearby visible cell. */
export function resolveVisibleCell(
  rows: RowMetrics,
  columns: ColumnMetrics,
  merges: MergeIndex,
  row: number,
  col: number,
) {
  const projected = projectCell(rows, columns, merges, row, col);
  if (projected) return { row: projected.row, col: projected.col };
  const candidate = rows.indexAtOrAfter(row);
  let index = rows.nextVisible(candidate);
  if (index < 0) index = rows.nextVisible(candidate, -1);
  let visibleCol = columns.nextVisible(col);
  if (visibleCol < 0) visibleCol = columns.previousVisible(col);
  if (index < 0 || visibleCol < 0) return null;
  const target = projectCell(rows, columns, merges, rows.row(index), visibleCol);
  return target ? { row: target.row, col: target.col } : null;
}

/** Number of displayed indices belonging to the original frozen-row prefix. */
export function projectedFrozenRows(rows: RowMetrics, frozenRows: number): number {
  return rows.indexAtOrAfter(Math.max(0, Math.trunc(frozenRows)));
}

/** Visible pieces in the frozen/scrolling panes, sharing the same logical rect. */
export function projectPaneFragments(
  projection: RangeProjection,
  rows: RowMetrics,
  frozen: number,
  scroll: number,
  viewportHeight: number,
) {
  const frozenHeight = rows.offset(frozen);
  const paneBoundary = HEADER_HEIGHT + frozenHeight;
  const end = projection.y + projection.height;
  const fragments: Array<{ y: number; height: number; contentY: number }> = [];
  if (projection.y < frozenHeight) {
    const contentY = HEADER_HEIGHT + projection.y;
    const bottom = Math.min(HEADER_HEIGHT + end, paneBoundary, viewportHeight);
    if (bottom > contentY) fragments.push({ y: contentY, height: bottom - contentY, contentY });
  }
  if (end > frozenHeight) {
    const contentY = HEADER_HEIGHT + projection.y - scroll;
    const y = Math.max(contentY, paneBoundary);
    const bottom = Math.min(HEADER_HEIGHT + end - scroll, viewportHeight);
    if (bottom > y) fragments.push({ y, height: bottom - y, contentY });
  }
  return fragments;
}

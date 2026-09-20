import { ColumnMetrics, MergeIndex } from './geometry';
import { RowMetrics } from './row-metrics';
import { projectCell, resolveVisibleCell } from './projection';

/** Keep observer/event repeats from scheduling another React render and paint. */
export function stableViewportSize<T extends { width: number; height: number }>(
  previous: T,
  width: number,
  height: number,
): T | { width: number; height: number } {
  return previous.width === width && previous.height === height ? previous : { width, height };
}

export function stableScrollPosition<T extends { left: number; top: number }>(
  previous: T,
  left: number,
  top: number,
): T | { left: number; top: number } {
  return previous.left === left && previous.top === top ? previous : { left, top };
}

/** Reveal a logical content interval outside a fixed header/frozen pane. */
export function revealScroll(
  start: number,
  end: number,
  scroll: number,
  viewport: number,
  inset: number,
): number {
  if (viewport <= inset || end <= start) return scroll;
  if (start < scroll + inset) return Math.max(0, start - inset);
  if (end > scroll + viewport) return Math.max(0, Math.min(start - inset, end - viewport));
  return scroll;
}

/** Keyboard movement skips hidden axes and exits a merged cell as one unit. */
export function moveVisibleCell(
  rows: RowMetrics,
  columns: ColumnMetrics,
  merges: MergeIndex,
  row: number,
  col: number,
  dr: number,
  dc: number,
  extend = false,
): { row: number; col: number } | null {
  if (rows.total <= 0 || columns.total <= 0) return null;
  const current = projectCell(rows, columns, merges, row, col);
  const merge = merges.at(row, col);
  let index = rows.indexOfRow(row);
  if (current) index = current.projection.topIndex;
  else if (index < 0) index = rows.indexAtOrAfter(row);
  let nextRow = rows.nextVisible(index, dr < 0 ? -1 : 1);
  if (dr) {
    let candidate = index + dr;
    if (merge && !extend) {
      if (dr > 0) candidate = Math.max(candidate, rows.indexAtOrAfter(merge.bottom + 1));
      else candidate = Math.min(candidate, rows.indexAtOrAfter(merge.top) - 1);
    }
    const moved = rows.nextVisible(candidate, dr < 0 ? -1 : 1);
    if (moved >= 0) nextRow = moved;
  }
  if (nextRow < 0) nextRow = rows.nextVisible(index, dr < 0 ? 1 : -1);
  const displayCol = current?.projection.leftCol ?? col;
  let nextCol = columns.nextVisible(displayCol, dc < 0 ? -1 : 1);
  if (dc) {
    let candidate = displayCol + dc;
    if (merge && !extend)
      candidate =
        dc > 0 ? Math.max(candidate, merge.right + 1) : Math.min(candidate, merge.left - 1);
    const moved = columns.nextVisible(candidate, dc < 0 ? -1 : 1);
    if (moved >= 0) nextCol = moved;
  }
  if (nextCol < 0) nextCol = columns.nextVisible(col, dc < 0 ? 1 : -1);
  return nextRow >= 0 && nextCol >= 0
    ? resolveVisibleCell(rows, columns, merges, rows.row(nextRow), nextCol)
    : null;
}

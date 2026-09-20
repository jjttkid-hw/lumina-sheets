import { describe, expect, it } from 'vitest';
import { ColumnMetrics, MergeIndex } from '../src/lib/canvas/geometry';
import { RowMetrics } from '../src/lib/canvas/row-metrics';
import {
  moveVisibleCell,
  revealScroll,
  stableViewportSize,
  stableScrollPosition,
} from '../src/lib/canvas/interaction';

describe('Canvas navigation across sparse layouts', () => {
  it('ignores repeated measurements and scroll events so an idle viewport stops painting', () => {
    const size = { width: 894, height: 480 };
    const scroll = { left: 0, top: 360.5 };
    expect(stableViewportSize(size, 894, 480)).toBe(size);
    expect(stableScrollPosition(scroll, 0, 360.5)).toBe(scroll);
    expect(stableViewportSize(size, 884, 480)).toEqual({ width: 884, height: 480 });
    expect(stableScrollPosition(scroll, 0, 360.75)).toEqual({ left: 0, top: 360.75 });
  });
  it('moves left over hidden columns instead of returning to the original column', () => {
    const rows = new RowMetrics(10);
    const columns = new ColumnMetrics(8, {}, {}, [1, 2, 3]);
    const merges = new MergeIndex();
    expect(moveVisibleCell(rows, columns, merges, 2, 4, 0, -1)).toEqual({ row: 2, col: 0 });
    expect(moveVisibleCell(rows, columns, merges, 2, 0, 0, 1)).toEqual({ row: 2, col: 4 });
    expect(moveVisibleCell(rows, columns, merges, 2, 0, 0, -1)).toEqual({ row: 2, col: 0 });
  });

  it('leaves the bottom of a merge before skipping hidden rows', () => {
    const rows = new RowMetrics(20, {}, [5, 6]);
    const columns = new ColumnMetrics(8);
    const merges = new MergeIndex([{ start: { row: 2, col: 0 }, end: { row: 4, col: 1 } }]);
    expect(moveVisibleCell(rows, columns, merges, 2, 0, 1, 0)).toEqual({ row: 7, col: 0 });
    expect(moveVisibleCell(rows, columns, merges, 2, 0, -1, 0)).toEqual({ row: 1, col: 0 });
    expect(moveVisibleCell(rows, columns, merges, 2, 0, 0, 1)).toEqual({ row: 2, col: 2 });
  });

  it('moves in filtered display order and crosses merges whose endpoint was filtered out', () => {
    const rows = new RowMetrics(20, {}, [8], [0, 2, 8, 12]);
    const columns = new ColumnMetrics(4);
    const merges = new MergeIndex([{ start: { row: 2, col: 0 }, end: { row: 6, col: 0 } }]);
    expect(moveVisibleCell(rows, columns, merges, 2, 0, 1, 0)).toEqual({ row: 12, col: 0 });
    expect(moveVisibleCell(rows, columns, merges, 12, 0, -1, 0)).toEqual({ row: 2, col: 0 });
    expect(moveVisibleCell(rows, columns, merges, 0, 0, -1, 0)).toEqual({ row: 0, col: 0 });
  });

  it('does not invent a navigation target when either axis is completely hidden', () => {
    const hiddenRows = new RowMetrics(3, {}, [0, 1, 2]);
    const hiddenColumns = new ColumnMetrics(3, {}, {}, [0, 1, 2]);
    expect(
      moveVisibleCell(hiddenRows, new ColumnMetrics(3), new MergeIndex(), 0, 0, 1, 0),
    ).toBeNull();
    expect(
      moveVisibleCell(new RowMetrics(3), hiddenColumns, new MergeIndex(), 0, 0, 0, 1),
    ).toBeNull();
    expect(hiddenColumns.at(0)).toBe(-1);
    expect(hiddenColumns.visible(0, 500)).toEqual({ first: -1, last: -1 });
  });

  it('reveals the selected row below a tall frozen pane when navigating upward', () => {
    // Header 34 + frozen rows 96 = 130 px that scrolling cells cannot occupy.
    expect(revealScroll(202, 238, 100, 300, 130)).toBe(72);
    expect(revealScroll(274, 310, 100, 300, 130)).toBe(100);
    expect(revealScroll(454, 490, 100, 300, 130)).toBe(190);
    expect(revealScroll(202, 802, 100, 300, 130)).toBe(72);
    expect(revealScroll(44 + 96, 44 + 228, 120, 500, 44)).toBe(96);
  });

  it('iterates visible rows by skipping a long hidden run', () => {
    const rows = new RowMetrics(
      100_000,
      {},
      Array.from({ length: 99_998 }, (_, index) => index + 1),
    );
    const visited: number[] = [];
    for (let index = rows.nextVisible(0); index >= 0; index = rows.nextVisible(index + 1))
      visited.push(index);
    expect(visited).toEqual([0, 99_999]);
    const columns = new ColumnMetrics(
      16_384,
      {},
      {},
      Array.from({ length: 16_382 }, (_, index) => index + 1),
    );
    expect(columns.nextVisible(1)).toBe(16_383);
    expect(columns.previousVisible(16_382)).toBe(0);
    expect(columns.at(columns.width(0))).toBe(16_383);
  });
});

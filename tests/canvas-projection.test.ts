import { describe, expect, it } from 'vitest';
import { ColumnMetrics, MergeIndex } from '../src/lib/canvas/geometry';
import { RowMetrics } from '../src/lib/canvas/row-metrics';
import {
  projectRange,
  projectCell,
  resolveVisibleCell,
  projectedFrozenRows,
  projectPaneFragments,
} from '../src/lib/canvas/projection';
import { moveVisibleCell } from '../src/lib/canvas/interaction';

const columns = new ColumnMetrics(6, { 0: 80, 1: 100, 2: 120 });
const range = { top: 2, bottom: 8, left: 0, right: 2 };
const merges = new MergeIndex([{ start: { row: 2, col: 0 }, end: { row: 8, col: 2 } }]);

describe('filtered merge projection', () => {
  it('projects an interior subset when both original endpoints are filtered away', () => {
    const rows = new RowMetrics(20, { 4: 48, 6: 24 }, [], [0, 4, 6, 12]);
    expect(projectRange(rows, columns, range)).toMatchObject({
      topIndex: 1,
      bottomIndex: 2,
      leftCol: 0,
      rightCol: 2,
      x: 0,
      y: 36,
      width: 300,
      height: 72,
    });
    const hit = projectCell(rows, columns, merges, rows.row(rows.at(36)), columns.at(81));
    expect(hit).toMatchObject({ row: 2, col: 0, projection: { y: 36, height: 72 } });
    expect(projectCell(rows, columns, merges, 2, 0)).toEqual(hit);
  });

  it('compresses hidden middle rows and columns while keeping the original edit anchor', () => {
    const rows = new RowMetrics(20, { 4: 48, 5: 60, 6: 24 }, [4, 5], [0, 4, 5, 6, 12]);
    const hiddenColumns = new ColumnMetrics(6, { 0: 80, 1: 100, 2: 120 }, {}, [0, 1]);
    expect(projectCell(rows, hiddenColumns, merges, 6, 2)).toMatchObject({
      row: 2,
      col: 0,
      projection: { topIndex: 3, bottomIndex: 3, leftCol: 2, rightCol: 2, height: 24, width: 120 },
    });
    // Re-selecting or editing the already-selected hidden anchor must not move it.
    expect(resolveVisibleCell(rows, hiddenColumns, merges, 2, 0)).toEqual({ row: 2, col: 0 });
    expect(projectCell(rows, hiddenColumns, merges, 2, 0)?.row).toBe(2);
  });

  it('removes a merge with no surviving rows or no visible columns', () => {
    expect(projectRange(new RowMetrics(20, {}, [], [0, 1, 12]), columns, range)).toBeNull();
    expect(projectCell(new RowMetrics(20, {}, [4, 6], [4, 6]), columns, merges, 2, 0)).toBeNull();
    expect(
      projectRange(new RowMetrics(20), new ColumnMetrics(6, {}, {}, [0, 1, 2]), range),
    ).toBeNull();
  });

  it('projects ordinary range selections whose endpoints are filtered away', () => {
    const rows = new RowMetrics(20, {}, [], [0, 4, 6, 12]);
    expect(projectRange(rows, columns, { top: 3, bottom: 9, left: 1, right: 3 })).toMatchObject({
      topIndex: 1,
      bottomIndex: 2,
      height: 72,
    });
  });

  it('freezes only surviving members of the original leading row prefix', () => {
    const rows = new RowMetrics(100, {}, [2], [2, 6, 20, 40]);
    const frozen = projectedFrozenRows(rows, 5);
    expect(frozen).toBe(1);
    expect(rows.offset(frozen)).toBe(0);
    expect(rows.visibleFrozen(200, frozen)).toEqual({ first: -1, last: -1 });
    expect(rows.visible(0, 200, frozen).first).toBe(1);
    expect(projectedFrozenRows(new RowMetrics(100, {}, [], [6, 20]), 5)).toBe(0);
  });

  it('navigates out of a projected merge and back to its hidden anchor', () => {
    const rows = new RowMetrics(20, {}, [6], [0, 4, 6, 12]);
    const hiddenColumns = new ColumnMetrics(6, {}, {}, [0, 1]);
    expect(moveVisibleCell(rows, hiddenColumns, merges, 2, 0, 1, 0)).toEqual({ row: 12, col: 2 });
    expect(moveVisibleCell(rows, hiddenColumns, merges, 2, 0, -1, 0)).toEqual({ row: 0, col: 2 });
    expect(moveVisibleCell(rows, hiddenColumns, merges, 2, 0, 0, 1)).toEqual({ row: 4, col: 3 });
    expect(moveVisibleCell(rows, hiddenColumns, merges, 2, 0, 0, -1)).toEqual({ row: 2, col: 0 });
    expect(moveVisibleCell(rows, hiddenColumns, merges, 12, 2, -1, 0)).toEqual({ row: 2, col: 0 });
    expect(moveVisibleCell(rows, hiddenColumns, merges, 4, 3, 0, -1)).toEqual({ row: 2, col: 0 });
  });

  it('projects a million-row merge without materializing absent rows', () => {
    const rows = new RowMetrics(1_048_576, {}, [], [2, 500_000, 900_000]);
    expect(
      projectRange(rows, columns, { top: 1, bottom: 1_000_000, left: 0, right: 2 }),
    ).toMatchObject({
      topIndex: 0,
      bottomIndex: 2,
      height: 108,
    });
    expect(rows.count).toBe(3);
  });

  it('clips one projected merge into separate frozen and scrolling pieces', () => {
    const rows = new RowMetrics(20, {}, [], [1, 4, 6, 12]);
    const projected = projectRange(rows, columns, { top: 0, bottom: 8, left: 0, right: 2 })!;
    const frozen = projectedFrozenRows(rows, 3);
    expect(projectPaneFragments(projected, rows, frozen, 20, 180)).toEqual([
      { y: 34, height: 36, contentY: 34 },
      { y: 70, height: 52, contentY: 14 },
    ]);
    expect(projectPaneFragments(projected, rows, frozen, 200, 180)).toEqual([
      { y: 34, height: 36, contentY: 34 },
    ]);
    // A merge filtered entirely out of the original frozen prefix must scroll.
    const body = new RowMetrics(20, {}, [], [4, 6, 12]);
    const bodyProjection = projectRange(body, columns, range)!;
    expect(
      projectPaneFragments(bodyProjection, body, projectedFrozenRows(body, 3), 20, 180),
    ).toEqual([{ y: 34, height: 52, contentY: 14 }]);
  });
});

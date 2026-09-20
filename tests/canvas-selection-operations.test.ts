import { describe, expect, it, vi } from 'vitest';
import { ColumnMetrics, MergeIndex } from '../src/lib/canvas/geometry';
import { RowMetrics } from '../src/lib/canvas/row-metrics';
import {
  visibleSelection,
  visiblePasteTarget,
  visibleFillPlan,
} from '../src/lib/canvas/selection-operations';

const noMerges = new MergeIndex();
const rectangle = (top: number, bottom: number, left = 0, right = left) => ({
  top,
  bottom,
  left,
  right,
});
const merged = new MergeIndex([{ start: { row: 2, col: 0 }, end: { row: 8, col: 2 } }]);

describe('visible selection operations', () => {
  it('selects filtered fragments while skipping hidden endpoints and columns', () => {
    const rows = new RowMetrics(100, {}, [2, 90], [2, 10, 50, 90]);
    const columns = new ColumnMetrics(6, {}, {}, [0, 2, 5]);
    const result = visibleSelection(rows, columns, noMerges, rectangle(2, 90, 0, 5));
    expect(result.rows).toEqual([10, 50]);
    expect(result.columns).toEqual([1, 3, 4]);
    expect(result.cells).toEqual([
      [
        { row: 10, col: 1 },
        { row: 10, col: 3 },
        { row: 10, col: 4 },
      ],
      [
        { row: 50, col: 1 },
        { row: 50, col: 3 },
        { row: 50, col: 4 },
      ],
    ]);
  });

  it('returns only one original anchor when a partial selection intersects a projected merge', () => {
    const rows = new RowMetrics(20, {}, [], [0, 4, 6, 12]);
    const columns = new ColumnMetrics(5, {}, {}, [0]);
    const selected = visibleSelection(rows, columns, merged, rectangle(4, 6, 1, 3));
    expect(selected.cells).toEqual([
      [{ row: 2, col: 0 }, null, { row: 4, col: 3 }],
      [null, null, { row: 6, col: 3 }],
    ]);
    const anchor = visibleSelection(rows, columns, merged, rectangle(2, 2));
    expect(anchor.rows).toEqual([4, 6]);
    expect(anchor.columns).toEqual([1, 2]);
    expect(anchor.cells).toEqual([
      [{ row: 2, col: 0 }, null],
      [null, null],
    ]);
    // Null merge members still occupy copied matrix positions and count toward quota.
    expect(() => visibleSelection(rows, columns, merged, rectangle(2, 2), 3)).toThrow('3 个可见');
  });

  it('returns no cells when a selected merge or ordinary range is entirely absent', () => {
    const rows = new RowMetrics(20, {}, [], [0, 12]);
    const columns = new ColumnMetrics(5);
    expect(visibleSelection(rows, columns, merged, rectangle(2, 2))).toEqual({
      rows: [],
      columns: [],
      cells: [],
    });
    expect(visibleSelection(rows, columns, noMerges, rectangle(3, 8))).toEqual({
      rows: [],
      columns: [],
      cells: [],
    });
  });

  it('admits three visible rows from a million-row range without walking absent rows', () => {
    const rows = new RowMetrics(1_048_576, {}, [], [1, 500_000, 1_000_000]);
    const next = vi.spyOn(rows, 'nextVisible');
    expect(
      visibleSelection(rows, new ColumnMetrics(1), noMerges, rectangle(0, 1_048_575), 3).rows,
    ).toEqual([1, 500_000, 1_000_000]);
    expect(next.mock.calls.length).toBeLessThan(10);
  });

  it('stops at the visible-cell quota before constructing a large matrix', () => {
    const rows = new RowMetrics(1_048_576);
    const next = vi.spyOn(rows, 'nextVisible');
    expect(() =>
      visibleSelection(rows, new ColumnMetrics(3), noMerges, rectangle(0, 1_048_575, 0, 2), 5),
    ).toThrow('5 个可见单元格');
    expect(next.mock.calls.length).toBeLessThan(8);
    expect(() =>
      visibleSelection(rows, new ColumnMetrics(6), noMerges, rectangle(0, 0, 0, 5), 5),
    ).toThrow('5 个可见');
  });

  it('pastes across visible axes and plans nothing when available space is insufficient', () => {
    const rows = new RowMetrics(20, {}, [4], [0, 4, 8, 12]);
    const columns = new ColumnMetrics(6, {}, {}, [0, 2, 5]);
    expect(visiblePasteTarget(rows, columns, noMerges, { row: 4, col: 0 }, 2, 2).cells).toEqual([
      [
        { row: 8, col: 1 },
        { row: 8, col: 3 },
      ],
      [
        { row: 12, col: 1 },
        { row: 12, col: 3 },
      ],
    ]);
    const before = rows.total;
    expect(() => visiblePasteTarget(rows, columns, noMerges, { row: 8, col: 1 }, 3, 2)).toThrow(
      '不足',
    );
    expect(rows.total).toBe(before);
    expect(visiblePasteTarget(rows, columns, noMerges, { row: 8, col: 1 }, 2, 2).rows).toEqual([
      8, 12,
    ]);
    expect(() =>
      visiblePasteTarget(rows, columns, noMerges, { row: 0, col: 0 }, 1_000_000, 1),
    ).toThrow('最多支持');
  });

  it('permits a single-cell paste to a hidden merge anchor but rejects any multi-cell merge overlap', () => {
    const rows = new RowMetrics(20, {}, [], [0, 4, 6, 12]);
    const columns = new ColumnMetrics(5, {}, {}, [0]);
    expect(visiblePasteTarget(rows, columns, merged, { row: 2, col: 0 }, 1, 1)).toEqual({
      rows: [4],
      columns: [1],
      cells: [[{ row: 2, col: 0 }]],
    });
    expect(() => visiblePasteTarget(rows, columns, merged, { row: 2, col: 0 }, 1, 2)).toThrow(
      '合并',
    );
    expect(() => visiblePasteTarget(rows, columns, merged, { row: 0, col: 1 }, 2, 1)).toThrow(
      '合并',
    );
    expect(() =>
      visiblePasteTarget(
        new RowMetrics(20, {}, [], [0, 12]),
        columns,
        merged,
        { row: 2, col: 0 },
        1,
        1,
      ),
    ).toThrow('没有可见');
  });

  it('fills by visible ordinals and preserves real coordinates for formula offsets', () => {
    const rows = new RowMetrics(100, {}, [], [2, 10, 30, 90]);
    const columns = new ColumnMetrics(5, {}, {}, [1, 3]);
    expect(
      visibleFillPlan(rows, columns, noMerges, rectangle(2, 10, 0, 2), rectangle(2, 90, 0, 4)),
    ).toEqual([
      { row: 2, col: 4, sourceRow: 2, sourceCol: 0 },
      { row: 10, col: 4, sourceRow: 10, sourceCol: 0 },
      { row: 30, col: 0, sourceRow: 2, sourceCol: 0 },
      { row: 30, col: 2, sourceRow: 2, sourceCol: 2 },
      { row: 30, col: 4, sourceRow: 2, sourceCol: 0 },
      { row: 90, col: 0, sourceRow: 10, sourceCol: 0 },
      { row: 90, col: 2, sourceRow: 10, sourceCol: 2 },
      { row: 90, col: 4, sourceRow: 10, sourceCol: 0 },
    ]);
  });

  it('fills upward and left using the negative periodic phase of the visible source block', () => {
    const rows = new RowMetrics(100, {}, [], [2, 10, 30, 90]);
    const columns = new ColumnMetrics(5, {}, {}, [1, 3]);
    const plan = visibleFillPlan(
      rows,
      columns,
      noMerges,
      rectangle(30, 90, 2, 4),
      rectangle(2, 90, 0, 4),
    );
    expect(plan.find((cell) => cell.row === 10 && cell.col === 0)).toEqual({
      row: 10,
      col: 0,
      sourceRow: 90,
      sourceCol: 4,
    });
    expect(plan.find((cell) => cell.row === 2 && cell.col === 2)).toEqual({
      row: 2,
      col: 2,
      sourceRow: 30,
      sourceCol: 2,
    });
    expect(plan.some((cell) => cell.row >= 30 && cell.col >= 2)).toBe(false);
  });

  it('rejects empty sources, visible merges, quota overflow, and a target excluding the source', () => {
    const rows = new RowMetrics(20, {}, [], [0, 4, 6, 12]);
    const columns = new ColumnMetrics(5);
    expect(() =>
      visibleFillPlan(rows, columns, noMerges, rectangle(1, 3), rectangle(0, 12)),
    ).toThrow('没有可见');
    expect(() => visibleFillPlan(rows, columns, merged, rectangle(0, 0), rectangle(0, 12))).toThrow(
      '合并',
    );
    expect(() => visibleFillPlan(rows, columns, merged, rectangle(4, 6), rectangle(0, 12))).toThrow(
      '合并',
    );
    expect(() =>
      visibleFillPlan(rows, columns, noMerges, rectangle(0, 0), rectangle(0, 12), 3),
    ).toThrow('最多支持');
    expect(() =>
      visibleFillPlan(rows, columns, noMerges, rectangle(0, 4), rectangle(4, 12)),
    ).toThrow('必须包含');
    const removedMergeRows = new RowMetrics(20, {}, [], [0, 12]);
    expect(
      visibleFillPlan(removedMergeRows, columns, merged, rectangle(0, 0), rectangle(0, 12)),
    ).toEqual([{ row: 12, col: 0, sourceRow: 0, sourceCol: 0 }]);
  });
});

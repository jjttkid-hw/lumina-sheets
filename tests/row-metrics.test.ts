import { describe, expect, it } from 'vitest';
import { RowMetrics } from '../src/lib/canvas/row-metrics';

describe('sparse row geometry', () => {
  it('positions a million logical rows using only sparse adjustments', () => {
    const rows = new RowMetrics(1_048_576, { 3: 60, 900_000: 12 }, [4, 900_001]);
    expect(rows.count).toBe(1_048_576);
    expect(rows.row(900_000)).toBe(900_000);
    expect(rows.offset(3)).toBe(108);
    expect(rows.offset(4)).toBe(168);
    expect(rows.offset(5)).toBe(168);
    expect(rows.offset(500_000)).toBe(500_000 * 36 - 12);
    expect(rows.total).toBe(1_048_576 * 36 - 72);
    expect(rows.at(rows.offset(900_000))).toBe(900_000);
    expect(rows.at(rows.offset(900_001))).toBe(900_002);
    expect(rows.at(rows.total)).toBe(1_048_575);
  });

  it('uses variable heights and selects the next row at exact boundaries', () => {
    const rows = new RowMetrics(4, { 0: 20, 1: 50, 3: 10 });
    expect([0, 1, 2, 3, 4].map((index) => rows.offset(index))).toEqual([0, 20, 70, 106, 116]);
    expect([0, 19.9, 20, 69.9, 70, 106, 116].map((offset) => rows.at(offset))).toEqual([
      0, 0, 1, 1, 2, 3, 3,
    ]);
    expect(rows.at(-100)).toBe(0);
    expect(rows.at(Number.POSITIVE_INFINITY)).toBe(3);
    expect(rows.height(-1)).toBe(0);
    expect(rows.height(4)).toBe(0);
    expect(rows.row(4)).toBe(-1);
  });

  it('skips hidden runs and hidden endpoints in either direction', () => {
    const rows = new RowMetrics(10, { 5: 20 }, [9, 0, 3, 2, 1, 6, 7, 8, 3]);
    expect(rows.total).toBe(56);
    expect(rows.at(0)).toBe(4);
    expect(rows.at(35.99)).toBe(4);
    expect(rows.at(36)).toBe(5);
    expect(rows.at(56)).toBe(5);
    expect(rows.at(1000)).toBe(5);
    expect(rows.nextVisible(0)).toBe(4);
    expect(rows.nextVisible(4)).toBe(4);
    expect(rows.nextVisible(6)).toBe(-1);
    expect(rows.nextVisible(9, -1)).toBe(5);
    expect(rows.nextVisible(5, -1)).toBe(5);
    expect(rows.nextVisible(3, -1)).toBe(-1);
    expect(rows.nextVisible(-1)).toBe(4);
    expect(rows.nextVisible(10, -1)).toBe(5);
  });

  it('returns no row for empty or entirely hidden views', () => {
    for (const rows of [new RowMetrics(0), new RowMetrics(3, {}, [0, 1, 2])]) {
      expect(rows.total).toBe(0);
      expect(rows.at(-1)).toBe(-1);
      expect(rows.at(0)).toBe(-1);
      expect(rows.at(100)).toBe(-1);
      expect(rows.nextVisible(0)).toBe(-1);
      expect(rows.visible(0, 600, 0)).toEqual({ first: -1, last: -1 });
    }
  });

  it('maps filtered display order to original rows including hidden members', () => {
    const rows = new RowMetrics(1000, { 7: 60, 2: 10, 900: 24 }, [2], [7, 2, 900, 5]);
    expect(rows.count).toBe(4);
    expect([0, 1, 2, 3].map((index) => rows.row(index))).toEqual([7, 2, 900, 5]);
    expect([0, 1, 2, 3].map((index) => rows.height(index))).toEqual([60, 0, 24, 36]);
    expect(rows.total).toBe(120);
    expect(rows.offset(2)).toBe(60);
    expect(rows.at(60)).toBe(2);
    expect(rows.nextVisible(1)).toBe(2);
    expect(rows.nextVisible(1, -1)).toBe(0);
    expect(new RowMetrics(1000, {}, [], []).count).toBe(0);
  });

  it('culls the scrolling body below variable-height frozen rows', () => {
    const rows = new RowMetrics(100, { 0: 60, 3: 50 }, [1, 4]);
    // Header 34 + frozen pane 60 leaves exactly 86 px: row 2 (36) + row 3 (50).
    expect(rows.visible(0, 180, 2)).toEqual({ first: 2, last: 3 });
    expect(rows.visible(36, 180, 2)).toEqual({ first: 3, last: 5 });
    expect(rows.visible(0, 34, 2)).toEqual({ first: -1, last: -1 });
    expect(rows.visible(0, 94, 2)).toEqual({ first: -1, last: -1 });
    expect(rows.visible(0, 95, 2)).toEqual({ first: 2, last: 2 });
    expect(new RowMetrics(5, {}, [2, 3, 4]).visible(0, 600, 2)).toEqual({ first: -1, last: -1 });
    const large = new RowMetrics(1_048_576);
    const visible = large.visible(36 * 500_000, 800, 2);
    expect(visible.first).toBe(500_002);
    expect(visible.last - visible.first).toBeLessThan(30);
  });

  it('bounds frozen painting to viewport pixels even when a million rows are frozen', () => {
    const rows = new RowMetrics(1_048_576);
    expect(rows.visibleFrozen(800, 1_048_576)).toEqual({ first: 0, last: 21 });
    expect(rows.visibleFrozen(34, 1_048_576)).toEqual({ first: -1, last: -1 });
    const hidden = new RowMetrics(100, { 0: 600 }, [1, 2]);
    expect(hidden.visibleFrozen(600, 10)).toEqual({ first: 0, last: 0 });
    expect(new RowMetrics(3, {}, [0, 1, 2]).visibleFrozen(800, 3)).toEqual({ first: -1, last: -1 });
  });
});

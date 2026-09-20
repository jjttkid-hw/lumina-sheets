import { describe, expect, it } from 'vitest';
import {
  ColumnMetrics,
  MergeIndex,
  pixelSize,
  scrollAxis,
  visibleRowWindow,
} from '../src/lib/canvas/geometry';

describe('canvas geometry remains bounded for sparse sheets', () => {
  it('maps binary indexed columns and visible ranges', () => {
    const columns = new ColumnMetrics(16_384);
    expect(columns.total).toBeGreaterThan(1_000_000);
    expect(columns.at(0)).toBe(0);
    expect(columns.at(columns.total - 1)).toBe(16_383);
    const visible = columns.visible(30_000, 900);
    expect(visible.first).toBeLessThanOrEqual(visible.last);
  });
  it('caps browser physical scroll while preserving logical million rows', () => {
    const axis = scrollAxis(36 * 1_048_576, 800);
    expect(axis.physicalSize).toBe(8_000_000);
    expect(axis.toLogical(axis.physicalSize - 800)).toBe(axis.logicalMax);
  });
  it('keeps row culling proportional to viewport', () => {
    const rows = visibleRowWindow(1_048_576, 2, 36 * 500_000, 800);
    expect(rows.first).toBe(500_002);
    expect(rows.last - rows.first).toBeLessThan(30);
  });
  it('indexes merge rectangles without expanding giant ranges', () => {
    const merges = new MergeIndex([
      { start: { row: 100, col: 20 }, end: { row: 900_000, col: 12_000 } },
    ]);
    expect(merges.at(500_000, 500)).toEqual({ top: 100, bottom: 900_000, left: 20, right: 12_000 });
    expect(merges.at(1, 1)).toBeUndefined();
  });
  it('uses high DPI backing dimensions', () => {
    expect(pixelSize(900, 600, 2)).toEqual({ width: 1800, height: 1200, ratio: 2 });
  });
});

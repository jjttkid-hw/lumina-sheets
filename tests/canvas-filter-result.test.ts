import { describe, expect, it } from 'vitest';
import { currentFilteredRows } from '../src/lib/canvas/filter-result';
import type { FilterSource } from '../src/lib/canvas/filter-result';
import { RowMetrics } from '../src/lib/canvas/row-metrics';

const source = (): FilterSource => ({
  sheetId: 'orders',
  cells: {},
  text: 'open',
  frozenRows: 1,
  rowCount: 1000,
  calculationVersion: 0,
  evaluator: () => '',
});

describe('filtered row result lifecycle', () => {
  it('never applies the previous sheet indices while a smaller sheet scan is pending', () => {
    const first = source();
    const result = { source: first, rows: [0, 900] };
    const next = { ...first, sheetId: 'summary', rowCount: 5 };
    const rows = currentFilteredRows(result, next);
    expect(rows).toBeNull();
    const geometry = new RowMetrics(next.rowCount, {}, [], rows);
    expect(geometry.count).toBe(5);
    expect(geometry.row(geometry.count - 1)).toBe(4);
    expect(currentFilteredRows({ source: next, rows: [0, 2] }, next)).toEqual([0, 2]);
  });

  it('invalidates stale same-sheet results for every meaning-changing scan input', () => {
    const original = source();
    const result = { source: original, rows: [0, 900] };
    const updates: Partial<FilterSource>[] = [
      { sheetId: 'other' },
      { cells: {} },
      { text: 'closed' },
      { frozenRows: 0 },
      { rowCount: 20 },
      { calculationVersion: 1 },
      { evaluator: () => 'changed' },
    ];
    for (const update of updates)
      expect(currentFilteredRows(result, { ...original, ...update })).toBeNull();
    expect(currentFilteredRows(result, { ...original })).toBe(result.rows);
  });

  it('rejects a late scan completion after a query change and distinguishes empty from pending', () => {
    const oldQuery = source();
    const newQuery = { ...oldQuery, text: 'closed' };
    const lateResult = { source: oldQuery, rows: [0, 900] };
    expect(currentFilteredRows(lateResult, newQuery)).toBeNull();
    expect(currentFilteredRows({ source: newQuery, rows: [] }, newQuery)).toEqual([]);
    expect(currentFilteredRows(lateResult, { ...oldQuery, text: '' })).toBeNull();
  });
});

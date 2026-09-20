import { describe, it, expect } from 'vitest';
import { generateReport, conditionalStyle, type ReportColumn } from '../src/lib/report';
import { createEvaluator } from '../src/lib/engine';
const columns: ReportColumn[] = [
  { field: 'group', title: '产品' },
  { field: 'sales', title: '收入', aggregate: 'sum' },
  { field: 'cost', title: '成本' },
  { field: 'profit', title: '利润', formula: '=B{row}-C{row}', aggregate: 'sum' },
];
const records = [
  { group: 'A', month: '1月', sales: 10, cost: 3 },
  { group: 'B', month: '1月', sales: 20, cost: 7 },
  { group: 'A', month: '2月', sales: 30, cost: 11 },
];
describe('JavaScript report generation', () => {
  it('binds rows and generates formulas plus totals', () => {
    const b = generateReport({ name: '经营', layout: 'list', columns }, records),
      s = b.sheets[0],
      v = createEvaluator(b);
    expect(s.cells.D2.value).toBe('=B2-C2');
    expect(v(s, 'D5')).toBe(39);
    expect(v(s, 'B5')).toBe(60);
  });
  it('groups records without counting subtotals twice', () => {
    const b = generateReport({ name: '分组', layout: 'group', columns, groupBy: 'group' }, records),
      s = b.sheets[0],
      v = createEvaluator(b);
    expect(s.merges).toHaveLength(2);
    expect(v(s, 'D5')).toBe(26);
    expect(v(s, 'D8')).toBe(13);
  });
  it('creates cross-tab row/column/grand totals', () => {
    const b = generateReport(
        {
          name: '交叉',
          layout: 'cross',
          columns,
          cross: { rows: 'group', columns: 'month', value: 'sales' },
        },
        records,
      ),
      s = b.sheets[0];
    expect(s.cells.D4.value).toBe(60);
    expect(s.cells.B4.value).toBe(30);
    expect(s.cells.C4.value).toBe(30);
  });
  it('evaluates typed conditional rules only within range', () => {
    const rule = {
      range: { start: { row: 1, col: 2 }, end: { row: 5, col: 2 } },
      operator: 'lessThan' as const,
      value: 0,
      style: { color: '#ff0000' },
    };
    expect(conditionalStyle([rule], 2, 2, -1)).toEqual({ color: '#ff0000' });
    expect(conditionalStyle([rule], 0, 2, -1)).toEqual({});
    expect(conditionalStyle([rule], 2, 2, '')).toEqual({});
  });
});

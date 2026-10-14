import { describe, it, expect } from 'vitest';
import {
  generateReport,
  conditionalScaleStyle,
  conditionalStyle,
  type ReportColumn,
} from '../src/lib/report';
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
  it('supports inclusive, inverse and text conditional operators', () => {
    const style = { background: '#ff0000' };
    expect(
      conditionalStyle(
        [
          {
            range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
            operator: 'greaterThanOrEqual',
            value: 5,
            style,
          },
        ],
        0,
        0,
        5,
      ),
    ).toEqual(style);
    expect(
      conditionalStyle(
        [
          {
            range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
            operator: 'lessThanOrEqual',
            value: 5,
            style,
          },
        ],
        0,
        0,
        5,
      ),
    ).toEqual(style);
    expect(
      conditionalStyle(
        [
          {
            range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
            operator: 'notEqual',
            value: 5,
            style,
          },
        ],
        0,
        0,
        4,
      ),
    ).toEqual(style);
    expect(
      conditionalStyle(
        [
          {
            range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
            operator: 'notContains',
            value: 'error',
            style,
          },
        ],
        0,
        0,
        'ready',
      ),
    ).toEqual(style);
  });
  it('calculates bounded two-color conditional scales without affecting text', () => {
    const rules = [
      {
        range: { start: { row: 0, col: 0 }, end: { row: 2, col: 0 } },
        minColor: '#fff7ed',
        maxColor: '#c2410c',
        min: 0,
        max: 100,
      },
    ];
    expect(conditionalScaleStyle(rules, 0, 0, 'x')).toEqual({});
    expect(conditionalScaleStyle(rules, 0, 0, 0).background).toBe('#fff7ed');
    expect(conditionalScaleStyle(rules, 1, 0, 50).background).toBe('#e19c7d');
    expect(conditionalScaleStyle(rules, 2, 0, 100).background).toBe('#c2410c');
    expect(conditionalScaleStyle(rules, 4, 0, 50)).toEqual({});
  });
  it('normalizes finite extreme bounds without overflow', () => {
    const rules = [
      {
        range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
        minColor: '#000000',
        maxColor: '#ffffff',
        min: -Number.MAX_VALUE,
        max: Number.MAX_VALUE,
      },
    ];
    expect(conditionalScaleStyle(rules, 0, 0, 0).background).toBe('#808080');
    expect(conditionalScaleStyle(rules, 0, 0, Number.MAX_VALUE).background).toBe('#ffffff');
  });
});

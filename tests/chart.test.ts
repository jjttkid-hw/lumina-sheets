import { describe, expect, it } from 'vitest';
import { createChartModel, createPivotChartModel } from '../src/lib/chart';
import { createPivot } from '../src/lib/pivot';

describe('bounded chart models', () => {
  it('aggregates records deterministically without evaluating formula-like labels', () => {
    const model = createChartModel(
      {
        type: 'line',
        category: 'month',
        sort: 'label',
        series: [
          { field: 'revenue', title: '营收', aggregate: 'sum' },
          { field: 'orders', title: '订单', aggregate: 'count' },
        ],
      },
      [
        { month: '10月', revenue: 20, orders: 'x' },
        { month: '@SUM(1,2)', revenue: 5 },
        { month: '2月', revenue: 10, orders: 'y' },
        { month: '10月', revenue: 2, orders: '' },
      ],
    );
    expect(model.categories).toEqual(['10月', '2月', '@SUM(1,2)']);
    expect(model.series[0].values).toEqual([22, 10, 5]);
    expect(model.series[1].values).toEqual([1, 1, null]);
    expect(model.domain).toEqual({ min: 0, max: 22 });
  });

  it('rejects unsafe chart combinations and nonnumeric measures atomically', () => {
    expect(() =>
      createChartModel(
        { type: 'pie', category: 'name', series: [{ field: 'a' }, { field: 'b' }] },
        [{ name: 'x', a: 1, b: 2 }],
      ),
    ).toThrow('饼图只能包含一个');
    expect(() =>
      createChartModel({ type: 'bar', category: 'name', series: [{ field: 'a' }] }, [
        { name: 'x', a: '=A1' },
      ]),
    ).toThrow('仅接受有限数字');
    expect(() =>
      createChartModel({ type: 'pie', category: 'name', series: [{ field: 'a' }] }, [
        { name: 'x', a: -1 },
      ]),
    ).toThrow('不能包含负数');
  });

  it('maps pivot totals into the same model contract', () => {
    const pivot = createPivot(
      { rows: ['region'], columns: 'year', values: [{ field: 'amount', aggregate: 'sum' }] },
      [
        { region: '华东', year: 2025, amount: 10 },
        { region: '华东', year: 2026, amount: 20 },
      ],
    );
    const model = createPivotChartModel(pivot, { type: 'bar' });
    expect(model.source).toBe('pivot');
    expect(model.categories).toEqual(['华东']);
    expect(model.series).toHaveLength(1);
    expect(model.series[0].values).toEqual([30]);
  });
});

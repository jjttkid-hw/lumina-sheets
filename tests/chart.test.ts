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

describe('chart boundary integrity', () => {
  const definition = { type: 'bar' as const, category: 'r', series: [{ field: 'v' }] };
  it('keeps typed and blank categories separate even with identical display labels', () => {
    const model = createChartModel(definition, [
      { r: 1, v: 2 },
      { r: '1', v: 3 },
      { r: null, v: 4 },
      { r: '未分类', v: 5 },
    ]);
    expect(model.categories).toEqual(['1', '1', '未分类', '未分类']);
    expect(model.series[0].values).toEqual([2, 3, 4, 5]);
  });
  it('retains min/max aggregation and missing versus zero values', () => {
    const model = createChartModel({ ...definition, series: [{ field: 'v', aggregate: 'min' }] }, [
      { r: 'a', v: 0 },
      { r: 'a', v: 5 },
      { r: 'b', v: null },
    ]);
    expect(model.series[0].values).toEqual([0, null]);
    const pivot = createPivot({ rows: ['r'], values: [{ field: 'v', aggregate: 'max' }] }, [
      { r: 'a', v: 1 },
      { r: 'a', v: 5 },
    ]);
    expect(createPivotChartModel(pivot, { type: 'bar' }).series[0]).toMatchObject({
      aggregate: 'max',
      values: [5],
    });
  });
  it('rejects malformed sparse inputs, non-finite values and expanded text', () => {
    expect(() => createChartModel(definition, new Array(1))).toThrow();
    expect(() => createChartModel({ ...definition, series: new Array(1) }, [])).toThrow();
    expect(() => createChartModel(definition, [{ r: 'a', v: Infinity }])).toThrow();
    expect(() =>
      createChartModel(definition, [
        { r: 'a', v: Number.MAX_VALUE },
        { r: 'a', v: Number.MAX_VALUE },
      ]),
    ).toThrow('溢出');
    expect(() =>
      createChartModel({ ...definition, maxCategories: 1 }, [
        { r: 'a', v: 1 },
        { r: 'b', v: 2 },
      ]),
    ).toThrow('分类数量');
    const pivot = createPivot({ rows: ['r'], values: [{ field: 'v' }] }, [{ r: 'a', v: 1 }]);
    pivot.rows[0].cells[0] = NaN;
    expect(() => createPivotChartModel(pivot, { type: 'bar' })).toThrow('有限数字');
    expect(() =>
      createPivotChartModel(pivot, { type: 'bar', series: '0' as unknown as number[] }),
    ).toThrow('数组');
  });
  it('rejects a default multi-series pie and isolates pivot outputs', () => {
    const pivot = createPivot({ rows: ['r'], values: [{ field: 'v' }, { field: 'n' }] }, [
      { r: 'a', v: 1, n: 2 },
    ]);
    expect(() => createPivotChartModel(pivot, { type: 'pie' })).toThrow('一个数据系列');
    const model = createPivotChartModel(pivot, { type: 'pie', series: [0] });
    model.series[0].values[0] = 999;
    expect(pivot.rows[0].cells[0]).toBe(1);
  });
});

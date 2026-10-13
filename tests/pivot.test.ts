import { describe, expect, it } from 'vitest';
import {
  createPivot,
  createPivotAsync,
  generatePivotReport,
  PIVOT_LIMITS,
  type PivotDefinition,
} from '../src/lib/pivot';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
const definition: PivotDefinition = {
  rows: ['region', 'team'],
  columns: 'month',
  values: [
    { field: 'amount', title: '收入', aggregate: 'sum' },
    { field: 'amount', title: '均值', aggregate: 'average' },
    { field: 'amount', title: '记录数', aggregate: 'count' },
    { field: 'amount', title: '最小', aggregate: 'min' },
    { field: 'amount', title: '最大', aggregate: 'max' },
  ],
};
const records = [
  { region: '华东', team: 'A', month: '1月', amount: 10 },
  { region: '华东', team: 'A', month: '1月', amount: 30 },
  { region: '华东', team: 'A', month: '2月', amount: 80 },
  { region: '华南', team: 'B', month: '1月', amount: -20 },
  { region: '华南', team: 'B', month: '2月', amount: null },
];
describe('bounded multi-measure pivot', () => {
  it('runs cooperatively with progress and cancellation', async () => {
    const progress: number[] = [];
    const result = await createPivotAsync(
      { rows: ['region'], values: [{ field: 'amount' }] },
      records,
      { batchSize: 2, onProgress: ({ completed }) => progress.push(completed) },
    );
    expect(result.grandTotals).toEqual([100]);
    expect(progress).toEqual([0, 2, 4, 5]);
    const controller = new AbortController();
    const pending = createPivotAsync(
      { rows: ['region'], values: [{ field: 'amount' }] },
      Array.from({ length: 5_000 }, (_, i) => ({ region: 'r', amount: i })),
      { batchSize: 1, signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('aggregates categories, row totals and weighted grand averages from records', () => {
    const result = createPivot(definition, records);
    expect(result.rows[0]).toEqual({
      keys: ['华东', 'A'],
      cells: [40, 20, 2, 10, 30, 80, 80, 1, 80, 80, 120, 40, 3, 10, 80],
    });
    expect(result.rows[1].cells).toEqual([
      -20, -20, 1, -20, -20, 0, 0, 1, 0, 0, -20, -20, 2, -20, -20,
    ]);
    expect(result.grandTotals).toEqual([
      20,
      20 / 3,
      3,
      -20,
      30,
      80,
      80,
      2,
      80,
      80,
      100,
      25,
      5,
      -20,
      80,
    ]);
    expect(result.columns).toHaveLength(15);
    expect(new Set(result.columns.map((item) => item.key)).size).toBe(15);
  });
  it('keeps typed dimensions, missing values and reserved strings distinct', () => {
    const result = createPivot(
      { rows: ['group'], columns: 'category', values: [{ field: 'n', aggregate: 'count' }] },
      [
        { group: 1, category: '__total__' },
        { group: '1', category: '__total__' },
        { group: null, category: null },
        { group: '未分类', category: '未分类' },
      ],
    );
    expect(result.rows).toHaveLength(4);
    expect(result.columns).toHaveLength(4);
    expect(result.columns[0]).toMatchObject({ category: '__total__' });
    expect(result.columns[0].total).toBeUndefined();
    expect(result.columns[3].total).toBe(true);
    expect(result.grandTotals).toEqual([2, 1, 1, 4]);
  });
  it('uses tuple label sorting without delimiter collisions and never mutates inputs', () => {
    const input = [
      { a: 'b', b: 'x', n: 2 },
      { a: 'a', b: 'z', n: 3 },
      { a: 'a', b: 'y', n: 4 },
    ];
    const before = structuredClone(input);
    const result = createPivot(
      { rows: ['a', 'b'], values: [{ field: 'n' }], sort: 'label' },
      input,
    );
    expect(result.rows.map((row) => row.keys)).toEqual([
      ['a', 'y'],
      ['a', 'z'],
      ['b', 'x'],
    ]);
    expect(result.grandTotals).toEqual([9]);
    expect(input).toEqual(before);
    result.rows[0].keys[0] = 'changed';
    expect(createPivot({ rows: ['a'], values: [{ field: 'n' }] }, input).rows[0].keys).toEqual([
      'b',
    ]);
  });
  it('treats count as record count, ignores blanks for numeric measures, and reads own fields', () => {
    const inherited = Object.create({ group: 'inherited', n: 200 });
    expect(
      createPivot(
        { rows: ['group'], values: [{ field: 'n' }, { field: 'n', aggregate: 'count' }] },
        [inherited],
      ).rows[0],
    ).toEqual({ keys: ['未分类'], cells: [0, 1] });
    expect(
      createPivot({ rows: ['a'], values: [{ field: 'n', aggregate: 'count' }] }, [
        { a: false, n: '=1/0' },
      ]).grandTotals,
    ).toEqual([1]);
    for (const value of ['12', true, Infinity, NaN, '=1+1', ' '])
      expect(() =>
        createPivot({ rows: ['a'], values: [{ field: 'n' }] }, [{ a: 'ok', n: value }]),
      ).toThrow('有限数字');
  });
  it('rejects sum overflow and oversized Cartesian output before allocating output rows', () => {
    expect(() =>
      createPivot({ rows: ['a'], values: [{ field: 'n' }] }, [
        { n: Number.MAX_VALUE },
        { n: Number.MAX_VALUE },
      ]),
    ).toThrow('溢出');
    const many = Array.from({ length: 400 }, (_, i) => ({ a: i, c: i % 256, n: 1 }));
    expect(() =>
      createPivot({ rows: ['a'], columns: 'c', values: [{ field: 'n' }] }, many),
    ).toThrow('100,000 格');
    expect(() =>
      createPivot({ rows: ['a'], values: [{ field: 'n' }], maxGroups: 1 }, many.slice(0, 2)),
    ).toThrow('分组数量');
    expect(() =>
      createPivot(
        { rows: ['a'], columns: 'c', values: [{ field: 'n' }], maxColumns: 1 },
        many.slice(0, 2),
      ),
    ).toThrow('分类数量');
    expect(() =>
      createPivot({ rows: ['a'], values: [{ field: 'n' }] }, Array(PIVOT_LIMITS.records + 1)),
    ).toThrow('记录数');
  });
  it('validates configuration and returns a finite empty table', () => {
    for (const change of [
      { rows: [] },
      { rows: ['a', 'a'] },
      { rows: [''] },
      { columns: '' },
      { values: [] },
      { values: [{ field: 'n', title: 2 }] },
      { values: [{ field: 'n', aggregate: 'median' }] },
      { maxGroups: 0 },
      { sort: 'other' },
    ])
      expect(() => createPivot({ ...definition, ...change } as never, [])).toThrow();
    const empty = createPivot(definition, []);
    expect(empty.rows).toEqual([]);
    expect(empty.grandTotals).toEqual([0, 0, 0, 0, 0]);
    expect(empty.columns).toHaveLength(5);
  });
  it('rejects unbounded text, objects and formula-like labels in workbook output', () => {
    expect(() =>
      createPivot({ rows: ['a'], values: [{ field: 'n' }] }, [{ a: {} } as never]),
    ).toThrow('透视维度');
    expect(() =>
      createPivot({ rows: ['a'], values: [{ field: 'n' }] }, [{ a: 'x'.repeat(32768) }]),
    ).toThrow('32,767');
    const text = Array.from({ length: 250 }, () => ({ a: 'x'.repeat(32767) }));
    expect(() => createPivot({ rows: ['a'], values: [{ field: 'n' }] }, text)).toThrow('扫描上限');
    expect(() =>
      generatePivotReport({ rows: ['a'], values: [{ field: 'n' }] }, [{ a: '=1+1', n: 1 }]),
    ).toThrow('解释为公式');
  });
  it('exports ordinary cells with correct totals and types through XLSX', async () => {
    const book = generatePivotReport({ ...definition, name: '经营分析' }, records);
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    const sheet = restored.sheets[0];
    expect(sheet.cells.A2.value).toBe('华东');
    expect(sheet.cells.C2.value).toBe(40);
    expect(sheet.cells.N4.value).toBe(25);
    expect(sheet.cells.C4.value).toBe(20);
    expect(book.sheets[0].cells.A1.style?.bold).toBe(true);
  });
});

it('rejects sparse configuration arrays instead of creating missing measures', () => {
  expect(() => createPivot({ rows: Array(1), values: [{ field: 'n' }] }, [])).toThrow();
  expect(() => createPivot({ rows: ['r'], values: Array(1) }, [])).toThrow();
});
it('bounds repeated category header text before allocating the output', () => {
  const records = Array.from({ length: 32 }, (_, i) => ({
    r: 'r',
    c: 'x'.repeat(32760) + i,
    n: 1,
  }));
  expect(() =>
    createPivot(
      {
        rows: ['r'],
        columns: 'c',
        values: Array.from({ length: 8 }, (_, i) => ({ field: 'n', title: 'indicator' + i })),
      },
      records,
    ),
  ).toThrow('输出文字');
});

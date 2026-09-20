import { describe, expect, it } from 'vitest';
import { createEvaluator, MAX_ROWS } from '../src/lib/engine';
import { generateReport, type ReportColumn, type ReportDefinition } from '../src/lib/report';
import type { Sheet } from '../src/lib/types';

const columns: ReportColumn[] = [
  { field: 'region', title: '区域' },
  { field: 'team', title: '团队', aggregate: 'count' },
  { field: 'amount', title: '金额', aggregate: 'sum' },
  { field: 'amount', title: '均值', aggregate: 'average' },
];
const records = [
  { region: '华东', team: '一组', amount: 10 },
  { region: '华东', team: '一组', amount: 15 },
  { region: '华东', team: '二组', amount: 7 },
  { region: '华南', team: '三组', amount: 12 },
];
function rowWithLabel(sheet: Sheet, label: string): string {
  const entry = Object.entries(sheet.cells).find(
    ([key, cell]) => /^A\d+$/.test(key) && cell.value === label,
  );
  if (!entry) throw new Error(`Missing label: ${label}`);
  return entry[0].slice(1);
}

describe('advanced report layouts', () => {
  it('renders nested merges and aggregates uneven child groups from detail values', () => {
    const book = generateReport(
      { name: '多级分组', layout: 'group', columns, groupBy: ['region', 'team'] },
      records,
    );
    const sheet = book.sheets[0];
    const value = createEvaluator(book);
    expect(sheet.merges).toHaveLength(5);
    expect(sheet.merges?.[0]).toEqual({ start: { row: 1, col: 0 }, end: { row: 1, col: 3 } });
    expect(sheet.cells.A2.value).toBe('华东 · 3 条记录');
    expect(sheet.cells.A3.value).toBe('一组 · 2 条记录');
    const firstTeam = rowWithLabel(sheet, '一组小计');
    const east = rowWithLabel(sheet, '华东小计');
    const south = rowWithLabel(sheet, '华南小计');
    expect(value(sheet, `C${firstTeam}`)).toBe(25);
    expect(value(sheet, `C${east}`)).toBe(32);
    expect(value(sheet, `B${east}`)).toBe(3);
    expect(value(sheet, `D${east}`)).toBeCloseTo(32 / 3);
    expect(value(sheet, `C${south}`)).toBe(12);
    expect(sheet.cells[`D${east}`].value).toBe('=AVERAGE(D4:D5,D8)');
    // Editing a detail recalculates parent average; child subtotal edits are excluded.
    sheet.cells.D4.value = 40;
    sheet.cells[`D${firstTeam}`].value = 999;
    expect(value(sheet, `D${east}`)).toBeCloseTo(62 / 3);
  });

  it.each(['list', 'group'] as const)(
    'excludes repeated headers from %s count/average/sum totals',
    (layout) => {
      const book = generateReport(
        {
          name: '重复表头明细',
          layout,
          columns,
          ...(layout === 'group' ? { groupBy: 'region' } : {}),
          pagination: { rowsPerPage: 1 },
        },
        records,
      );
      const sheet = book.sheets[0];
      const value = createEvaluator(book);
      const label = layout === 'list' ? '合计' : '华东小计';
      const total = rowWithLabel(sheet, label);
      expect(value(sheet, `B${total}`)).toBe(layout === 'list' ? 4 : 3);
      expect(value(sheet, `C${total}`)).toBe(layout === 'list' ? 44 : 32);
      expect(value(sheet, `D${total}`)).toBeCloseTo(layout === 'list' ? 11 : 32 / 3);
      const headings = Object.values(sheet.cells).filter((cell) => cell.value === '区域');
      expect(headings).toHaveLength(4);
      expect(headings.every((cell) => cell.style?.bold)).toBe(true);
    },
  );

  it('preserves template formulas at their actual rows after inserting repeated headers', () => {
    const book = generateReport(
      {
        name: '公式',
        layout: 'list',
        columns: [
          ...columns,
          { field: 'double', title: '双倍', formula: '=C{row}*2', aggregate: 'sum' },
        ],
        pagination: { rowsPerPage: 2 },
      },
      records,
    );
    const sheet = book.sheets[0];
    expect(sheet.cells.E5.value).toBe('=C5*2');
    expect(createEvaluator(book)(sheet, 'E7')).toBe(88);
  });

  it('can suppress repeated header rows explicitly', () => {
    const book = generateReport(
      {
        name: '无重复行',
        layout: 'list',
        columns,
        pagination: { rowsPerPage: 1, repeatHeader: false },
      },
      records,
    );
    expect(book.sheets[0].rowCount).toBe(6);
    expect(createEvaluator(book)(book.sheets[0], 'B6')).toBe(4);
  });

  it('compresses thousands of detail references into contiguous ranges', () => {
    const data = Array.from({ length: 6000 }, (_, index) => ({
      region: '全体',
      team: index < 4500 ? '大组' : '小组',
      amount: index < 4500 ? 2 : 10,
    }));
    const book = generateReport(
      { name: '大分组', layout: 'group', columns, groupBy: ['region', 'team'] },
      data,
    );
    const sheet = book.sheets[0];
    const total = rowWithLabel(sheet, '全体小计');
    const value = createEvaluator(book);
    expect(String(sheet.cells[`C${total}`].value).length).toBeLessThan(100);
    expect(value(sheet, `B${total}`)).toBe(6000);
    expect(value(sheet, `C${total}`)).toBe(24000);
    expect(value(sheet, `D${total}`)).toBe(4);
  });

  it('rejects fragmented subtotal formulas exceeding the evaluator length limit', () => {
    const data = Array.from({ length: 1800 }, (_, index) => ({
      region: '全体',
      team: `团队${index}`,
      amount: 1,
    }));
    expect(() =>
      generateReport(
        { name: '过多碎片', layout: 'group', columns, groupBy: ['region', 'team'] },
        data,
      ),
    ).toThrow('汇总公式超过 8192');
  });

  it('deduplicates grouping fields while preserving their order', () => {
    const book = generateReport(
      { name: '去重', layout: 'group', columns, groupBy: ['region', 'region', 'team'] },
      records,
    );
    expect(book.sheets[0].merges).toHaveLength(5);
    expect(book.sheets[0].rowCount).toBe(15);
  });

  it.each([undefined, [], [''], ['region', '  '], ['region', 2]])(
    'rejects invalid grouping fields %j',
    (groupBy) => {
      expect(() =>
        generateReport(
          { name: '错误分组', layout: 'group', columns, groupBy } as ReportDefinition,
          records,
        ),
      ).toThrow('有效的分组字段');
    },
  );

  it('bounds grouping depth before rendering', () => {
    expect(() =>
      generateReport(
        {
          name: '过深分组',
          layout: 'group',
          columns,
          groupBy: Array.from({ length: 9 }, (_, i) => `level${i}`),
        },
        records,
      ),
    ).toThrow('最多为 8 级');
  });

  it.each([0, -1, 0.5, Infinity, NaN, MAX_ROWS + 1])(
    'rejects invalid pagination size %s',
    (rowsPerPage) => {
      expect(() =>
        generateReport(
          { name: '错误分页', layout: 'list', columns, pagination: { rowsPerPage } },
          records,
        ),
      ).toThrow('分页行数必须');
    },
  );

  it('rejects invalid header setting, cross pagination, and unsupported layouts', () => {
    expect(() =>
      generateReport(
        {
          name: '错误表头',
          layout: 'list',
          columns,
          pagination: { rowsPerPage: 2, repeatHeader: 'yes' },
        } as unknown as ReportDefinition,
        records,
      ),
    ).toThrow('布尔值');
    expect(() =>
      generateReport(
        {
          name: '交叉分页',
          layout: 'cross',
          columns,
          cross: { rows: 'region', columns: 'team', value: 'amount' },
          pagination: { rowsPerPage: 2 },
        },
        records,
      ),
    ).toThrow('交叉报表不支持');
    expect(() =>
      generateReport(
        { name: '未知布局', layout: 'other', columns } as unknown as ReportDefinition,
        records,
      ),
    ).toThrow('不支持的报表布局');
  });

  it('rejects oversized detail template formulas before returning a workbook', () => {
    expect(() =>
      generateReport(
        {
          name: '超长公式',
          layout: 'list',
          columns: [{ field: 'x', title: 'x', formula: `=${'1+'.repeat(4096)}1` }],
        },
        [{}],
      ),
    ).toThrow('公式超过 8192');
  });
});

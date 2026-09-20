import { describe, expect, it } from 'vitest';
import { groupAnalytics, readWorkbookAnalytics, summaryCsv } from '../src/components/Analytics';
import { parseCsv } from '../src/lib/io';
import { createBlankWorkbook, createDemoWorkbook, createTemplateWorkbook } from '../src/lib/seed';

describe('workbook financial analytics', () => {
  it('aggregates evaluated values from the seeded workbook and updates after edits', () => {
    const workbook = createDemoWorkbook();
    const initial = readWorkbookAnalytics(workbook);
    expect(initial.rows).toHaveLength(12);
    expect(initial.rows.reduce((sum, row) => sum + row.revenue, 0)).toBe(3451000);
    expect(initial.rows.reduce((sum, row) => sum + (row.cost ?? 0), 0)).toBe(1935000);
    expect(initial.rows.reduce((sum, row) => sum + (row.profit ?? 0), 0)).toBe(1516000);
    expect(
      groupAnalytics(initial.rows, 'period').find((group) => group.name === '6月')?.revenue,
    ).toBe(780000);
    workbook.sheets[0].cells.D2.value = 200000;
    const updated = readWorkbookAnalytics(workbook);
    expect(updated.rows[0].profit).toBe(92000);
    expect(updated.rows.reduce((sum, row) => sum + row.revenue, 0)).toBe(3465000);
  });

  it('excludes a subtotal and whitespace cells instead of double counting or inventing zeros', () => {
    const workbook = createDemoWorkbook();
    const sheet = workbook.sheets[0];
    sheet.cells.A14 = { value: '合计' };
    sheet.cells.D14 = { value: '=SUM(D2:D13)' };
    sheet.cells.D15 = { value: '   ' };
    expect(readWorkbookAnalytics(workbook).rows).toHaveLength(12);
  });

  it('keeps missing cost distinct from a measured zero', () => {
    const workbook = createDemoWorkbook();
    delete workbook.sheets[0].cells.E2;
    const analysis = readWorkbookAnalytics(workbook);
    expect(analysis.rows[0].cost).toBeNull();
    expect(analysis.hasCost).toBe(false);
  });

  it('provides numeric analysis for a nonfinancial template and an empty state for a blank workbook', () => {
    const budget = readWorkbookAnalytics(createTemplateWorkbook('budget'));
    expect(budget.financial).toBe(false);
    expect(budget.revenueLabel).toBe('年度预算');
    expect(budget.rows).toHaveLength(5);
    expect(budget.rows.reduce((sum, row) => sum + row.revenue, 0)).toBe(3680000);
    expect(readWorkbookAnalytics(createBlankWorkbook()).rows).toHaveLength(0);
  });

  it('sorts periods naturally and preserves negative data', () => {
    const workbook = createBlankWorkbook();
    workbook.sheets[0].cells = {
      A1: { value: '月份' },
      B1: { value: '营收' },
      A2: { value: '10月' },
      B2: { value: -25 },
      A3: { value: '2月' },
      B3: { value: 100 },
    };
    const analysis = readWorkbookAnalytics(workbook);
    expect(analysis.periods).toEqual(['2月', '10月']);
    expect(groupAnalytics(analysis.rows, 'period').map((row) => row.revenue)).toEqual([100, -25]);
  });

  it('keeps prototype-shaped categories separate and neutralizes exported formula-like labels', () => {
    const workbook = createBlankWorkbook();
    workbook.sheets[0].cells = {
      A1: { value: '月份' },
      B1: { value: '产品线' },
      C1: { value: '营收' },
      A2: { value: '@SUM(1,2)' },
      B2: { value: '__proto__' },
      C2: { value: 50 },
      A3: { value: '2月' },
      B3: { value: 'constructor' },
      C3: { value: -20 },
    };
    const analysis = readWorkbookAnalytics(workbook);
    expect(groupAnalytics(analysis.rows, 'product').map((row) => row.name)).toEqual([
      '__proto__',
      'constructor',
    ]);
    const csv = parseCsv(summaryCsv(groupAnalytics(analysis.rows, 'period'), analysis));
    expect(csv.some((row) => row[0] === "'@SUM(1,2)")).toBe(true);
    expect(csv.some((row) => row[1] === '-20')).toBe(true);
  });
});

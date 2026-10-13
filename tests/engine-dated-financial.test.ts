import { describe, expect, it } from 'vitest';
import { createEvaluator, evaluateCell } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { calculateSync } from '../src/lib/calculation';

function fixture(
  values = [-10000, 2750, 4250, 3250, 2750],
  dates: (string | number)[] = [
    '2008-01-01',
    '2008-03-01',
    '2008-10-30',
    '2009-02-15',
    '2009-04-01',
  ],
) {
  const book = createBlankWorkbook();
  const sheet = book.sheets[0];
  sheet.name = 'Cash';
  sheet.cells = {};
  values.forEach((value, i) => (sheet.cells[`A${i + 1}`] = { value }));
  dates.forEach((value, i) => (sheet.cells[`B${i + 1}`] = { value }));
  sheet.cells.C1 = { value: `=XNPV(0.09,A1:A${values.length},B1:B${dates.length})` };
  sheet.cells.C2 = { value: `=XIRR(A1:A${values.length},B1:B${dates.length})` };
  return { book, sheet, read: (key: string) => evaluateCell(sheet, key, book) };
}
describe('dated financial functions', () => {
  it('matches the published Microsoft irregular cash-flow example', () => {
    const { read } = fixture();
    expect(read('C1')).toBeCloseTo(2086.64760203154, 7);
    expect(read('C2')).toBeCloseTo(0.373362533518831, 9);
  });
  it.each([-0.75, -0.1, 0, 0.1, 4, 999])('solves a two-payment annual schedule at %s', (rate) => {
    const { sheet, read } = fixture([-100, 100 * (1 + rate)], [45000, 45365]);
    expect(read('C2')).toBeCloseTo(rate, 7);
    sheet.cells.C1.value = `=XNPV(${rate},A1:A2,B1:B2)`;
    expect(read('C1')).toBeCloseTo(0, 9);
  });
  it('keeps small cash flows significant and avoids false roots at far future dates', () => {
    expect(fixture([-1e-200, 2e-200], [45000, 45365]).read('C2')).toBeCloseTo(1, 9);
    expect(fixture([-1e300, 2e300], [45000, 45365]).read('C2')).toBeCloseTo(1, 9);
    // Independent analytic root: (3/2)^(365/20000)-1.
    expect(fixture([-2, 3], [45000, 65000]).read('C2')).toBeCloseTo(
      Math.expm1((Math.log(1.5) * 365) / 20000),
      10,
    );
  });
  it('truncates fractional date serials and preserves unsorted and duplicate later dates', () => {
    const { sheet, read } = fixture([-100, 60, 50, 20], [45000.9, 45730.2, 45365.7, 45365.1]);
    expect(read('C1')).toBeCloseTo(-100 + 60 / 1.09 ** 2 + 70 / 1.09, 10);
    sheet.cells.C1.value = '=XNPV(0,A1:A4,B1:B4)';
    expect(read('C1')).toBe(30);
  });
  it('retains compensated cancellation and excludes zero cash from overflow', () => {
    const { sheet, read } = fixture([1e16, 1, -1e16], [45000, 45000, 45000]);
    expect(read('C1')).toBe(1);
    sheet.cells.A1.value = 0;
    sheet.cells.A2.value = 0;
    sheet.cells.A3.value = 0;
    sheet.cells.B3.value = 2_958_465;
    sheet.cells.C1.value = '=XNPV(-0.9999999999999999,A1:A3,B1:B3)';
    expect(read('C1')).toBe(0);
  });
  it.each([
    ['=XNPV(0.1,A1:A3,B1:B2)', '#VALUE!'],
    ['=XIRR(A1:A3,B1:C3)', '#VALUE!'],
    ['=XIRR(A1,B1)', '#NUM!'],
    ['=XNPV(-1,A1:A2,B1:B2)', '#NUM!'],
    ['=XIRR(A1:A2,B1:B2,-1)', '#NUM!'],
    ['=XIRR(A1:A2,B1:B2,1000001)', '#NUM!'],
    ['=XNPV(0.1,A1:A100001,B1:B100001)', '#NUM!'],
    ['=XIRR(A1:A2)', '#VALUE!'],
  ])('rejects unsupported input %s', (formula, expected) => {
    const { sheet, read } = fixture();
    sheet.cells.C1.value = formula;
    expect(read('C1')).toBe(expected);
  });
  it.each(['', '10', true])('does not silently shift cash/date alignment for %s', (value) => {
    const { sheet, read } = fixture();
    sheet.cells.A2 = { value };
    expect(read('C1')).toBe('#VALUE!');
    expect(read('C2')).toBe('#VALUE!');
  });
  it.each(['2008-02-30', '01/03/2008', '', true, -1, 2_958_466])(
    'rejects invalid dates %s',
    (value) => {
      const { sheet, read } = fixture();
      sheet.cells.B2 = { value };
      expect(read('C1')).toBe(typeof value === 'number' ? '#NUM!' : '#VALUE!');
    },
  );
  it('propagates member errors and recalculates recovered input', () => {
    const { sheet, read } = fixture();
    sheet.cells.B2.value = '=1/0';
    expect(read('C2')).toBe('#DIV/0!');
    sheet.cells.D1 = { value: '=IFERROR(C2,42)' };
    expect(read('D1')).toBe(42);
    sheet.cells.B2.value = '2008-03-01';
    expect(read('D1')).toBeCloseTo(0.373362533518831, 9);
  });
  it('rejects earlier dates, missing signs, same-day indeterminate schedules and no root', () => {
    expect(fixture([-100, 110], [45000, 44999]).read('C2')).toBe('#NUM!');
    expect(fixture([100, 110], [45000, 45365]).read('C2')).toBe('#NUM!');
    expect(fixture([-100, 100], [45000, 45000]).read('C2')).toBe('#NUM!');
    expect(fixture([-100, 10, -100], [45000, 45365, 45730]).read('C2')).toBe('#NUM!');
  });
  it('bounds iterative member work for large schedules', () => {
    const values = Array.from({ length: 100_000 }, (_, i) => (i === 0 ? -100000 : 1));
    const dates = values.map((_, i) => 45000 + i);
    expect(fixture(values, dates).read('C2')).toBe('#NUM!');
  });
  it('invalidates both cross-sheet cash and date dependencies and survives XLSX', async () => {
    const { book, sheet } = fixture([-100, 110], [45000, 45365]);
    const result = {
      ...sheet,
      id: 'result',
      name: 'Result',
      cells: {
        D1: { value: '=XIRR(Cash!A1:A2,Cash!B1:B2)' },
        D2: { value: '=XNPV(0.1,Cash!A1:A2,Cash!B1:B2)' },
      },
    };
    book.sheets.push(result);
    const evaluator = createEvaluator(book, { managedMutations: true });
    expect(evaluator(result, 'D1')).toBeCloseTo(0.1, 9);
    sheet.cells.A2.value = 121;
    evaluator.invalidateCells(sheet.id, ['A2']);
    expect(evaluator(result, 'D1')).toBeCloseTo(0.21, 9);
    sheet.cells.B2.value = 45730;
    evaluator.invalidateCells(sheet.id, ['B2']);
    expect(evaluator(result, 'D1')).toBeCloseTo(0.1, 9);
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[1].cells.D1.value).toBe(result.cells.D1.value);
    expect(evaluateCell(restored.sheets[1], 'D1', restored)).toBeCloseTo(0.1, 9);
    expect(evaluateCell(restored.sheets[1], 'D2', restored)).toBeCloseTo(0, 8);
    const targets = ['D1', 'D2'].map((key) => ({ sheetId: result.id, key }));
    const calculated = calculateSync({ type: 'calculate', revision: 1, workbook: book, targets });
    expect(calculated.values['result:D1']).toBeCloseTo(0.1, 9);
  });
});

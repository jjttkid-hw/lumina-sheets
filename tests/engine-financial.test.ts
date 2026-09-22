import { describe, expect, it } from 'vitest';
import { createEvaluator, evaluateCell } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
function evaluate(formula: string) {
  const book = createBlankWorkbook();
  book.sheets[0].cells.A1 = { value: formula };
  return evaluateCell(book.sheets[0], 'A1', book);
}
describe('periodic financial functions', () => {
  it('computes standard loan, present value and savings examples', () => {
    expect(evaluate('=PMT(0.08/12,120,10000)')).toBeCloseTo(-121.327594355, 8);
    expect(evaluate('=PV(0.08/12,240,500)')).toBeCloseTo(-59777.145851, 5);
    // Independent 50-digit decimal monthly recurrence: balance = balance*1.005 + 200.
    expect(evaluate('=FV(0.06/12,120,-200,-1000)')).toBeCloseTo(34595.26609532484, 8);
  });
  it.each([0, 1])('matches independent period-by-period cash flow for type %s', (when) => {
    const rate = 0.01,
      periods = 36,
      payment = -150,
      present = -2000;
    let balance = -present;
    for (let i = 0; i < periods; i++) {
      if (when) balance -= payment;
      balance *= 1 + rate;
      if (!when) balance -= payment;
    }
    expect(evaluate(`=FV(${rate},${periods},${payment},${present},${when})`)).toBeCloseTo(
      balance,
      8,
    );
    expect(evaluate(`=PV(${rate},${periods},${payment},${balance},${when})`)).toBeCloseTo(
      present,
      8,
    );
    expect(evaluate(`=PMT(${rate},${periods},${present},${balance},${when})`)).toBeCloseTo(
      payment,
      8,
    );
  });
  it('handles zero and tiny rates without subtractive precision loss', () => {
    expect(evaluate('=PMT(0,10,1000,100)')).toBe(-110);
    expect(evaluate('=PV(0,10,-100,50)')).toBe(950);
    expect(evaluate('=FV(0,10,-100,-50,1)')).toBe(1050);
    expect(evaluate('=PMT(1e-16,100,1000)')).toBeCloseTo(-10, 10);
    expect(evaluate('=PV(1e-16,100,-10)')).toBeCloseTo(1000, 9);
    expect(evaluate('=FV(1e-16,100,-10)')).toBeCloseTo(1000, 9);
    expect(evaluate('=PV(0.1,0,20,100)')).toBe(-100);
    expect(evaluate('=FV(0.1,0,20,100)')).toBe(-100);
  });
  it('supports negative rates above -100% and fractional periods', () => {
    const future = evaluate('=FV(-0.01,12.5,-20,-100)') as number;
    expect(evaluate(`=PV(-0.01,12.5,-20,${future})`)).toBeCloseTo(-100, 10);
    expect(evaluate(`=PMT(-0.01,12.5,-100,${future})`)).toBeCloseTo(-20, 10);
  });
  it.each(['PMT', 'PV', 'FV'])('validates %s arguments and propagates formula errors', (name) => {
    expect(evaluate(`=${name}(0,0,100)`)).toBe(name === 'PMT' ? '#DIV/0!' : 0);
    expect(evaluate(`=${name}(-1,10,100)`)).toBe('#NUM!');
    expect(evaluate(`=${name}(0.1,-10,100)`)).toBe('#NUM!');
    expect(evaluate(`=${name}(0.1,10,100,0,2)`)).toBe('#NUM!');
    expect(evaluate(`=${name}(0.1,10)`)).toBe('#VALUE!');
    expect(evaluate(`=${name}(0.1,10,100,0,0,1)`)).toBe('#VALUE!');
    expect(evaluate(`=${name}("bad",10,100)`)).toBe('#VALUE!');
    expect(evaluate(`=${name}(1/0,10,100)`)).toBe('#DIV/0!');
    expect(evaluate(`=${name}(10,10000,100)`)).toBe('#NUM!');
  });
  it('invalidates dependent payments after an input changes', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = { A1: { value: 1000 }, B1: { value: '=PMT(0,10,A1)' }, C1: { value: '=B1*10' } };
    const evaluator = createEvaluator(book, { managedMutations: true });
    expect(evaluator(sheet, 'C1')).toBe(-1000);
    sheet.cells.A1.value = 2000;
    evaluator.invalidateCells(sheet.id, ['A1']);
    expect(evaluator(sheet, 'C1')).toBe(-2000);
  });
  it('retains financial formula text and computed values over an XLSX round trip', async () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: '=PMT(0,12,1200)' },
      B1: { value: '=FV(0,12,A1)' },
      C1: { value: '=PV(0,12,A1)' },
    };
    const result = await workbookFromXlsx(await workbookToXlsx(book));
    for (const key of ['A1', 'B1', 'C1']) {
      expect(result.sheets[0].cells[key].value).toBe(sheet.cells[key].value);
      expect(evaluateCell(result.sheets[0], key, result)).toBe(evaluateCell(sheet, key, book));
    }
  });
});

describe('number of payment periods', () => {
  it.each([0, 1])('recovers periods from an independent balance recurrence for type %s', (when) => {
    for (const rate of [-0.02, 0, 0.001, 0.15]) {
      let balance = 2000;
      for (let period = 0; period < 48; period++) {
        if (when) balance += 150;
        balance *= 1 + rate;
        if (!when) balance += 150;
      }
      expect(evaluate(`=NPER(${rate},-150,-2000,${balance},${when})`)).toBeCloseTo(48, 8);
    }
  });
  it('supports standard loan, fractional, zero and tiny-rate cases', () => {
    expect(evaluate('=NPER(0,-100,1200)')).toBe(12);
    expect(evaluate('=NPER(0,-100,1250)')).toBe(12.5);
    expect(evaluate('=NPER(1e-16,-100,1200)')).toBeCloseTo(12, 10);
    expect(evaluate('=NPER(0.1,0,-100,121)')).toBeCloseTo(2, 12);
    expect(evaluate('=NPER(0.1,-200,1000,-1000)')).toBe(0);
    const payment = evaluate('=PMT(0.08/12,120,10000)');
    expect(evaluate(`=NPER(0.08/12,${payment},10000)`)).toBeCloseTo(120, 9);
  });
  it('normalizes large cash flows and avoids quotient overflow', () => {
    expect(evaluate('=NPER(0,-1e308,1e308,1e308)')).toBe(2);
    expect(evaluate('=NPER(0.1,0,-1e308,1.21e308)')).toBeCloseTo(2, 12);
    expect(evaluate('=NPER(0.1,0,-1e-100,1e200)')).toBeCloseTo(
      (300 * Math.log(10)) / Math.log1p(0.1),
      8,
    );
  });
  it('rejects unreachable, ambiguous and invalid inputs and propagates errors', () => {
    for (const formula of [
      'NPER(-1,-10,100)',
      'NPER(0.1,-1,100)',
      'NPER(0,10,100)',
      'NPER(0.1,0,100,100)',
      'NPER(0.1,-100,1000,0,2)',
    ])
      expect(evaluate(`=${formula}`)).toBe('#NUM!');
    expect(evaluate('=NPER(0,0,100)')).toBe('#DIV/0!');
    expect(evaluate('=NPER(0.1,0,0)')).toBe('#DIV/0!');
    expect(evaluate('=NPER(0.1,-100,1000,-1000)')).toBe('#DIV/0!');
    expect(evaluate('=NPER(0,10)')).toBe('#VALUE!');
    expect(evaluate('=NPER(0,10,100,0,0,0)')).toBe('#VALUE!');
    expect(evaluate('=NPER("bad",10,100)')).toBe('#VALUE!');
    expect(evaluate('=NPER(1/0,10,100)')).toBe('#DIV/0!');
  });
  it('recalculates dependencies and retains the formula over XLSX', async () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: 1200 },
      B1: { value: '=NPER(0,-100,A1)' },
      C1: { value: '=B1/12' },
    };
    const evaluator = createEvaluator(book, { managedMutations: true });
    expect(evaluator(sheet, 'C1')).toBe(1);
    sheet.cells.A1.value = 2400;
    evaluator.invalidateCells(sheet.id, ['A1']);
    expect(evaluator(sheet, 'C1')).toBe(2);
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[0].cells.B1.value).toBe('=NPER(0,-100,A1)');
    expect(evaluateCell(restored.sheets[0], 'C1', restored)).toBe(2);
  });
});

describe('periodic discounted cash flow', () => {
  it('discounts the first payment one period and adds the initial investment outside NPV', () => {
    // Independently summed using 50-digit Decimal arithmetic, at periods 1, 2, 3.
    expect(evaluate('=NPV(0.1,3000,4200,6800)-10000')).toBeCloseTo(1307.2877535687453, 8);
    expect(evaluate('=NPV(0.1,-10000,3000,4200,6800)')).toBeCloseTo(1188.443412335223, 8);
    expect(evaluate('=NPV(0,10,-2,5)')).toBe(13);
    expect(evaluate('=NPV(-0.5,10,20)')).toBeCloseTo(100, 10);
    expect(evaluate('=NPV(1e-16,10,20)')).toBeCloseTo(30, 10);
  });
  it('matches an independent reverse cash-flow recurrence', () => {
    let state = 739;
    for (const rate of [-0.05, 0, 0.001, 0.2]) {
      const flows = Array.from({ length: 60 }, () => {
        state = (state * 16807) % 2147483647;
        return (state % 10000) - 4000;
      });
      let present = 0;
      for (let i = flows.length - 1; i >= 0; i--) present = (present + flows[i]) / (1 + rate);
      expect(evaluate(`=NPV(${rate},${flows.join(',')})`)).toBeCloseTo(present, 6);
    }
  });
  it('skips nonnumeric references but counts stored zero as a period', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: 100 },
      A3: { value: '200' },
      A4: { value: false },
      A5: { value: 0 },
      A6: { value: 100 },
      B1: { value: '=NPV(0.1,A1:A6)' },
      B2: { value: '=NPV(0.1,A3,A4,A2)' },
    };
    expect(evaluateCell(sheet, 'B1', book)).toBeCloseTo(100 / 1.1 + 100 / 1.1 ** 3, 10);
    expect(evaluateCell(sheet, 'B2', book)).toBe(0);
    expect(evaluate('=NPV(0,"100",TRUE,FALSE)')).toBe(101);
    expect(evaluate('=NPV(0,"bad")')).toBe('#VALUE!');
  });
  it('uses argument order and row-major order within rectangular ranges', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: 1 },
      B1: { value: 2 },
      A2: { value: 3 },
      B2: { value: 4 },
      C1: { value: '=NPV(1,A1:B2,5)' },
    };
    expect(evaluateCell(sheet, 'C1', book)).toBe(1 / 2 + 2 / 4 + 3 / 8 + 4 / 16 + 5 / 32);
  });
  it('keeps small cash flows through cancellation and guards numerical overflow', () => {
    expect(evaluate('=NPV(0,1e16,1,-1e16)')).toBe(1);
    expect(evaluate('=NPV(0,1e308,1e308)')).toBe('#NUM!');
    expect(evaluate('=NPV(-0.9999999999999999,0,0)')).toBe(0);
    expect(evaluate('=NPV(-1,5)')).toBe('#DIV/0!');
    expect(evaluate('=NPV(-2,5)')).toBe('#NUM!');
  });
  it('validates argument/work limits and propagates formula errors', () => {
    expect(evaluate('=NPV(0.1)')).toBe('#VALUE!');
    expect(evaluate(`=NPV(0,${Array(255).fill(1).join(',')})`)).toBe('#VALUE!');
    expect(evaluate(`=NPV(0,${Array(254).fill(1).join(',')})`)).toBe(254);
    expect(evaluate('=NPV("bad",1)')).toBe('#VALUE!');
    expect(evaluate('=NPV(0,1/0)')).toBe('#DIV/0!');
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.rowCount = 100001;
    sheet.cells.B1 = { value: '=NPV(0,A1:A100000,1)' };
    expect(evaluateCell(sheet, 'B1', book)).toBe('#NUM!');
    sheet.cells.B1.value = '=NPV(0,A1:A100000)';
    expect(evaluateCell(sheet, 'B1', book)).toBe(0);
    sheet.cells.A50 = { value: '=1/0' };
    expect(evaluateCell(sheet, 'B1', book)).toBe('#DIV/0!');
  });
  it('recalculates cross-sheet range dependencies and preserves NPV over XLSX', async () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.name = 'Cash';
    sheet.cells = { A1: { value: 100 }, A3: { value: 100 } };
    const output = {
      ...sheet,
      id: 'result',
      name: 'Result',
      cells: { B1: { value: '=NPV(0.1,Cash!A1:A3)' } },
    };
    book.sheets.push(output);
    const evaluator = createEvaluator(book, { managedMutations: true });
    expect(evaluator(output, 'B1')).toBeCloseTo(100 / 1.1 + 100 / 1.1 ** 2, 10);
    sheet.cells.A2 = { value: 0 };
    evaluator.invalidateCells(sheet.id, ['A2']);
    const expected = 100 / 1.1 + 100 / 1.1 ** 3;
    expect(evaluator(output, 'B1')).toBeCloseTo(expected, 10);
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[1].cells.B1.value).toBe(output.cells.B1.value);
    expect(evaluateCell(restored.sheets[1], 'B1', restored)).toBeCloseTo(expected, 10);
  });
});

describe('rate of return functions', () => {
  it('computes IRR from direct cash flows and ranges', () => {
    expect(evaluate('=IRR(-10000,3000,4200,6800)')).toBeCloseTo(0.1634056008, 9);
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: -10000 },
      A2: { value: 3000 },
      A3: { value: 4200 },
      A4: { value: 6800 },
      A5: { value: '备注' },
      B1: { value: '=IRR(A1:A5)' },
    };
    expect(evaluateCell(sheet, 'B1', book)).toBeCloseTo(0.1634056008, 9);
  });

  it('solves RATE for a payment schedule and rejects unsupported domains', () => {
    expect(evaluate('=RATE(120,-121.327594355,10000)')).toBeCloseTo(0.08 / 12, 9);
    expect(evaluate('=RATE(10,0,-100,110)')).toBeCloseTo(0.0095765827, 9);
    for (const formula of ['=IRR(1,2,3)', '=IRR(-1,1,-1)', '=RATE(0,-1,1)', '=RATE(10,-1,1,0,2)'])
      expect(evaluate(formula)).toBe('#NUM!');
    expect(evaluate('=IRR(-10000,3000,1/0,6800)')).toBe('#DIV/0!');
    expect(evaluate('=RATE(10,-1,1,1/0)')).toBe('#DIV/0!');
  });
});

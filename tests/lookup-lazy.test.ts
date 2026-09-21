import { describe, expect, it } from 'vitest';
import { createEvaluator, evaluateCell } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';

describe('selected lookup cell evaluation', () => {
  function fixture() {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: 'first' },
      A2: { value: 'last' },
      B1: { value: 42 },
      B2: { value: '=1/0' },
      C1: { value: '=1/0' },
      C2: { value: '=1/0' },
    };
    const run = (formula: string) => {
      sheet.cells.D1 = { value: formula };
      return evaluateCell(sheet, 'D1', book);
    };
    return { book, sheet, run };
  }
  it('does not evaluate unselected INDEX entries or unreturned VLOOKUP columns', () => {
    const { run } = fixture();
    expect(run('=INDEX(B1:C2,1,1)')).toBe(42);
    expect(run('=INDEX(B1:C2,2,1)')).toBe('#DIV/0!');
    expect(run('=VLOOKUP("first",A1:C2,2,FALSE)')).toBe(42);
    expect(run('=VLOOKUP("first",A1:C2,3,FALSE)')).toBe('#DIV/0!');
    expect(run('=VLOOKUP("missing",A1:C2,2,FALSE)')).toBe('#N/A');
    expect(run('=INDEX(B1,1)')).toBe(42);
  });
  it('reads only the selected XLOOKUP result and stops exact search at the first match', () => {
    const { run, sheet } = fixture();
    expect(run('=XLOOKUP("first",A1:A2,B1:B2,"none")')).toBe(42);
    expect(run('=XLOOKUP("missing",A1:A2,B1:B2,"none")')).toBe('none');
    expect(run('=XLOOKUP("last",A1:A2,B1:B2,"none")')).toBe('#DIV/0!');
    sheet.cells.A2.value = '=1/0';
    expect(run('=XLOOKUP("first",A1:A2,B1:B2,"none")')).toBe(42);
    expect(run('=VLOOKUP("first",A1:B2,2,FALSE)')).toBe(42);
    expect(run('=XLOOKUP("first",A1:A2,B1:B2,"none",0,-1)')).toBe('#DIV/0!');
    sheet.cells.A1.value = '=1/0';
    sheet.cells.A2.value = 'last';
    sheet.cells.B2.value = 99;
    expect(run('=XLOOKUP("last",A1:A2,B1:B2,"none",0,-1)')).toBe(99);
  });
  it.each([true, false])(
    'keeps dependency invalidation correct with managed mutations %s',
    (managed) => {
      const { book, sheet } = fixture();
      sheet.cells.D1 = { value: '=XLOOKUP("first",A1:A2,B1:B2,"none")' };
      sheet.cells.E1 = { value: '=INDEX(B1:B2,1)' };
      const evaluate = createEvaluator(book, { managedMutations: managed });
      expect(evaluate(sheet, 'D1')).toBe(42);
      expect(evaluate(sheet, 'E1')).toBe(42);
      sheet.cells.B1.value = 50;
      if (managed) evaluate.invalidateCells(sheet.id, ['B1']);
      expect(evaluate(sheet, 'D1')).toBe(50);
      expect(evaluate(sheet, 'E1')).toBe(50);
      sheet.cells.A1.value = 'other';
      sheet.cells.A2.value = 'first';
      if (managed) evaluate.invalidateCells(sheet.id, ['A1', 'A2']);
      expect(evaluate(sheet, 'D1')).toBe('#DIV/0!');
      sheet.cells.B2.value = 70;
      if (managed) evaluate.invalidateCells(sheet.id, ['B2']);
      expect(evaluate(sheet, 'D1')).toBe(70);
    },
  );
  it('retains shape, range quota and selected self-reference errors', () => {
    const { run, sheet } = fixture();
    expect(run('=XLOOKUP("first",A1:A2,B1:C1,"none")')).toBe('#VALUE!');
    expect(run('=INDEX(A1:XFD1048576,1,1)')).toBe('#NUM!');
    expect(run('=INDEX(D1:D2,1)')).toBe('#CYCLE!');
    expect(run('=INDEX(D1:D2,2)')).toBe('');
    sheet.cells.A1.value = 1;
    sheet.cells.A2.value = 3;
    expect(run('=VLOOKUP(2,A1:C2,2,TRUE)')).toBe(42);
  });
});

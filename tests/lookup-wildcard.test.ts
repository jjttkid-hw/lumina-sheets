import { describe, expect, it } from 'vitest';
import { createEvaluator, evaluateCell } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';

function fixture() {
  const book = createBlankWorkbook(),
    sheet = book.sheets[0];
  sheet.cells = {
    A1: { value: 'AC-01' },
    A2: { value: 'ac*02' },
    A3: { value: 'AC-03' },
    B1: { value: 10 },
    B2: { value: 20 },
    B3: { value: 30 },
  };
  const run = (formula: string) => {
    sheet.cells.D1 = { value: formula };
    return evaluateCell(sheet, 'D1', book);
  };
  return { book, sheet, run };
}
describe('wildcard report lookups', () => {
  it('uses wildcard syntax only for exact VLOOKUP and returns the first match', () => {
    const { run } = fixture();
    expect(run('=VLOOKUP("ac*",A1:B3,2,FALSE)')).toBe(10);
    expect(run('=VLOOKUP("ac~*02",A1:B3,2,FALSE)')).toBe(20);
    expect(run('=VLOOKUP("ac?03",A1:B3,2,FALSE)')).toBe(30);
    expect(run('=VLOOKUP("missing*",A1:B3,2,FALSE)')).toBe('#N/A');
    expect(run('=VLOOKUP("ac~*02",A1:B3,2,TRUE)')).not.toBe(20);
    expect(run('=VLOOKUP("ac*",A1:B3,3,FALSE)')).toBe('#REF!');
  });
  it('supports forward and reverse XLOOKUP wildcard matching with lazy fallback', () => {
    const { run } = fixture();
    expect(run('=XLOOKUP("ac*",A1:A3,B1:B3,1/0,2,1)')).toBe(10);
    expect(run('=XLOOKUP("ac*",A1:A3,B1:B3,1/0,2,-1)')).toBe(30);
    expect(run('=XLOOKUP("ac~*02",A1:A3,B1:B3,"none",2,-1)')).toBe(20);
    expect(run('=XLOOKUP("missing*",A1:A3,B1:B3,"none",2)')).toBe('none');
    expect(run('=XLOOKUP("missing*",A1:A3,B1:B3,1/0,2)')).toBe('#DIV/0!');
    expect(run('=XLOOKUP("ac*",A1:A3,B1:B3,"literal",0)')).toBe('literal');
    expect(run('=XLOOKUP("ac*",A1:A3,B1:B3,"none",2,2)')).toBe('#VALUE!');
  });
  it('keeps numeric lookup distinct from text and matches across line breaks', () => {
    const { run, sheet } = fixture();
    sheet.cells.A1.value = 12;
    sheet.cells.A2.value = '12';
    sheet.cells.A3.value = 'A\nB';
    expect(run('=XLOOKUP(12,A1:A3,B1:B3,"none",2)')).toBe(10);
    expect(run('=XLOOKUP("1?",A1:A3,B1:B3,"none",2)')).toBe(20);
    expect(run('=VLOOKUP("1?",A1:B3,2,FALSE)')).toBe(20);
    expect(run('=XLOOKUP("a?b",A1:A3,B1:B3,"none",2)')).toBe(30);
  });
  it('supports horizontal wildcard lookup and preserves formulas through XLSX and edits', async () => {
    const { book, sheet, run } = fixture();
    sheet.cells.C1 = { value: 'AC-final' };
    sheet.cells.C2 = { value: 99 };
    expect(run('=XLOOKUP("ac*",A1:C1,A2:C2,"none",2,-1)')).toBe(99);
    sheet.cells.D1.value = '=XLOOKUP("ac*",A1:A3,B1:B3,"none",2,-1)';
    const evaluate = createEvaluator(book, { managedMutations: true });
    expect(evaluate(sheet, 'D1')).toBe(30);
    sheet.cells.A3.value = 'Other';
    evaluate.invalidateCells(sheet.id, ['A3']);
    expect(evaluate(sheet, 'D1')).toBe(20);
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[0].cells.D1.value).toBe(sheet.cells.D1.value);
    expect(evaluateCell(restored.sheets[0], 'D1', restored)).toBe(20);
  });
  it('propagates exhausted matching budgets instead of using the missing-value fallback', () => {
    const { sheet, run } = fixture();
    sheet.cells.A1.value = 'a'.repeat(32767);
    sheet.cells.C1 = { value: '*' + 'a'.repeat(1000) + 'b' };
    expect(run('=XLOOKUP(C1,A1:A3,B1:B3,"missing",2)')).toBe('#NUM!');
    expect(run('=IFERROR(VLOOKUP(C1,A1:B3,2,FALSE),"budget")')).toBe('budget');
  });
});

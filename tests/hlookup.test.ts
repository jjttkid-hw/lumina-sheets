import { describe, expect, it } from 'vitest';
import { createEvaluator, evaluateCell } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';

function fixture() {
  const book = createBlankWorkbook();
  const sheet = book.sheets[0];
  sheet.cells = {
    A1: { value: 'AC-01' },
    B1: { value: 'ac*02' },
    C1: { value: 'AC-03' },
    A2: { value: 10 },
    B2: { value: 20 },
    C2: { value: 30 },
  };
  const run = (formula: string) => {
    sheet.cells.D1 = { value: formula };
    return evaluateCell(sheet, 'D1', book);
  };
  return { book, sheet, run };
}

describe('horizontal table lookup', () => {
  it('matches exact wildcard escapes and keeps numeric candidates distinct', () => {
    const { run, sheet } = fixture();
    expect(run('=HLOOKUP("ac*",A1:C2,2,FALSE)')).toBe(10);
    expect(run('=HLOOKUP("ac~*02",A1:C2,2,FALSE)')).toBe(20);
    expect(run('=HLOOKUP("ac?03",A1:C2,2,FALSE)')).toBe(30);
    sheet.cells.A1.value = 12;
    sheet.cells.B1.value = '12';
    expect(run('=HLOOKUP("1?",A1:C2,2,FALSE)')).toBe(20);
    expect(run('=HLOOKUP(12,A1:C2,2,FALSE)')).toBe(10);
  });

  it('defaults to approximate lookup on ascending headers and validates arguments', () => {
    const { run, sheet } = fixture();
    sheet.cells.A1.value = 0;
    sheet.cells.B1.value = 10;
    sheet.cells.C1.value = 20;
    expect(run('=HLOOKUP(15,A1:C2,2)')).toBe(20);
    expect(run('=HLOOKUP(99,A1:C2,2,TRUE)')).toBe(30);
    expect(run('=HLOOKUP(-1,A1:C2,2)')).toBe('#N/A');
    expect(run('=HLOOKUP(10,A1:C2,2.9,FALSE)')).toBe(20);
    expect(run('=HLOOKUP(10,A1:C2,-1,FALSE)')).toBe('#VALUE!');
    expect(run('=HLOOKUP(10,A1:C2,"bad",FALSE)')).toBe('#VALUE!');
    expect(run('=HLOOKUP(10,A1:C2)')).toBe('#VALUE!');
    expect(run('=HLOOKUP(10,A1:C2,2,FALSE,1)')).toBe('#VALUE!');
    expect(run('=HLOOKUP(10,A1:XFD1048576,2,FALSE)')).toBe('#NUM!');
  });

  it('reads only needed cells while propagating selected and search errors', () => {
    const { run, sheet } = fixture();
    sheet.cells.B2.value = '=1/0';
    sheet.cells.C1.value = '=1/0';
    expect(run('=HLOOKUP("AC-01",A1:C2,2,FALSE)')).toBe(10);
    expect(run('=HLOOKUP("ac~*02",A1:C2,2,FALSE)')).toBe('#DIV/0!');
    expect(run('=HLOOKUP("missing",A1:C2,2,FALSE)')).toBe('#DIV/0!');
    expect(run('=HLOOKUP("AC-01",A1:D2,1,FALSE)')).toBe('AC-01');
    sheet.cells.A2.value = '=D1';
    expect(run('=HLOOKUP("AC-01",A1:C2,2,FALSE)')).toBe('#CYCLE!');
  });

  it.each([true, false])('invalidates horizontal dependencies (managed=%s)', (managed) => {
    const { book, sheet } = fixture();
    sheet.cells.D1 = { value: '=HLOOKUP("ac*",A1:C2,2,FALSE)' };
    const evaluate = createEvaluator(book, { managedMutations: managed });
    expect(evaluate(sheet, 'D1')).toBe(10);
    sheet.cells.A1.value = 'other';
    if (managed) evaluate.invalidateCells(sheet.id, ['A1']);
    expect(evaluate(sheet, 'D1')).toBe(20);
    sheet.cells.B2.value = 99;
    if (managed) evaluate.invalidateCells(sheet.id, ['B2']);
    expect(evaluate(sheet, 'D1')).toBe(99);
  });

  it('preserves formula text and recomputes after XLSX import', async () => {
    const { book, sheet } = fixture();
    const formula = '=HLOOKUP("ac~*02",A1:C2,2,FALSE)';
    sheet.cells.D1 = { value: formula };
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[0].cells.D1.value).toBe(formula);
    expect(evaluateCell(restored.sheets[0], 'D1', restored)).toBe(20);
  });
});

import { describe, expect, it } from 'vitest';
import { createEvaluator } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';

describe('typed calculation outcomes', () => {
  it('distinguishes values and errors through cached and incremental references', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: '="#N/A"' },
      B1: { value: '=A1' },
      C1: { value: '=IFERROR(A1,42)' },
    };
    const evaluate = createEvaluator(book, { managedMutations: true });
    for (let pass = 0; pass < 2; pass++)
      for (const key of ['A1', 'B1', 'C1'])
        expect(evaluate.result(sheet, key)).toEqual({ kind: 'value', value: '#N/A' });
    sheet.cells.A1.value = '=#N/A';
    evaluate.invalidateCells(sheet.id, ['A1']);
    for (const key of ['A1', 'B1'])
      expect(evaluate.result(sheet, key)).toEqual({ kind: 'error', error: '#N/A' });
    expect(evaluate.result(sheet, 'C1')).toEqual({ kind: 'value', value: 42 });
    expect(evaluate(sheet, 'A1')).toBe('#N/A');
    sheet.cells.A1.value = '#N/A';
    evaluate.invalidateCells(sheet.id, ['A1']);
    expect(evaluate.result(sheet, 'B1')).toEqual({ kind: 'value', value: '#N/A' });
  });
  it('returns isolated outcomes for blanks, booleans and engine-specific errors', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = { A1: { value: '=TRUE' }, B1: { value: '=B1' }, C1: { value: '=(' } };
    const evaluate = createEvaluator(book);
    const value = evaluate.result(sheet, 'A1');
    if (value.kind === 'value') value.value = 'mutated';
    expect(evaluate.result(sheet, 'A1')).toEqual({ kind: 'value', value: true });
    expect(evaluate.result(sheet, 'D1')).toEqual({ kind: 'value', value: '' });
    expect(evaluate.result(sheet, 'B1')).toEqual({ kind: 'error', error: '#CYCLE!' });
    expect(evaluate.result(sheet, 'C1')).toEqual({ kind: 'error', error: '#ERROR!' });
  });
  it('distinguishes unavailable paged cells from source-provided error-looking strings', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.dataSource = { kind: 'paged' };
    const evaluate = createEvaluator(book, {
      readPagedCell: (_sheet, key) => (key === 'A1' ? '#N/A' : undefined),
    });
    expect(evaluate.result(sheet, 'A1')).toEqual({ kind: 'value', value: '#N/A' });
    expect(evaluate.result(sheet, 'A2')).toEqual({ kind: 'error', error: '#N/A' });
  });
});

import { expect, it } from 'vitest';
import { createEvaluator } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';

it('reads external cached values and distinguishes unknown pages, blanks and literal error strings', () => {
  const book = createBlankWorkbook();
  const summary = book.sheets[0];
  const data = {
    id: 'data',
    name: 'Data',
    rowCount: 100,
    colCount: 3,
    cells: {},
    dataSource: { kind: 'paged' as const },
  };
  book.sheets.push(data);
  summary.cells = {
    A1: { value: '=SUM(Data!A1:A3)' },
    A2: { value: '=IFERROR(Data!B1,"pending")' },
    A3: { value: '=IFERROR(Data!C1,"error")' },
    A4: { value: '=IF(FALSE,Data!B1,7)' },
  };
  const values: Record<string, string | number | null> = { A1: 12, A2: null, A3: 8, C1: '#N/A' };
  const evaluate = createEvaluator(book, {
    managedMutations: true,
    readPagedCell: (_, key) => values[key],
  });
  expect(evaluate(summary, 'A1')).toBe(20);
  expect(evaluate(summary, 'A2')).toBe('pending');
  expect(evaluate(summary, 'A3')).toBe('#N/A');
  expect(evaluate(summary, 'A4')).toBe(7);
  values.A2 = 4;
  evaluate.invalidateCells(data.id, ['A2']);
  expect(evaluate(summary, 'A1')).toBe(24);
  delete values.A1;
  evaluate.invalidateCells(data.id, ['A1']);
  expect(evaluate(summary, 'A1')).toBe('#N/A');
  expect(createEvaluator(book)(summary, 'A1')).toBe('#N/A');
});

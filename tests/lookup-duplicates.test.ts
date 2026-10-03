import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createEvaluator } from '../src/lib/engine';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { createBlankWorkbook } from '../src/lib/seed';

describe('duplicate lookup thresholds', () => {
  it('matches native WPS results and keeps formula caches through XLSX export', async () => {
    const bytes = await readFile(
      'docs/acceptance/wps-lookup-duplicates-2026-10-03-r39/wps-saved.xlsx',
    );
    const book = await workbookFromXlsx(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const expected = ['旧10', '新10', '新10', '新10', '旧20', '新20', '新20', '#N/A'];
    for (const candidate of [book, await workbookFromXlsx(await workbookToXlsx(book))]) {
      const evaluate = createEvaluator(candidate);
      for (const [i, value] of expected.entries())
        for (const column of ['L', 'M'])
          expect(evaluate(candidate.sheets[0], `${column}${i + 2}`)).toBe(value);
    }
  });

  it.each(['VLOOKUP', 'HLOOKUP'])(
    '%s only reads the selected result and preserves exact first-match behavior',
    (fn) => {
      const book = createBlankWorkbook();
      const sheet = book.sheets[0];
      const vertical = fn === 'VLOOKUP';
      const range = vertical ? 'A1:B3' : 'A1:C2';
      sheet.cells = vertical
        ? {
            A1: { value: 10 },
            A2: { value: 10 },
            A3: { value: 20 },
            B1: { value: '=1/0' },
            B2: { value: 42 },
            B3: { value: '=1/0' },
          }
        : {
            A1: { value: 10 },
            B1: { value: 10 },
            C1: { value: 20 },
            A2: { value: '=1/0' },
            B2: { value: 42 },
            C2: { value: '=1/0' },
          };
      sheet.cells.D1 = { value: `=${fn}(10,${range},2,TRUE)` };
      sheet.cells.D2 = { value: `=${fn}(10,${range},2,FALSE)` };
      const evaluate = createEvaluator(book);
      expect(evaluate(sheet, 'D1')).toBe(42);
      expect(evaluate(sheet, 'D2')).toBe('#DIV/0!');
      sheet.cells.B2.value = '=D1';
      expect(evaluate(sheet, 'D1')).toBe('#CYCLE!');
    },
  );

  it.each([true, false])('invalidates the later duplicate (managed=%s)', (managed) => {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: 0 },
      A2: { value: 10 },
      A3: { value: 10 },
      B1: { value: 0 },
      B2: { value: 1 },
      B3: { value: 2 },
      F1: { value: 0 },
      G1: { value: 10 },
      H1: { value: 10 },
      F2: { value: 0 },
      G2: { value: 1 },
      H2: { value: 2 },
      D1: { value: '=VLOOKUP(10,A1:B3,2)' },
      D2: { value: '=HLOOKUP(10,F1:H2,2)' },
    };
    const evaluate = createEvaluator(book, { managedMutations: managed });
    expect(evaluate(sheet, 'D1')).toBe(2);
    expect(evaluate(sheet, 'D2')).toBe(2);
    sheet.cells.B3.value = 99;
    sheet.cells.H2.value = 99;
    if (managed) evaluate.invalidateCells(sheet.id, ['B3', 'H2']);
    expect(evaluate(sheet, 'D1')).toBe(99);
    expect(evaluate(sheet, 'D2')).toBe(99);
    sheet.cells.A3.value = 20;
    sheet.cells.H1.value = 20;
    if (managed) evaluate.invalidateCells(sheet.id, ['A3', 'H1']);
    expect(evaluate(sheet, 'D1')).toBe(1);
    expect(evaluate(sheet, 'D2')).toBe(1);
  });
});

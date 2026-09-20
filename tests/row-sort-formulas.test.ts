import { describe, expect, it } from 'vitest';
import { createEvaluator, evaluateCell, translateFormula } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import { planRowSort } from '../src/lib/row-sort';
import type { CellValue } from '../src/lib/types';

describe('formula translation used by row sorting', () => {
  it('recognizes A1-shaped function names and sheet prefixes across whitespace', () => {
    expect(translateFormula('=LOG10 (A2)+LOG10\t(A3)+A1 (B2)', 1, 0)).toBe(
      '=LOG10 (A3)+LOG10\t(A4)+A1 (B3)',
    );
    expect(translateFormula('=A1 ! B2+SUM ( A1 ! C2:D3 )', 2, 0)).toBe(
      '=A1 ! B4+SUM ( A1 ! C4:D5 )',
    );
    expect(translateFormula('=LOG10(A2)+A1!B2', 2, 0)).toBe('=LOG10(A4)+A1!B4');
  });

  it('preserves quoted sheet text, escaped strings, absolute rows and identifier tokens', () => {
    const formula = `='O''Brien A1' ! $B2 + A$3 + $C$4 + SUM($D2:E$5) + "A2 ""B3""" + NamedA2 + A2.name + 1E10 + _A2`;
    expect(translateFormula(formula, 3, 0)).toBe(
      `='O''Brien A1' ! $B5 + A$3 + $C$4 + SUM($D5:E$5) + "A2 ""B3""" + NamedA2 + A2.name + 1E10 + _A2`,
    );
  });

  it('keeps explicit sheet prefixes on both range endpoints and relative columns for copy/fill', () => {
    expect(translateFormula("=SUM('Data A1' ! $A2 : 'Data A1' ! B$4)", 2, 1)).toBe(
      "=SUM('Data A1' ! $A4 : 'Data A1' ! C$4)",
    );
    expect(translateFormula('=SUM(A5:A2)+$B2+C$4+$D$5', -1, 1)).toBe('=SUM(B4:B1)+$B1+D$4+$D$5');
    expect(translateFormula('plain A1', 4, 0)).toBe('plain A1');
  });

  it.each([
    ['=SUM(A1:A2)', -1, 0, '=SUM(#REF!)'],
    ['=SUM(A1048575:A1048576)', 1, 0, '=SUM(#REF!)'],
    ["='Data A1'!A1", -1, 0, '=#REF!'],
    ["=SUM('Data A1'!A2 : 'Data A1'!A1)", -1, 0, '=SUM(#REF!)'],
    ['=SUM(A1:B1)', 0, -1, '=SUM(#REF!)'],
    ['=SUM(XFC1:XFD1)', 0, 1, '=SUM(#REF!)'],
  ])('uses one REF error for an invalid moved reference/range: %s', (formula, dr, dc, expected) => {
    const translated = translateFormula(String(formula), Number(dr), Number(dc));
    expect(translated).toBe(expected);
    const workbook = createBlankWorkbook();
    const sheet = workbook.sheets[0];
    sheet.cells.Z1 = { value: translated };
    expect(evaluateCell(sheet, 'Z1', workbook)).toBe('#REF!');
  });

  it('keeps absolute boundary references valid and supports lazy recovery from moved REF errors', () => {
    expect(translateFormula('=$A$1+$XFD$1048576', -100, 0)).toBe('=$A$1+$XFD$1048576');
    const workbook = createBlankWorkbook();
    const sheet = workbook.sheets[0];
    sheet.cells.Z1 = { value: translateFormula('=IFERROR(SUM(A1:A2),42)', -1, 0) };
    expect(evaluateCell(sheet, 'Z1', workbook)).toBe(42);
  });
});

describe('row-sort formula planning', () => {
  function workbook(cells: Record<string, CellValue>) {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    sheet.name = 'Data';
    sheet.rowCount = 8;
    sheet.colCount = 8;
    sheet.frozenRows = 0;
    sheet.cells = Object.fromEntries(Object.entries(cells).map(([key, value]) => [key, { value }]));
    return { book, sheet };
  }
  const ascending = { startRow: 1, rowCount: 3, keys: [{ column: 0, direction: 'asc' as const }] };

  it('moves whole stored rows, translates row-relative formulas and keeps outside references positional', () => {
    const { book, sheet } = workbook({
      A2: 30,
      A3: 10,
      A4: 20,
      C2: '=A2+$A$1',
      C3: '=A3+$A$1',
      C4: '=A4+$A$1',
      G2: '=LOG10 (A2)+A1 ! B2',
      G3: '=LOG10 (A3)+A1 ! B3',
      G4: '=LOG10 (A4)+A1 ! B4',
      H2: "='O''Brien A1' ! $B2+A$1+SUM(D2:E$8)",
      H3: "='O''Brien A1' ! $B3+A$1+SUM(D3:E$8)",
      H4: "='O''Brien A1' ! $B4+A$1+SUM(D4:E$8)",
      A1: 100,
      C8: '=A2',
    });
    const before = structuredClone(sheet);
    const evaluate = createEvaluator(book);
    const plan = planRowSort(sheet, ascending, (key) => evaluate(sheet, key));
    expect(plan.rowOrder).toEqual([2, 3, 1]);
    expect(sheet).toEqual(before);
    for (const patch of plan.changes) {
      if (patch.cell) sheet.cells[patch.key] = patch.cell;
      else delete sheet.cells[patch.key];
    }
    expect(sheet.cells.C2.value).toBe('=A2+$A$1');
    expect(sheet.cells.G2.value).toBe('=LOG10 (A2)+A1 ! B2');
    expect(sheet.cells.H2.value).toBe("='O''Brien A1' ! $B2+A$1+SUM(D2:E$8)");
    expect(sheet.cells.C8.value).toBe('=A2');
    expect(evaluateCell(sheet, 'C2', book)).toBe(110);
    expect(evaluateCell(sheet, 'C8', book)).toBe(10);
  });

  it('uses the original row delta when hidden rows make target positions non-contiguous', () => {
    const { book, sheet } = workbook({ A2: 20, A3: 99, A4: 10, C2: '=B2', C3: '=B3', C4: '=B4' });
    sheet.hiddenRows = [2];
    const evaluate = createEvaluator(book);
    const plan = planRowSort(sheet, ascending, (key) => evaluate(sheet, key));
    expect(plan.targetRows).toEqual([1, 3]);
    expect(plan.rowOrder).toEqual([3, 1]);
    expect(plan.changes.find(({ key }) => key === 'C3')).toBeUndefined();
    expect(plan.changes.find(({ key }) => key === 'C2')?.cell?.value ?? sheet.cells.C2.value).toBe(
      '=B2',
    );
    expect(plan.changes.find(({ key }) => key === 'C4')?.cell?.value ?? sheet.cells.C4.value).toBe(
      '=B4',
    );
  });

  it('turns an out-of-bounds moved range into one catchable REF error', () => {
    const { book, sheet } = workbook({ A2: 30, A3: 10, A4: 20, B3: '=IFERROR(SUM(C1:C2),42)' });
    const evaluate = createEvaluator(book);
    const plan = planRowSort(sheet, ascending, (key) => evaluate(sheet, key));
    expect(plan.changes.find(({ key }) => key === 'B2')?.cell?.value).toBe(
      '=IFERROR(SUM(#REF!),42)',
    );
  });

  it.each([
    '=Table1[A1]',
    '=[A1]Data!B2',
    "='[book.xlsx]Data'!A2",
    '=SUM(A:A)',
    '=SUM(1:3)',
    '=SUM(Data:Other!A2)',
    "=SUM('Data':'Other'!A2)",
    '=SUM(Data!A2:Other!A3)',
    '=@A2',
    '=A2#',
    '={1,2}',
    '=A2+"unclosed',
    "='A2'",
  ])('atomically rejects unsupported reference syntax in a moved formula: %s', (formula) => {
    const { book, sheet } = workbook({ A2: 30, A3: 10, A4: 20, B4: formula });
    const before = structuredClone(sheet);
    const evaluate = createEvaluator(book);
    expect(() => planRowSort(sheet, ascending, (key) => evaluate(sheet, key))).toThrow(
      /公式.*引用/,
    );
    expect(sheet).toEqual(before);
  });

  it('does not inspect or change an unsupported formula outside the sorted rows', () => {
    const { book, sheet } = workbook({ A2: 30, A3: 10, A4: 20, B8: '=Table1[A1]' });
    const evaluate = createEvaluator(book);
    expect(
      planRowSort(sheet, ascending, (key) => evaluate(sheet, key)).changes.some(
        ({ key }) => key === 'B8',
      ),
    ).toBe(false);
    expect(sheet.cells.B8.value).toBe('=Table1[A1]');
  });
});

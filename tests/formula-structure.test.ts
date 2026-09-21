import { describe, expect, it } from 'vitest';
import {
  renameFormulaSheet,
  validateFormulaReferences,
  rewriteFormulaReferences,
  type StructureEdit,
} from '../src/lib/formula-structure';

const rewrite = (
  formula: string,
  edit: StructureEdit,
  formulaSheetName = 'Data',
  targetSheetName = 'Data',
) => rewriteFormulaReferences(formula, { formulaSheetName, targetSheetName, edit });
const insertRows = (index: number, count = 1): StructureEdit => ({
  axis: 'row',
  kind: 'insert',
  index,
  count,
});
const deleteRows = (index: number, count = 1): StructureEdit => ({
  axis: 'row',
  kind: 'delete',
  index,
  count,
});
const insertColumns = (index: number, count = 1): StructureEdit => ({
  axis: 'column',
  kind: 'insert',
  index,
  count,
});
const deleteColumns = (index: number, count = 1): StructureEdit => ({
  axis: 'column',
  kind: 'delete',
  index,
  count,
});

describe('formula structural reference rewrites', () => {
  it.each([':', '!', '(', ')', ',', ';', '[', ']'])(
    'keeps quoted %s opaque during validation, renaming and row edits',
    (symbol) => {
      const formula = `=Data!A1&"${symbol}"`;
      expect(() => validateFormulaReferences(formula, 'Data')).not.toThrow();
      expect(renameFormulaSheet(formula, 'Data', 'Data', 'Next')).toBe(`='Next'!A1&"${symbol}"`);
      expect(rewrite(formula, insertRows(0))).toBe(`=Data!A2&"${symbol}"`);
    },
  );
  it('moves absolute and relative references while preserving unchanged formatting', () => {
    expect(rewrite('=SUM( A1, $B$2 ,c$3,$d4 )', insertRows(1, 2))).toBe(
      '=SUM( A1, $B$4 ,c$5,$d6 )',
    );
    expect(rewrite('=$A1+B$2+$C$3+d4', insertColumns(1, 2))).toBe('=$A1+D$2+$E$3+f4');
    expect(rewrite('=A1 + $B$2', insertRows(5))).toBe('=A1 + $B$2');
    expect(rewrite('plain A1', insertRows(0))).toBe('plain A1');
  });

  it('targets local references only on the edited sheet and matches explicit sheet names case insensitively', () => {
    const formula = "=A2+Data!B2+OTHER!C2+'Data'!$D$2";
    expect(rewrite(formula, insertRows(0), 'Report', 'dAtA')).toBe(
      "=A2+Data!B3+OTHER!C2+'Data'!$D$3",
    );
    expect(rewrite(formula, insertRows(0), 'Data', 'Data')).toBe(
      "=A3+Data!B3+OTHER!C2+'Data'!$D$3",
    );
    expect(rewrite("='O''Brien A1'!A1+\"O'Brien A1\"", insertRows(0), 'Report', "O'Brien A1")).toBe(
      "='O''Brien A1'!A2+\"O'Brien A1\"",
    );
    expect(rewrite('=A1!B2', insertRows(1), 'Data', 'A1')).toBe('=A1!B3');
    expect(rewrite('=Other!#REF!', insertRows(0))).toBe('=Other!#REF!');
  });

  it('preserves strings, error tokens, function names, numeric literals and identifiers', () => {
    const formula = '=LOG10(A1)+1E10+1.2e-3+NamedA1+_A1+namespace.A1+"A1"+"a""B2"+#REF!';
    expect(rewrite(formula, insertRows(0))).toBe(
      '=LOG10(A2)+1E10+1.2e-3+NamedA1+_A1+namespace.A1+"A1"+"a""B2"+#REF!',
    );
    expect(rewrite('=A1(B2)+1A1', insertRows(0))).toBe('=A1(B3)+1A1');
    expect(rewrite('="[Book]Sheet!A1 & Table[Col] & Sheet1:Sheet3!A1"', insertRows(0))).toBe(
      '="[Book]Sheet!A1 & Table[Col] & Sheet1:Sheet3!A1"',
    );
  });

  it('expands ranges only when inserting within their member boundaries', () => {
    expect(rewrite('=SUM(A2:A5)', insertRows(1, 2))).toBe('=SUM(A4:A7)');
    expect(rewrite('=SUM(A2:A5)', insertRows(2, 2))).toBe('=SUM(A2:A7)');
    expect(rewrite('=SUM(A2:A5)', insertRows(5, 2))).toBe('=SUM(A2:A5)');
    expect(rewrite('=SUM($B$2 : D5)', insertColumns(2, 2))).toBe('=SUM($B$2 : F5)');
    expect(rewrite('=SUM(A5:A2)', insertRows(2, 2))).toBe('=SUM(A7:A2)');
  });

  it('shrinks partially deleted ranges, preserving their orientation and anchors', () => {
    expect(rewrite('=SUM(A2:A6)', deleteRows(2, 2))).toBe('=SUM(A2:A4)');
    expect(rewrite('=SUM(A2:A6)', deleteRows(0, 3))).toBe('=SUM(A1:A3)');
    expect(rewrite('=SUM(A2:A6)', deleteRows(4, 5))).toBe('=SUM(A2:A4)');
    expect(rewrite('=SUM($A$6:A$2)', deleteRows(2, 2))).toBe('=SUM($A$4:A$2)');
    expect(rewrite('=SUM(B2:F6)', deleteColumns(2, 2))).toBe('=SUM(B2:D6)');
    expect(rewrite('=SUM(B2:C6)', deleteColumns(1))).toBe('=SUM(B2:B6)');
  });

  it('replaces deleted cells and entirely deleted ranges with REF errors', () => {
    expect(rewrite('=A1+$A$2+A3', deleteRows(1))).toBe('=A1+#REF!+A2');
    expect(rewrite("='Data'!A2+SUM(Data!B2:C4)", deleteRows(1, 3), 'Report')).toBe(
      '=#REF!+SUM(#REF!)',
    );
    expect(rewrite('=SUM(A6:A2)', deleteRows(1, 5))).toBe('=SUM(#REF!)');
    expect(rewrite('=SUM(B2:D6)', deleteColumns(1, 3))).toBe('=SUM(#REF!)');
    expect(rewrite('=Other!A2', deleteRows(1))).toBe('=Other!A2');
  });

  it('supports qualified ranges and preserves literal separators', () => {
    expect(rewrite("=SUM('Data' ! $A$2 : B4)", insertRows(2, 2), 'Report')).toBe(
      "=SUM('Data' ! $A$2 : B6)",
    );
    expect(rewrite('=SUM(Data!A2:DATA!B4)', insertRows(2), 'Report')).toBe('=SUM(Data!A2:DATA!B5)');
    expect(rewrite('=SUM(Other!A2:B4)', insertRows(2), 'Report')).toBe('=SUM(Other!A2:B4)');
  });

  it('rejects coordinate overflow and malformed edit parameters before committing any rewrite', () => {
    expect(() => rewrite('=A1048576', insertRows(0))).toThrow(RangeError);
    expect(() => rewrite('=XFD1', insertColumns(0))).toThrow(RangeError);
    expect(() => rewrite('=SUM(A1:A1048576)', insertRows(4))).toThrow(RangeError);
    expect(rewrite('=Other!XFD1', insertColumns(0))).toBe('=Other!XFD1');
    expect(() => rewrite('=A1', insertRows(-1))).toThrow(RangeError);
    expect(() => rewrite('=A1', insertRows(0, 0))).toThrow(RangeError);
    expect(() => rewrite('=A1', deleteRows(1048575, 2))).toThrow(RangeError);
    expect(rewrite('=A1048576', deleteRows(1048575))).toBe('=#REF!');
  });

  it.each([
    '=[Book.xlsx]Data!A1',
    "='[Book.xlsx]Data'!A1",
    '=Table1[Amount]',
    '=SUM(Data:Other!A1)',
    "=SUM('Data':'Other'!A1)",
    "='Data:Other'!A1",
    '=SUM(Data!A1:Other!B2)',
    '=SUM(A:A)',
    '=SUM(1:3)',
    '=SUM(A1:)',
  ])('rejects unsupported structural reference syntax: %s', (formula) => {
    expect(() => rewrite(formula, insertRows(1))).toThrow(SyntaxError);
  });

  it('rejects unclosed quotes rather than performing partial rewriting', () => {
    expect(() => rewrite('=A1+"A2', insertRows(0))).toThrow(SyntaxError);
    expect(() => rewrite("='Data!A1", insertRows(0))).toThrow(SyntaxError);
  });

  it.each([
    "='A1'",
    "=SUM('A1':'A3')",
    "='plain text'",
    '=@A1',
    '=A1#',
    '={1,2}',
    '=A1|B2',
    '=A1?',
  ])('rejects unsupported syntax instead of silently skipping or rewriting it: %s', (formula) => {
    expect(() => rewrite(formula, insertRows(0))).toThrow(SyntaxError);
  });

  it('preserves supported errors and quoted sheet names while ignoring symbols inside strings', () => {
    expect(rewrite("='A1'!B2+#REF!+#DIV/0!+#NAME?", insertRows(0), 'Report', 'A1')).toBe(
      "='A1'!B3+#REF!+#DIV/0!+#NAME?",
    );
    expect(rewrite('="@A1 A1# {1,2} | ?"&A1', insertRows(0))).toBe('="@A1 A1# {1,2} | ?"&A2');
  });

  it('matches surviving source cell sets for many range deletion boundaries', () => {
    for (let low = 0; low < 8; low++) {
      for (let high = low; high < 10; high++) {
        for (let index = 0; index < 10; index++) {
          for (let count = 1; count <= 3; count++) {
            const remaining = Array.from({ length: high - low + 1 }, (_, i) => low + i)
              .filter((value) => value < index || value >= index + count)
              .map((value) => (value >= index + count ? value - count : value));
            const expected = remaining.length
              ? `=SUM(A${remaining[0] + 1}:A${remaining.at(-1)! + 1})`
              : '=SUM(#REF!)';
            expect(rewrite(`=SUM(A${low + 1}:A${high + 1})`, deleteRows(index, count))).toBe(
              expected,
            );
          }
        }
      }
    }
  });
});

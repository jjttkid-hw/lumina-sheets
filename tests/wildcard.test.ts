import { describe, expect, it } from 'vitest';
import { compileWildcard } from '../src/lib/wildcard';
import { createBlankWorkbook } from '../src/lib/seed';
import { evaluateCell } from '../src/lib/engine';

describe('bounded wildcard matching', () => {
  it('agrees with an independent exhaustive matcher on short patterns and values', () => {
    const words = (alphabet: string[], depth: number): string[] =>
      depth === 0
        ? ['']
        : ['', ...words(alphabet, depth - 1).flatMap((word) => alphabet.map((c) => c + word))];
    const oracle = (pattern: string, text: string): boolean => {
      if (!pattern) return !text;
      if (pattern[0] === '*')
        return oracle(pattern.slice(1), text) || (!!text && oracle(pattern, text.slice(1)));
      return (
        !!text &&
        (pattern[0] === '?' || pattern[0].toLowerCase() === text[0].toLowerCase()) &&
        oracle(pattern.slice(1), text.slice(1))
      );
    };
    for (const pattern of new Set(words(['a', 'B', '*', '?'], 4))) {
      const match = compileWildcard(pattern);
      for (const text of new Set(words(['A', 'b', 'c'], 3)))
        expect(match(text)).toBe(oracle(pattern, text));
    }
  });
  it('handles escaped symbols, newlines, literal regex punctuation and Unicode', () => {
    for (const [pattern, text] of [
      ['a~*b', 'A*b'],
      ['~?', '?'],
      ['~~', '~'],
      ['x~', 'x~'],
      ['[a].', '[a].'],
      ['a*b', 'a\nb'],
      ['a?b', 'a\nb'],
    ])
      expect(compileWildcard(pattern)(text)).toBe(true);
    expect(compileWildcard('?')('😀')).toBe(true);
    expect(compileWildcard('?', { unicode: false })('😀')).toBe(false);
    expect(compileWildcard('??', { unicode: false })('😀')).toBe(true);
    expect(compileWildcard('K')('k')).toBe(true);
    expect(compileWildcard('K', { unicode: false })('k')).toBe(false);
    expect(compileWildcard('a')('a\n')).toBe(false);
  });
  it('avoids exponential star branching and bounds retry work across repeated calls', () => {
    expect(compileWildcard('*a'.repeat(80) + 'b')('a'.repeat(2000))).toBe(false);
    const limited = compileWildcard('*' + 'a'.repeat(50) + 'b', { maxSteps: 100 });
    expect(() => limited('a'.repeat(200))).toThrow(RangeError);
    const shared = compileWildcard('abc', { maxSteps: 5 });
    expect(shared('abc')).toBe(true);
    expect(() => shared('abc')).toThrow(RangeError);
  });
  it('supports conditional functions and MATCH without regex backtracking', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: 'a\nb' },
      A2: { value: 'a*b' },
      B1: { value: 5 },
      B2: { value: 7 },
    };
    for (const [formula, expected] of [
      ['=COUNTIF(A1:A2,"a*b")', 2],
      ['=COUNTIF(A1:A2,"a~*b")', 1],
      ['=SUMIF(A1:A2,"a?b",B1:B2)', 12],
      ['=COUNTIFS(A1:A2,"<>a~*b")', 1],
      ['=MATCH("a?b",A1:A2,0)', 1],
      ['=COUNTIF(A1:A2,"=a\nb")', 1],
    ] as const) {
      sheet.cells.C1 = { value: formula };
      expect(evaluateCell(sheet, 'C1', book)).toBe(expected);
    }
    sheet.cells.A1.value = 'a'.repeat(32767);
    sheet.cells.B1.value = '*' + 'a'.repeat(1000) + 'b';
    sheet.cells.C1.value = '=IFERROR(COUNTIF(A1,B1),"budget")';
    expect(evaluateCell(sheet, 'C1', book)).toBe('budget');
  });
});

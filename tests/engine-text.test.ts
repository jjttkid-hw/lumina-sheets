import { describe, expect, it } from 'vitest';
import { createEvaluator, evaluateCell } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import type { CellValue } from '../src/lib/types';

function evaluate(formula: string, value: CellValue = '') {
  const book = createBlankWorkbook(),
    sheet = book.sheets[0];
  sheet.cells = { A1: { value }, B1: { value: formula } };
  return evaluateCell(sheet, 'B1', book);
}
describe('text extraction and cleanup', () => {
  it.each(['+', '-', '(', ')', ',', ';', '%', ':', '!', '*', '/', '&', '=', '<>'])(
    'treats the quoted operator %s as text in expressions and function arguments',
    (text) => {
      expect(evaluate(`="${text}"`)).toBe(text);
      expect(evaluate(`=CONCAT("${text}","end")`)).toBe(`${text}end`);
      expect(evaluate(`=CONCAT("start","${text}")`)).toBe(`start${text}`);
      expect(evaluate(`=IF(TRUE,"${text}","other")`)).toBe(text);
    },
  );
  it('finds literal case-sensitive text with one-based UTF-16 positions', () => {
    expect(evaluate('=FIND("-",A1)', 'CN-2026-01')).toBe(3);
    expect(evaluate('=FIND("-",A1,4.9)', 'CN-2026-01')).toBe(8);
    expect(evaluate('=FIND("a",A1)', 'ABC')).toBe('#VALUE!');
    expect(evaluate('=FIND("*",A1)', 'a*b')).toBe(2);
    expect(evaluate('=FIND("A",A1)', '😀A')).toBe(3);
    expect(evaluate('=FIND("",A1,2)', 'abc')).toBe(2);
    for (const start of [0, -1, 4, '1e100'])
      expect(evaluate(`=FIND("",A1,${start})`, 'abc')).toBe('#VALUE!');
    expect(evaluate('=FIND("",A1)', '')).toBe('#VALUE!');
  });
  it('replaces a bounded positional slice, supports insertion and appends beyond the end', () => {
    expect(evaluate('=REPLACE(A1,4,4,"2027")', 'CN-2026-01')).toBe('CN-2027-01');
    expect(evaluate('=REPLACE(A1,2.9,1.9,"X")', 'abc')).toBe('aXc');
    expect(evaluate('=REPLACE(A1,2,0,"X")', 'abc')).toBe('aXbc');
    expect(evaluate('=REPLACE(A1,1e100,1e100,"X")', 'abc')).toBe('abcX');
    expect(evaluate('=REPLACE(A1,2,1e100,"X")', 'abc')).toBe('aX');
    expect(evaluate('=REPLACE(A1,0.9,1,"X")', 'abc')).toBe('#VALUE!');
    expect(evaluate('=REPLACE(A1,1,-0.1,"X")', 'abc')).toBe('#VALUE!');
  });
  it('substitutes literal nonoverlapping matches, preserving dollar and wildcard characters', () => {
    expect(evaluate('=SUBSTITUTE(A1,"aa","X")', 'aaaaa')).toBe('XXa');
    expect(evaluate('=SUBSTITUTE(A1,"aa","X",2.9)', 'aaaaa')).toBe('aaXa');
    expect(evaluate('=SUBSTITUTE(A1,"aa","X",3)', 'aaaaa')).toBe('aaaaa');
    expect(evaluate('=SUBSTITUTE(A1,"a","$&")', 'aAa')).toBe('$&A$&');
    expect(evaluate('=SUBSTITUTE(A1,"*","?")', 'a*b*')).toBe('a?b?');
    expect(evaluate('=SUBSTITUTE(A1,"","X")', 'abc')).toBe('abc');
    expect(evaluate('=SUBSTITUTE(A1,"a","")', 'abcab')).toBe('bcb');
    expect(evaluate('=SUBSTITUTE(A1,"a","X",0.9)', 'abc')).toBe('#VALUE!');
  });
  it('bounds replacement output and propagates invalid arguments and upstream errors', () => {
    expect(evaluate('=SUBSTITUTE(A1,"x","xx")', 'x'.repeat(16384))).toBe('#VALUE!');
    expect(evaluate('=REPLACE(A1,1,0,"x")', 'x'.repeat(32767))).toBe('#VALUE!');
    expect(evaluate('=SUBSTITUTE(A1,"x","")', 'x'.repeat(32767))).toBe('');
    expect(evaluate('=REPLACE(A1,1,1,"y")', 'x'.repeat(32767))).toHaveLength(32767);
    expect(evaluate('=FIND(2,123)')).toBe(2);
    expect(evaluate('=SUBSTITUTE(TRUE,"R","r")')).toBe('TrUE');
    for (const formula of ['=FIND("x",1/0)', '=REPLACE("x",1,1,1/0)', '=SUBSTITUTE("x","x",1/0)'])
      expect(evaluate(formula)).toBe('#DIV/0!');
    for (const formula of [
      '=FIND("x")',
      '=FIND("x","x",1,2)',
      '=REPLACE("x",1,1)',
      '=SUBSTITUTE("x","x")',
      '=SUBSTITUTE("x","x","a",1,2)',
    ])
      expect(evaluate(formula)).toBe('#VALUE!');
  });
  it('recalculates and round-trips a lookup/replacement pipeline', async () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: 'CN-2026' },
      B1: { value: '=FIND("-",A1)' },
      C1: { value: '=REPLACE(A1,B1,1,"/")' },
      D1: { value: '=SUBSTITUTE(C1,"CN","中国")' },
    };
    const evaluator = createEvaluator(book, { managedMutations: true });
    expect(evaluator(sheet, 'D1')).toBe('中国/2026');
    sheet.cells.A1.value = 'CN-2027';
    evaluator.invalidateCells(sheet.id, ['A1']);
    expect(evaluator(sheet, 'D1')).toBe('中国/2027');
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[0].cells.D1.value).toBe(sheet.cells.D1.value);
    expect(evaluateCell(restored.sheets[0], 'D1', restored)).toBe('中国/2027');
  });
  it('bounds concatenation at the cell text limit before building oversized results', () => {
    const full = 'a'.repeat(32767);
    expect(evaluate('=A1&""', full)).toBe(full);
    expect(evaluate('=A1&"x"', full)).toBe('#VALUE!');
    for (const name of ['CONCAT', 'CONCATENATE']) {
      expect(evaluate(`=${name}(A1,"")`, full)).toBe(full);
      expect(evaluate(`=${name}(A1,"x")`, full)).toBe('#VALUE!');
      expect(evaluate(`=${name}(A1:A2,"x")`, full)).toBe('#VALUE!');
      expect(evaluate(`=${name}()`)).toBe('#VALUE!');
      expect(evaluate(`=${name}(${Array(256).fill('1').join(',')})`)).toBe('#VALUE!');
      expect(evaluate(`=${name}(${Array(255).fill('1').join(',')})`)).toBe('1'.repeat(255));
    }
  });
  it('contains exponential reference chains and recovers after a source change', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells.A1 = { value: 'x'.repeat(16384) };
    for (let i = 2; i <= 80; i++) sheet.cells[`A${i}`] = { value: `=A${i - 1}&A${i - 1}` };
    sheet.cells.B1 = { value: '=IFERROR(A80,"too long")' };
    const evaluate = createEvaluator(book, { managedMutations: true });
    expect(evaluate(sheet, 'A2')).toBe('#VALUE!');
    expect(evaluate(sheet, 'B1')).toBe('too long');
    sheet.cells.A1.value = '';
    evaluate.invalidateCells(sheet.id, ['A1']);
    expect(evaluate(sheet, 'B1')).toBe('');
  });
  it('checks expanding case conversions and referenced formula output', () => {
    expect(evaluate('=UPPER(A1)', 'ß'.repeat(16384))).toBe('#VALUE!');
    expect(evaluate('=LOWER(A1)', 'İ'.repeat(16384))).toBe('#VALUE!');
    expect(evaluate('=A1', 'x'.repeat(32768))).toBe('#VALUE!');
    expect(evaluate('=LEFT(A1,3)', 'x'.repeat(32768))).toBe('xxx');
  });
  it('trims only ASCII spaces without silently removing significant whitespace', () => {
    expect(evaluate('=TRIM(A1)', '  客户   名称  ')).toBe('客户 名称');
    expect(evaluate('=TRIM(A1)', '\u00a0 A\t B\n\u3000')).toBe('\u00a0 A\t B\n\u3000');
    expect(evaluate('=TRIM(A1)', '     ')).toBe('');
  });
  it('cleans ASCII controls while preserving Unicode characters and DEL', () => {
    const controls = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('');
    expect(evaluate('=CLEAN(A1)', `中${controls}文\u007f\u0085\u00a0😀`)).toBe(
      '中文\u007f\u0085\u00a0😀',
    );
    expect(evaluate('=TRIM(CLEAN(A1))', '  A\r\n  B\t  ')).toBe('A B');
  });
  it.each(['LEFT', 'RIGHT'])('handles %s defaults, zero, large and fractional counts', (name) => {
    expect(evaluate(`=${name}(A1)`, '订单ABC')).toBe(name === 'LEFT' ? '订' : 'C');
    expect(evaluate(`=${name}(A1,2.9)`, '订单ABC')).toBe(name === 'LEFT' ? '订单' : 'BC');
    expect(evaluate(`=${name}(A1,0)`, 'ABC')).toBe('');
    expect(evaluate(`=${name}(A1,1e100)`, 'ABC')).toBe('ABC');
    expect(evaluate(`=${name}(A1,-0.1)`, 'ABC')).toBe('#VALUE!');
    expect(evaluate(`=${name}(A1,2)`, '')).toBe('');
  });
  it('uses one-based MID positions and bounded slice lengths', () => {
    expect(evaluate('=MID(A1,3,4)', 'CN-2026-01')).toBe('-202');
    expect(evaluate('=MID(A1,2.9,2.9)', 'ABCDE')).toBe('BC');
    expect(evaluate('=MID(A1,3,1e100)', 'ABCDE')).toBe('CDE');
    expect(evaluate('=MID(A1,1e100,2)', 'ABCDE')).toBe('');
    expect(evaluate('=MID(A1,1,0)', 'ABCDE')).toBe('');
    expect(evaluate('=MID(A1,0.9,2)', 'ABCDE')).toBe('#VALUE!');
    expect(evaluate('=MID(A1,1,-0.1)', 'ABCDE')).toBe('#VALUE!');
  });
  it('uses UTF-16 code units consistently with the current LEN implementation', () => {
    expect(evaluate('=LEN(A1)', '😀A')).toBe(3);
    expect(evaluate('=LEFT(A1,2)', '😀A')).toBe('😀');
    expect(evaluate('=MID(A1,3,1)', '😀A')).toBe('A');
    expect(evaluate('=RIGHT(A1,2)', 'A😀')).toBe('😀');
  });
  it('coerces scalars and propagates errors while enforcing arity', () => {
    expect(evaluate('=LEFT(A1,2)', 12345)).toBe('12');
    expect(evaluate('=RIGHT(TRUE,2)')).toBe('UE');
    for (const name of ['TRIM', 'CLEAN', 'LEFT', 'RIGHT']) {
      expect(evaluate(`=${name}(1/0)`)).toBe('#DIV/0!');
      expect(evaluate(`=${name}()`)).toBe('#VALUE!');
      expect(evaluate(`=${name}(A1,2,3)`)).toBe('#VALUE!');
    }
    expect(evaluate('=MID(A1,1/0,2)')).toBe('#DIV/0!');
    expect(evaluate('=LEFT(A1,"bad")')).toBe('#VALUE!');
    expect(evaluate('=MID(A1,1)')).toBe('#VALUE!');
  });
  it('updates dependencies and preserves a cleanup/extraction pipeline over XLSX', async () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: '  CN-2026  ' },
      B1: { value: '=TRIM(CLEAN(A1))' },
      C1: { value: '=LEFT(B1,2)&MID(B1,4,4)&RIGHT(B1,2)' },
    };
    const evaluator = createEvaluator(book, { managedMutations: true });
    expect(evaluator(sheet, 'C1')).toBe('CN202626');
    sheet.cells.A1.value = '  US-2027  ';
    evaluator.invalidateCells(sheet.id, ['A1']);
    expect(evaluator(sheet, 'C1')).toBe('US202727');
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[0].cells.C1.value).toBe(sheet.cells.C1.value);
    expect(evaluateCell(restored.sheets[0], 'C1', restored)).toBe('US202727');
  });
});

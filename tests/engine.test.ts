import { describe, expect, it } from 'vitest';
import {
  cellKey,
  columnLabel,
  createEvaluator,
  displayCell,
  evaluateCell,
  parseCellKey,
  translateFormula,
} from '../src/lib/engine';
import { createBlankWorkbook, createDemoWorkbook } from '../src/lib/seed';
import type { CellValue } from '../src/lib/types';

function evaluate(formula: string, values: Record<string, CellValue> = {}) {
  const workbook = createBlankWorkbook();
  const sheet = workbook.sheets[0];
  for (const [key, value] of Object.entries(values)) sheet.cells[key] = { value };
  sheet.cells.Z1 = { value: formula };
  return evaluateCell(sheet, 'Z1', workbook);
}

describe('spreadsheet references', () => {
  it('round trips column labels at boundaries', () => {
    expect(columnLabel(0)).toBe('A');
    expect(columnLabel(25)).toBe('Z');
    expect(columnLabel(26)).toBe('AA');
    expect(columnLabel(16383)).toBe('XFD');
    expect(parseCellKey('$XFD$1048576')).toEqual({ row: 1048575, col: 16383 });
    expect(parseCellKey('XFE1')).toBeNull();
    expect(parseCellKey('A0')).toBeNull();
    expect(cellKey(12, 26)).toBe('AA13');
  });
  it('translates only relative reference coordinates', () => {
    expect(translateFormula('=SUM(A1,$B2,C$3,$D$4)+\'Sheet A1\'!E5+"A1"', 2, 1)).toBe(
      '=SUM(B3,$B4,D$3,$D$4)+\'Sheet A1\'!F7+"A1"',
    );
    expect(translateFormula('=LOG10(A1)+Sheet1!B2', 1, 1)).toBe('=LOG10(B2)+Sheet1!C3');
    expect(translateFormula('=A1', -1, 0)).toBe('=#REF!');
    expect(evaluate(translateFormula('=A1', -1, 0))).toBe('#REF!');
  });
});

describe('safe spreadsheet formula evaluator', () => {
  it('handles operator precedence, percent, comparisons and booleans', () => {
    expect(evaluate('=2+3*4^2')).toBe(50);
    expect(evaluate('=(2+3)*4')).toBe(20);
    expect(evaluate('=25%*200')).toBe(50);
    expect(evaluate('=A1>=20', { A1: 20 })).toBe(true);
    expect(evaluate('=IF(TRUE,12,8)')).toBe(12);
    expect(evaluate('="a"&"b"')).toBe('ab');
  });
  it('computes aggregates over ranges while ignoring text and empty cells', () => {
    const values = { A1: 10, A2: 20, A3: 'text', A5: 0 };
    expect(evaluate('=SUM(A1:A5)', values)).toBe(30);
    expect(evaluate('=AVERAGE(A1:A5)', values)).toBe(10);
    expect(evaluate('=COUNT(A1:A5)', values)).toBe(3);
    expect(evaluate('=COUNTA(A1:A5)', values)).toBe(4);
    expect(evaluate('=MIN(A1:A5)', values)).toBe(0);
    expect(evaluate('=MAX(A1:A5)', values)).toBe(20);
  });
  it('resolves references across Chinese sheets and recalculates dependent cells', () => {
    const workbook = createDemoWorkbook();
    const sheet = workbook.sheets[0];
    const goals = workbook.sheets[1];
    expect(evaluateCell(sheet, 'F2', workbook)).toBe(78000);
    expect(evaluateCell(goals, 'C2', workbook)).toBe(434000);
    sheet.cells.D2.value = 200000;
    const evalCell = createEvaluator(workbook);
    expect(evalCell(sheet, 'F2')).toBe(92000);
    expect(evalCell(goals, 'C2')).toBe(448000);
  });
  it('short circuits conditional branches and catches calculation errors', () => {
    expect(evaluate('=IF(1=1,42,1/0)')).toBe(42);
    expect(evaluate('=IFERROR(1/0,"待填写")')).toBe('待填写');
    expect(evaluate('=1/0')).toBe('#DIV/0!');
    expect(evaluate('=MISSING(A1)')).toBe('#NAME?');
    expect(evaluate("='不存在'!A1")).toBe('#REF!');
    expect(evaluate('=SUM(A1:XFD1048576)')).toBe('#NUM!');
    expect(evaluate('=globalThis.alert("x")')).toBe('#NAME?');
  });
  it('detects direct and indirect cycles', () => {
    expect(evaluate('=Z1+1')).toBe('#CYCLE!');
    expect(evaluate('=A1', { A1: '=B1', B1: '=A1' })).toBe('#CYCLE!');
  });
  it('supports business criteria and table lookups', () => {
    const values = { A1: '云端协作', A2: '企业服务', A3: '云端协作', B1: 100, B2: 200, B3: 300 };
    expect(evaluate('=SUMIF(A1:A3,"云*",B1:B3)', values)).toBe(400);
    expect(evaluate('=COUNTIF(B1:B3,">=200")', values)).toBe(2);
    expect(evaluate('=VLOOKUP("企业服务",A1:B3,2,FALSE)', values)).toBe(200);
    expect(evaluate('=VLOOKUP("不存在",A1:B3,2,FALSE)', values)).toBe('#N/A');
    expect(
      evaluate('=VLOOKUP(15,A1:B3,2,TRUE)', { A1: 0, A2: 10, A3: 20, B1: 1, B2: 2, B3: 3 }),
    ).toBe(2);
  });
  it('supports text, rounding, absolute values and dates', () => {
    expect(evaluate('=CONCAT(UPPER("abc"),LOWER("DEF"),LEN("你好"))')).toBe('ABCdef2');
    expect(evaluate('=ROUND(-1.25,1)')).toBe(-1.3);
    expect(evaluate('=ROUND(1.005,2)')).toBe(1.01);
    expect(evaluate('=ABS(-12)')).toBe(12);
    const today = evaluate('=TODAY()');
    expect(typeof today).toBe('number');
    expect(today).toBeGreaterThan(45000);
    expect(displayCell({ value: 0.356, style: { format: 'percent' } })).toBe('35.6%');
  });
});

describe('incremental evaluator cache', () => {
  it('invalidates only dependent formulas after a mutable edit', () => {
    const workbook = createBlankWorkbook();
    const sheet = workbook.sheets[0];
    sheet.cells.A1 = { value: 2 };
    sheet.cells.B1 = { value: '=A1*2' };
    sheet.cells.C1 = { value: '=B1+1' };
    sheet.cells.D1 = { value: '=999' };
    const evaluate = createEvaluator(workbook);
    expect(evaluate(sheet, 'C1')).toBe(5);
    expect(evaluate(sheet, 'D1')).toBe(999);
    sheet.cells.A1.value = 10;
    expect(evaluate(sheet, 'C1')).toBe(21);
    expect(evaluate(sheet, 'D1')).toBe(999);
  });

  it('supports explicit batch revision invalidation', () => {
    const workbook = createBlankWorkbook();
    const sheet = workbook.sheets[0];
    sheet.cells.A1 = { value: 3 };
    sheet.cells.B1 = { value: '=A1+1' };
    const evaluate = createEvaluator(workbook, { revision: 1 });
    expect(evaluate(sheet, 'B1')).toBe(4);
    sheet.cells.A1.value = 8;
    evaluate.invalidate(2);
    expect(evaluate(sheet, 'B1')).toBe(9);
    expect(evaluate.revision).toBe(2);
  });
});

describe('cached formula errors', () => {
  it('keeps IFERROR stable across cache validation passes', () => {
    const workbook = createBlankWorkbook();
    const sheet = workbook.sheets[0];
    sheet.cells.A1 = { value: '=1/0' };
    sheet.cells.B1 = { value: '=IFERROR(A1,"ok")' };
    const evaluate = createEvaluator(workbook);
    expect(evaluate(sheet, 'B1')).toBe('ok');
    expect(evaluate(sheet, 'B1')).toBe('ok');
  });
});

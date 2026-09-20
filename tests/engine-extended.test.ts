import { describe, expect, it } from 'vitest';
import { createEvaluator, displayCell, evaluateCell } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import type { CellValue } from '../src/lib/types';

function evaluate(formula: string, values: Record<string, CellValue> = {}) {
  const workbook = createBlankWorkbook();
  const sheet = workbook.sheets[0];
  for (const [key, value] of Object.entries(values)) sheet.cells[key] = { value };
  sheet.cells.Z1 = { value: formula };
  return evaluateCell(sheet, 'Z1', workbook);
}

describe('commercial report formulas', () => {
  it('evaluates boolean functions and handles text criteria', () => {
    expect(evaluate('=AND(TRUE,1,"TRUE")')).toBe(true);
    expect(evaluate('=OR(FALSE,0,2)')).toBe(true);
    expect(evaluate('=NOT(0)')).toBe(true);
    expect(evaluate('=IF("FALSE",1,2)')).toBe(2);
    expect(
      evaluate('=COUNTIFS(A1:A4,"完成",B1:B4,">=10")', {
        A1: '完成',
        A2: '待办',
        A3: '完成',
        A4: '完成',
        B1: 10,
        B2: 99,
        B3: 9,
        B4: 20,
      }),
    ).toBe(2);
    expect(
      evaluate('=SUMIFS(B1:B4,A1:A4,"完成")', {
        A1: '完成',
        A2: '待办',
        A3: '完成',
        A4: '完成',
        B1: 10,
        B2: 99,
        B3: 9,
        B4: 20,
      }),
    ).toBe(39);
  });

  it('supports lookup combinations used by report templates', () => {
    const values = { A1: 'A', A2: 'B', A3: 'C', B1: 100, B2: 200, B3: 300 };
    expect(evaluate('=INDEX(B1:B3,MATCH("B",A1:A3,0))', values)).toBe(200);
    expect(evaluate('=XLOOKUP("C",A1:A3,B1:B3,"未找到")', values)).toBe(300);
    expect(evaluate('=XLOOKUP("X",A1:A3,B1:B3,"未找到")', values)).toBe('未找到');
    expect(
      evaluate('=XLOOKUP(25,A1:A3,B1:B3,"",1)', { A1: 10, A2: 20, A3: 30, B1: 1, B2: 2, B3: 3 }),
    ).toBe(3);
  });

  it('supports SUMPRODUCT weighted totals and explicit conditional masks', () => {
    expect(
      evaluate('=SUMPRODUCT(A1:A3,B1:B3)', {
        A1: 2,
        A2: 3,
        A3: 4,
        B1: 10,
        B2: 20,
        B3: 30,
      }),
    ).toBe(200);
    expect(
      evaluate('=SUMPRODUCT(A1:A3,B1:B3)', {
        A1: true,
        A2: false,
        A3: true,
        B1: 10,
        B2: 20,
        B3: 30,
      }),
    ).toBe(0);
    expect(
      evaluate('=SUMPRODUCT(A1:A3,B1:B3)', {
        A1: '2',
        A2: '',
        B1: 10,
        B2: 20,
        B3: 30,
      }),
    ).toBe(0);
    expect(
      evaluate('=SUMPRODUCT((A1:A3="完成")*B1:B3)', {
        A1: '完成',
        A2: '待办',
        A3: '完成',
        B1: 10,
        B2: 20,
        B3: 30,
      }),
    ).toBe(40);
    expect(
      evaluate('=SUMPRODUCT(--(A1:A3="完成"),B1:B3)', {
        A1: '完成',
        A2: '待办',
        A3: '完成',
        B1: 10,
        B2: 20,
        B3: 30,
      }),
    ).toBe(40);
    expect(evaluate('=SUMPRODUCT(A1:A2*1,B1:B2)', { A1: '2', A2: true, B1: 10, B2: 20 })).toBe(40);
    expect(
      evaluate('=SUMPRODUCT(A1:B2,C1:D2)', {
        A1: 1,
        B1: 2,
        A2: 3,
        B2: 4,
        C1: 5,
        D1: 6,
        C2: 7,
        D2: 8,
      }),
    ).toBe(70);
    expect(evaluate('=SUMPRODUCT(A1:A3)', { A1: 1, A2: 2, A3: 3 })).toBe(6);
    expect(evaluate('=SUMPRODUCT(2,3,4)')).toBe(24);
    expect(evaluate('=SUMPRODUCT("2",3)')).toBe(0);
    expect(evaluate(`=SUMPRODUCT(${Array(255).fill('1').join(',')})`)).toBe(1);
  });

  it('bounds SUMPRODUCT shapes, propagates errors and leaves normal formulas scalar', () => {
    expect(evaluate('=SUMPRODUCT(A1:A2,B1:B3)', { A1: 1, A2: 2, B1: 1, B2: 2, B3: 3 })).toBe(
      '#VALUE!',
    );
    expect(evaluate('=SUMPRODUCT(A1:A2,2)', { A1: 1, A2: 2 })).toBe('#VALUE!');
    expect(evaluate('=SUMPRODUCT(A1:A2,B1:B2)', { A1: 'text', A2: 2, B1: 1, B2: 1 })).toBe(2);
    expect(evaluate('=SUMPRODUCT(A1:A2*B1:B2)', { A1: 'text', A2: 2, B1: 1, B2: 1 })).toBe(
      '#VALUE!',
    );
    expect(evaluate('=SUMPRODUCT(A1:A2,B1:B2)', { A1: '=1/0', B1: 0 })).toBe('#DIV/0!');
    expect(evaluate('=SUMPRODUCT(A1:A2/(B1:B2))', { A1: 1, A2: 2, B1: 1, B2: 0 })).toBe('#DIV/0!');
    expect(evaluate('=SUMPRODUCT(A1:A2*C1:D1)', { A1: 1, A2: 2, C1: 1, D1: 2 })).toBe('#VALUE!');
    expect(evaluate('=SUM(A1:A2*B1:B2)', { A1: 1, A2: 2, B1: 3, B2: 4 })).toBe(3);
    expect(evaluate('=SUMPRODUCT(A1:B2,C1:C4)')).toBe('#VALUE!');
    expect(evaluate('=SUMPRODUCT(A1:A100000)', { A1: 2, A100000: 3 })).toBe(5);
    expect(evaluate('=SUMPRODUCT(A1:A100001,B1:B100001)')).toBe('#NUM!');
    expect(evaluate('=SUMPRODUCT(A1:A3,B1:B3)', { A1: 1, A2: 2, A3: 3, B1: 1, B2: 2, B3: 3 })).toBe(
      14,
    );
    expect(
      evaluate('=SUMPRODUCT(A1:A3,B1:B3)', {
        A1: 1e308,
        A2: 1e308,
        A3: 1,
        B1: 1e308,
        B2: 1e308,
        B3: 1,
      }),
    ).toBe('#NUM!');
    expect(evaluate('=SUMPRODUCT()')).toBe('#VALUE!');
    expect(evaluate(`=SUMPRODUCT(${Array(256).fill('1').join(',')})`)).toBe('#VALUE!');
  });

  it('invalidates SUMPRODUCT condition and value ranges across sheets', () => {
    const workbook = createBlankWorkbook();
    const input = workbook.sheets[0];
    input.name = 'Data';
    input.cells = {
      A1: { value: '完成' },
      A2: { value: '待办' },
      B1: { value: 10 },
      B2: { value: 20 },
    };
    const output = {
      ...input,
      id: 'output',
      name: 'Output',
      cells: { A1: { value: '=SUMPRODUCT((Data!A1:A2="完成")*Data!B1:B2)' } },
    };
    workbook.sheets.push(output);
    const evaluate = createEvaluator(workbook, { managedMutations: true });
    expect(evaluate(output, 'A1')).toBe(10);
    input.cells.A2.value = '完成';
    evaluate.invalidateCells(input.id, ['A2']);
    expect(evaluate(output, 'A1')).toBe(30);
    input.cells.B2.value = 50;
    evaluate.invalidateCells(input.id, ['B2']);
    expect(evaluate(output, 'A1')).toBe(60);
  });

  it('does not leak array arithmetic into referenced formula cells or scalar caches', () => {
    const workbook = createBlankWorkbook();
    const sheet = workbook.sheets[0];
    sheet.cells = {
      A1: { value: 1 },
      A2: { value: 2 },
      B1: { value: 3 },
      B2: { value: 4 },
      C1: { value: '=A1:A2*B1:B2' },
      D1: { value: '=SUMPRODUCT(A1:A2*B1:B2)' },
      E1: { value: '=SUMPRODUCT(C1,2)' },
    };
    const evaluate = createEvaluator(workbook, { managedMutations: true });
    expect(evaluate(sheet, 'D1')).toBe(11);
    expect(evaluate(sheet, 'C1')).toBe(3);
    expect(evaluate(sheet, 'E1')).toBe(6);
    expect(evaluate(sheet, 'D1')).toBe(11);
    expect(evaluate(sheet, 'C1')).toBe(3);
  });

  it('rounds with Excel direction semantics, including negative numbers', () => {
    expect(evaluate('=ROUNDUP(1.21,1)')).toBe(1.3);
    expect(evaluate('=ROUNDUP(-1.21,1)')).toBe(-1.3);
    expect(evaluate('=ROUNDDOWN(1.29,1)')).toBe(1.2);
    expect(evaluate('=ROUNDDOWN(-1.29,1)')).toBe(-1.2);
    expect(evaluate('=ROUND(1234,-2)')).toBe(1200);
  });

  it('supports MOD and INT for report period and bucket calculations', () => {
    expect(evaluate('=MOD(10,3)')).toBe(1);
    expect(evaluate('=MOD(-10,3)')).toBe(2);
    expect(evaluate('=MOD(10,-3)')).toBe(-2);
    expect(evaluate('=MOD(-10,-3)')).toBe(-1);
    expect(evaluate('=MOD(5.5,2)')).toBe(1.5);
    expect(evaluate('=MOD("10",3)')).toBe(1);
    expect(evaluate('=MOD(1,0)')).toBe('#DIV/0!');
    expect(evaluate('=INT(3.9)')).toBe(3);
    expect(evaluate('=INT(-3.1)')).toBe(-4);
    expect(evaluate('=INT("4.9")')).toBe(4);
    expect(evaluate('=INT("not a number")')).toBe('#VALUE!');
    expect(evaluate('=MOD(1)')).toBe('#VALUE!');
  });

  it('supports serial date creation and extraction', () => {
    expect(evaluate('=DATE(2024,2,29)')).toBe(45351);
    expect(evaluate('=YEAR(DATE(2024,2,29))')).toBe(2024);
    expect(evaluate('=MONTH(DATE(2024,2,29))')).toBe(2);
    expect(evaluate('=DAY(DATE(2024,2,29))')).toBe(29);
    expect(evaluate('=DAYS(DATE(2024,3,1),DATE(2024,2,29))')).toBe(1);
    expect(evaluate('=EOMONTH(DATE(2024,2,12),1)')).toBe(45382);
  });
});

describe('formula compatibility boundaries', () => {
  it('propagates all AND/OR argument errors and ignores text in ranges', () => {
    expect(evaluate('=AND(FALSE,1/0)')).toBe('#DIV/0!');
    expect(evaluate('=OR(TRUE,1/0)')).toBe('#DIV/0!');
    expect(evaluate('=AND(A1:A4)', { A1: 'ignored', A2: true, A4: 4 })).toBe(true);
    expect(evaluate('=OR(A1:A4)', { A1: 'TRUE', A2: false, A4: 0 })).toBe(false);
    expect(evaluate('=AND(A1:A2)', { A1: 'TRUE' })).toBe('#VALUE!');
    expect(evaluate('=OR(A1:A2)')).toBe('#VALUE!');
    expect(evaluate('=AND(TRUE,"nonsense")')).toBe('#VALUE!');
    expect(evaluate('=OR(FALSE,"false")')).toBe(false);
    expect(evaluate('=NOT("nonsense")')).toBe('#VALUE!');
    expect(evaluate('=IF("nonsense",1,2)')).toBe('#VALUE!');
  });

  it('requires criteria ranges to have the same two-dimensional shape', () => {
    const values = { A1: 1, A2: 1, B1: 2, B2: 2, C1: 1, D1: 1 };
    expect(evaluate('=COUNTIFS(A1:A2,1,C1:D1,1)', values)).toBe('#VALUE!');
    expect(evaluate('=SUMIFS(A1:A2,C1:D1,1)', values)).toBe('#VALUE!');
    expect(evaluate('=COUNTIFS(A1:B2,">0",A1:B2,"<3")', values)).toBe(4);
    expect(evaluate('=SUMIFS(A1:B2,A1:B2,">0")', values)).toBe(6);
    expect(evaluate('=COUNTIFS(A1:A2,1,A1:A2)', values)).toBe('#VALUE!');
  });

  it('selects nearest XLOOKUP candidates in unsorted data in either direction', () => {
    const values = {
      A1: 30,
      A2: 10,
      A3: 20,
      A4: 20,
      B1: 'thirty',
      B2: 'ten',
      B3: 'first twenty',
      B4: 'last twenty',
    };
    expect(evaluate('=XLOOKUP(20,A1:A4,B1:B4,"missing",0,1)', values)).toBe('first twenty');
    expect(evaluate('=XLOOKUP(20,A1:A4,B1:B4,"missing",0,-1)', values)).toBe('last twenty');
    expect(evaluate('=XLOOKUP(15,A1:A4,B1:B4,"missing",1,1)', values)).toBe('first twenty');
    expect(evaluate('=XLOOKUP(15,A1:A4,B1:B4,"missing",1,-1)', values)).toBe('last twenty');
    expect(evaluate('=XLOOKUP(25,A1:A4,B1:B4,"missing",-1,1)', values)).toBe('first twenty');
    expect(evaluate('=XLOOKUP(25,A1:A4,B1:B4,"missing",-1,-1)', values)).toBe('last twenty');
    expect(evaluate('=XLOOKUP(5,A1:A4,B1:B4,"missing",-1)', values)).toBe('missing');
    expect(evaluate('=XLOOKUP(35,A1:A4,B1:B4,"missing",1)', values)).toBe('missing');
  });

  it('evaluates XLOOKUP fallback lazily and rejects unsupported modes and shapes', () => {
    const values = { A1: 1, A2: 2, B1: 'a', B2: 'b', C1: 'c', D1: 'd' };
    expect(evaluate('=XLOOKUP(1,A1:A2,B1:B2,1/0)', values)).toBe('a');
    expect(evaluate('=XLOOKUP(3,A1:A2,B1:B2,1/0)', values)).toBe('#DIV/0!');
    expect(evaluate('=XLOOKUP(3,A1:A2,B1:B2)', values)).toBe('#N/A');
    expect(evaluate('=XLOOKUP(1,A1:A2,B1:B2,"",0,2)', values)).toBe('#VALUE!');
    expect(evaluate('=XLOOKUP(1,A1:A2,B1:B2,"",0,-2)', values)).toBe('#VALUE!');
    expect(evaluate('=XLOOKUP(1,A1:A2,B1:B2,"",2)', values)).toBe('#VALUE!');
    expect(evaluate('=XLOOKUP(1,A1:A2,C1:D1)', values)).toBe('#VALUE!');
    expect(evaluate('=XLOOKUP(1,A1:B2,A1:B2)', values)).toBe('#VALUE!');
  });

  it('supports horizontal INDEX and exact MATCH wildcards with escapes', () => {
    const values = { A1: 'alpha', B1: 'a*b', C1: 'beta', A2: 10, B2: 20, C2: 30 };
    expect(evaluate('=INDEX(A1:C1,2)', values)).toBe('a*b');
    expect(evaluate('=INDEX(A1:C1,4)', values)).toBe('#REF!');
    expect(evaluate('=MATCH("a*",A1:C1,0)', values)).toBe(1);
    expect(evaluate('=MATCH("a~*b",A1:C1,0)', values)).toBe(2);
    expect(evaluate('=MATCH("?eta",A1:C1,0)', values)).toBe(3);
    expect(evaluate('=MATCH("alpha",A1:C2,0)', values)).toBe('#VALUE!');
  });

  it('preserves the Excel 1900 leap-year compatibility date', () => {
    expect(evaluate('=DATE(1900,1,1)')).toBe(1);
    expect(evaluate('=DATE(1900,2,28)')).toBe(59);
    expect(evaluate('=DATE(1900,2,29)')).toBe(60);
    expect(evaluate('=DATE(1900,3,1)')).toBe(61);
    expect(evaluate('=DATE(1900,3,0)')).toBe(60);
    expect(evaluate('=YEAR(60)')).toBe(1900);
    expect(evaluate('=MONTH(60)')).toBe(2);
    expect(evaluate('=DAY(60)')).toBe(29);
    expect(evaluate('=EOMONTH(59,0)')).toBe(60);
    expect(evaluate('=DATEVALUE("1900-02-29")')).toBe(60);
    expect(displayCell({ value: 60, style: { format: 'date' } })).toBe('1900-02-29');
  });

  it('uses strict timezone-independent ISO dates and rejects invalid dates', () => {
    expect(evaluate('=DATEVALUE("2024-02-29")')).toBe(45351);
    expect(evaluate('=DATEVALUE("2023-02-29")')).toBe('#VALUE!');
    expect(evaluate('=DATEVALUE("2024-04-31")')).toBe('#VALUE!');
    expect(evaluate('=DATEVALUE("2024-13-01")')).toBe('#VALUE!');
    expect(evaluate('=DATEVALUE("02/03/2024")')).toBe('#VALUE!');
    expect(evaluate('=DATEVALUE("2024-02-29T23:00:00-08:00")')).toBe('#VALUE!');
    expect(evaluate('=DATEVALUE("9999-12-31")')).toBe(2958465);
    expect(evaluate('=YEAR(-1)')).toBe('#NUM!');
    expect(evaluate('=DATE(10000,1,1)')).toBe('#NUM!');
    expect(evaluate('=EOMONTH(DATE(9999,12,1),1)')).toBe('#NUM!');
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FORMULA_HELP, leadingFormulaHelp } from '../src/lib/formula-help';

describe('formula help', () => {
  it('covers exactly the functions dispatched by the evaluator', () => {
    const engine = readFileSync('src/lib/engine.ts', 'utf8');
    const functions = [...engine.matchAll(/case '([A-Z][A-Z0-9_]*)':/g)].map((match) => match[1]);
    const names = FORMULA_HELP.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...new Set(functions)].sort());
  });
  it('describes the leading function without confusing strings, nested calls or sheet names', () => {
    expect(leadingFormulaHelp('= nper (')).toMatchObject({ name: 'NPER' });
    expect(leadingFormulaHelp('=TRIM(CLEAN(A1))')).toMatchObject({ name: 'TRIM' });
    for (const text of ['SUM(', '=SUM', '=UNKNOWN(', '="SUM("', "='SUM'!A1", '=A1+SUM('])
      expect(leadingFormulaHelp(text)).toBeUndefined();
    expect(leadingFormulaHelp('=TODAY()')?.syntax).toBe('TODAY()');
  });
});

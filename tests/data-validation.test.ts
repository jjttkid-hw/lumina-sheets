import { describe, expect, it, vi } from 'vitest';
import {
  checkValue,
  copyDataValidationRules,
  DATA_VALIDATION_LIMITS,
  DataValidationRuleError,
  type DataValidationRule,
  type ValidationOperator,
} from '../src/lib/data-validation';
import { createBlankWorkbook } from '../src/lib/seed';
import { createEvaluator } from '../src/lib/engine';

const range = { start: { row: 0, col: 0 }, end: { row: 9, col: 2 } };
const rule = (overrides: Record<string, unknown> = {}) => ({
  id: 'quantity',
  kind: 'whole',
  range,
  operator: 'between',
  min: 0,
  max: 100,
  ...overrides,
});
const failures = (value: string | number | boolean, input: unknown = [rule()]) =>
  checkValue('sales', 'A1', value, copyDataValidationRules(input));

describe('strict data-validation configuration', () => {
  it('copies nested input and normalizes blank behavior without expanding large ranges', () => {
    const source = [
      {
        id: 'choices',
        kind: 'list',
        range: { start: { row: 0, col: 0 }, end: { row: 1_048_575, col: 16_383 } },
        values: ['原值', 0, false],
      },
    ];
    const rules = copyDataValidationRules(source);
    source[0].values[0] = 'mutated';
    source[0].range.start.row = 100;
    expect(rules).toHaveLength(1);
    expect(rules[0].allowBlank).toBe(true);
    expect(checkValue('sheet', '$XFD$1048576', 0, rules)).toEqual([]);
    expect(checkValue('sheet', 'A1', '原值', rules)).toEqual([]);
    const second = copyDataValidationRules(rules);
    second[0].range.start.row = 1;
    expect(rules[0].range.start.row).toBe(0);
  });

  it.each([
    null,
    {},
    Array(1),
    [rule({ id: '' })],
    [rule(), rule()],
    [rule({ kind: 'unknown' })],
    [rule({ allowBlank: 'true' })],
    [rule({ min: 2, max: 1 })],
    [rule({ min: 0.5 })],
    [rule({ max: Infinity })],
    [rule({ formula: '=RUN()' })],
    [rule({ range: { start: { row: 0, col: 0 }, end: { row: 1_048_576, col: 1 } } })],
    [rule({ range: { start: { row: 2, col: 0 }, end: { row: 1, col: 1 } } })],
    [rule({ range: { start: { row: 0, col: 0, extra: 1 }, end: { row: 1, col: 1 } } })],
    [rule({ message: 'x'.repeat(501) })],
    [{ id: 'list', kind: 'list', range, values: [] }],
    [{ id: 'list', kind: 'list', range, values: Array(1) }],
    [{ id: 'list', kind: 'list', range, values: [null] }],
    [{ id: 'list', kind: 'list', range, values: ['x'.repeat(32768)] }],
    [{ id: 'list', kind: 'list', range, values: [1], operator: 'equal' }],
    [rule({ kind: 'textLength', min: -1 })],
    [rule({ kind: 'textLength', max: 32768 })],
    [{ id: 'bad', kind: 'decimal', range, operator: 'equal', min: 1 }],
  ])('rejects invalid or ambiguous rule input %j', (input) => {
    expect(() => copyDataValidationRules(input)).toThrow(DataValidationRuleError);
  });

  it('bounds rules and list allocations with a useful error path', () => {
    expect(() =>
      copyDataValidationRules(Array.from({ length: 1001 }, (_, i) => rule({ id: `r${i}` }))),
    ).toThrow('rules:');
    expect(() =>
      copyDataValidationRules([{ id: 'list', kind: 'list', range, values: Array(1001).fill(1) }]),
    ).toThrow('rules[0].values');
    expect(() =>
      copyDataValidationRules(
        Array.from({ length: 101 }, (_, i) => ({
          id: `l${i}`,
          kind: 'list',
          range,
          values: Array(1000).fill(1),
        })),
      ),
    ).toThrow('100000');
    expect(DATA_VALIDATION_LIMITS.rules).toBe(1000);
  });
});

describe('computed value validation', () => {
  it('uses strict scalar types: blank, false, zero, and numeric text are distinct', () => {
    expect(failures('')).toEqual([]);
    expect(failures('', [rule({ allowBlank: false })])[0].code).toBe('BLANK_NOT_ALLOWED');
    expect(failures(0)).toEqual([]);
    expect(failures(false)[0].code).toBe('TYPE_MISMATCH');
    expect(failures('10')[0].code).toBe('TYPE_MISMATCH');
    expect(failures(1.5)[0].code).toBe('TYPE_MISMATCH');
    expect(failures(1.5, [rule({ kind: 'decimal' })])).toEqual([]);
    expect(failures('1.5', [rule({ kind: 'decimal' })])[0].code).toBe('TYPE_MISMATCH');
  });

  it('matches list items by exact type and case and applies blank policy first', () => {
    const input = [
      { id: 'list', kind: 'list', range, values: [0, false, 'Yes', ''], allowBlank: false },
    ];
    expect(failures(0, input)).toEqual([]);
    expect(failures(false, input)).toEqual([]);
    expect(failures('Yes', input)).toEqual([]);
    expect(failures('0', input)[0].code).toBe('NOT_IN_LIST');
    expect(failures('yes', input)[0].code).toBe('NOT_IN_LIST');
    expect(failures('', input)[0].code).toBe('BLANK_NOT_ALLOWED');
  });

  it.each<
    [
      { operator: ValidationOperator; min?: number; max?: number; value?: number },
      number[],
      number[],
    ]
  >([
    [{ operator: 'between', min: 1, max: 3 }, [1, 2, 3], [0, 4]],
    [{ operator: 'notBetween', min: 1, max: 3 }, [0, 4], [1, 2, 3]],
    [{ operator: 'equal', value: 2 }, [2], [1, 3]],
    [{ operator: 'notEqual', value: 2 }, [1, 3], [2]],
    [{ operator: 'greaterThan', value: 2 }, [3], [1, 2]],
    [{ operator: 'greaterThanOrEqual', value: 2 }, [2, 3], [1]],
    [{ operator: 'lessThan', value: 2 }, [1], [2, 3]],
    [{ operator: 'lessThanOrEqual', value: 2 }, [1, 2], [3]],
  ])('honors numeric operator and exact boundary %j', (comparison, accepted, rejected) => {
    const rules = copyDataValidationRules([
      { id: 'comparison', kind: 'decimal', range, ...comparison },
    ]);
    accepted.forEach((value) => expect(checkValue('sheet', 'A1', value, rules)).toEqual([]));
    rejected.forEach((value) =>
      expect(checkValue('sheet', 'A1', value, rules)[0].code).toBe('OUT_OF_RANGE'),
    );
  });

  it('counts text Unicode code points, does not coerce numbers, and preserves combining marks', () => {
    const input = [{ id: 'length', kind: 'textLength', range, operator: 'equal', value: 2 }];
    expect(failures('中文', input)).toEqual([]);
    expect(failures('😀中', input)).toEqual([]);
    expect(failures('e\u0301', input)).toEqual([]);
    expect(failures('é', input)[0].code).toBe('OUT_OF_RANGE');
    expect(failures(12, input)[0].code).toBe('TYPE_MISMATCH');
    expect(failures('👨‍👩‍👧‍👦', input)[0].code).toBe('OUT_OF_RANGE');
  });

  it('iterates a text value once for 1,000 overlapping length rules and preserves every ordered failure', () => {
    const target = `${'😀'.repeat(4096)}e\u0301中`;
    const codePointLength = 4099;
    const rules = copyDataValidationRules(
      Array.from({ length: 1000 }, (_, i) => ({
        id: `length-${i}`,
        kind: 'textLength',
        range,
        operator: i % 2 ? 'equal' : 'lessThan',
        value: codePointLength,
        message: `长度规则 ${i}`,
      })),
    );
    const originalIterator = String.prototype[Symbol.iterator];
    let targetTraversals = 0;
    const spy = vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(function (
      this: string,
    ) {
      if (String(this) === target) targetTraversals++;
      return originalIterator.call(this);
    });
    try {
      const result = checkValue('sales', 'A1', target, rules);
      expect(targetTraversals).toBe(1);
      expect(result).toEqual(
        Array.from({ length: 500 }, (_, i) => ({
          ruleId: `length-${i * 2}`,
          sheetId: 'sales',
          key: 'A1',
          kind: 'textLength',
          code: 'OUT_OF_RANGE',
          message: `长度规则 ${i * 2}`,
          value: target,
        })),
      );
      expect(checkValue('sales', 'A1', target, rules)).toEqual(result);
      expect(targetTraversals).toBe(2);
      expect(checkValue('sales', 'A1', '😀中', rules)).toHaveLength(500);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not scan text when no applicable length rule needs it', () => {
    const target = '😀e\u0301';
    const rules = copyDataValidationRules([
      { id: 'list', kind: 'list', range, values: [target] },
      rule({ id: 'number' }),
      rule({ id: 'other-sheet', kind: 'textLength', sheetId: 'other' }),
      rule({
        id: 'other-range',
        kind: 'textLength',
        range: { start: { row: 10, col: 0 }, end: { row: 20, col: 0 } },
      }),
    ]);
    const originalIterator = String.prototype[Symbol.iterator];
    let targetTraversals = 0;
    const spy = vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(function (
      this: string,
    ) {
      if (String(this) === target) targetTraversals++;
      return originalIterator.call(this);
    });
    try {
      expect(checkValue('sales', 'A1', target, rules)).toEqual([
        expect.objectContaining({ ruleId: 'number', code: 'TYPE_MISMATCH' }),
      ]);
      expect(targetTraversals).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps blank policy and non-string type failures for overlapping length rules', () => {
    const rules = copyDataValidationRules([
      rule({ id: 'optional', kind: 'textLength' }),
      rule({ id: 'required-a', kind: 'textLength', allowBlank: false }),
      rule({ id: 'required-b', kind: 'textLength', allowBlank: false }),
    ]);
    expect(checkValue('sales', 'A1', '', rules)).toEqual([
      expect.objectContaining({ ruleId: 'required-a', code: 'BLANK_NOT_ALLOWED' }),
      expect.objectContaining({ ruleId: 'required-b', code: 'BLANK_NOT_ALLOWED' }),
    ]);
    for (const value of [0, false])
      expect(checkValue('sales', 'A1', value, rules)).toEqual(
        rules.map((rule) =>
          expect.objectContaining({ ruleId: rule.id, code: 'TYPE_MISMATCH', value }),
        ),
      );
  });

  it('applies all overlapping rules, preserves messages, and filters by sheet and range', () => {
    const rules = copyDataValidationRules([
      rule({ id: 'a', sheetId: 'sales', min: 1, max: 3, message: '数量只能是 1 到 3' }),
      { id: 'b', kind: 'list', range, values: [2] },
      rule({ id: 'other-sheet', sheetId: 'other', min: 1, max: 2 }),
    ]);
    expect(checkValue('sales', '$a$1', 9, rules)).toEqual([
      {
        ruleId: 'a',
        sheetId: 'sales',
        key: 'A1',
        kind: 'whole',
        code: 'OUT_OF_RANGE',
        message: '数量只能是 1 到 3',
        value: 9,
      },
      {
        ruleId: 'b',
        sheetId: 'sales',
        key: 'A1',
        kind: 'list',
        code: 'NOT_IN_LIST',
        message: '单元格值不在允许的选项中。',
        value: 9,
      },
    ]);
    expect(checkValue('sales', 'D1', 9, rules)).toEqual([]);
    expect(checkValue('other', 'A1', 2, rules)).toEqual([]);
    expect(checkValue('sales', 'A11', 9, rules)).toEqual([]);
  });

  it('checks evaluated formulas rather than executing source formulas itself', () => {
    const workbook = createBlankWorkbook();
    workbook.sheets[0].cells = { A1: { value: 2 }, B1: { value: '=A1*3' }, C1: { value: '=A1/0' } };
    const evaluate = createEvaluator(workbook);
    const rules = copyDataValidationRules([rule({ min: 0, max: 10 })]);
    expect(
      checkValue(workbook.activeSheetId, 'B1', evaluate(workbook.sheets[0], 'B1'), rules),
    ).toEqual([]);
    expect(
      checkValue(workbook.activeSheetId, 'C1', evaluate(workbook.sheets[0], 'C1'), rules)[0].code,
    ).toBe('TYPE_MISMATCH');
    expect(checkValue(workbook.activeSheetId, 'B1', '=A1*3', rules)[0].code).toBe('TYPE_MISMATCH');
  });

  it('rejects invalid coordinates and unsupported scalar payloads explicitly', () => {
    expect(() => checkValue('sheet', 'XFE1', 1, [])).toThrow(RangeError);
    expect(() => checkValue('sheet', 'A1', Infinity, [])).toThrow(DataValidationRuleError);
    expect(() => checkValue('sheet', 'A1', null as never, [])).toThrow(DataValidationRuleError);
    expect(() => checkValue('', 'A1', 1, [])).toThrow(TypeError);
  });
});

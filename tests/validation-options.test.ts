import { describe, expect, it } from 'vitest';
import {
  checkValue,
  copyDataValidationRules,
  DATA_VALIDATION_LIMITS,
  type DataValidationRule,
} from '../src/lib/data-validation';
import type { CellRange, CellValue } from '../src/lib/types';
import {
  getValidationOptions,
  isValidationOption,
  validationOptionLabel,
  validationOptionType,
} from '../src/lib/validation-options';

const range = (): CellRange => ({ start: { row: 1, col: 1 }, end: { row: 5, col: 3 } });
const list = (id: string, values: CellValue[]): DataValidationRule => ({
  id,
  kind: 'list',
  values,
  range: range(),
});
const numeric = (id = 'whole'): Exclude<DataValidationRule, { kind: 'list' }> => ({
  id,
  kind: 'whole',
  operator: 'between',
  min: 1,
  max: 5,
  range: range(),
});

describe('validation list options', () => {
  it('returns null when no matching list exists, including numeric-only validation', () => {
    expect(getValidationOptions('sheet', 'B2', [])).toBeNull();
    expect(getValidationOptions('sheet', 'B2', [numeric()])).toBeNull();
    expect(getValidationOptions('sheet', 'A1', [list('list', ['x'])])).toBeNull();
    expect(
      getValidationOptions('sheet', 'B2', [{ ...list('list', ['x']), sheetId: 'other' }]),
    ).toBeNull();
  });

  it('returns a fresh empty result when overlapping lists have no common option', () => {
    const rules = [list('first', [1]), list('second', ['1'])];
    expect(getValidationOptions('sheet', 'B2', rules)).toEqual({
      values: [],
      unsupportedFormulaCount: 0,
    });
    expect(getValidationOptions('sheet', 'B2', rules)?.values).not.toBe(
      getValidationOptions('sheet', 'B2', rules)?.values,
    );
  });

  it('keeps first-list order and distinguishes text, numbers and booleans while deduplicating', () => {
    const rules = [
      list('first', ['1', 1, true, false, 'true', 0, '0', '1', 1, false, -0]),
      list('second', [false, '0', true, '1', 1, 0]),
    ];
    expect(getValidationOptions('sheet', 'B2', rules)).toEqual({
      values: ['1', 1, true, false, 0, '0'],
      unsupportedFormulaCount: 0,
    });
  });

  it('matches absolute lowercase addresses and inclusive edges with exact sheet scopes', () => {
    const rules = [
      list('global', ['global', 'local']),
      { ...list('local', ['local']), sheetId: 'sheet' },
    ];
    for (const key of ['$b$2', 'D2', 'B6', '$d$6'])
      expect(getValidationOptions('sheet', key, rules)?.values).toEqual(['local']);
    expect(getValidationOptions('other', 'B2', rules)?.values).toEqual(['global', 'local']);
    for (const key of ['A2', 'B1', 'E2', 'B7'])
      expect(getValidationOptions('sheet', key, rules)).toBeNull();
  });

  it('does not read list values outside the matching address or sheet', () => {
    const inaccessible = new Proxy(['private'], {
      get() {
        throw new Error('Read unrelated list values');
      },
      ownKeys() {
        throw new Error('Enumerated unrelated list values');
      },
    });
    const rules = [
      list('first', ['yes']),
      { ...list('foreign', inaccessible), sheetId: 'other' },
      {
        ...list('elsewhere', inaccessible),
        range: { start: { row: 9, col: 0 }, end: { row: 9, col: 0 } },
      },
    ];
    expect(getValidationOptions('sheet', 'B2', rules)?.values).toEqual(['yes']);
  });

  it('applies intersecting whole and decimal rules without coercing numeric strings', () => {
    const rules: DataValidationRule[] = [
      list('list', [0, 1, 1.5, 2, 3, 4, 5, 6, '2', true]),
      numeric(),
      { id: 'decimal', kind: 'decimal', operator: 'greaterThan', value: 1.5, range: range() },
      { id: 'exclude', kind: 'decimal', operator: 'notEqual', value: 3, range: range() },
    ];
    expect(getValidationOptions('sheet', 'B2', rules)?.values).toEqual([2, 4, 5]);
  });

  it('uses Unicode code points and text-only semantics for text length rules', () => {
    const rules: DataValidationRule[] = [
      list('list', ['a', '😀', '😀b', 'e\u0301', '三四五', 12, true, '']),
      { id: 'length', kind: 'textLength', operator: 'equal', value: 2, range: range() },
    ];
    expect(getValidationOptions('sheet', 'B2', rules)?.values).toEqual(['😀b', 'e\u0301', '']);
  });

  it('offers blank only when explicitly in the first list and every matching rule allows it', () => {
    expect(
      getValidationOptions('sheet', 'B2', [list('first', [1]), list('other', ['', 1])])?.values,
    ).toEqual([1]);
    const rules = [list('first', ['', 1, '']), list('other', [1]), numeric()];
    expect(getValidationOptions('sheet', 'B2', rules)?.values).toEqual(['', 1]);
    expect(
      getValidationOptions('sheet', 'B2', [...rules, { ...numeric('required'), allowBlank: false }])
        ?.values,
    ).toEqual([1]);
    expect(
      getValidationOptions('sheet', 'B2', [rules[0], { ...rules[1], allowBlank: false }])?.values,
    ).toEqual([1]);
    expect(
      getValidationOptions('sheet', 'B2', [{ ...rules[0], allowBlank: false }])?.values,
    ).toEqual([1]);
  });

  it('ignores blank restrictions belonging to a different range or sheet', () => {
    const rules = [
      list('blank', ['']),
      { ...numeric('foreign'), sheetId: 'other', allowBlank: false },
    ];
    expect(getValidationOptions('sheet', 'B2', rules)?.values).toEqual(['']);
  });

  it('excludes unique formula-like strings only when they otherwise satisfy all rules', () => {
    const rules: DataValidationRule[] = [
      list('first', ['=1', '=1', '=2', '=long', 'x', ' =1', "'=1", '=']),
      list('second', ['=1', '=long', 'x', ' =1', "'=1", '=']),
      { id: 'length', kind: 'textLength', operator: 'lessThanOrEqual', value: 3, range: range() },
    ];
    expect(getValidationOptions('sheet', 'B2', rules)).toEqual({
      values: ['x', ' =1', "'=1"],
      unsupportedFormulaCount: 2,
    });
    expect(getValidationOptions('sheet', 'B2', [rules[0], numeric()])).toEqual({
      values: [],
      unsupportedFormulaCount: 0,
    });
    expect(getValidationOptions('sheet', 'B2', [list('formulas', ['=1', '=1', '=2'])])).toEqual({
      values: [],
      unsupportedFormulaCount: 2,
    });
  });

  it('does not expand Excel-sized ranges or mutate frozen rule inputs', () => {
    const rules = copyDataValidationRules([
      {
        ...list('full', ['x', 'y']),
        range: { start: { row: 0, col: 0 }, end: { row: 1_048_575, col: 16_383 } },
      },
    ]);
    const first = rules[0];
    Object.freeze(first.range.start);
    Object.freeze(first.range.end);
    Object.freeze(first.range);
    if (first.kind === 'list') Object.freeze(first.values);
    Object.freeze(first);
    Object.freeze(rules);
    const result = getValidationOptions('sheet', 'XFD1048576', rules)!;
    expect(result.values).toEqual(['x', 'y']);
    result.values[0] = 'changed';
    result.values.push('new');
    expect(getValidationOptions('sheet', 'A1', rules)?.values).toEqual(['x', 'y']);
  });

  it('indexes maximum-total list values once rather than repeatedly calling includes', () => {
    const values = Array.from({ length: DATA_VALIDATION_LIMITS.listValues }, (_, index) => index);
    const count = DATA_VALIDATION_LIMITS.totalListValues / DATA_VALIDATION_LIMITS.listValues;
    const rules = copyDataValidationRules(
      Array.from({ length: count }, (_, index) => list(String(index), values)),
    );
    let iteratorReads = 0;
    for (const rule of rules) {
      if (rule.kind !== 'list') throw new Error('Expected list');
      rule.values = new Proxy(rule.values, {
        get(target, key, receiver) {
          if (key === 'includes') throw new Error('Used linear lookup for candidate');
          if (key === Symbol.iterator) iteratorReads++;
          return Reflect.get(target, key, receiver);
        },
      });
    }
    expect(getValidationOptions('sheet', 'B2', rules)?.values).toEqual(values);
    expect(iteratorReads).toBe(count + 1); // One Set per list, then the first-list candidate pass.
  });

  it('agrees with checkValue for mixed overlapping validation configurations', () => {
    const candidates: CellValue[] = [
      '',
      0,
      1,
      2,
      2.5,
      3,
      5,
      '2',
      'ab',
      '😀',
      '😀b',
      true,
      false,
      '=1',
      '=1',
      2,
    ];
    const constraints: DataValidationRule[][] = [
      [],
      [numeric()],
      [{ ...numeric(), allowBlank: false }],
      [{ ...numeric(), kind: 'decimal' }],
      [{ id: 'length', kind: 'textLength', operator: 'between', min: 1, max: 2, range: range() }],
      [list('second', [true, 2, '2', '=1'])],
      [{ ...list('second', [true, 2, '2', '=1']), allowBlank: false }],
      [{ ...numeric(), sheetId: 'foreign' }],
    ];
    for (const extra of constraints) {
      const rules = copyDataValidationRules([list('first', candidates), ...extra]);
      const accepted = [...new Set(candidates)].filter(
        (value) => checkValue('sheet', 'B2', value, rules).length === 0,
      );
      const unsupported = (value: CellValue) => typeof value === 'string' && value.startsWith('=');
      expect(getValidationOptions('sheet', 'B2', rules)).toEqual({
        values: accepted.filter((value) => !unsupported(value)),
        unsupportedFormulaCount: accepted.filter(unsupported).length,
      });
    }
  });

  it('rejects invalid addresses and sheet identifiers consistently with checkValue', () => {
    for (const key of ['A0', 'XFE1', 'A1048577', 'Sheet!A1', 'A1:B2', ''])
      expect(() => getValidationOptions('sheet', key, [])).toThrow(RangeError);
    expect(() => getValidationOptions('', 'A1', [])).toThrow(TypeError);
  });
});

describe('single validation option checks', () => {
  it('agrees with derived choices across types, blank handling, overlapping constraints and formulas', () => {
    const values: CellValue[] = ['', 0, -0, 1, 1.5, 2, '1', true, false, 'ab', '😀', '=1', ' =1'];
    const cases: DataValidationRule[][] = [
      [],
      [numeric()],
      [list('first', values)],
      [list('first', values), numeric()],
      [list('first', values), { ...numeric(), allowBlank: false }],
      [list('first', values), { ...numeric(), kind: 'decimal' }],
      [
        list('first', values),
        { id: 'text', kind: 'textLength', operator: 'equal', value: 2, range: range() },
      ],
      [list('first', values), list('second', [1, true, '=1'])],
      [list('first', values), { ...list('second', [1, true, '=1']), allowBlank: false }],
      [list('first', [1]), list('second', ['', 1])],
      [{ ...list('first', values), sheetId: 'other' }],
      [list('first', values), { ...numeric(), sheetId: 'other' }],
    ];
    for (const input of cases) {
      const rules = copyDataValidationRules(input);
      for (const key of ['B2', '$d$6', 'A1']) {
        const options = getValidationOptions('sheet', key, rules);
        for (const value of [...values, 'missing', 100])
          expect(isValidationOption('sheet', key, value, rules)).toBe(
            options?.values.includes(value) ?? false,
          );
      }
    }
  });

  it('does not read other matching list values when the first list does not offer the value', () => {
    const inaccessible = new Proxy(['secret'], {
      get() {
        throw new Error('Read later list');
      },
      ownKeys() {
        throw new Error('Enumerated later list');
      },
    });
    const rules = [list('first', ['offered']), list('second', inaccessible)];
    expect(isValidationOption('sheet', 'B2', 'missing', rules)).toBe(false);
    expect(isValidationOption('sheet', 'B2', '', rules)).toBe(false);
    expect(isValidationOption('sheet', 'B2', 1, rules)).toBe(false);
  });

  it('rejects offered formula text before reading other matching list values', () => {
    const inaccessible = new Proxy(['=1'], {
      get() {
        throw new Error('Read later list');
      },
    });
    expect(
      isValidationOption('sheet', 'B2', '=1', [
        list('first', ['=1']),
        list('second', inaccessible),
      ]),
    ).toBe(false);
  });

  it('checks only the selected string and never reads later candidates when list membership resolves early', () => {
    const candidate = 'ready';
    let membershipReads = 0;
    const values = new Proxy(
      Array.from({ length: 1000 }, (_, i) => (i === 0 ? candidate : 'x'.repeat(32767))),
      {
        get(target, key, receiver) {
          if (key === Symbol.iterator) throw new Error('Expanded all candidates');
          if (typeof key === 'string' && /^\d+$/.test(key)) {
            if (key !== '0') throw new Error('Read unrelated candidate');
            membershipReads++;
          }
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const rules: DataValidationRule[] = [
      list('first', values),
      list('second', values),
      {
        id: 'length',
        kind: 'textLength',
        operator: 'equal',
        value: candidate.length,
        range: range(),
      },
    ];
    expect(isValidationOption('sheet', 'B2', candidate, rules)).toBe(true);
    expect(membershipReads).toBe(3); // First-list inclusion, then one check per matching list.
  });

  it('shares address validation and does not mutate frozen input', () => {
    const rule = list('list', [1, '1']);
    if (rule.kind !== 'list') throw new Error('Expected list');
    Object.freeze(rule.values);
    Object.freeze(rule);
    const rules = Object.freeze([rule]);
    expect(isValidationOption('sheet', 'B2', 1, rules)).toBe(true);
    expect(isValidationOption('sheet', 'B2', false, rules)).toBe(false);
    expect(() => isValidationOption('', 'B2', 1, rules)).toThrow(TypeError);
    expect(() => isValidationOption('sheet', 'XFE1', 1, rules)).toThrow(RangeError);
  });
});

describe('validation option labels', () => {
  it.each([
    ['', '空白', '文本'],
    ['1', '"1"', '文本'],
    [1, '1', '数字'],
    [0, '0', '数字'],
    [-0.5, '-0.5', '数字'],
    [true, 'true', '布尔'],
    [false, 'false', '布尔'],
    ['  text  ', '"  text  "', '文本'],
    ['first\nsecond\t', '"first\\nsecond\\t"', '文本'],
    ['"quoted"\\', '"\\"quoted\\"\\\\"', '文本'],
  ] as const)('labels %j without losing type or whitespace', (value, label, type) => {
    expect(validationOptionLabel(value)).toBe(label);
    expect(validationOptionType(value)).toBe(type);
  });
});

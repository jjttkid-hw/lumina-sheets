import { describe, expect, it } from 'vitest';
import {
  DATA_VALIDATION_LIMITS,
  DataValidationRuleError,
  type DataValidationRule,
} from '../src/lib/data-validation';
import { MAX_COLUMNS, MAX_ROWS } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import type { CellRange, Sheet, Workbook } from '../src/lib/types';
import {
  parseValidationRange,
  planWorkspaceValidationRules,
  validationRangeLabel,
} from '../src/lib/workspace-validation';

const dimensions = { rowCount: 10, colCount: 6 };
const range = (): CellRange => ({ start: { row: 0, col: 0 }, end: { row: 9, col: 0 } });
const numericRule = (id = 'quantity'): DataValidationRule => ({
  id,
  range: range(),
  kind: 'whole',
  operator: 'between',
  min: 1,
  max: 10,
});
function fixture(): { book: Workbook; sheet: Sheet } {
  const book = createBlankWorkbook();
  const sheet = book.sheets[0];
  Object.assign(sheet, dimensions, {
    cells: { A1: { value: -50 }, B1: { value: '=1/0' } },
    rowHeights: { 0: 35 },
    hiddenRows: [4],
    hiddenColumns: [3],
    frozenRows: 1,
    merges: [{ start: { row: 2, col: 0 }, end: { row: 2, col: 1 } }],
    printSettings: { paperSize: 'A4', repeatRows: 1 },
    dataSource: { kind: 'static' },
  });
  book.sheets.push({ id: 'other', name: 'Other', cells: {}, ...dimensions });
  return { book, sheet };
}

describe('workspace validation range entry', () => {
  it.each([
    ['A1', 'A1'],
    ['  $a$1\t', 'A1'],
    ['B2:F10', 'B2:F10'],
    [' $f$10 : b2 ', 'B2:F10'],
    ['F2:B10', 'B2:F10'],
    ['B10:F2', 'B2:F10'],
    ['c3:c3', 'C3'],
  ])('parses %s as %s without changing the sheet', (input, label) => {
    const frozen = Object.freeze({ ...dimensions });
    expect(validationRangeLabel(parseValidationRange(input, frozen))).toBe(label);
  });

  it('round trips the full Excel range when the current sheet supports it', () => {
    const full = { start: { row: 0, col: 0 }, end: { row: MAX_ROWS - 1, col: MAX_COLUMNS - 1 } };
    expect(validationRangeLabel(full)).toBe('A1:XFD1048576');
    expect(
      parseValidationRange('XFD1048576:A1', { rowCount: MAX_ROWS, colCount: MAX_COLUMNS }),
    ).toEqual(full);
  });

  it.each([
    '',
    ' ',
    'A0',
    'A01',
    'A-1',
    'A1.5',
    '$$A1',
    'A 1',
    '1',
    'A1:',
    ':B2',
    'A1:B2:C3',
    'A1 B2',
    'A1,B2',
    'A:A',
    '1:10',
    'Sheet1!A1',
    "'Other sheet'!A1:B2",
    '[book]Sheet1!A1',
    'A1#',
    '=A1',
    'A11',
    'G1',
    'F10:A11',
    'XFE1',
    'A1048577',
  ])('rejects malformed, external or out-of-sheet input %s', (input) => {
    expect(() => parseValidationRange(input, dimensions)).toThrow(RangeError);
  });

  it('rejects nontext inputs and invalid sheet dimensions', () => {
    expect(() => parseValidationRange(null as unknown as string, dimensions)).toThrow(TypeError);
    for (const count of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => parseValidationRange('A1', { ...dimensions, rowCount: count })).toThrow(
        RangeError,
      );
      expect(() => parseValidationRange('A1', { ...dimensions, colCount: count })).toThrow(
        RangeError,
      );
    }
    expect(() => parseValidationRange('A1', { ...dimensions, rowCount: MAX_ROWS + 1 })).toThrow(
      RangeError,
    );
    expect(() => parseValidationRange('A1', { ...dimensions, colCount: MAX_COLUMNS + 1 })).toThrow(
      RangeError,
    );
  });

  it('returns independent endpoint objects for a single cell', () => {
    const parsed = parseValidationRange('C3', dimensions);
    expect(parsed.start).not.toBe(parsed.end);
    parsed.start.row = 0;
    expect(parsed.end.row).toBe(2);
  });
});

describe('workspace validation rule planning', () => {
  it('changes only rules and preserves workbook, cell and metadata identity', () => {
    const { book, sheet } = fixture();
    const other = book.sheets[1];
    const before = structuredClone(book);
    const planned = planWorkspaceValidationRules(book, sheet.id, [numericRule()])!;
    expect(planned).not.toBe(sheet);
    for (const key of Object.keys(sheet) as (keyof Sheet)[]) expect(planned[key]).toBe(sheet[key]);
    expect(planned.dataValidations).toEqual([{ ...numericRule(), allowBlank: true }]);
    expect(book).toEqual(before);
    expect(book.sheets[0]).toBe(sheet);
    expect(book.sheets[1]).toBe(other);
    expect(sheet.dataValidations).toBeUndefined();
  });

  it('isolates all input ranges and list values without freezing the caller', () => {
    const { book, sheet } = fixture();
    const rule: DataValidationRule = {
      id: 'list',
      kind: 'list',
      range: range(),
      values: [1, true, '1'],
    };
    const input = [rule];
    const before = structuredClone(input);
    const planned = planWorkspaceValidationRules(book, sheet.id, input)!;
    expect(input).toEqual(before);
    expect(planned.dataValidations).not.toBe(input);
    rule.range.start.row = 5;
    rule.values[0] = 'changed';
    input.length = 0;
    expect(planned.dataValidations).toEqual([{ ...before[0], allowBlank: true }]);
    const copy = planned.dataValidations![0];
    if (copy.kind !== 'list') throw new Error('Expected list rule');
    copy.values.push(false);
    expect(rule.values).toEqual(['changed', true, '1']);
  });

  it('preserves explicit IDs, foreign sheet scopes, duplicates in lists and overlapping rule order', () => {
    const { book, sheet } = fixture();
    const input: DataValidationRule[] = [
      { ...numericRule(' keep spaces '), sheetId: 'not-an-existing-sheet', allowBlank: false },
      { id: 'overlap', kind: 'list', values: [1, '1', true, 1], range: range(), message: '' },
    ];
    const planned = planWorkspaceValidationRules(book, sheet.id, input)!;
    expect(planned.dataValidations).toEqual([input[0], { ...input[1], allowBlank: true }]);
  });

  it('accepts all supported rule types and numeric comparison shapes', () => {
    const { book, sheet } = fixture();
    const input: DataValidationRule[] = [
      numericRule(),
      { id: 'decimal', range: range(), kind: 'decimal', operator: 'greaterThan', value: 0.5 },
      { id: 'text', range: range(), kind: 'textLength', operator: 'notBetween', min: 0, max: 2 },
      { id: 'list', range: range(), kind: 'list', values: [0, false, ''] },
    ];
    expect(planWorkspaceValidationRules(book, sheet.id, input)?.dataValidations).toHaveLength(4);
  });

  it('keeps valid Excel ranges outside the current sheet and does not inspect existing values', () => {
    const { book, sheet } = fixture();
    const poison = new Proxy(sheet.cells, {
      get() {
        throw new Error('Read an existing cell');
      },
      ownKeys() {
        throw new Error('Scanned existing cells');
      },
    });
    sheet.cells = poison;
    const rule = numericRule();
    rule.range.end = { row: MAX_ROWS - 1, col: MAX_COLUMNS - 1 };
    sheet.dataValidations = [rule];
    const planned = planWorkspaceValidationRules(book, sheet.id, [{ ...rule, allowBlank: false }])!;
    expect(planned.cells).toBe(poison);
    expect(planned.dataValidations![0].range.end).toEqual(rule.range.end);
    expect(planned.rowCount).toBe(dimensions.rowCount);
    expect(planned.colCount).toBe(dimensions.colCount);
  });

  it('does not reject existing invalid values or evaluate formulas when adding a rule', () => {
    const { book, sheet } = fixture();
    const planned = planWorkspaceValidationRules(book, sheet.id, [numericRule()])!;
    expect(planned.cells.A1.value).toBe(-50);
    expect(planned.cells.B1.value).toBe('=1/0');
  });

  it('returns null for absent, empty, equivalent defaults and reordered object properties', () => {
    const { book, sheet } = fixture();
    expect(planWorkspaceValidationRules(book, sheet.id, [])).toBeNull();
    sheet.dataValidations = [];
    expect(planWorkspaceValidationRules(book, sheet.id, [])).toBeNull();
    sheet.dataValidations = [numericRule()];
    const equivalent = {
      max: 10,
      min: 1,
      operator: 'between',
      kind: 'whole',
      range: range(),
      allowBlank: true,
      id: 'quantity',
    };
    expect(planWorkspaceValidationRules(book, sheet.id, [equivalent])).toBeNull();
    expect(sheet.dataValidations[0].allowBlank).toBeUndefined();
  });

  it('treats scope, message, order and list scalar types as meaningful changes', () => {
    const { book, sheet } = fixture();
    const first = numericRule('first');
    const second: DataValidationRule = { id: 'second', range: range(), kind: 'list', values: [1] };
    sheet.dataValidations = [first, second];
    for (const candidate of [
      [{ ...first, sheetId: sheet.id }, second],
      [{ ...first, message: '' }, second],
      [second, first],
      [first, { ...second, values: ['1'] }],
    ])
      expect(planWorkspaceValidationRules(book, sheet.id, candidate)).not.toBeNull();
  });

  it('clears existing rules without changing other sheet fields', () => {
    const { book, sheet } = fixture();
    sheet.dataValidations = [numericRule()];
    const previous = sheet.dataValidations;
    const planned = planWorkspaceValidationRules(book, sheet.id, [])!;
    expect(planned.dataValidations).toEqual([]);
    expect(planned.cells).toBe(sheet.cells);
    expect(sheet.dataValidations).toBe(previous);
    expect(previous).toHaveLength(1);
  });

  it('rejects unknown sheets and paged sources even for no-op requests', () => {
    const { book, sheet } = fixture();
    expect(() => planWorkspaceValidationRules(book, 'missing', [])).toThrow('找不到工作表');
    sheet.dataSource = { kind: 'paged', totalRows: 100_000 };
    expect(() => planWorkspaceValidationRules(book, sheet.id, [])).toThrow('分页数据源只读');
  });

  it.each([
    null,
    undefined,
    {},
    '[]',
    [null],
    [{ ...numericRule(), allowBlank: 'false' }],
    [{ ...numericRule(), min: NaN }],
    [{ ...numericRule(), min: 1.5 }],
    [{ ...numericRule(), min: 11 }],
    [{ ...numericRule(), sheetId: '' }],
    [{ ...numericRule(), unexpected: true }],
    [{ ...numericRule(), range: { start: { row: 5, col: 0 }, end: { row: 1, col: 0 } } }],
    [{ ...numericRule(), range: { start: { row: 0, col: 0 }, end: { row: MAX_ROWS, col: 0 } } }],
    [{ ...numericRule(), range: { start: { row: 0, col: 0 }, end: { row: 0, col: MAX_COLUMNS } } }],
    [{ id: 'list', kind: 'list', range: range(), values: [] }],
    [{ id: 'list', kind: 'list', range: range(), values: [null] }],
    [numericRule(), numericRule()],
  ])('rejects invalid input atomically: %j', (input) => {
    const { book, sheet } = fixture();
    sheet.dataValidations = [numericRule('original')];
    const previous = sheet.dataValidations;
    const before = structuredClone(book);
    expect(() => planWorkspaceValidationRules(book, sheet.id, input)).toThrow(
      DataValidationRuleError,
    );
    expect(book).toEqual(before);
    expect(sheet.dataValidations).toBe(previous);
  });

  it('enforces per-list, total-list and rule quotas without committing partial rules', () => {
    const { book, sheet } = fixture();
    const rule: DataValidationRule = {
      id: 'list',
      kind: 'list',
      range: range(),
      values: Array(DATA_VALIDATION_LIMITS.listValues).fill('x'),
    };
    const maximumRules = Array.from({ length: DATA_VALIDATION_LIMITS.rules }, (_, index) =>
      numericRule(String(index)),
    );
    expect(
      planWorkspaceValidationRules(book, sheet.id, maximumRules)?.dataValidations,
    ).toHaveLength(DATA_VALIDATION_LIMITS.rules);
    expect(() =>
      planWorkspaceValidationRules(book, sheet.id, [...maximumRules, numericRule('extra')]),
    ).toThrow(DataValidationRuleError);
    expect(planWorkspaceValidationRules(book, sheet.id, [rule])?.dataValidations).toHaveLength(1);
    expect(() =>
      planWorkspaceValidationRules(book, sheet.id, [
        { ...rule, values: [...rule.values, 'extra'] },
      ]),
    ).toThrow(DataValidationRuleError);
    const maximumLists = Array.from(
      { length: DATA_VALIDATION_LIMITS.totalListValues / DATA_VALIDATION_LIMITS.listValues },
      (_, index) => ({ ...rule, id: String(index) }),
    );
    expect(
      planWorkspaceValidationRules(book, sheet.id, maximumLists)?.dataValidations,
    ).toHaveLength(maximumLists.length);
    expect(() =>
      planWorkspaceValidationRules(book, sheet.id, [
        ...maximumLists,
        { ...rule, id: 'extra', values: [1] },
      ]),
    ).toThrow(DataValidationRuleError);
    expect(sheet.dataValidations).toBeUndefined();
  });
});

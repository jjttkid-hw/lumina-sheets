import { describe, expect, it } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import { cellKey, createEvaluator } from '../src/lib/engine';
import type { DataValidationRule } from '../src/lib/data-validation';
import type { Cell, Workbook } from '../src/lib/types';
import { validateWorkbookCellChanges } from '../src/lib/workbook-validation';

function workbook(): Workbook {
  const book = createBlankWorkbook('候选验证');
  Object.assign(book.sheets[0], {
    name: 'Input',
    rowCount: 10,
    colCount: 6,
    cells: { A1: { value: 2 }, B1: { value: '=A1*2' }, C1: { value: 'required' } },
  });
  return book;
}
function rule(key: string, expected: number): DataValidationRule {
  const col = key.charCodeAt(0) - 65,
    row = Number(key.slice(1)) - 1;
  return {
    id: key,
    kind: 'whole',
    operator: 'equal',
    value: expected,
    range: { start: { row, col }, end: { row, col } },
  };
}

describe('shared workbook candidate validation', () => {
  it('checks the full candidate before edits regardless of patch order and preserves live caches', () => {
    const book = workbook(),
      sheet = book.sheets[0];
    sheet.dataValidations = [rule('B1', 8)];
    const live = createEvaluator(book, { managedMutations: true });
    expect(live(sheet, 'B1')).toBe(4);
    const stats = live.stats,
      before = structuredClone(book);
    const changes = [
      { key: 'B1', cell: { value: '=A1*2' } },
      { key: 'A1', cell: { value: 4 } },
    ];
    expect(validateWorkbookCellChanges(book, sheet.id, changes)).toEqual([]);
    expect(validateWorkbookCellChanges(book, sheet.id, [...changes].reverse())).toEqual([]);
    sheet.dataValidations = [rule('B1', 4)];
    const failures = validateWorkbookCellChanges(book, sheet.id, changes);
    expect(failures).toEqual([
      expect.objectContaining({ key: 'B1', value: 8, code: 'OUT_OF_RANGE' }),
    ]);
    expect(live.stats).toEqual(stats);
    expect(sheet.cells).toEqual(before.sheets[0].cells);
    expect(changes).toEqual([
      { key: 'B1', cell: { value: '=A1*2' } },
      { key: 'A1', cell: { value: 4 } },
    ]);
  });

  it('resolves cross-sheet formula dependencies through the same candidate overlay', () => {
    const book = workbook(),
      sheet = book.sheets[0];
    book.sheets.push({
      id: 'derived',
      name: 'Derived',
      rowCount: 10,
      colCount: 6,
      cells: { A1: { value: '=Input!A1*3' } },
    });
    sheet.dataValidations = [rule('B1', 13)];
    const changes = [
      { key: 'B1', cell: { value: '=Derived!A1+1' } },
      { key: 'A1', cell: { value: 4 } },
    ];
    expect(validateWorkbookCellChanges(book, sheet.id, changes)).toEqual([]);
    sheet.dataValidations = [rule('B1', 7)];
    expect(validateWorkbookCellChanges(book, sheet.id, changes)[0]).toMatchObject({
      key: 'B1',
      value: 13,
    });
    expect(sheet.cells.A1.value).toBe(2);
    expect(book.sheets[1].cells.A1.value).toBe('=Input!A1*3');
  });

  it('shadows deletions for required values and formulas, and uses the last duplicate patch', () => {
    const book = workbook(),
      sheet = book.sheets[0];
    sheet.dataValidations = [
      rule('B1', 0),
      {
        id: 'required',
        kind: 'list',
        values: ['required'],
        allowBlank: false,
        range: { start: { row: 0, col: 2 }, end: { row: 0, col: 2 } },
      },
    ];
    const changes = [
      { key: 'A1', cell: { value: 30 } },
      { key: 'B1', cell: { value: '=A1*2' } },
      { key: 'A1', cell: null },
      { key: 'C1', cell: null },
    ];
    expect(validateWorkbookCellChanges(book, sheet.id, changes)).toEqual([
      expect.objectContaining({ key: 'C1', value: '', code: 'BLANK_NOT_ALLOWED' }),
    ]);
    expect(sheet.cells.A1.value).toBe(2);
    expect(sheet.cells.C1.value).toBe('required');
  });

  it('checks retained formulas only when explicitly included and deduplicates validation keys', () => {
    const book = workbook(),
      sheet = book.sheets[0];
    sheet.dataValidations = [rule('A1', 100), rule('B1', 4)];
    const changes = [{ key: 'A1', cell: { value: 9 } }];
    expect(
      validateWorkbookCellChanges(book, sheet.id, changes).map((failure) => failure.key),
    ).toEqual(['A1']);
    expect(
      validateWorkbookCellChanges(book, sheet.id, changes, { validationKeys: ['B1', 'B1'] }),
    ).toEqual([expect.objectContaining({ key: 'B1', value: 18 })]);
    expect(validateWorkbookCellChanges(book, sheet.id, changes, { validationKeys: [] })).toEqual(
      [],
    );
    expect(validateWorkbookCellChanges(book, sheet.id, [])).toEqual([]);
    expect(
      validateWorkbookCellChanges(book, sheet.id, [], { validationKeys: ['A1'] }),
    ).toHaveLength(1);
  });

  it('validates added cells and proposed dimensions without expanding or mutating the source sheet', () => {
    const book = workbook(),
      sheet = book.sheets[0];
    sheet.rowCount = 1;
    sheet.colCount = 3;
    sheet.dataValidations = [rule('D20', 7)];
    const before = structuredClone(book);
    expect(
      validateWorkbookCellChanges(book, sheet.id, [{ key: 'D20', cell: { value: '=A1+5' } }], {
        dimensions: { rowCount: 20, colCount: 4 },
      }),
    ).toEqual([]);
    expect(
      validateWorkbookCellChanges(book, sheet.id, [{ key: 'D20', cell: { value: 8 } }], {
        dimensions: { rowCount: 20 },
      })[0],
    ).toMatchObject({ key: 'D20', value: 8 });
    expect(book).toEqual(before);
  });

  it('never enumerates stored cells or evaluates unrelated formulas and rule scopes', () => {
    const book = workbook(),
      sheet = book.sheets[0];
    sheet.dataValidations = [rule('B1', 8), { ...rule('A1', 999), sheetId: 'different' }];
    const cells = sheet.cells;
    sheet.cells = new Proxy(cells, {
      ownKeys: () => {
        throw new Error('scanned cell store');
      },
      get: (target, key) => {
        if (key === 'C1') throw new Error('read unrelated cell');
        return Reflect.get(target, key);
      },
    });
    try {
      expect(
        validateWorkbookCellChanges(book, sheet.id, [
          { key: 'A1', cell: { value: 4 } },
          { key: 'B1', cell: { value: '=A1*2' } },
        ]),
      ).toEqual([]);
    } finally {
      sheet.cells = cells;
    }
  });

  it('short circuits at 100 failures without consuming the rest of a supplied key iterator', () => {
    const book = workbook(),
      sheet = book.sheets[0];
    sheet.dataValidations = [
      {
        id: 'required',
        kind: 'list',
        values: ['x'],
        allowBlank: false,
        range: { start: { row: 0, col: 0 }, end: { row: 999, col: 0 } },
      },
    ];
    function* keys() {
      for (let row = 0; row < 100; row++) yield cellKey(row, 0);
      throw new Error('validation read past failure cap');
    }
    const failures = validateWorkbookCellChanges(book, sheet.id, [], { validationKeys: keys() });
    expect(failures).toHaveLength(100);
    expect(failures[99]).toMatchObject({ key: 'A100' });
  });

  it('caps overlapping rule failures at 100 and returns isolated failure data', () => {
    const book = workbook(),
      sheet = book.sheets[0];
    sheet.dataValidations = Array.from({ length: 120 }, (_, index) => ({
      ...rule('A1', 99),
      id: `rule-${index}`,
    }));
    const changes: ReadonlyArray<{ key: string; cell: Cell | null }> = Object.freeze([
      Object.freeze({ key: 'A1', cell: Object.freeze({ value: 3 }) }),
    ]);
    const failures = validateWorkbookCellChanges(book, sheet.id, changes);
    expect(failures).toHaveLength(100);
    failures[0].message = 'changed';
    failures[0].value = 1000;
    expect(validateWorkbookCellChanges(book, sheet.id, changes)[0]).toMatchObject({ value: 3 });
    expect(sheet.cells.A1.value).toBe(2);
  });

  it('does no work when no rules apply and rejects a missing target sheet', () => {
    const book = workbook(),
      sheet = book.sheets[0];
    sheet.cells = new Proxy(sheet.cells, {
      get: () => {
        throw new Error('read without rule');
      },
    });
    expect(
      validateWorkbookCellChanges(book, sheet.id, [{ key: 'A1', cell: { value: 10 } }]),
    ).toEqual([]);
    expect(() => validateWorkbookCellChanges(book, 'missing', [])).toThrow('找不到工作表');
  });
});

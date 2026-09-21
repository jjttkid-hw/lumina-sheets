import { describe, expect, it } from 'vitest';
import {
  WorkspaceCalculationInputs,
  workspaceFormulaTargets,
} from '../src/lib/workspace-calculation';
import { createBlankWorkbook } from '../src/lib/seed';
import type { WorkbookPatch } from '../src/lib/persistence';
import type { Sheet } from '../src/lib/types';
import { createEvaluator } from '../src/lib/engine';

describe('workspace calculation inputs', () => {
  it('reuses the value source for presentation and workbook metadata without reading cells', () => {
    const book = createBlankWorkbook(),
      inputs = new WorkspaceCalculationInputs();
    book.sheets[0].cells = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('scan');
        },
        get() {
          throw new Error('read');
        },
      },
    );
    const original = inputs.get(book);
    const next = {
      ...book,
      name: 'renamed',
      starred: true,
      sheets: [
        { ...book.sheets[0], columnWidths: { 0: 200 }, hiddenRows: [3], dataValidations: [] },
      ],
    };
    inputs.register(book, next);
    expect(inputs.get(next)).toBe(original);
  });
  it('checks only patched values for style edits and treats presence and type as significant', () => {
    const book = createBlankWorkbook(),
      inputs = new WorkspaceCalculationInputs(),
      sheet = book.sheets[0];
    sheet.cells = new Proxy(
      { A1: { value: 1 } },
      {
        ownKeys() {
          throw new Error('scan');
        },
        get(target, key) {
          if (key !== 'A1') throw new Error('unrelated');
          return target.A1;
        },
      },
    );
    const original = inputs.get(book);
    const patch: WorkbookPatch = {
      kind: 'cell',
      sheetId: sheet.id,
      key: 'A1',
      cell: { value: 1, style: { bold: true } },
    };
    const next = {
      ...book,
      sheets: [{ ...sheet, cells: { A1: { value: 1, style: { bold: true } } } }],
    };
    inputs.register(book, next, [patch]);
    expect(inputs.get(next)).toBe(original);
    const changedCells: Sheet['cells'][] = [{ A1: { value: '1' } }, {}, { A1: { value: '=1' } }];
    for (const cells of changedCells) {
      const changed = { ...book, sheets: [{ ...sheet, cells }] };
      inputs.register(book, changed, [patch]);
      expect(inputs.get(changed).revision).toBeGreaterThan(original.revision);
    }
  });
  it.each(['name', 'rowCount', 'colCount', 'dataSource', 'id'] as const)(
    'invalidates on sheet %s',
    (key) => {
      const book = createBlankWorkbook(),
        inputs = new WorkspaceCalculationInputs(),
        first = inputs.get(book);
      const values = {
        name: 'New',
        rowCount: 1000,
        colCount: 99,
        dataSource: { kind: 'static' as const },
        id: 'new-sheet',
      };
      const next = { ...book, sheets: [{ ...book.sheets[0], [key]: values[key] }] };
      inputs.register(book, next, []);
      expect(inputs.get(next).revision).toBeGreaterThan(first.revision);
    },
  );
  it('invalidates arbitrary snapshots and same-id imports; active-sheet changes can reuse the source', () => {
    const book = createBlankWorkbook(),
      inputs = new WorkspaceCalculationInputs(),
      first = inputs.get(book);
    const switched = { ...book, activeSheetId: 'other' };
    inputs.register(book, switched);
    expect(inputs.get(switched)).toBe(first);
    expect(inputs.get(structuredClone(book)).revision).toBeGreaterThan(first.revision);
    const restored = structuredClone(book);
    inputs.register(book, restored);
    expect(inputs.get(restored)).not.toBe(first);
    const extended = { ...book, sheets: [...book.sheets, { ...book.sheets[0], id: 'new' }] };
    inputs.register(book, extended);
    expect(inputs.get(extended)).not.toBe(first);
  });
  it('keeps cross-sheet evaluation valid across style edits and refreshes it after a source value changes', () => {
    const book = createBlankWorkbook(),
      inputs = new WorkspaceCalculationInputs();
    book.sheets[0].cells = { A1: { value: '=Source!A1*2' } };
    book.sheets.push({
      ...book.sheets[0],
      id: 'source',
      name: 'Source',
      cells: { A1: { value: 3 } },
    });
    const initial = inputs.get(book),
      evaluate = createEvaluator(initial.workbook);
    expect(evaluate(book.sheets[0], 'A1')).toBe(6);
    const styled = {
      ...book,
      sheets: [
        book.sheets[0],
        { ...book.sheets[1], cells: { A1: { value: 3, style: { bold: true } } } },
      ],
    };
    inputs.register(book, styled, [
      { kind: 'cell', sheetId: 'source', key: 'A1', cell: styled.sheets[1].cells.A1 },
    ]);
    expect(inputs.get(styled)).toBe(initial);
    expect(evaluate(styled.sheets[0], 'A1')).toBe(6);
    const changed = {
      ...styled,
      sheets: [styled.sheets[0], { ...styled.sheets[1], cells: { A1: { value: 7 } } }],
    };
    inputs.register(styled, changed, [
      { kind: 'cell', sheetId: 'source', key: 'A1', cell: changed.sheets[1].cells.A1 },
    ]);
    const updated = inputs.get(changed);
    expect(updated).not.toBe(initial);
    expect(createEvaluator(updated.workbook)(changed.sheets[0], 'A1')).toBe(14);
  });
  it('stops reading values after the per-sheet formula limit', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    let reads = 0;
    sheet.cells = Object.create({ C1: { value: '=99' } });
    Object.defineProperties(sheet.cells, {
      A1: {
        enumerable: true,
        get() {
          reads++;
          return { value: '=1' };
        },
      },
      B1: {
        enumerable: true,
        get() {
          throw new Error('read beyond cap');
        },
      },
    });
    book.sheets.push({
      ...sheet,
      id: 'second',
      cells: { A1: { value: 2 }, B1: { value: '=A1+1' } },
    });
    expect(workspaceFormulaTargets(book, 1)).toEqual([
      { sheetId: sheet.id, key: 'A1' },
      { sheetId: 'second', key: 'B1' },
    ]);
    expect(reads).toBe(1);
    expect(workspaceFormulaTargets(book, 0)).toEqual([]);
    expect(() => workspaceFormulaTargets(book, -1)).toThrow();
  });
  it('excludes inherited formulas without reading them', () => {
    const book = createBlankWorkbook();
    const prototype = Object.defineProperty({}, 'B1', {
      enumerable: true,
      get() {
        throw new Error('inherited cell');
      },
    });
    book.sheets[0].cells = Object.assign(Object.create(prototype), {
      A1: { value: '=1' },
      C1: { value: 'plain' },
    });
    expect(workspaceFormulaTargets(book)).toEqual([{ sheetId: book.sheets[0].id, key: 'A1' }]);
  });
});

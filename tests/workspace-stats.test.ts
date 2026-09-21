import { describe, expect, it, vi } from 'vitest';
import { readSelectionStats, readSheetPopulation } from '../src/lib/workspace-stats';
import { cellKey, createEvaluator, parseCellKey } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import type { Selection } from '../src/lib/types';

describe('workspace statistics', () => {
  it('reads only a selected stored cell without enumerating unrelated data', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = new Proxy(
      { B2: { value: 7 }, Z99: { value: 99 } },
      {
        ownKeys() {
          throw new Error('full scan');
        },
        get(target, key) {
          if (key !== 'B2') throw new Error('unrelated read');
          return target.B2;
        },
      },
    );
    const evaluate = vi.fn(createEvaluator(book));
    expect(readSelectionStats(sheet, { row: 1, col: 1 }, evaluate)).toEqual({
      count: 1,
      sum: 7,
      avg: 7,
    });
    expect(evaluate).toHaveBeenCalledExactlyOnceWith(sheet, 'B2');
    evaluate.mockClear();
    expect(readSelectionStats(sheet, { row: 0, col: 0 }, evaluate)).toEqual({
      count: 0,
      sum: 0,
      avg: 0,
    });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('retains formula, error, text, boolean, blank and numeric-only average semantics', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = {
      A1: { value: 'header' },
      A2: { value: '' },
      A3: { value: '=""' },
      A4: { value: true },
      A5: { value: false },
      A6: { value: 0 },
      A7: { value: -4 },
      A8: { value: '=2*4' },
      A9: { value: '=1/0' },
      A10: { value: '12' },
    };
    expect(
      readSelectionStats(sheet, { row: 9, col: 0, endRow: 0, endCol: 0 }, createEvaluator(book)),
    ).toEqual({ count: 8, sum: 4, avg: 4 / 3 });
    expect(readSheetPopulation(sheet)).toEqual({ cells: 9, rows: 8 });
  });

  it('scans sparse storage once for a million-row selection without expanding logical blanks', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.rowCount = 1_000_000;
    sheet.colCount = 256;
    const enumerate = vi.fn((target: object) => Reflect.ownKeys(target));
    sheet.cells = new Proxy<typeof sheet.cells>(
      { A1: { value: 3 }, IV1000000: { value: '=4*2' } },
      { ownKeys: enumerate },
    );
    const evaluate = vi.fn(createEvaluator(book));
    expect(
      readSelectionStats(sheet, { row: 0, col: 0, endRow: 999_999, endCol: 255 }, evaluate),
    ).toEqual({ count: 2, sum: 11, avg: 5.5 });
    expect(enumerate).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('clips selections to sheet dimensions and does not include inherited cells', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.cells = Object.assign(Object.create({ A2: { value: 100 } }), {
      A1: { value: 5 },
      A101: { value: 200 },
    });
    const evaluate = createEvaluator(book);
    expect(
      readSelectionStats(sheet, { row: -10, col: -5, endRow: 1, endCol: 0 }, evaluate),
    ).toEqual({ count: 1, sum: 5, avg: 5 });
    expect(readSelectionStats(sheet, { row: 500, col: 0 }, evaluate)).toEqual({
      count: 0,
      sum: 0,
      avg: 0,
    });
    sheet.colCount = 100;
    expect(
      readSelectionStats(sheet, { row: 0, col: 0, endRow: 500, endCol: 500 }, evaluate),
    ).toEqual({ count: 1, sum: 5, avg: 5 });
  });

  it('counts hidden and merged stored cells consistently and evaluates cross-sheet references', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.hiddenRows = [1];
    sheet.hiddenColumns = [0];
    sheet.merges = [{ start: { row: 0, col: 0 }, end: { row: 0, col: 1 } }];
    sheet.cells = { A1: { value: 2 }, B1: { value: '' }, A2: { value: '=Source!A1' } };
    book.sheets.push({ ...sheet, id: 'source', name: 'Source', cells: { A1: { value: 6 } } });
    expect(
      readSelectionStats(sheet, { row: 0, col: 0, endRow: 1, endCol: 1 }, createEvaluator(book)),
    ).toEqual({ count: 2, sum: 8, avg: 4 });
  });

  it('matches a storage-scan reference on both sides of the direct-read threshold', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.rowCount = sheet.colCount = 100;
    for (let row = 0; row < 100; row++) {
      for (let col = 0; col < 100; col++) {
        if ((row + col) % 7 === 0)
          sheet.cells[cellKey(row, col)] = { value: row % 3 ? row - col : '' };
      }
    }
    for (const end of [0, 10, 63, 64, 99]) {
      const selection: Selection = { row: end, col: end, endRow: 0, endCol: 0 };
      const evaluate = createEvaluator(book);
      let count = 0,
        sum = 0,
        numbers = 0;
      for (const key of Object.keys(sheet.cells)) {
        const point = parseCellKey(key)!;
        if (point.row > end || point.col > end) continue;
        const value = evaluate(sheet, key);
        if (value !== '') count++;
        if (typeof value === 'number') {
          sum += value;
          numbers++;
        }
      }
      expect(readSelectionStats(sheet, selection, evaluate)).toEqual({
        count,
        sum,
        avg: numbers ? sum / numbers : 0,
      });
    }
  });
});

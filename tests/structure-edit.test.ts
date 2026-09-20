import { describe, expect, it } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import { MAX_COLUMNS, MAX_ROWS, createEvaluator } from '../src/lib/engine';
import { planStructureEdit, transformPosition, transformRange } from '../src/lib/structure-edit';
import type { StructureEdit } from '../src/lib/formula-structure';
import type { CellRange, Sheet, Workbook } from '../src/lib/types';

const range = (top: number, left: number, bottom = top, right = left): CellRange => ({
  start: { row: top, col: left },
  end: { row: bottom, col: right },
});
function fixture(): Workbook {
  const book = createBlankWorkbook();
  const sheet = book.sheets[0];
  sheet.name = 'Data';
  sheet.rowCount = 10;
  sheet.colCount = 8;
  sheet.cells = {
    A1: { value: 'header' },
    A3: { value: 10, style: { bold: true } },
    B3: { value: '=A3*2' },
    C6: { value: 30 },
  };
  sheet.columnWidths = { 0: 80, 2: 140, 7: 180 };
  sheet.frozenRows = 2;
  const other: Sheet = {
    id: 'other',
    name: 'Other',
    cells: { A1: { value: '=Data!A3+Data!C6' }, A2: { value: '=A1*2' } },
    rowCount: 10,
    colCount: 8,
  };
  const untouched: Sheet = {
    id: 'untouched',
    name: 'Untouched',
    cells: { A1: { value: 1 } },
    rowCount: 10,
    colCount: 8,
  };
  book.sheets.push(other, untouched);
  return book;
}
const edit = (
  axis: 'row' | 'column',
  kind: 'insert' | 'delete',
  index: number,
  count: number,
): StructureEdit => ({ axis, kind, index, count });

describe('structural coordinate transformations', () => {
  it('moves coordinates and removes those inside a deletion', () => {
    expect(transformPosition(4, edit('row', 'insert', 4, 2))).toBe(6);
    expect(transformPosition(3, edit('row', 'insert', 4, 2))).toBe(3);
    expect(transformPosition(4, edit('column', 'delete', 4, 2))).toBeUndefined();
    expect(transformPosition(6, edit('column', 'delete', 4, 2))).toBe(4);
  });
  it('shifts ranges at the start, expands inside, and preserves insertions after the end', () => {
    const original = range(2, 1, 5, 3);
    expect(transformRange(original, edit('row', 'insert', 2, 2))).toEqual(range(4, 1, 7, 3));
    expect(transformRange(original, edit('row', 'insert', 4, 2))).toEqual(range(2, 1, 7, 3));
    expect(transformRange(original, edit('row', 'insert', 6, 2))).toEqual(original);
    expect(original).toEqual(range(2, 1, 5, 3));
  });
  it('shrinks partially deleted ranges or removes completely deleted ranges', () => {
    expect(transformRange(range(2, 1, 5, 3), edit('row', 'delete', 1, 3))).toEqual(
      range(1, 1, 2, 3),
    );
    expect(transformRange(range(2, 1, 5, 3), edit('row', 'delete', 4, 4))).toEqual(
      range(2, 1, 3, 3),
    );
    expect(transformRange(range(2, 1, 5, 3), edit('row', 'delete', 3, 2))).toEqual(
      range(2, 1, 3, 3),
    );
    expect(transformRange(range(2, 1, 5, 3), edit('row', 'delete', 2, 4))).toBeUndefined();
  });
});

describe('atomic sparse workbook structure plans', () => {
  it('moves sparse row heights and hidden axes, dropping deleted metadata', () => {
    const book = fixture();
    const sheet = book.sheets[0];
    sheet.rowHeights = { 1: 36, 6: 48 };
    sheet.hiddenRows = [1, 6];
    sheet.hiddenColumns = [1, 6];
    const inserted = planStructureEdit(book, sheet.id, edit('row', 'insert', 1, 2)).sheets[0];
    expect(inserted.rowHeights).toEqual({ 3: 36, 8: 48 });
    expect(inserted.hiddenRows).toEqual([3, 8]);
    expect(inserted.hiddenColumns).toEqual([1, 6]);
    const removed = planStructureEdit(book, sheet.id, edit('row', 'delete', 1, 2)).sheets[0];
    expect(removed.rowHeights).toEqual({ 4: 48 });
    expect(removed.hiddenRows).toEqual([4]);
    const columns = planStructureEdit(book, sheet.id, edit('column', 'delete', 1, 2)).sheets[0];
    expect(columns.hiddenColumns).toEqual([4]);
    expect(columns.rowHeights).toEqual(sheet.rowHeights);
    inserted.hiddenRows!.push(9);
    expect(sheet.hiddenRows).toEqual([1, 6]);
  });
  it('inserts rows and rewrites moved/local/cross-sheet formulas without mutating input', () => {
    const book = fixture(),
      before = structuredClone(book),
      target = book.sheets[0];
    const plan = planStructureEdit(book, target.id, edit('row', 'insert', 2, 2));
    expect(book).toEqual(before);
    expect(plan.sheets[0].rowCount).toBe(12);
    expect(plan.sheets[0].cells.A5).toEqual({ value: 10, style: { bold: true } });
    expect(plan.sheets[0].cells.A3).toBeUndefined();
    expect(plan.sheets[0].cells.B5.value).toBe('=A5*2');
    expect(plan.sheets[1].cells.A1.value).toBe('=Data!A5+Data!C8');
    expect(plan.sheets[1].cells.A2.value).toBe('=A1*2');
    expect(plan.changedSheetIds).toEqual([target.id, 'other']);
    expect(plan.sheets[2]).toBe(book.sheets[2]);
    plan.sheets[0].cells.A5.style!.bold = false;
    expect(target.cells.A3.style!.bold).toBe(true);
    const candidate = { ...book, sheets: plan.sheets };
    expect(createEvaluator(candidate)(plan.sheets[1], 'A1')).toBe(40);
  });

  it('deletes cells and rewrites removed references to REF errors', () => {
    const book = fixture();
    const plan = planStructureEdit(book, book.sheets[0].id, edit('row', 'delete', 2, 2));
    expect(plan.sheets[0].rowCount).toBe(8);
    expect(plan.sheets[0].cells.A3).toBeUndefined();
    expect(plan.sheets[0].cells.C4.value).toBe(30);
    expect(plan.sheets[1].cells.A1.value).toContain('#REF!');
  });

  it('moves column widths sparsely and allows insertion at the end', () => {
    const book = fixture();
    const plan = planStructureEdit(book, book.sheets[0].id, edit('column', 'insert', 1, 2));
    expect(plan.sheets[0].columnWidths).toEqual({ 0: 80, 4: 140, 9: 180 });
    expect(plan.sheets[0].cells.D3.value).toBe('=A3*2');
    expect(plan.sheets[0].colCount).toBe(10);
    const after = planStructureEdit(book, book.sheets[0].id, edit('column', 'insert', 8, 1));
    expect(after.sheets[0].colCount).toBe(9);
    expect(after.sheets[1]).toBe(book.sheets[1]);
    const removed = planStructureEdit(book, book.sheets[0].id, edit('column', 'delete', 2, 2));
    expect(removed.sheets[0].columnWidths).toEqual({ 0: 80, 5: 180 });
  });

  it('expands and shrinks merges, removing full deletions and single-cell merges', () => {
    const book = fixture(),
      sheet = book.sheets[0];
    sheet.merges = [range(1, 1, 4, 2), range(6, 4, 7, 4)];
    const inserted = planStructureEdit(book, sheet.id, edit('row', 'insert', 3, 2));
    expect(inserted.sheets[0].merges).toEqual([range(1, 1, 6, 2), range(8, 4, 9, 4)]);
    const removed = planStructureEdit(book, sheet.id, edit('row', 'delete', 2, 5));
    expect(removed.sheets[0].merges).toEqual([range(1, 1, 1, 2)]);
    const removedAll = planStructureEdit(book, sheet.id, edit('column', 'delete', 1, 4));
    expect(removedAll.sheets[0].merges).toEqual([]);
  });

  it('updates frozen/repeated prefixes and boundary pagination without invalid duplicates', () => {
    const book = fixture(),
      sheet = book.sheets[0];
    sheet.frozenRows = 3;
    sheet.printSettings = {
      repeatRows: 3,
      rowBreaks: [4, 6, 8],
      repeatColumns: 1,
      columnBreaks: [4],
    };
    const inserted = planStructureEdit(book, sheet.id, edit('row', 'insert', 0, 2)).sheets[0];
    expect(inserted.frozenRows).toBe(5);
    expect(inserted.printSettings).toMatchObject({
      repeatRows: 5,
      rowBreaks: [6, 8, 10],
      columnBreaks: [4],
    });
    const atBoundary = planStructureEdit(book, sheet.id, edit('row', 'insert', 3, 1)).sheets[0];
    expect(atBoundary.frozenRows).toBe(3);
    expect(atBoundary.printSettings!.repeatRows).toBe(3);
    const deleted = planStructureEdit(book, sheet.id, edit('row', 'delete', 3, 4)).sheets[0];
    expect(deleted.printSettings).toMatchObject({ repeatRows: 3, rowBreaks: [4] });
    const leadingRemoved = planStructureEdit(book, sheet.id, edit('row', 'delete', 0, 2)).sheets[0];
    expect(leadingRemoved.frozenRows).toBe(1);
    expect(leadingRemoved.printSettings).toMatchObject({ repeatRows: 1, rowBreaks: [2, 4, 6] });
  });

  it('transforms validation ranges by explicit target id or owning sheet', () => {
    const book = fixture(),
      target = book.sheets[0],
      other = book.sheets[1];
    const rule = {
      id: 'local',
      kind: 'whole' as const,
      operator: 'between' as const,
      min: 0,
      max: 10,
      range: range(2, 0, 4, 0),
    };
    target.dataValidations = [rule, { ...rule, id: 'other-target', sheetId: other.id }];
    other.dataValidations = [
      { ...rule, id: 'explicit-target', sheetId: target.id },
      { ...rule, id: 'other-local' },
    ];
    const planned = planStructureEdit(book, target.id, edit('row', 'insert', 3, 2));
    expect(planned.sheets[0].dataValidations![0].range).toEqual(range(2, 0, 6, 0));
    expect(planned.sheets[0].dataValidations![1].range).toEqual(rule.range);
    expect(planned.sheets[1].dataValidations![0].range).toEqual(range(2, 0, 6, 0));
    expect(planned.sheets[1].dataValidations![1].range).toEqual(rule.range);
    const removed = planStructureEdit(book, target.id, edit('row', 'delete', 2, 3));
    expect(removed.sheets[0].dataValidations!.map((item) => item.id)).toEqual(['other-target']);
    expect(removed.sheets[1].dataValidations!.map((item) => item.id)).toEqual(['other-local']);
  });

  it('retains sparse storage for a million-row sheet', () => {
    const book = fixture(),
      sheet = book.sheets[0];
    sheet.rowCount = 1_000_000;
    sheet.cells = { A999999: { value: 9 } };
    book.sheets = [sheet];
    const planned = planStructureEdit(book, sheet.id, edit('row', 'insert', 0, 1));
    expect(Object.keys(planned.sheets[0].cells)).toEqual(['A1000000']);
    expect(planned.sheets[0].rowCount).toBe(1_000_001);
  });

  it.each([
    edit('row', 'insert', -1, 1),
    edit('row', 'insert', 11, 1),
    edit('row', 'insert', 1, 0),
    edit('row', 'delete', 9, 2),
    edit('row', 'delete', 0, 10),
    edit('column', 'delete', 0, 8),
    edit('row', 'insert', 0, MAX_ROWS),
    edit('column', 'insert', 0, MAX_COLUMNS),
  ])('rejects invalid edits atomically: %j', (operation) => {
    const book = fixture(),
      before = structuredClone(book);
    expect(() => planStructureEdit(book, book.sheets[0].id, operation)).toThrow('结构编辑');
    expect(book).toEqual(before);
  });

  it('rejects missing/paged targets, range overflow and conflicting merged print metadata', () => {
    const book = fixture(),
      sheet = book.sheets[0];
    expect(() => planStructureEdit(book, 'missing', edit('row', 'insert', 1, 1))).toThrow('找不到');
    sheet.dataSource = { kind: 'paged', totalRows: 10 };
    expect(() => planStructureEdit(book, sheet.id, edit('row', 'insert', 1, 1))).toThrow('只读');
    delete sheet.dataSource;
    sheet.dataValidations = [
      { id: 'overflow', kind: 'whole', operator: 'equal', value: 1, range: range(MAX_ROWS - 1, 0) },
    ];
    expect(() => planStructureEdit(book, sheet.id, edit('row', 'insert', 1, 1))).toThrow(
      '范围超出',
    );
    delete sheet.dataValidations;
    sheet.merges = [range(2, 0, 5, 0)];
    sheet.printSettings = { rowBreaks: [4] };
    expect(() => planStructureEdit(book, sheet.id, edit('row', 'insert', 8, 1))).toThrow(
      '跨越合并',
    );
  });
});

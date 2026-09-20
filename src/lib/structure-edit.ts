import { cellKey, MAX_COLUMNS, MAX_ROWS, parseCellKey } from './engine';
import { rewriteFormulaReferences, type StructureEdit } from './formula-structure';
import { copyPrintSettings } from './print-settings';
import type { Cell, CellRange, PrintSettings, Sheet, Workbook } from './types';

function fail(message: string): never {
  throw new Error(`结构编辑：${message}`);
}
function validateEdit(edit: StructureEdit) {
  if (
    !edit ||
    !['row', 'column'].includes(edit.axis) ||
    !['insert', 'delete'].includes(edit.kind) ||
    !Number.isSafeInteger(edit.index) ||
    edit.index < 0 ||
    !Number.isSafeInteger(edit.count) ||
    edit.count < 1
  )
    fail('行列操作、位置或数量无效。');
  const limit = edit.axis === 'row' ? MAX_ROWS : MAX_COLUMNS;
  if (
    edit.index > limit ||
    edit.count > limit ||
    (edit.kind === 'delete' && edit.index + edit.count > limit)
  )
    fail('操作超出行列上限。');
}
/** Maps one coordinate on the edited axis. Deleted coordinates have no successor. */
export function transformPosition(position: number, edit: StructureEdit): number | undefined {
  validateEdit(edit);
  const limit = edit.axis === 'row' ? MAX_ROWS : MAX_COLUMNS;
  if (!Number.isSafeInteger(position) || position < 0 || position >= limit)
    fail('坐标超出行列上限。');
  if (edit.kind === 'insert') {
    const next = position >= edit.index ? position + edit.count : position;
    if (next >= limit) fail('移动后的坐标超出行列上限。');
    return next;
  }
  if (position < edit.index) return position;
  if (position >= edit.index + edit.count) return position - edit.count;
  return undefined;
}
/** Inclusive ranges grow only for insertions inside their span; full deletion removes them. */
export function transformRange(range: CellRange, edit: StructureEdit): CellRange | undefined {
  validateEdit(edit);
  if (
    !range ||
    !range.start ||
    !range.end ||
    !Number.isSafeInteger(range.start.row) ||
    !Number.isSafeInteger(range.end.row) ||
    !Number.isSafeInteger(range.start.col) ||
    !Number.isSafeInteger(range.end.col) ||
    range.start.row < 0 ||
    range.start.col < 0 ||
    range.end.row >= MAX_ROWS ||
    range.end.col >= MAX_COLUMNS ||
    range.start.row > range.end.row ||
    range.start.col > range.end.col
  )
    fail('范围无效。');
  const key = edit.axis === 'row' ? 'row' : 'col';
  const start = range.start[key],
    end = range.end[key];
  let nextStart: number, nextEnd: number;
  if (edit.kind === 'insert') {
    nextStart = start >= edit.index ? start + edit.count : start;
    nextEnd = end >= edit.index ? end + edit.count : end;
  } else {
    const deletionEnd = edit.index + edit.count - 1;
    if (start >= edit.index && end <= deletionEnd) return undefined;
    nextStart = start < edit.index ? start : start > deletionEnd ? start - edit.count : edit.index;
    nextEnd = end > deletionEnd ? end - edit.count : end < edit.index ? end : edit.index - 1;
  }
  const limit = edit.axis === 'row' ? MAX_ROWS : MAX_COLUMNS;
  if (nextStart < 0 || nextEnd >= limit) fail('移动后的范围超出行列上限。');
  return { start: { ...range.start, [key]: nextStart }, end: { ...range.end, [key]: nextEnd } };
}
function transformPrefix(count: number, edit: StructureEdit): number {
  if (edit.kind === 'insert') return edit.index < count ? count + edit.count : count;
  return (
    count - Math.max(0, Math.min(count, edit.index + edit.count) - Math.min(count, edit.index))
  );
}
function transformBreaks(
  breaks: number[],
  edit: StructureEdit,
  repeat: number,
  dimension: number,
): number[] {
  const values = breaks.map((position) => {
    if (edit.kind === 'insert') return position >= edit.index ? position + edit.count : position;
    if (position >= edit.index + edit.count) return position - edit.count;
    return position >= edit.index ? edit.index : position;
  });
  // Collapsed boundaries at the start/end or repeated-title boundary are redundant.
  return [...new Set(values)].filter((position) => position > repeat && position < dimension);
}
function checkPrintMerges(sheet: Sheet) {
  const print = sheet.printSettings;
  if (!print) return;
  for (const merge of sheet.merges ?? []) {
    for (const [start, end, repeat, breaks] of [
      [
        merge.start.row,
        merge.end.row,
        print.repeatRows ?? sheet.frozenRows ?? 0,
        print.rowBreaks ?? [],
      ],
      [merge.start.col, merge.end.col, print.repeatColumns ?? 0, print.columnBreaks ?? []],
    ] as const) {
      if (start < repeat && end >= repeat) fail('合并区域跨越重复标题边界。');
      if (breaks.some((position) => start < position && end >= position))
        fail('手动分页跨越合并区域。');
    }
  }
}
function metadataForTarget(source: Sheet, next: Sheet, edit: StructureEdit) {
  if (edit.axis === 'column' && source.columnWidths) {
    const widths: Record<number, number> = {};
    for (const [raw, width] of Object.entries(source.columnWidths)) {
      if (!/^\d+$/.test(raw)) fail('列宽坐标无效。');
      const col = transformPosition(Number(raw), edit);
      if (col !== undefined) widths[col] = width;
    }
    next.columnWidths = widths;
  }
  if (edit.axis === 'row' && source.rowHeights) {
    const heights: Record<number, number> = {};
    for (const [raw, height] of Object.entries(source.rowHeights)) {
      if (!/^\d+$/.test(raw)) fail('行高坐标无效。');
      const row = transformPosition(Number(raw), edit);
      if (row !== undefined) heights[row] = height;
    }
    next.rowHeights = heights;
  }
  if (source.hiddenRows) {
    next.hiddenRows = source.hiddenRows
      .map((row) => (edit.axis === 'row' ? transformPosition(row, edit) : row))
      .filter((row): row is number => row !== undefined);
  }
  if (source.hiddenColumns) {
    next.hiddenColumns = source.hiddenColumns
      .map((col) => (edit.axis === 'column' ? transformPosition(col, edit) : col))
      .filter((col): col is number => col !== undefined);
  }
  if (edit.axis === 'row' && source.frozenRows !== undefined)
    next.frozenRows = transformPrefix(source.frozenRows, edit);
  if (source.merges)
    next.merges = source.merges.flatMap((merge) => {
      const transformed = transformRange(merge, edit);
      return transformed &&
        (transformed.start.row !== transformed.end.row ||
          transformed.start.col !== transformed.end.col)
        ? [transformed]
        : [];
    });
  if (source.printSettings) {
    const print: PrintSettings = copyPrintSettings(source.printSettings, source)!;
    const repeatKey = edit.axis === 'row' ? 'repeatRows' : 'repeatColumns';
    const breakKey = edit.axis === 'row' ? 'rowBreaks' : 'columnBreaks';
    if (print[repeatKey] !== undefined) print[repeatKey] = transformPrefix(print[repeatKey]!, edit);
    if (print[breakKey]) {
      const repeat = print[repeatKey] ?? (edit.axis === 'row' ? (next.frozenRows ?? 0) : 0);
      print[breakKey] = transformBreaks(
        print[breakKey]!,
        edit,
        repeat,
        edit.axis === 'row' ? next.rowCount : next.colCount,
      );
    }
    next.printSettings = copyPrintSettings(print, next);
  }
  if (
    source.dataSource?.kind === 'static' &&
    source.dataSource.totalRows !== undefined &&
    edit.axis === 'row'
  )
    next.dataSource = { ...source.dataSource, totalRows: next.rowCount };
  checkPrintMerges(next);
}

/**
 * Plans an atomic sparse workbook edit. Scans stored cells in every sheet to rewrite
 * cross-sheet formulas; never allocates the logical row × column grid. Unchanged
 * sheets retain identity, changed sheets are isolated copies suitable for history.
 */
export function planStructureEdit(
  workbook: Workbook,
  sheetId: string,
  edit: StructureEdit,
): { sheets: Sheet[]; changedSheetIds: string[] } {
  validateEdit(edit);
  const target = workbook.sheets.find((sheet) => sheet.id === sheetId);
  if (!target) fail('找不到目标工作表。');
  if (target.dataSource?.kind === 'paged') fail('分页数据源为只读，不能编辑行列结构。');
  const dimension = edit.axis === 'row' ? target.rowCount : target.colCount;
  const limit = edit.axis === 'row' ? MAX_ROWS : MAX_COLUMNS;
  if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > limit)
    fail('目标工作表尺寸无效。');
  if (edit.index > dimension || (edit.kind === 'delete' && edit.index + edit.count > dimension))
    fail('操作超出工作表范围。');
  const nextDimension = dimension + (edit.kind === 'insert' ? edit.count : -edit.count);
  if (nextDimension < 1) fail('不能删除工作表全部行或列。');
  if (nextDimension > limit) fail('插入后超过工作表行列上限。');
  const changedSheetIds: string[] = [];
  const sheets = workbook.sheets.map((source) => {
    const isTarget = source.id === target.id;
    let changed = isTarget;
    const cells: Record<string, Cell> = {};
    for (const [key, cell] of Object.entries(source.cells)) {
      const point = parseCellKey(key);
      if (!point) fail(`单元格地址无效：${key}`);
      let nextKey = key;
      if (isTarget) {
        const axisKey = edit.axis === 'row' ? 'row' : 'col';
        const position = transformPosition(point[axisKey], edit);
        if (position === undefined) continue;
        nextKey = cellKey(
          edit.axis === 'row' ? position : point.row,
          edit.axis === 'column' ? position : point.col,
        );
      }
      const value =
        typeof cell.value === 'string' && cell.value.startsWith('=')
          ? rewriteFormulaReferences(cell.value, {
              formulaSheetName: source.name,
              targetSheetName: target.name,
              edit,
            })
          : cell.value;
      if (value !== cell.value) changed = true;
      cells[nextKey] = value === cell.value ? cell : { ...cell, value };
    }
    const next: Sheet = { ...source, cells };
    if (isTarget) {
      if (edit.axis === 'row') next.rowCount = nextDimension;
      else next.colCount = nextDimension;
      metadataForTarget(source, next, edit);
    }
    if (source.dataValidations) {
      next.dataValidations = source.dataValidations.flatMap((rule) => {
        if ((rule.sheetId ?? source.id) !== target.id) return [rule];
        const range = transformRange(rule.range, edit);
        if (!range) {
          changed = true;
          return [];
        }
        if (
          range.start.row === rule.range.start.row &&
          range.start.col === rule.range.start.col &&
          range.end.row === rule.range.end.row &&
          range.end.col === rule.range.end.col
        )
          return [rule];
        changed = true;
        return [{ ...rule, range }];
      });
    }
    if (!changed) return source;
    changedSheetIds.push(source.id);
    return structuredClone(next);
  });
  return { sheets, changedSheetIds };
}

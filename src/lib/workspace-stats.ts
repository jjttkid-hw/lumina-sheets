import { cellKey, parseCellKey } from './engine';
import type { CellValue, Selection, Sheet } from './types';

/** Small selections read coordinates directly; large selections scan stored cells
 * instead of expanding logical blanks. Workspace storage uses canonical A1 keys. */
export function readSelectionStats(
  sheet: Sheet,
  selection: Selection,
  evaluate: (sheet: Sheet, key: string) => CellValue,
) {
  const top = Math.max(0, Math.min(selection.row, selection.endRow ?? selection.row));
  const bottom = Math.min(
    sheet.rowCount - 1,
    Math.max(selection.row, selection.endRow ?? selection.row),
  );
  const left = Math.max(0, Math.min(selection.col, selection.endCol ?? selection.col));
  const right = Math.min(
    sheet.colCount - 1,
    Math.max(selection.col, selection.endCol ?? selection.col),
  );
  let count = 0,
    sum = 0,
    numbers = 0;
  const include = (key: string) => {
    const value = evaluate(sheet, key);
    if (value !== '') count++;
    if (typeof value === 'number') {
      sum += value;
      numbers++;
    }
  };
  if (bottom < top || right < left) return { count, sum, avg: 0 };
  const area = (bottom - top + 1) * (right - left + 1);
  if (area <= 4096) {
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        const key = cellKey(row, col);
        if (Object.hasOwn(sheet.cells, key)) include(key);
      }
    }
  } else {
    for (const key in sheet.cells) {
      if (!Object.hasOwn(sheet.cells, key)) continue;
      const point = parseCellKey(key);
      if (
        point &&
        point.row >= top &&
        point.row <= bottom &&
        point.col >= left &&
        point.col <= right
      )
        include(key);
    }
  }
  return { count, sum, avg: numbers ? sum / numbers : 0 };
}

/** Dashboard counts retain raw-value semantics: a stored formula is populated
 * even when it evaluates to an empty string. Row zero is treated as a header. */
export function readSheetPopulation(sheet: Sheet) {
  const rows = new Set<number>();
  let cells = 0;
  for (const key in sheet.cells) {
    if (!Object.hasOwn(sheet.cells, key) || sheet.cells[key].value === '') continue;
    cells++;
    const point = parseCellKey(key);
    if (point && point.row > 0) rows.add(point.row);
  }
  return { rows: rows.size, cells };
}

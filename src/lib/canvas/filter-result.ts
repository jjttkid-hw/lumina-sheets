/** Every input which can change the meaning or bounds of a filtered row list. */
export interface FilterSource {
  sheetId: string;
  cells: object;
  text: string;
  frozenRows: number;
  rowCount: number;
  calculationVersion: number;
  evaluator: unknown;
}

export interface FilterResult {
  source: FilterSource;
  rows: number[];
}

/** Until the current scan finishes, show the current sheet without filtering. */
export function currentFilteredRows(
  result: FilterResult | null,
  source: FilterSource,
): number[] | null {
  if (!source.text || !result) return null;
  const previous = result.source;
  return previous.sheetId === source.sheetId &&
    previous.cells === source.cells &&
    previous.text === source.text &&
    previous.frozenRows === source.frozenRows &&
    previous.rowCount === source.rowCount &&
    previous.calculationVersion === source.calculationVersion &&
    previous.evaluator === source.evaluator
    ? result.rows
    : null;
}

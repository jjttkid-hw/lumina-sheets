import type { CalculationRequest, CalculationTarget } from './calculation';
import type { Cell, Sheet, Workbook } from './types';
import { cellKey, parseCellKey } from './engine';

export interface CalculationTransfer {
  type: 'calculate-sheets';
  revision: number;
  id: number;
  baseId: number | null;
  workbookId: string;
  sheetIds: string[];
  sheets: Sheet[];
  sheetPatches?: { sheetId: string; cells: { key: string; cell: Cell | null }[] }[];
  targets: CalculationTarget[];
}

// Bound patch bookkeeping. Bulk updates use one complete value snapshot instead.
export const CALCULATION_PATCH_LIMIT = 4096;

function valueSheet(sheet: Sheet): Sheet {
  const cells: Record<string, Cell> = {};
  for (const key of Object.keys(sheet.cells)) cells[key] = { value: sheet.cells[key].value };
  return {
    id: sheet.id,
    name: sheet.name,
    rowCount: sheet.rowCount,
    colCount: sheet.colCount,
    ...(sheet.dataSource ? { dataSource: { ...sheet.dataSource } } : {}),
    cells,
  };
}

function changedValues(before: Sheet, after: Sheet) {
  const cells: { key: string; cell: Cell | null }[] = [];
  for (const key in after.cells) {
    if (!Object.hasOwn(after.cells, key)) continue;
    if (
      !Object.hasOwn(before.cells, key) ||
      !Object.is(before.cells[key].value, after.cells[key].value)
    ) {
      cells.push({ key, cell: { value: after.cells[key].value } });
      if (cells.length > CALCULATION_PATCH_LIMIT) return undefined;
    }
  }
  for (const key in before.cells) {
    if (!Object.hasOwn(before.cells, key) || Object.hasOwn(after.cells, key)) continue;
    cells.push({ key, cell: null });
    if (cells.length > CALCULATION_PATCH_LIMIT) return undefined;
  }
  return cells;
}

/** Sender tracks immutable sheet dictionaries only after postMessage succeeds. */
export class CalculationTransferSender {
  private last?: { id: number; workbook: Workbook };
  reset() {
    this.last = undefined;
  }
  prepare(request: CalculationRequest, id: number): CalculationTransfer {
    const previous = this.last?.workbook.id === request.workbook.id ? this.last : undefined;
    const old = new Map(previous?.workbook.sheets.map((sheet) => [sheet.id, sheet]));
    const sheets: Sheet[] = [];
    const sheetPatches: NonNullable<CalculationTransfer['sheetPatches']> = [];
    for (const sheet of request.workbook.sheets) {
      const before = old.get(sheet.id);
      if (
        !before ||
        before.name !== sheet.name ||
        before.rowCount !== sheet.rowCount ||
        before.colCount !== sheet.colCount ||
        before.dataSource?.kind !== sheet.dataSource?.kind ||
        before.dataSource?.totalRows !== sheet.dataSource?.totalRows ||
        before.dataSource?.pageSize !== sheet.dataSource?.pageSize
      ) {
        sheets.push(valueSheet(sheet));
      } else if (before.cells !== sheet.cells) {
        const cells = changedValues(before, sheet);
        if (!cells) sheets.push(valueSheet(sheet));
        else if (cells.length) sheetPatches.push({ sheetId: sheet.id, cells });
      }
    }
    return {
      type: 'calculate-sheets',
      id,
      revision: request.revision,
      baseId: previous?.id ?? null,
      workbookId: request.workbook.id,
      sheetIds: request.workbook.sheets.map((sheet) => sheet.id),
      sheets,
      ...(sheetPatches.length ? { sheetPatches } : {}),
      targets: request.targets,
    };
  }
  commit(request: CalculationRequest, id: number) {
    this.last = { id, workbook: request.workbook };
  }
}

/** Worker-local value snapshot; a bad delta leaves the previous state intact. */
export class CalculationTransferReceiver {
  private last?: { id: number; workbook: Workbook };
  receive(message: CalculationTransfer): CalculationRequest {
    if (
      message.baseId !== null &&
      (this.last?.id !== message.baseId || this.last.workbook.id !== message.workbookId)
    )
      throw new Error('Calculation snapshot base mismatch');
    const sheets = new Map(
      message.baseId === null
        ? []
        : this.last!.workbook.sheets.map((sheet) => [sheet.id, sheet] as const),
    );
    const ids = new Set(message.sheetIds);
    if (ids.size !== message.sheetIds.length || !ids.size)
      throw new Error('Invalid calculation sheet directory');
    const replaced = new Set<string>();
    for (const sheet of message.sheets) {
      if (!ids.has(sheet.id) || replaced.has(sheet.id))
        throw new Error('Invalid calculation sheet replacement');
      replaced.add(sheet.id);
      sheets.set(sheet.id, sheet);
    }
    for (const patch of message.sheetPatches ?? []) {
      const sheet = sheets.get(patch.sheetId);
      if (
        message.baseId === null ||
        !sheet ||
        !ids.has(patch.sheetId) ||
        replaced.has(patch.sheetId) ||
        patch.cells.length > CALCULATION_PATCH_LIMIT
      )
        throw new Error('Invalid calculation sheet patch');
      replaced.add(patch.sheetId);
      const cells = { ...sheet.cells };
      const keys = new Set<string>();
      for (const change of patch.cells) {
        const point = parseCellKey(change.key);
        if (
          !point ||
          cellKey(point.row, point.col) !== change.key ||
          point.row >= sheet.rowCount ||
          point.col >= sheet.colCount ||
          keys.has(change.key)
        )
          throw new Error('Invalid calculation cell patch');
        keys.add(change.key);
        if (change.cell === null) delete cells[change.key];
        else cells[change.key] = { value: change.cell.value };
      }
      sheets.set(patch.sheetId, { ...sheet, cells });
    }
    const ordered = message.sheetIds.map((id) => {
      const sheet = sheets.get(id);
      if (!sheet) throw new Error('Missing calculation sheet');
      return sheet;
    });
    const workbook: Workbook = {
      id: message.workbookId,
      name: '',
      description: '',
      createdAt: '',
      updatedAt: '',
      activeSheetId: ordered[0].id,
      sheets: ordered,
    };
    this.last = { id: message.id, workbook };
    return { type: 'calculate', workbook, targets: message.targets, revision: message.revision };
  }
}

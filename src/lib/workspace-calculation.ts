import type { WorkbookPatch } from './persistence';
import type { Workbook } from './types';

export interface WorkspaceCalculationInput {
  workbook: Workbook;
  revision: number;
}

/** App workbooks are immutable. Equivalent presentation edits reuse one value
 * source and revision; unknown snapshots conservatively start a new revision. */
export class WorkspaceCalculationInputs {
  private inputs = new WeakMap<Workbook, WorkspaceCalculationInput>();
  private revision = 0;

  get(workbook: Workbook): WorkspaceCalculationInput {
    let input = this.inputs.get(workbook);
    if (!input) {
      input = { workbook, revision: ++this.revision };
      this.inputs.set(workbook, input);
    }
    return input;
  }

  /** Patches must describe the complete committed edit (the App transaction contract). */
  register(before: Workbook, after: Workbook, patches?: readonly WorkbookPatch[]): void {
    if (sameCalculationData(before, after, patches)) this.inputs.set(after, this.get(before));
  }
}

function sameCalculationData(
  before: Workbook,
  after: Workbook,
  patches?: readonly WorkbookPatch[],
) {
  if (before.id !== after.id || before.sheets.length !== after.sheets.length) return false;
  const touched = new Map<string, Set<string>>();
  for (const patch of patches ?? []) {
    if (patch.kind !== 'cell') continue;
    const keys = touched.get(patch.sheetId) ?? new Set<string>();
    keys.add(patch.key);
    touched.set(patch.sheetId, keys);
  }
  return before.sheets.every((sheet, index) => {
    const next = after.sheets[index];
    if (
      sheet.id !== next.id ||
      sheet.name !== next.name ||
      sheet.rowCount !== next.rowCount ||
      sheet.colCount !== next.colCount ||
      sheet.dataSource !== next.dataSource
    )
      return false;
    if (sheet.cells === next.cells) return true;
    const keys = touched.get(sheet.id);
    if (!keys?.size) return false;
    for (const key of keys) {
      // Presence is significant: inserting/removing a stored blank is not
      // assumed equivalent to a style-only change to an existing cell.
      if (
        (sheet.cells[key] === undefined) !== (next.cells[key] === undefined) ||
        !Object.is(sheet.cells[key]?.value, next.cells[key]?.value)
      )
        return false;
    }
    return true;
  });
}

/** Scan sparsely with early stop per sheet; do not allocate all entries first. */
export function workspaceFormulaTargets(workbook: Workbook, limitPerSheet = 25_000) {
  if (!Number.isSafeInteger(limitPerSheet) || limitPerSheet < 0)
    throw new RangeError('公式目标上限必须为非负整数');
  const targets: Array<{ sheetId: string; key: string }> = [];
  if (!limitPerSheet) return targets;
  for (const sheet of workbook.sheets) {
    let count = 0;
    for (const key in sheet.cells) {
      if (!Object.hasOwn(sheet.cells, key)) continue;
      const value = sheet.cells[key].value;
      if (typeof value === 'string' && value.startsWith('=')) {
        targets.push({ sheetId: sheet.id, key });
        if (++count >= limitPerSheet) break;
      }
    }
  }
  return targets;
}

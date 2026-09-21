import { applyWorkbookPatches, type WorkbookPatch } from './persistence';
import type { Workbook } from './types';

type Entry =
  | { kind: 'patches'; workbookId: string; forward: WorkbookPatch[]; inverse: WorkbookPatch[] }
  | { kind: 'snapshot'; workbookId: string; workbook: Workbook };

export interface WorkspaceHistoryResult {
  workbook: Workbook;
  /** Omitted for structural/snapshot operations. */
  patches?: WorkbookPatch[];
}

/** Hybrid history: ordinary edits retain only touched values; structural changes
 * retain a snapshot. Callers commit validated edits and serialize persistence. */
export class WorkspaceHistory {
  private past: Entry[] = [];
  private future: Entry[] = [];
  constructor(private readonly limit = 60) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('历史容量必须为正整数');
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  clear() {
    this.past = [];
    this.future = [];
  }

  record(workbook: Workbook, patches?: readonly WorkbookPatch[]): void {
    if (patches && !patches.length) return;
    let entry: Entry;
    if (patches) {
      const sheets = new Map(workbook.sheets.map((sheet) => [sheet.id, sheet]));
      // Capture each original address/property only once, even if the batch
      // assigns it repeatedly. No workbook or cell dictionary enumeration.
      const cells = new Map<string, Set<string>>();
      const metadata = new Map<string, Set<string>>();
      const inverse: WorkbookPatch[] = [];
      for (const patch of patches) {
        const sheet = sheets.get(patch.sheetId);
        if (!sheet) throw new Error('找不到历史补丁工作表');
        if (patch.kind === 'cell') {
          const seen = cells.get(sheet.id) ?? new Set<string>();
          cells.set(sheet.id, seen);
          if (seen.has(patch.key)) continue;
          seen.add(patch.key);
          inverse.push({
            kind: 'cell',
            sheetId: sheet.id,
            key: patch.key,
            cell: sheet.cells[patch.key] ?? null,
          });
        } else {
          const seen = metadata.get(sheet.id) ?? new Set<string>();
          metadata.set(sheet.id, seen);
          const changes: Record<string, unknown> = {};
          for (const key of Object.keys(patch.changes)) {
            if (seen.has(key)) continue;
            seen.add(key);
            changes[key] = sheet[key as keyof typeof sheet];
          }
          if (Object.keys(changes).length)
            inverse.push({ kind: 'sheet-meta', sheetId: sheet.id, changes });
        }
      }
      entry = {
        kind: 'patches',
        workbookId: workbook.id,
        forward: structuredClone([...patches]),
        inverse: structuredClone(inverse),
      };
    } else
      entry = { kind: 'snapshot', workbookId: workbook.id, workbook: structuredClone(workbook) };
    this.past.push(entry);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(workbook: Workbook): WorkspaceHistoryResult | null {
    return this.move(workbook, false);
  }
  redo(workbook: Workbook): WorkspaceHistoryResult | null {
    return this.move(workbook, true);
  }
  private move(workbook: Workbook, redo: boolean): WorkspaceHistoryResult | null {
    const source = redo ? this.future : this.past,
      target = redo ? this.past : this.future;
    const entry = source.at(-1);
    if (!entry) return null;
    if (entry.workbookId !== workbook.id) throw new Error('历史记录不属于当前工作簿');
    let result: WorkspaceHistoryResult, counterpart: Entry;
    if (entry.kind === 'patches') {
      const patches = structuredClone(redo ? entry.forward : entry.inverse);
      result = { workbook: applyWorkbookPatches(workbook, patches), patches };
      counterpart = entry;
    } else {
      result = { workbook: structuredClone(entry.workbook) };
      counterpart = {
        kind: 'snapshot',
        workbookId: workbook.id,
        workbook: structuredClone(workbook),
      };
    }
    source.pop();
    target.push(counterpart);
    return result;
  }
}

import type { Workbook } from './types';

/** Reserve the suffix inside the persisted 200 UTF-16 unit name limit. */
export function workbookCopyName(name: string, suffix: string): string {
  let prefix = name.slice(0, Math.max(0, 200 - suffix.length));
  const last = prefix.charCodeAt(prefix.length - 1);
  const next = name.charCodeAt(prefix.length);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
    prefix = prefix.slice(0, -1);
  return prefix + suffix;
}

/** Fork identity while keeping sheet-scoped validation attached to the copied sheets. */
export function independentWorkbookCopy(source: Workbook): Workbook {
  const copy = structuredClone(source);
  const ids = new Map(copy.sheets.map((sheet) => [sheet.id, crypto.randomUUID()]));
  copy.id = crypto.randomUUID();
  for (const sheet of copy.sheets) {
    sheet.id = ids.get(sheet.id)!;
    for (const rule of sheet.dataValidations ?? []) {
      if (rule.sheetId !== undefined && ids.has(rule.sheetId))
        rule.sheetId = ids.get(rule.sheetId)!;
    }
  }
  copy.activeSheetId = ids.get(copy.activeSheetId) ?? copy.sheets[0].id;
  return copy;
}

import { parseCellKey } from './engine';
import type { Workbook } from './types';

/** Only explicit web/mail schemes become clickable. Other targets stay data. */
export function externalHyperlinkUrl(target: string): string | undefined {
  if (target !== target.trim() || /[\u0000-\u0020\u007f\\]/.test(target)) return undefined;
  if (!/^(https?:\/\/|mailto:)/i.test(target)) return undefined;
  try {
    const url = new URL(target);
    if (url.protocol === 'mailto:') return url.pathname ? url.href : undefined;
    if (!url.hostname || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function resolveInternalHyperlink(book: Workbook, sourceSheetId: string, target: string) {
  const match =
    /^#(?:(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_.]*))!)?(\$?[A-Za-z]{1,3}\$?[1-9]\d*)$/u.exec(
      target,
    );
  if (!match) throw new Error('链接目标不是有效的工作簿内单元格地址。');
  const name = match[1]?.replaceAll("''", "'") ?? match[2];
  const sheet =
    name === undefined
      ? book.sheets.find((sheet) => sheet.id === sourceSheetId)
      : book.sheets.find((sheet) => sheet.name.toLowerCase() === name.toLowerCase());
  const point = parseCellKey(match[3]);
  if (!sheet || !point || point.row >= sheet.rowCount || point.col >= sheet.colCount)
    throw new Error('链接目标工作表或单元格不存在。');
  if (sheet.hiddenRows?.includes(point.row) || sheet.hiddenColumns?.includes(point.col))
    throw new Error('目标位于隐藏行列中，请先取消隐藏。');
  const merge = sheet.merges?.find(
    (range) =>
      point.row >= range.start.row &&
      point.row <= range.end.row &&
      point.col >= range.start.col &&
      point.col <= range.end.col,
  );
  const destination = merge ? merge.start : point;
  if (sheet.hiddenRows?.includes(destination.row) || sheet.hiddenColumns?.includes(destination.col))
    throw new Error('目标合并单元格的主格位于隐藏行列中，请先取消隐藏。');
  return { sheetId: sheet.id, ...destination };
}

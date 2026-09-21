import { renameFormulaSheet } from './formula-structure';
import type { Workbook } from './types';

/** Build a complete rename candidate before any history or storage mutation. */
export function planSheetRename(book: Workbook, sheetId: string, name: string): Workbook {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 31 ||
    /[\\/*?:[\]\u0000-\u001f]/.test(name) ||
    /^'|'$/.test(name) ||
    name.toLowerCase() === 'history'
  )
    throw new Error(
      '工作表名称须为 1–31 个字符，不含 \\ / * ? : [ ]、控制字符，不能以单引号开头或结尾，不能为 History。',
    );
  const target = book.sheets.find((s) => s.id === sheetId);
  if (!target) throw new Error('找不到工作表。');
  if (target.dataSource?.kind === 'paged') throw new Error('分页工作表只读，不能重命名。');
  if (book.sheets.some((s) => s.id !== sheetId && s.name.toLowerCase() === name.toLowerCase()))
    throw new Error('工作表名称已存在。');
  if (target.name === name) return book;
  const sheets = book.sheets.map((source) => {
    let changed = source.id === sheetId;
    const cells = { ...source.cells };
    for (const [key, cell] of Object.entries(source.cells)) {
      const value =
        typeof cell.value === 'string' && cell.value.startsWith('=')
          ? renameFormulaSheet(cell.value, source.name, target.name, name)
          : cell.value;
      if (typeof value === 'string' && value.length > 8192 && value.startsWith('='))
        throw new Error('重命名后的公式超过 8,192 字符，请缩短工作表名称。');
      let link = cell.hyperlink?.target;
      if (link) {
        const match =
          /^#(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_.]*))!(\$?[A-Za-z]{1,3}\$?[1-9]\d*)$/u.exec(
            link,
          );
        if (
          match &&
          (match[1]?.replaceAll("''", "'") ?? match[2]).toLowerCase() === target.name.toLowerCase()
        )
          link = `#'${name.replaceAll("'", "''")}'!${match[3]}`;
      }
      if (value !== cell.value || link !== cell.hyperlink?.target) {
        changed = true;
        cells[key] = {
          ...cell,
          value,
          ...(cell.hyperlink ? { hyperlink: { ...cell.hyperlink, target: link! } } : {}),
        };
      }
    }
    if (!changed) return source;
    if (source.dataSource?.kind === 'paged')
      throw new Error('关联引用位于只读分页工作表，不能重命名。');
    return { ...source, name: source.id === sheetId ? name : source.name, cells };
  });
  return { ...book, sheets };
}

import { parseCellKey } from './engine';
import { replaceCellText } from './rich-text';
import type { Cell, Sheet } from './types';

export const MAX_SEARCH_MATCHES = 100_000;
export const MAX_SEARCH_CELLS = 100_000;
export const MAX_SEARCH_TEXT_UNITS = 32_000_000;

export interface FindCellsOptions {
  matchCase?: boolean;
  wholeCell?: boolean;
  /** Search formula source, never calculated results. Default: false. */
  includeFormulas?: boolean;
  /** Exceeding any budget rejects the entire operation, without partial results. */
  maxMatches?: number;
  maxCells?: number;
  maxTextUnits?: number;
}

export interface CellMatch {
  sheetId: string;
  key: string;
  value: string;
  /** UTF-16 source offset and length, including case-insensitive Unicode matches. */
  index: number;
  length: number;
}

export interface ReplaceAllRequest extends FindCellsOptions {
  search: string;
  /** Literal text; empty string deletes matched text. */
  replacement: string;
}

export interface ReplaceAllResult {
  matches: number;
  changedCells: number;
  changes: Array<{ key: string; cell: Cell }>;
}

function text(value: unknown, label: string, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.length) || value.length > 32767)
    throw new RangeError(`${label}必须为 ${empty ? '0' : '1'}–32,767 个字符。`);
  return value;
}
function budget(value: unknown, maximum: number, label: string) {
  if (value === undefined) return maximum;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new RangeError(`${label}上限必须为 1–${maximum.toLocaleString('en-US')} 的整数。`);
  return value;
}

/** Stored source strings only, ordered by row, column and non-overlapping source offset.
 * Case-insensitive matching uses ECMAScript Unicode simple case folding, not locale casing.
 * Hidden/filtered cells are included. Paged sources require server-side search instead.
 */
export function findStoredCells(
  sheet: Sheet,
  search: string,
  options: FindCellsOptions = {},
): CellMatch[] {
  const needle = text(search, '查找内容');
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('查找选项必须为对象。');
  for (const name of ['matchCase', 'wholeCell', 'includeFormulas'] as const)
    if (options[name] !== undefined && typeof options[name] !== 'boolean')
      throw new TypeError(`${name} 必须为布尔值。`);
  const maxMatches = budget(options.maxMatches, MAX_SEARCH_MATCHES, '匹配数量');
  const maxCells = budget(options.maxCells, MAX_SEARCH_CELLS, '已存储单元格数量');
  const maxText = budget(options.maxTextUnits, MAX_SEARCH_TEXT_UNITS, '文本扫描字符数量');
  if (sheet.dataSource?.kind === 'paged')
    throw new Error('分页数据源需要由服务端查找，不能只查找已缓存数据。');
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, options.matchCase ? 'gu' : 'giu');
  const matches: CellMatch[] = [];
  let visited = 0,
    scanned = 0;
  for (const key in sheet.cells) {
    if (!Object.hasOwn(sheet.cells, key)) continue;
    if (++visited > maxCells) throw new RangeError('已存储单元格数量超过查找上限，请缩小工作表。');
    const value = sheet.cells[key].value;
    if (typeof value !== 'string') continue;
    scanned += value.length;
    if (scanned > maxText) throw new RangeError('文本扫描字符数量超过查找上限，请缩小工作表。');
    if (!options.includeFormulas && value.startsWith('=')) continue;
    const point = parseCellKey(key);
    if (!point || point.row >= sheet.rowCount || point.col >= sheet.colCount)
      throw new Error(`查找遇到无效地址：${key}`);
    pattern.lastIndex = 0;
    let found: RegExpExecArray | null;
    while ((found = pattern.exec(value))) {
      if (options.wholeCell && (found.index !== 0 || found[0].length !== value.length)) break;
      if (matches.length >= maxMatches)
        throw new RangeError('匹配数量超过查找上限，未返回部分结果或替换任何内容。');
      matches.push({ sheetId: sheet.id, key, value, index: found.index, length: found[0].length });
    }
  }
  const positions = new Map(matches.map(({ key }) => [key, parseCellKey(key)!]));
  return matches.sort((a, b) => {
    const p = positions.get(a.key)!,
      q = positions.get(b.key)!;
    return p.row - q.row || p.col - q.col || a.index - b.index;
  });
}

/** Plans replacements without mutating the source. The caller validates and commits one transaction. */
export function replaceStoredCells(sheet: Sheet, request: ReplaceAllRequest): ReplaceAllResult {
  if (!request || typeof request !== 'object' || Array.isArray(request))
    throw new TypeError('替换请求必须为对象。');
  const replacement = text(request.replacement, '替换内容', true);
  const matches = findStoredCells(sheet, request.search, request);
  const changes: ReplaceAllResult['changes'] = [];
  let outputUnits = 0;
  for (let i = 0; i < matches.length;) {
    const first = matches[i],
      parts: string[] = [];
    let from = 0,
      size = first.value.length;
    while (i < matches.length && matches[i].key === first.key) {
      const match = matches[i++];
      size += replacement.length - match.length;
      if (size > 32767) throw new RangeError('替换后单元格文字超过 32,767 个字符，整批未修改。');
      parts.push(first.value.slice(from, match.index), replacement);
      from = match.index + match.length;
    }
    if (size > 32767) throw new RangeError('替换后单元格文字超过 32,767 个字符，整批未修改。');
    outputUnits += size;
    if (outputUnits > MAX_SEARCH_TEXT_UNITS)
      throw new RangeError('替换后文本超过批量处理上限，整批未修改。');
    parts.push(first.value.slice(from));
    const next = parts.join('');
    if (next === first.value) continue;
    if (!first.value.startsWith('=') && next.startsWith('='))
      throw new Error('替换不能将普通文字转换为公式，请通过单元格编辑显式输入公式。');
    changes.push({
      key: first.key,
      cell: structuredClone(replaceCellText(sheet.cells[first.key], next)),
    });
  }
  return { matches: matches.length, changedCells: changes.length, changes };
}

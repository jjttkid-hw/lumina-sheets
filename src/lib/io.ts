import type { Cell, CellRange, CellStyle, CellValue, Sheet, Workbook } from './types';
import { copyRichText } from './rich-text';
import { encodeXlsxString } from './xlsx-string';
import { copyHyperlink } from './cell-hyperlink';
import { cellKey, createEvaluator, parseCellKey, MAX_ROWS } from './engine';
import { createBlankWorkbook, makeId } from './seed';
import type ExcelJS from 'exceljs';
import { workbookCsvBlob } from './io-stream';
import { workbookPdfBlob } from './report-pdf';
import { copyPrintSettings } from './print-settings';
import { copyDataValidationRules } from './data-validation';
import { awaitFileOperation } from './file-operation';
import { readUtf8File } from './file-text';

export const IMPORT_LIMITS = {
  bytes: 20 * 1024 * 1024,
  cells: 100_000,
  sheets: 50,
  rows: 100_000,
  columns: 256,
  mergedCells: 10_000,
  mergedSheetCells: 100_000,
  frozenRows: 20,
};
function reject(message: string): never {
  throw new Error(message);
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const colorPattern = /^#[\da-f]{6}$/i;
function cleanStyle(input: unknown): CellStyle | undefined {
  if (!isRecord(input)) return undefined;
  const style: CellStyle = {};
  for (const key of ['bold', 'italic', 'underline'] as const)
    if (typeof input[key] === 'boolean') style[key] = input[key];
  for (const key of ['color', 'background'] as const)
    if (typeof input[key] === 'string' && colorPattern.test(input[key])) style[key] = input[key];
  if (['left', 'center', 'right'].includes(String(input.align)))
    style.align = input.align as CellStyle['align'];
  if (['general', 'number', 'currency', 'percent', 'date'].includes(String(input.format)))
    style.format = input.format as CellStyle['format'];
  if (typeof input.fontSize === 'number' && input.fontSize >= 6 && input.fontSize <= 96)
    style.fontSize = input.fontSize;
  return Object.keys(style).length ? style : undefined;
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
function validateSheetName(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 31 ||
    /[\\/*?:[\]\u0000-\u001f]/.test(value) ||
    /^'|'$/.test(value) ||
    value.toLowerCase() === 'history'
  )
    reject(
      '工作表名称必须为 1–31 个字符，不能包含 \\ / * ? : [ ]、控制字符，或以单引号开头/结尾；History 为保留名称。',
    );
}
function validateDimensions(rows: unknown, columns: unknown): void {
  if (!integer(rows, 1, IMPORT_LIMITS.rows) || !integer(columns, 1, IMPORT_LIMITS.columns))
    reject('工作表最多支持 100,000 行和 256 列。');
}
function sparseAxis(value: unknown, dimension: number, label: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) reject(`${label}必须为数组。`);
  const values = value.map((item) => {
    if (!integer(item, 0, dimension - 1)) reject(`${label}坐标无效。`);
    return item;
  });
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length !== values.length) reject(`${label}不能重复。`);
  return unique;
}
function sparseHeights(value: unknown, dimension: number): Record<number, number> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) reject('行高配置必须为对象。');
  const result: Record<number, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^\d+$/.test(key) || Number(key) >= dimension) reject('行高坐标无效。');
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1 || raw > 600)
      reject('行高必须为 1–600 像素。');
    result[Number(key)] = raw;
  }
  return result;
}

/** Validates persisted/imported workbooks and returns a fresh, sanitized object. */
export function validateWorkbook(input: unknown): Workbook {
  if (
    !isRecord(input) ||
    !Array.isArray(input.sheets) ||
    !input.sheets.length ||
    input.sheets.length > IMPORT_LIMITS.sheets
  )
    reject('工作簿格式不正确，或工作表数量超过 50 个。');
  const sheetsInput = input.sheets as unknown[];
  let total = 0;
  let mergedTotal = 0;
  const ids = new Set<string>();
  const names = new Set<string>();
  // Reserve all supplied identities before generating missing ones. Ambiguous
  // identities cannot be repaired without guessing rule/active-sheet targets.
  for (const raw of sheetsInput) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) continue;
    if (ids.has(raw.id)) reject('工作表 ID 不能重复；请修正文件后重新导入。');
    ids.add(raw.id);
  }
  const sheets = sheetsInput.map((raw): Sheet => {
    if (!isRecord(raw) || !isRecord(raw.cells)) reject('工作表格式不正确。');
    validateSheetName(raw.name);
    validateDimensions(raw.rowCount, raw.colCount);
    const rowCount = raw.rowCount as number;
    const colCount = raw.colCount as number;
    // Preserve the exact sheet name so quoted cross-sheet formula references remain valid.
    const name = raw.name;
    if (names.has(name.toLowerCase())) reject('工作表名称不能重复。');
    names.add(name.toLowerCase());
    const cells: Record<string, Cell> = {};
    for (const [key, value] of Object.entries(raw.cells)) {
      if (++total > IMPORT_LIMITS.cells) reject('工作簿超过 100,000 个单元格限制。');
      const position = parseCellKey(key);
      if (!position || position.row >= rowCount || position.col >= colCount || !isRecord(value))
        reject('单元格地址或内容无效。');
      if (
        !['string', 'number', 'boolean'].includes(typeof value.value) ||
        (typeof value.value === 'number' && !Number.isFinite(value.value))
      )
        reject('单元格值必须是文本、数字或布尔值。');
      if (typeof value.value === 'string' && value.value.length > 32767)
        reject('单元格文本超过 32,767 个字符。');
      const canonicalKey = cellKey(position.row, position.col);
      if (Object.hasOwn(cells, canonicalKey))
        reject(`单元格地址重复：${key} 与其他地址指向 ${canonicalKey}。`);
      cells[canonicalKey] = {
        value: value.value as CellValue,
        ...(value.richText !== undefined
          ? { richText: copyRichText(value.richText, value.value as CellValue) }
          : {}),
        ...(cleanStyle(value.style) ? { style: cleanStyle(value.style) } : {}),
        ...(value.hyperlink !== undefined
          ? { hyperlink: copyHyperlink(value.hyperlink, value.value) }
          : {}),
      };
    }
    const columnWidths: Record<number, number> = {};
    if (isRecord(raw.columnWidths))
      for (const [key, value] of Object.entries(raw.columnWidths))
        if (
          /^\d+$/.test(key) &&
          Number(key) < colCount &&
          typeof value === 'number' &&
          Number.isFinite(value)
        )
          columnWidths[Number(key)] = Math.min(600, Math.max(48, value));
    let id = typeof raw.id === 'string' && raw.id ? raw.id : '';
    if (!id) {
      do {
        id = makeId();
      } while (ids.has(id));
      ids.add(id);
    }
    const sheet: Sheet = {
      id,
      name,
      cells,
      rowCount,
      colCount,
      columnWidths,
      rowHeights: sparseHeights(raw.rowHeights, rowCount),
      hiddenRows: sparseAxis(raw.hiddenRows, rowCount, '隐藏行'),
      hiddenColumns: sparseAxis(raw.hiddenColumns, colCount, '隐藏列'),
    };
    if (raw.dataSource !== undefined) {
      const source = raw.dataSource;
      if (
        !isRecord(source) ||
        (source.kind !== 'static' && source.kind !== 'paged') ||
        (source.totalRows !== undefined && !integer(source.totalRows, 0, MAX_ROWS)) ||
        (source.pageSize !== undefined && !integer(source.pageSize, 1, MAX_ROWS))
      )
        reject('工作表数据源元数据无效。');
      sheet.dataSource = {
        kind: source.kind as 'static' | 'paged',
        ...(source.totalRows !== undefined ? { totalRows: source.totalRows as number } : {}),
        ...(source.pageSize !== undefined ? { pageSize: source.pageSize as number } : {}),
      };
    }
    if (raw.printSettings !== undefined)
      sheet.printSettings = copyPrintSettings(raw.printSettings, sheet);
    if (raw.dataValidations !== undefined)
      sheet.dataValidations = copyDataValidationRules(raw.dataValidations);
    if (raw.frozenRows !== undefined) {
      if (!integer(raw.frozenRows, 0, Math.min(rowCount, IMPORT_LIMITS.frozenRows)))
        reject('冻结行最多支持 20 行。');
      sheet.frozenRows = raw.frozenRows;
    }
    if (raw.merges !== undefined) {
      if (!Array.isArray(raw.merges)) reject('合并单元格格式不正确。');
      if (raw.merges.length && rowCount * colCount > IMPORT_LIMITS.mergedSheetCells)
        reject('包含合并单元格的工作表布局最多支持 100,000 个单元格。');
      const covered = new Set<number>();
      const merges: CellRange[] = [];
      for (const range of raw.merges) {
        if (
          !isRecord(range) ||
          !isRecord(range.start) ||
          !isRecord(range.end) ||
          !integer(range.start.row, 0, rowCount - 1) ||
          !integer(range.end.row, 0, rowCount - 1) ||
          !integer(range.start.col, 0, colCount - 1) ||
          !integer(range.end.col, 0, colCount - 1) ||
          range.start.row > range.end.row ||
          range.start.col > range.end.col
        )
          reject('合并单元格范围无效。');
        const area = (range.end.row - range.start.row + 1) * (range.end.col - range.start.col + 1);
        mergedTotal += area;
        if (mergedTotal > IMPORT_LIMITS.mergedCells)
          reject('合并区域累计最多覆盖 10,000 个单元格。');
        for (let row = range.start.row; row <= range.end.row; row++)
          for (let col = range.start.col; col <= range.end.col; col++) {
            const index = row * colCount + col;
            if (covered.has(index)) reject('合并单元格范围不能重叠。');
            covered.add(index);
          }
        merges.push({
          start: { row: range.start.row, col: range.start.col },
          end: { row: range.end.row, col: range.end.col },
        });
      }
      sheet.merges = merges;
    }
    return sheet;
  });
  const now = new Date().toISOString();
  const date = (value: unknown) =>
    typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : now;
  return {
    id: typeof input.id === 'string' && input.id ? input.id : makeId(),
    name:
      typeof input.name === 'string' && input.name.trim()
        ? input.name.slice(0, 200)
        : '导入的工作簿',
    description: typeof input.description === 'string' ? input.description.slice(0, 2000) : '',
    sheets,
    activeSheetId: sheets.find((s) => s.id === input.activeSheetId)?.id ?? sheets[0].id,
    createdAt: date(input.createdAt),
    updatedAt: date(input.updatedAt),
    starred: input.starred === true,
    category: typeof input.category === 'string' ? input.category.slice(0, 100) : '导入文件',
  };
}

/** Detect separators only outside quoted fields in the first logical record. */
function* detectDelimiter(text: string): Generator<void, string> {
  let quoted = false;
  let fieldStart = true;
  let comma = false;
  let tab = false;
  for (let i = 0, checkpoint = 32768; i < text.length; i++) {
    if (i >= checkpoint) {
      checkpoint = i + 32768;
      yield;
    }
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') i++;
        else quoted = false;
      }
      continue;
    }
    if (char === '\r' || char === '\n') break;
    if (char === '"' && fieldStart) quoted = true;
    else if (char === ',' || char === '\t') {
      comma ||= char === ',';
      tab ||= char === '\t';
      fieldStart = true;
      continue;
    }
    fieldStart = false;
  }
  return tab && !comma ? '\t' : ',';
}

function* csvParser(
  text: string,
  delimiter?: string,
  onRow?: (row: string[]) => void,
): Generator<void, string[][]> {
  if (text.length > IMPORT_LIMITS.bytes) reject('CSV 文件超过 20 MB 限制。');
  text = text.replace(/^\uFEFF/, '');
  if (!text) return [];
  const separator = delimiter ?? (yield* detectDelimiter(text));
  if (separator.length !== 1) reject('CSV 分隔符必须是一个字符。');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let total = 0;
  const append = (value: string) => {
    if (field.length + value.length > 32767) reject('CSV 单元格内容过长。');
    field += value;
  };
  const pushField = () => {
    if (++total > IMPORT_LIMITS.cells) reject('CSV 超过 100,000 个单元格限制。');
    if (field.length > 32767) reject('CSV 单元格内容过长。');
    row.push(field);
    field = '';
    afterQuote = false;
  };
  for (let i = 0, checkpoint = 32768; i < text.length; i++) {
    if (i >= checkpoint) {
      checkpoint = i + 32768;
      yield;
    }
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          append('"');
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else append(c);
      continue;
    }
    if (c === separator) {
      pushField();
      continue;
    }
    if (c === '\r' || c === '\n') {
      pushField();
      if (onRow) onRow(row);
      else rows.push(row);
      row = [];
      if (c === '\r' && text[i + 1] === '\n') i++;
      continue;
    }
    if (c === '"' && field === '' && !afterQuote) {
      quoted = true;
      continue;
    }
    if (afterQuote) {
      if (c === ' ' || c === '\t') continue;
      reject('CSV 引号后存在无效字符。');
    }
    append(c);
  }
  if (quoted) reject('CSV 文件中存在未闭合的引号。');
  if (row.length || field.length || afterQuote || !/[\r\n]$/.test(text)) {
    pushField();
    if (onRow) onRow(row);
    else rows.push(row);
  }
  return rows;
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  const parser = csvParser(text, delimiter);
  let result = parser.next();
  while (!result.done) result = parser.next();
  return result.value;
}

async function parseCsvAsync(
  text: string,
  delimiter: string | undefined,
  signal: AbortSignal | undefined,
  onRow: (row: string[]) => void,
): Promise<void> {
  const parser = csvParser(text, delimiter, onRow);
  try {
    while (true) {
      signal?.throwIfAborted();
      const result = parser.next();
      if (result.done) return;
      const turn = new Promise<void>((resolve) => setTimeout(resolve, 0));
      await (signal ? awaitFileOperation(turn, signal) : turn);
    }
  } finally {
    parser.return([]);
  }
}

/** Exports evaluated data; text that spreadsheet software could execute is prefixed with an apostrophe. */
export function serializeCsv(rows: CellValue[][]): string {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value);
            if (typeof value === 'string' && /^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(text))
              text = `'${text}`;
            return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
          })
          .join(','),
      )
      .join('\r\n')
  );
}

export function csvToWorkbook(text: string, name = '导入的工作簿'): Workbook {
  const builder = delimitedWorkbookBuilder(name);
  const parser = csvParser(text, undefined, builder.append);
  while (!parser.next().done) {
    /* Synchronous API retains its return contract. */
  }
  return builder.finish();
}

/** Compare normalized decimal spellings, without expanding exponent-sized strings. */
function decimalIdentity(text: string): string {
  const [mantissa, exponent = '0'] = text.toLowerCase().split('e');
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [whole, fraction = ''] = unsigned.split('.');
  const digits = (whole + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const coefficient = digits.replace(/0+$/, '');
  const power = Number(exponent) - fraction.length + digits.length - coefficient.length;
  return `${negative ? '-' : ''}${coefficient}e${power}`;
}

function delimitedValue(raw: string): CellValue {
  // Preserve identifiers and decimal values changed by numeric under/overflow or rounding.
  if (
    !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw) ||
    raw.replace(/\D/g, '').length > 15
  )
    return raw;
  const number = Number(raw);
  return Number.isFinite(number) &&
    !Object.is(number, -0) &&
    decimalIdentity(raw) === decimalIdentity(String(number))
    ? number
    : raw;
}

function delimitedWorkbookBuilder(name: string) {
  const workbook = createBlankWorkbook(name);
  const sheet = workbook.sheets[0];
  sheet.name = '数据';
  let sourceColumns = 0,
    rowCount = 0,
    lastStoredRow = -1,
    lastStoredColumn = -1;
  return {
    append(row: string[]) {
      const r = rowCount++;
      sourceColumns = Math.max(sourceColumns, row.length);
      validateDimensions(Math.max(100, rowCount), Math.max(16, sourceColumns));
      row.forEach((raw, c) => {
        if (!raw) return;
        sheet.cells[cellKey(r, c)] = { value: delimitedValue(raw) };
        lastStoredRow = r;
        lastStoredColumn = Math.max(lastStoredColumn, c);
      });
    },
    finish() {
      // A single blank corner preserves file bounds without retaining parsed rows.
      if (
        rowCount &&
        sourceColumns &&
        (lastStoredRow < rowCount - 1 || lastStoredColumn < sourceColumns - 1)
      )
        sheet.cells[cellKey(rowCount - 1, sourceColumns - 1)] ??= { value: '' };
      sheet.rowCount = Math.max(100, rowCount);
      sheet.colCount = Math.max(16, sourceColumns);
      return validateWorkbook(workbook);
    },
  };
}

async function excelModule() {
  const module = await import('exceljs');
  return module.default;
}
function excelColor(input: Partial<ExcelJS.Color> | undefined): string | undefined {
  return input?.argb && /^[\da-f]{8}$/i.test(input.argb) ? `#${input.argb.slice(-6)}` : undefined;
}
function excelStyle(cell: ExcelJS.Cell): CellStyle | undefined {
  const result: CellStyle = {};
  if (cell.font?.bold) result.bold = true;
  if (cell.font?.italic) result.italic = true;
  if (cell.font?.underline) result.underline = true;
  const color = excelColor(cell.font?.color);
  if (color) result.color = color;
  if (cell.font?.size) result.fontSize = cell.font.size;
  if (cell.fill?.type === 'pattern') {
    const background = excelColor(cell.fill.fgColor);
    if (background) result.background = background;
  }
  if (['left', 'center', 'right'].includes(cell.alignment?.horizontal ?? ''))
    result.align = cell.alignment.horizontal as CellStyle['align'];
  if (cell.numFmt?.includes('%')) result.format = 'percent';
  else if (/[¥￥$€£]/.test(cell.numFmt ?? '')) result.format = 'currency';
  else if (/[ymd]/i.test((cell.numFmt ?? '').replace(/"[^"]*"/g, ''))) result.format = 'date';
  else if (/[0#]/.test(cell.numFmt ?? '')) result.format = 'number';
  return Object.keys(result).length ? cleanStyle(result) : undefined;
}

export async function workbookFromXlsx(
  buffer: ArrayBuffer,
  name = '导入的工作簿',
): Promise<Workbook> {
  return readXlsxWorkbook(buffer, name);
}

async function readXlsxWorkbook(
  buffer: ArrayBuffer,
  name: string,
  signal?: AbortSignal,
): Promise<Workbook> {
  const stage = async <T>(start: () => Promise<T>): Promise<T> => {
    signal?.throwIfAborted();
    const work = start();
    const result = await (signal ? awaitFileOperation(work, signal) : work);
    signal?.throwIfAborted();
    return result;
  };
  signal?.throwIfAborted();
  if (buffer.byteLength > IMPORT_LIMITS.bytes) reject('文件超过 20 MB 限制。');
  const Excel = await stage(excelModule);
  const [
    { readXlsxArchive, writeXlsxArchive, assertExcelJsCompatiblePaths, xmlChildren },
    { readXlsxPrintSettings },
    { extractXlsxValidationRules },
    { readXlsxVisibility },
    { readXlsxStoredCells },
    { readXlsxMerges },
    { assertXlsxObjectsPreservable },
    { readXlsxHyperlinks },
    { readXlsxRichText },
    { expandXlsxSharedFormulas },
  ] = await stage(() =>
    Promise.all([
      import('./xlsx-archive'),
      import('./xlsx-print'),
      import('./xlsx-validation'),
      import('./xlsx-visibility'),
      import('./xlsx-cells'),
      import('./xlsx-merges'),
      import('./xlsx-objects'),
      import('./xlsx-hyperlinks'),
      import('./xlsx-rich-text'),
      import('./xlsx-formulas'),
    ]),
  );
  const archive = await stage(() => readXlsxArchive(buffer, signal));
  assertExcelJsCompatiblePaths(archive);
  await stage(() => assertXlsxObjectsPreservable(archive));
  const properties = xmlChildren(archive.workbook, 'workbookPr');
  if (properties.length > 1) reject('XLSX 工作簿属性重复。');
  const date1904 = properties[0]?.attributes.date1904;
  if (date1904 !== undefined && !['0', 'false'].includes(date1904))
    reject('XLSX 暂不支持 1904 日期系统或无效日期系统设置；请在原文件中转换为 1900 日期系统。');
  const mergeRanges = readXlsxMerges(archive, IMPORT_LIMITS);
  const printSettings = readXlsxPrintSettings(archive);
  const validationRules = await stage(() => extractXlsxValidationRules(archive));
  const visibility = readXlsxVisibility(archive, IMPORT_LIMITS);
  const storedCells = readXlsxStoredCells(archive, IMPORT_LIMITS);
  const hyperlinks = await stage(() => readXlsxHyperlinks(archive));
  const plainTexts = new Map<string, Map<string, string>>();
  const richTexts = await stage(() => readXlsxRichText(archive, signal, plainTexts));
  for (const sheet of archive.sheets) {
    const stored = storedCells.get(sheet.name)!;
    const addresses = new Set(stored.addresses);
    for (const key of hyperlinks.get(sheet.name)!.keys()) {
      if (!addresses.has(key))
        reject(`XLSX 超链接没有对应存储单元格：${sheet.name}!${key}，无法无损导入。`);
      stored.payloads.add(key);
    }
    const payloads = storedCells.get(sheet.name)!.payloads;
    for (const range of mergeRanges.get(sheet.name) ?? [])
      for (let row = range.start.row; row <= range.end.row; row++)
        for (let col = range.start.col; col <= range.end.col; col++) {
          if (row === range.start.row && col === range.start.col) continue;
          const key = cellKey(row, col);
          if (payloads.has(key))
            reject(
              `XLSX 合并区域包含非主格内容：${sheet.name}!${key}。请先在原文件中取消合并并检查内容。`,
            );
        }
  }
  expandXlsxSharedFormulas(archive);
  const source = new Excel.Workbook();
  // Bound stored coordinates, merges and column ranges before ExcelJS expands them.
  const rewritten = await stage(() => writeXlsxArchive(archive));
  await stage(() => source.xlsx.load(rewritten, { ignoreNodes: ['dataValidations'] }));
  if (
    source.worksheets.length !== archive.sheets.length ||
    source.worksheets.some((sheet) => !archive.sheets.some((item) => item.name === sheet.name))
  )
    reject('Excel 解码结果与文件工作表目录不一致，未导入部分数据。');
  if (source.worksheets.length > IMPORT_LIMITS.sheets) reject('工作表数量超过 50 个。');
  const book = createBlankWorkbook(name);
  let total = 0;
  book.sheets = source.worksheets.map((ws) => {
    validateSheetName(ws.name);
    const print = printSettings.get(ws.name);
    const validations = validationRules.get(ws.name);
    const layout = visibility.get(ws.name)!;
    const stored = storedCells.get(ws.name)!;
    // OOXML print titles, page breaks and validation ranges need not contain
    // stored cells. Reconstruct their logical extent without materializing it.
    let rowCount = Math.max(
      100,
      ws.rowCount,
      print?.repeatRows ?? 0,
      layout.rowCount,
      stored.rowCount,
    );
    let colCount = Math.max(
      16,
      ws.columnCount,
      print?.repeatColumns ?? 0,
      layout.colCount,
      stored.colCount,
    );
    for (const position of print?.rowBreaks ?? []) rowCount = Math.max(rowCount, position + 1);
    for (const position of print?.columnBreaks ?? []) colCount = Math.max(colCount, position + 1);
    for (const rule of validations ?? []) {
      rowCount = Math.max(rowCount, rule.range.end.row + 1);
      colCount = Math.max(colCount, rule.range.end.col + 1);
    }
    // Metadata does not bypass file-import quotas or get silently clamped.
    validateDimensions(rowCount, colCount);
    const frozenView = (ws.views ?? []).find((v) => v.state === 'frozen');
    const frozenRows = frozenView && 'ySplit' in frozenView ? (frozenView.ySplit ?? 0) : 0;
    const sheet: Sheet = {
      id: makeId(),
      name: ws.name,
      cells: {},
      rowCount,
      colCount,
      columnWidths: {},
      rowHeights: layout.rowHeights,
      hiddenRows: layout.hiddenRows,
      hiddenColumns: layout.hiddenColumns,
      frozenRows,
      printSettings: print,
      dataValidations: validations,
    };
    for (const address of stored.addresses) {
      const cell = ws.getCell(address);
      if (cell.type === Excel.ValueType.Merge) continue;
      const style = excelStyle(cell);
      if (
        cell.value === null &&
        !stored.errors.has(address) &&
        !stored.booleans.has(address) &&
        !style &&
        !hyperlinks.get(ws.name)!.has(address) &&
        !richTexts.get(ws.name)!.has(address)
      )
        continue;
      if (++total > IMPORT_LIMITS.cells) reject('文件超过 100,000 个单元格限制。');
      let value: CellValue = '';
      const raw = cell.value;
      if (stored.errors.has(address)) value = `=${stored.errors.get(address)}`;
      else if (stored.booleans.has(address)) value = stored.booleans.get(address)!;
      else if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean')
        value = raw;
      else if (raw instanceof Date) {
        // Date cannot represent Excel's fictional 1900-02-29 (serial 60).
        // Preserve the source serial, including its fractional day, when available.
        const serial = stored.numbers.get(address);
        if (serial !== undefined) value = serial;
        else {
          const converted = raw.getTime() / 86_400_000 + 25569;
          value = converted < 61 ? converted - 1 : converted;
        }
      } else if ((raw && 'formula' in raw) || (raw && 'sharedFormula' in raw))
        value = `=${cell.formula}`;
      else if (raw && 'richText' in raw) {
        if (!richTexts.get(ws.name)!.has(address))
          reject('XLSX 富文本缺少原始片段，无法无损导入。');
        value = raw.richText.map((run) => run.text).join('');
      }
      // ExcelJS represents an empty hyperlink label as undefined on read.
      else if (raw && 'text' in raw) value = raw.text ?? '';
      else if (raw && 'error' in raw)
        reject(`XLSX 错误单元格缺少可验证的原始错误码：${ws.name}!${address}。`);
      const richText = richTexts.get(ws.name)!.get(address);
      if (richText) value = richText.map((run) => run.text).join('');
      else if (plainTexts.get(ws.name)!.has(address))
        value = plainTexts.get(ws.name)!.get(address)!;
      const hyperlink = copyHyperlink(hyperlinks.get(ws.name)!.get(address), value);
      sheet.cells[cell.address] = {
        value,
        ...(style ? { style } : {}),
        ...(richText ? { richText } : {}),
        ...(hyperlink ? { hyperlink } : {}),
      };
    }
    ws.columns.forEach((column, i) => {
      if (column.width && sheet.columnWidths)
        sheet.columnWidths[i] = Math.max(48, Math.min(600, column.width * 7));
    });
    sheet.hiddenRows = [...new Set(sheet.hiddenRows)].sort((a, b) => a - b);
    sheet.hiddenColumns = [...new Set(sheet.hiddenColumns)].sort((a, b) => a - b);
    if (!sheet.hiddenRows.length) delete sheet.hiddenRows;
    if (!sheet.hiddenColumns.length) delete sheet.hiddenColumns;
    if (!Object.keys(sheet.rowHeights ?? {}).length) delete sheet.rowHeights;
    sheet.merges = mergeRanges.get(ws.name)!;
    return sheet;
  });
  if (!book.sheets.length) reject('文件中没有可读取的工作表。');
  book.activeSheetId = book.sheets[0].id;
  return validateWorkbook(book);
}

export async function importFile(file: File, signal?: AbortSignal): Promise<Workbook> {
  signal?.throwIfAborted();
  if (file.size > IMPORT_LIMITS.bytes) reject('文件超过 20 MB 限制。');
  const name = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'json' || ext === 'tsv' || ext === 'csv') {
    const text = await readUtf8File(file, signal);
    signal?.throwIfAborted();
    if (ext === 'json') return validateWorkbook(JSON.parse(text));
    const builder = delimitedWorkbookBuilder(name);
    await parseCsvAsync(text, ext === 'tsv' ? '\t' : undefined, signal, builder.append);
    signal?.throwIfAborted();
    return builder.finish();
  }
  if (ext === 'xlsx') {
    const work = file.arrayBuffer();
    const bytes = await (signal ? awaitFileOperation(work, signal) : work);
    signal?.throwIfAborted();
    return readXlsxWorkbook(bytes, name, signal);
  }
  return reject('暂不支持此文件类型，请选择 .xlsx、.csv、.tsv 或 .json 文件。');
}

export async function workbookToXlsx(workbook: Workbook): Promise<ArrayBuffer> {
  if (workbook.sheets.some((sheet) => sheet.dataSource?.kind === 'paged'))
    reject('分页工作表不能直接导出完整 XLSX，请先生成完整静态报表或使用数据源 CSV 导出。');
  workbook = validateWorkbook(workbook);
  // ExcelJS clears subordinate cell values when creating a merge. Never turn
  // a valid in-memory snapshot into an apparently successful lossy download.
  for (const sheet of workbook.sheets)
    for (const range of sheet.merges ?? [])
      for (let row = range.start.row; row <= range.end.row; row++)
        for (let col = range.start.col; col <= range.end.col; col++) {
          if (row === range.start.row && col === range.start.col) continue;
          const key = cellKey(row, col);
          const cell = sheet.cells[key];
          if (cell && (cell.value !== '' || cell.hyperlink || cell.richText))
            reject(
              `XLSX 合并区域包含非主格内容：${sheet.name}!${key}。请取消合并或移动内容后导出。`,
            );
        }
  const Excel = await excelModule();
  const { exportXlsxValidationRules } = await import('./xlsx-validation');
  const target = new Excel.Workbook();
  // Cached values reflect this engine's supported subset; Excel should recalculate.
  target.calcProperties.fullCalcOnLoad = true;
  const evaluate = createEvaluator(workbook);
  target.creator = 'Lumina Sheets';
  target.created = new Date(workbook.createdAt);
  target.modified = new Date();
  for (const sheet of workbook.sheets) {
    const ws = target.addWorksheet(sheet.name);
    exportXlsxValidationRules(ws, sheet);
    if (sheet.frozenRows) ws.views = [{ state: 'frozen', ySplit: sheet.frozenRows }];
    for (const [index, width] of Object.entries(sheet.columnWidths ?? {}))
      ws.getColumn(Number(index) + 1).width = width / 7;
    for (const row of sheet.hiddenRows ?? []) ws.getRow(row + 1).hidden = true;
    for (const row of Object.keys(sheet.rowHeights ?? {}))
      ws.getRow(Number(row) + 1).height = (sheet.rowHeights![Number(row)] * 72) / 96;
    for (const col of sheet.hiddenColumns ?? []) ws.getColumn(col + 1).hidden = true;
    for (const [key, source] of Object.entries(sheet.cells)) {
      const cell = ws.getCell(key);
      const value = source.value;
      copyRichText(source.richText, value);
      const hyperlink = copyHyperlink(source.hyperlink, value);
      if (typeof value === 'string' && value.startsWith('=')) {
        const outcome = evaluate.result(sheet, key);
        const result = outcome.kind === 'value' ? outcome.value : outcome.error;
        const errors = ['#N/A', '#REF!', '#NAME?', '#DIV/0!', '#NULL!', '#VALUE!', '#NUM!'];
        cell.value = {
          formula: value.slice(1),
          result:
            outcome.kind === 'error'
              ? errors.includes(outcome.error)
                ? { error: outcome.error as ExcelJS.CellErrorValue['error'] }
                : undefined // Engine-only errors have no equivalent Excel cache code.
              : typeof result === 'string'
                ? encodeXlsxString(result)
                : result,
        };
      } else if (hyperlink)
        cell.value = {
          // ExcelJS identifies hyperlinks by truthy text. Use a placeholder for
          // empty labels, then restore an empty inline string in the archive.
          text: source.richText ? ' ' : encodeXlsxString(value as string) || ' ',
          hyperlink: hyperlink.target,
          ...(hyperlink.tooltip !== undefined ? { tooltip: hyperlink.tooltip } : {}),
        };
      // Rich text is emitted from original runs after archive construction;
      // never put its unescaped UTF-16 text into ExcelJS's temporary strings.
      else
        cell.value = source.richText
          ? ' '
          : typeof value === 'string'
            ? encodeXlsxString(value)
            : value;
      const style = source.style;
      if (!style) continue;
      cell.font = {
        name: 'Aptos',
        ...(style.bold ? { bold: true } : {}),
        ...(style.italic ? { italic: true } : {}),
        ...(style.underline ? { underline: true } : {}),
        ...(style.color ? { color: { argb: `FF${style.color.slice(1)}` } } : {}),
        ...(style.fontSize ? { size: style.fontSize } : {}),
      };
      if (style.background)
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${style.background.slice(1)}` },
        };
      if (style.align) cell.alignment = { horizontal: style.align, vertical: 'middle' };
      if (style.format)
        cell.numFmt = {
          general: 'General',
          number: '#,##0.00',
          currency: '"¥"#,##0.00',
          percent: '0.0%',
          date: 'yyyy-mm-dd',
        }[style.format];
    }
    for (const range of sheet.merges ?? [])
      ws.mergeCells(range.start.row + 1, range.start.col + 1, range.end.row + 1, range.end.col + 1);
  }
  const buffer = await target.xlsx.writeBuffer();
  const blankLinks = workbook.sheets.some((sheet) =>
    Object.values(sheet.cells).some((cell) => cell.value === '' && cell.hyperlink),
  );
  if (
    !blankLinks &&
    !workbook.sheets.some((sheet) => Object.values(sheet.cells).some((cell) => cell.richText)) &&
    !workbook.sheets.some((sheet) => sheet.printSettings || sheet.hiddenRows?.length)
  )
    return new Uint8Array(buffer).slice().buffer;
  const [
    { readXlsxArchive, writeXlsxArchive, xmlChild, xmlChildren, xmlElement },
    { applyXlsxPrintSettings },
    { applyXlsxVisibility },
    { applyXlsxRichText },
  ] = await Promise.all([
    import('./xlsx-archive'),
    import('./xlsx-print'),
    import('./xlsx-visibility'),
    import('./xlsx-rich-text'),
  ]);
  const archive = await readXlsxArchive(new Uint8Array(buffer));
  if (blankLinks)
    for (const sheet of archive.sheets) {
      const source = workbook.sheets.find((item) => item.name === sheet.name)!;
      const data = xmlChild(sheet.xml, 'sheetData');
      for (const row of data ? xmlChildren(data, 'row') : [])
        for (const cell of xmlChildren(row, 'c')) {
          const original = source.cells[cell.attributes.r];
          if (original?.value !== '' || !original.hyperlink) continue;
          cell.attributes.t = 'inlineStr';
          cell.children = [xmlElement('is', {}, [xmlElement('t')])];
        }
    }
  applyXlsxRichText(archive, workbook.sheets);
  applyXlsxPrintSettings(archive, workbook.sheets);
  applyXlsxVisibility(archive, workbook.sheets);
  return writeXlsxArchive(archive);
}

export interface WorkbookExportOptions {
  /** Internal SDK snapshot of active-sheet results; values remain literal CSV fields. */
  frozenCsvValues?: ReadonlyMap<string, CellValue>;
  /** XLSX cancels serialization waiting; CSV/PDF stop cooperatively; JSON checks before download. */
  signal?: AbortSignal;
  /** CSV counts rows, PDF counts pages, XLSX/JSON report 1/1 when serialization finishes. */
  onProgress?: (completed: number, total: number) => void;
}

export async function exportWorkbook(
  workbook: Workbook,
  format: 'xlsx' | 'csv' | 'json' | 'pdf',
  options: WorkbookExportOptions = {},
): Promise<void> {
  const checkAbort = () => {
    if (options.signal?.aborted) throw new DOMException('导出已取消。', 'AbortError');
  };
  checkAbort();
  if (format !== 'csv' && workbook.sheets.some((sheet) => sheet.dataSource?.kind === 'paged'))
    reject('含分页工作表的工作簿不能直接导出完整文件，请先生成完整静态报表或使用数据源 CSV 导出。');
  let blob: Blob;
  if (format === 'xlsx') {
    const serialization = workbookToXlsx(workbook);
    const bytes = await (options.signal
      ? awaitFileOperation(serialization, options.signal)
      : serialization);
    checkAbort();
    blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  } else if (format === 'csv') {
    // Stream CSV rows instead of materializing the whole used range as a 2-D array.
    // This keeps export memory bounded for large, sparsely populated report sheets.
    const evaluate = createEvaluator(workbook);
    const frozen = options.frozenCsvValues;
    const evaluator = frozen
      ? Object.assign(
          (sheet: Sheet, key: string) =>
            sheet.id === workbook.activeSheetId && frozen.has(key)
              ? frozen.get(key)!
              : evaluate(sheet, key),
          evaluate,
        )
      : evaluate;
    blob = await workbookCsvBlob(workbook, {
      evaluator,
      signal: options.signal,
      onProgress: options.onProgress,
    });
  } else if (format === 'pdf') blob = await workbookPdfBlob(workbook, options);
  else blob = new Blob([JSON.stringify(workbook, null, 2)], { type: 'application/json' });
  if (format === 'xlsx' || format === 'json') options.onProgress?.(1, 1);
  // JSON serialization is synchronous. Yield before the irreversible download so a
  // caller's cancel/load/destroy event can prevent the side effect for every format.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkAbort();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${workbook.name.replace(/[\\/:*?"<>|]/g, '_')}.${format}`;
  try {
    document.body.append(link);
    checkAbort();
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

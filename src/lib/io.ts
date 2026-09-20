import type { Cell, CellRange, CellStyle, CellValue, Sheet, Workbook } from './types';
import { cellKey, createEvaluator, parseCellKey } from './engine';
import { createBlankWorkbook, makeId } from './seed';
import type ExcelJS from 'exceljs';
import { workbookCsvBlob } from './io-stream';
import { workbookPdfBlob } from './report-pdf';
import { copyPrintSettings } from './print-settings';
import { copyDataValidationRules } from './data-validation';

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
      cells[cellKey(position.row, position.col)] = {
        value: value.value as CellValue,
        ...(cleanStyle(value.style) ? { style: cleanStyle(value.style) } : {}),
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
    let id = typeof raw.id === 'string' && raw.id ? raw.id : makeId();
    if (ids.has(id)) id = makeId();
    ids.add(id);
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

export function parseCsv(text: string, delimiter?: string): string[][] {
  if (text.length > IMPORT_LIMITS.bytes) reject('CSV 文件超过 20 MB 限制。');
  text = text.replace(/^\uFEFF/, '');
  if (!text) return [];
  const firstLine = text.split(/\r?\n/, 1)[0];
  const separator =
    delimiter ?? (firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',');
  if (separator.length !== 1) reject('CSV 分隔符必须是一个字符。');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let total = 0;
  const pushField = () => {
    if (++total > IMPORT_LIMITS.cells) reject('CSV 超过 100,000 个单元格限制。');
    if (field.length > 32767) reject('CSV 单元格内容过长。');
    row.push(field);
    field = '';
    afterQuote = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else field += c;
      continue;
    }
    if (c === separator) {
      pushField();
      continue;
    }
    if (c === '\r' || c === '\n') {
      pushField();
      rows.push(row);
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
    field += c;
  }
  if (quoted) reject('CSV 文件中存在未闭合的引号。');
  if (row.length || field.length || afterQuote || !/[\r\n]$/.test(text)) {
    pushField();
    rows.push(row);
  }
  return rows;
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
  const rows = parseCsv(text);
  const workbook = createBlankWorkbook(name);
  const sheet = workbook.sheets[0];
  sheet.name = '数据';
  rows.forEach((row, r) =>
    row.forEach((raw, c) => {
      if (!raw) return;
      // Keep leading zeroes and long numeric identifiers intact.
      const value: CellValue =
        /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw) &&
        raw.replace(/\D/g, '').length <= 15 &&
        Number.isFinite(Number(raw))
          ? Number(raw)
          : raw;
      sheet.cells[cellKey(r, c)] = { value };
    }),
  );
  sheet.rowCount = Math.max(100, rows.length);
  sheet.colCount = Math.max(16, ...rows.map((row) => row.length));
  return validateWorkbook(workbook);
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
  if (buffer.byteLength > IMPORT_LIMITS.bytes) reject('文件超过 20 MB 限制。');
  const Excel = await excelModule();
  const [
    { readXlsxArchive, writeXlsxArchive, assertExcelJsCompatiblePaths },
    { readXlsxPrintSettings },
    { extractXlsxValidationRules },
    { readXlsxVisibility },
  ] = await Promise.all([
    import('./xlsx-archive'),
    import('./xlsx-print'),
    import('./xlsx-validation'),
    import('./xlsx-visibility'),
  ]);
  const archive = await readXlsxArchive(buffer);
  assertExcelJsCompatiblePaths(archive);
  const printSettings = readXlsxPrintSettings(archive);
  const validationRules = await extractXlsxValidationRules(archive);
  const visibility = readXlsxVisibility(archive);
  const source = new Excel.Workbook();
  // Preflight the original range XML before ExcelJS can expand rules per cell.
  await source.xlsx.load(await writeXlsxArchive(archive), { ignoreNodes: ['dataValidations'] });
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
    // OOXML print titles, page breaks and validation ranges need not contain
    // stored cells. Reconstruct their logical extent without materializing it.
    let rowCount = Math.max(100, ws.rowCount, print?.repeatRows ?? 0, layout.rowCount);
    let colCount = Math.max(16, ws.columnCount, print?.repeatColumns ?? 0, layout.colCount);
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
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.type === Excel.ValueType.Merge || cell.value === null) return;
        if (++total > IMPORT_LIMITS.cells) reject('文件超过 100,000 个单元格限制。');
        let value: CellValue = '';
        const raw = cell.value;
        if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean')
          value = raw;
        else if (raw instanceof Date) value = raw.getTime() / 86_400_000 + 25569;
        else if ((raw && 'formula' in raw) || (raw && 'sharedFormula' in raw))
          value = `=${cell.formula}`;
        else if (raw && 'richText' in raw) value = raw.richText.map((run) => run.text).join('');
        else if (raw && 'text' in raw) value = raw.text;
        else if (raw && 'error' in raw) value = raw.error;
        const style = excelStyle(cell);
        sheet.cells[cell.address] = { value, ...(style ? { style } : {}) };
      }),
    );
    ws.columns.forEach((column, i) => {
      if (column.width && sheet.columnWidths)
        sheet.columnWidths[i] = Math.max(48, Math.min(600, column.width * 7));
    });
    sheet.hiddenRows = [...new Set(sheet.hiddenRows)].sort((a, b) => a - b);
    sheet.hiddenColumns = [...new Set(sheet.hiddenColumns)].sort((a, b) => a - b);
    if (!sheet.hiddenRows.length) delete sheet.hiddenRows;
    if (!sheet.hiddenColumns.length) delete sheet.hiddenColumns;
    if (!Object.keys(sheet.rowHeights ?? {}).length) delete sheet.rowHeights;
    sheet.merges = (ws.model.merges ?? []).flatMap((range: string) => {
      const [a, b] = range.split(':').map(parseCellKey);
      return a && b ? [{ start: a, end: b }] : [];
    });
    return sheet;
  });
  if (!book.sheets.length) reject('文件中没有可读取的工作表。');
  book.activeSheetId = book.sheets[0].id;
  return validateWorkbook(book);
}

export async function importFile(file: File): Promise<Workbook> {
  if (file.size > IMPORT_LIMITS.bytes) reject('文件超过 20 MB 限制。');
  const name = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'json') return validateWorkbook(JSON.parse(await file.text()));
  if (ext === 'csv' || ext === 'tsv') return csvToWorkbook(await file.text(), name);
  if (ext === 'xlsx') return workbookFromXlsx(await file.arrayBuffer(), name);
  return reject('暂不支持此文件类型，请选择 .xlsx、.csv、.tsv 或 .json 文件。');
}

export async function workbookToXlsx(workbook: Workbook): Promise<ArrayBuffer> {
  workbook = validateWorkbook(workbook);
  const Excel = await excelModule();
  const { exportXlsxValidationRules } = await import('./xlsx-validation');
  const target = new Excel.Workbook();
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
      if (typeof value === 'string' && value.startsWith('=')) {
        const result = evaluate(sheet, key);
        const errors = ['#N/A', '#REF!', '#NAME?', '#DIV/0!', '#NULL!', '#VALUE!', '#NUM!'];
        cell.value = {
          formula: value.slice(1),
          result:
            typeof result === 'string' && errors.includes(result)
              ? { error: result as ExcelJS.CellErrorValue['error'] }
              : result,
        };
      } else cell.value = value;
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
  if (!workbook.sheets.some((sheet) => sheet.printSettings || sheet.hiddenRows?.length))
    return new Uint8Array(buffer).slice().buffer;
  const [
    { readXlsxArchive, writeXlsxArchive },
    { applyXlsxPrintSettings },
    { applyXlsxVisibility },
  ] = await Promise.all([
    import('./xlsx-archive'),
    import('./xlsx-print'),
    import('./xlsx-visibility'),
  ]);
  const archive = await readXlsxArchive(new Uint8Array(buffer));
  applyXlsxPrintSettings(archive, workbook.sheets);
  applyXlsxVisibility(archive, workbook.sheets);
  return writeXlsxArchive(archive);
}

export interface WorkbookExportOptions {
  /** CSV/PDF stop between chunks/pages; XLSX/JSON check before downloading. */
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
  let blob: Blob;
  if (format === 'xlsx')
    blob = new Blob([await workbookToXlsx(workbook)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  else if (format === 'csv') {
    // Stream CSV rows instead of materializing the whole used range as a 2-D array.
    // This keeps export memory bounded for large, sparsely populated report sheets.
    blob = await workbookCsvBlob(workbook, {
      evaluator: createEvaluator(workbook),
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

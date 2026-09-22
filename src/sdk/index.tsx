import { createRoot, type Root } from 'react-dom/client';
import { useSyncExternalStore } from 'react';
import Spreadsheet from '../components/Spreadsheet';
import { copyRichText, replaceCellText } from '../lib/rich-text';
import { copyHyperlink } from '../lib/cell-hyperlink';
import type {
  Cell,
  CellStyle,
  CellValue,
  PrintSettings,
  Selection,
  Sheet,
  Workbook,
} from '../lib/types';
import { copyPrintSettings } from '../lib/print-settings';
import { planStructureEdit, transformPosition, transformRange } from '../lib/structure-edit';
import type { RowSortRequest } from '../lib/row-sort';
import { planWorkbookRowSort, WorkbookSortValidationError } from '../lib/workbook-sort';
import { planSheetRename } from '../lib/sheet-rename';
import { validateWorkbookCellChanges } from '../lib/workbook-validation';
import type { StructureEdit } from '../lib/formula-structure';
import {
  checkValue,
  copyDataValidationRules,
  type DataValidationRule,
  type DataValidationFailure,
} from '../lib/data-validation';
import { cellKey, createEvaluator, MAX_COLUMNS, MAX_ROWS, parseCellKey } from '../lib/engine';
import { createBlankWorkbook } from '../lib/seed';
import {
  ReportChunkCache,
  type ChunkCacheOptions,
  type ReportDataSource,
} from '../lib/report-data';
import { reportDataCsvBlob, type ReportDataCsvOptions } from '../lib/report-data-export';
import {
  conditionalStyle,
  generateReport,
  type ConditionalRule,
  type ReportDefinition,
  type ReportRecord,
} from '../lib/report';
import { exportWorkbook, importFile } from '../lib/io';
import '../styles/spreadsheet.css';
import './sdk.css';

export * from '../lib/types';
export { parseCellInput } from '../lib/cell-input';
export * from '../lib/report-data';
export * from '../lib/report-data-export';
export * from '../lib/report';
export * from '../lib/data-validation';
export * from '../lib/print-settings';
export { workbookCsvBlob, workbookCsvReadableStream, iterateCsvChunks } from '../lib/io-stream';
export { workbookToPdf, workbookPdfBlob } from '../lib/report-pdf';
export { workbookToXlsx, workbookFromXlsx, validateWorkbook } from '../lib/io';
export { createEvaluator, cellKey, parseCellKey, translateFormula } from '../lib/engine';
export type { EvaluationResult } from '../lib/engine';
export type { StructureEdit } from '../lib/formula-structure';
export type { RowSortKey, RowSortRequest } from '../lib/row-sort';

export interface SortResult {
  movedRows: number;
  changedCells: number;
}

export interface StructureChangeEvent extends StructureEdit {
  sheetId: string;
  affectedSheetIds: string[];
  phase: 'apply' | 'undo' | 'redo';
}

export interface SheetRenameEvent {
  sheetId: string;
  previousName: string;
  name: string;
  affectedSheetIds: string[];
  phase: 'apply' | 'undo' | 'redo';
}

export interface ActiveSheetChangeEvent {
  previousSheetId: string;
  sheetId: string;
}

/** Visible coordinates by default; `all` retains the original rectangular selection. */
export type ClipboardMode = 'visible' | 'all';

export interface SpreadsheetOptions {
  workbook?: Workbook;
  readOnly?: boolean;
  zoom?: number;
  clipboardMode?: ClipboardMode;
  conditionalRules?: ConditionalRule[];
  onChange?: (event: { sheetId: string; changes: CellChange[] }) => void;
  /** One atomic structural edit; does not emit a large synthetic cell-change list. */
  onStructureChange?: (event: StructureChangeEvent) => void;
  /** One atomic rename, including rewritten formulas and internal links. */
  onSheetRename?: (event: SheetRenameEvent) => void;
  onActiveSheetChange?: (event: ActiveSheetChangeEvent) => void;
  onSelectionChange?: (selection: Selection) => void;
  onError?: (error: Error) => void;
  onRender?: (metrics: { drawMs: number; paintedCells: number; domNodes: number }) => void;
  /** Emitted when a bound data source starts/finishes loading or is cleared. */
  onDataStateChange?: (state: DataSourceState) => void;
}

/** Stable error categories for hosts that need localization or telemetry. */
export type LuminaErrorCode =
  | 'INVALID_ARGUMENT'
  | 'READ_ONLY'
  | 'DESTROYED'
  | 'DATA_SOURCE'
  | 'EXPORT_CANCELLED'
  | 'IMPORT_CANCELLED'
  | 'VALIDATION_FAILED';

export class LuminaError extends Error {
  readonly code: LuminaErrorCode;
  readonly cause?: unknown;
  constructor(code: LuminaErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'LuminaError';
    this.code = code;
    this.cause = cause;
  }
}

export class DataValidationError extends LuminaError {
  readonly failures: DataValidationFailure[];
  constructor(failures: DataValidationFailure[]) {
    super('VALIDATION_FAILED', `${failures[0].key}：${failures[0].message}`);
    this.name = 'DataValidationError';
    this.failures = structuredClone(failures);
  }
}

export interface DataSourceState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  cachedPages: number;
  loading: number;
  rowCount?: number;
  pageSize?: number;
  error?: Error;
}

export interface ImportOptions {
  /** Cancels waiting/commit; an already running file parser may finish in the background. */
  signal?: AbortSignal;
}

export interface ExportOptions {
  /** Applies only to CSV exported from a bound paged source; independent of viewport cache. */
  pagedCsv?: Pick<ReportDataCsvOptions, 'pageSize' | 'maxPageTextUnits' | 'maxRows'>;
  /** XLSX cancels serialization waiting; CSV/PDF stop cooperatively; JSON checks before download. */
  signal?: AbortSignal;
  /** CSV reports rows, PDF pages; XLSX/JSON report 1/1 after serialization. */
  onProgress?: (completed: number, total: number | undefined) => void;
}
export interface CellChange {
  key: string;
  cell: Cell | null;
}
function asArgument<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof LuminaError) throw error;
    throw new LuminaError(
      'INVALID_ARGUMENT',
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}
function asDataError(error: unknown): Error {
  if (error instanceof LuminaError || (error as { name?: string })?.name === 'AbortError')
    return error as Error;
  return new LuminaError(
    'DATA_SOURCE',
    error instanceof Error ? error.message : String(error),
    error,
  );
}
function validateClipboardMode(value: unknown): asserts value is ClipboardMode {
  if (value !== 'visible' && value !== 'all')
    throw new LuminaError('INVALID_ARGUMENT', 'clipboardMode 必须为 visible 或 all');
}
/** Validate nested export budgets before any source request starts.
 *
 * These options are part of the public SDK boundary. Keeping the checks here
 * means malformed host configuration is reported as INVALID_ARGUMENT rather
 * than being mistaken for a remote DATA_SOURCE failure by the paged exporter.
 */
function validateExportBudgets(value: unknown): asserts value is ExportOptions['pagedCsv'] {
  if (value === undefined) return;
  if (!plainRecord(value)) throw new LuminaError('INVALID_ARGUMENT', '无效分页 CSV 导出选项');
  const allowed = new Set(['pageSize', 'maxPageTextUnits', 'maxRows']);
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowed.has(key)))
    throw new LuminaError('INVALID_ARGUMENT', '无效分页 CSV 导出选项');
  const pageSize = value.pageSize;
  const maxRows = value.maxRows;
  const maxPageTextUnits = value.maxPageTextUnits;
  if (pageSize !== undefined && !validInteger(pageSize, 1, MAX_ROWS))
    throw new LuminaError('INVALID_ARGUMENT', '分页 CSV pageSize 必须为正整数');
  if (maxRows !== undefined && !validInteger(maxRows, 1, MAX_ROWS))
    throw new LuminaError('INVALID_ARGUMENT', '分页 CSV maxRows 必须为正整数');
  if (maxPageTextUnits !== undefined && !validInteger(maxPageTextUnits, 1, 32_000_000))
    throw new LuminaError(
      'INVALID_ARGUMENT',
      '分页 CSV maxPageTextUnits 必须为 1–32,000,000 的整数',
    );
}
function copyRules(input: ConditionalRule[]): ConditionalRule[] {
  if (!Array.isArray(input)) throw new LuminaError('INVALID_ARGUMENT', '无效条件格式规则');
  return input.map((rule) => {
    if (
      !record(rule) ||
      !record(rule.range) ||
      !record(rule.range.start) ||
      !record(rule.range.end)
    )
      throw new LuminaError('INVALID_ARGUMENT', '无效条件格式范围');
    if (rule.sheetId !== undefined && (typeof rule.sheetId !== 'string' || !rule.sheetId))
      throw new LuminaError('INVALID_ARGUMENT', '无效条件格式工作表');
    const { start, end } = rule.range;
    if (
      !validInteger(start.row, 0, MAX_ROWS - 1) ||
      !validInteger(end.row, start.row, MAX_ROWS - 1) ||
      !validInteger(start.col, 0, MAX_COLUMNS - 1) ||
      !validInteger(end.col, start.col, MAX_COLUMNS - 1) ||
      !['greaterThan', 'lessThan', 'equal', 'between', 'contains'].includes(rule.operator)
    )
      throw new LuminaError('INVALID_ARGUMENT', '无效条件格式规则');
    const cell = copyCell({ value: rule.value, style: rule.style });
    if (
      rule.upper !== undefined &&
      (typeof rule.upper !== 'number' || !Number.isFinite(rule.upper))
    )
      throw new LuminaError('INVALID_ARGUMENT', '无效条件格式上限');
    return { ...structuredClone(rule), style: cell.style ?? {} };
  });
}
type SheetDimensions = Pick<Sheet, 'rowCount' | 'colCount'>;
/** Sparse layout metadata; coordinates are zero-based and sizes are CSS pixels. */
export type SheetLayout = Pick<
  Sheet,
  'columnWidths' | 'rowHeights' | 'hiddenRows' | 'hiddenColumns' | 'frozenRows'
>;
const layoutFields = [
  'columnWidths',
  'rowHeights',
  'hiddenRows',
  'hiddenColumns',
  'frozenRows',
] as const;
type SheetMetadata = Pick<
  Sheet,
  | 'columnWidths'
  | 'rowHeights'
  | 'hiddenRows'
  | 'hiddenColumns'
  | 'frozenRows'
  | 'merges'
  | 'printSettings'
  | 'dataValidations'
>;
interface Transaction {
  type: 'cells';
  sheetId: string;
  changes: CellChange[];
  inverse: CellChange[];
  before: SheetDimensions;
  after: SheetDimensions;
  beforeMetadata?: SheetMetadata;
  afterMetadata?: SheetMetadata;
  preserveSelection?: boolean;
}
interface StructureTransaction {
  type: 'structure';
  sheetId: string;
  edit: StructureEdit;
  affectedSheetIds: string[];
  beforeSheets: Sheet[];
  afterSheets: Sheet[];
  beforeRules: ConditionalRule[];
  afterRules: ConditionalRule[];
  beforeSelection: Selection;
  afterSelection: Selection;
}
interface SortTransaction {
  type: 'sort';
  groups: Array<{ sheetId: string; changes: CellChange[]; inverse: CellChange[] }>;
}
interface RenameTransaction {
  type: 'rename';
  sheetId: string;
  previousName: string;
  name: string;
  beforeSheets: Sheet[];
  afterSheets: Sheet[];
}
type HistoryTransaction = Transaction | StructureTransaction | SortTransaction | RenameTransaction;
const validInteger = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const plainRecord = (value: unknown): value is Record<string, unknown> =>
  record(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
  Reflect.ownKeys(value).every((key) => typeof key === 'string');
function dimensions(sheet: Sheet): SheetDimensions {
  return { rowCount: sheet.rowCount, colCount: sheet.colCount };
}
function layoutOf(sheet: Sheet): SheetLayout {
  return structuredClone({
    columnWidths: sheet.columnWidths,
    rowHeights: sheet.rowHeights,
    hiddenRows: sheet.hiddenRows,
    hiddenColumns: sheet.hiddenColumns,
    frozenRows: sheet.frozenRows,
  });
}
function sameLayout(a: SheetLayout, b: SheetLayout): boolean {
  return layoutFields.every((field) => {
    const left = a[field],
      right = b[field];
    if (left === right) return true;
    if (left === undefined || right === undefined) return false;
    if (Array.isArray(left) && Array.isArray(right)) {
      const members = new Set(left);
      return left.length === right.length && right.every((value) => members.has(value));
    }
    if (record(left) && record(right)) {
      const leftRecord = left as Record<string, unknown>,
        rightRecord = right as Record<string, unknown>;
      const keys = Object.keys(leftRecord);
      return (
        keys.length === Object.keys(rightRecord).length &&
        keys.every((key) => leftRecord[key] === rightRecord[key])
      );
    }
    return false;
  });
}
function metadata(sheet: Sheet): SheetMetadata {
  return structuredClone({
    columnWidths: sheet.columnWidths,
    rowHeights: sheet.rowHeights,
    hiddenRows: sheet.hiddenRows,
    hiddenColumns: sheet.hiddenColumns,
    frozenRows: sheet.frozenRows,
    merges: sheet.merges,
    printSettings: sheet.printSettings,
    dataValidations: sheet.dataValidations,
  });
}
function validateDimensions(value: SheetDimensions) {
  if (!validInteger(value.rowCount, 1, MAX_ROWS) || !validInteger(value.colCount, 1, MAX_COLUMNS))
    throw new LuminaError('INVALID_ARGUMENT', '工作表尺寸必须为 1–1,048,576 行和 1–16,384 列');
}
function copyCell(value: unknown): Cell {
  if (
    !record(value) ||
    !['string', 'number', 'boolean'].includes(typeof value.value) ||
    (typeof value.value === 'number' && !Number.isFinite(value.value)) ||
    (typeof value.value === 'string' && value.value.length > 32767)
  )
    throw new LuminaError('INVALID_ARGUMENT', '无效单元格值');
  const cell: Cell = { value: value.value as CellValue };
  if (value.richText !== undefined)
    cell.richText = asArgument(() => copyRichText(value.richText, cell.value));
  if (value.hyperlink !== undefined) {
    try {
      cell.hyperlink = copyHyperlink(value.hyperlink, value.value);
    } catch (cause) {
      throw new LuminaError(
        'INVALID_ARGUMENT',
        cause instanceof Error ? cause.message : '无效超链接',
      );
    }
  }
  if (value.style !== undefined) {
    if (!record(value.style)) throw new LuminaError('INVALID_ARGUMENT', '无效单元格样式');
    const style: CellStyle = {};
    for (const key of ['bold', 'italic', 'underline'] as const) {
      if (value.style[key] !== undefined && typeof value.style[key] !== 'boolean')
        throw new LuminaError('INVALID_ARGUMENT', '无效单元格样式');
      if (typeof value.style[key] === 'boolean') style[key] = value.style[key];
    }
    for (const key of ['color', 'background'] as const) {
      if (
        value.style[key] !== undefined &&
        (typeof value.style[key] !== 'string' || !/^#[\da-f]{6}$/i.test(value.style[key]))
      )
        throw new LuminaError('INVALID_ARGUMENT', '颜色必须为六位十六进制值');
      if (typeof value.style[key] === 'string') style[key] = value.style[key];
    }
    if (value.style.align !== undefined) {
      if (!['left', 'center', 'right'].includes(String(value.style.align)))
        throw new LuminaError('INVALID_ARGUMENT', '无效对齐方式');
      style.align = value.style.align as CellStyle['align'];
    }
    if (value.style.format !== undefined) {
      if (
        !['general', 'number', 'currency', 'percent', 'date'].includes(String(value.style.format))
      )
        throw new LuminaError('INVALID_ARGUMENT', '无效数字格式');
      style.format = value.style.format as CellStyle['format'];
    }
    if (value.style.fontSize !== undefined) {
      if (
        typeof value.style.fontSize !== 'number' ||
        !Number.isFinite(value.style.fontSize) ||
        value.style.fontSize < 6 ||
        value.style.fontSize > 96
      )
        throw new LuminaError('INVALID_ARGUMENT', '字号必须为 6–96');
      style.fontSize = value.style.fontSize;
    }
    cell.style = style;
  }
  return cell;
}
function validateSheetMetadata(sheet: Sheet) {
  if (sheet.dataSource !== undefined) {
    const source = sheet.dataSource;
    if (
      !record(source) ||
      (source.kind !== 'static' && source.kind !== 'paged') ||
      (source.totalRows !== undefined && !validInteger(source.totalRows, 0, MAX_ROWS)) ||
      (source.pageSize !== undefined && !validInteger(source.pageSize, 1, MAX_ROWS))
    )
      throw new LuminaError('INVALID_ARGUMENT', '无效数据源元数据');
  }
  asArgument(() => copyPrintSettings(sheet.printSettings, sheet));
  if (sheet.dataValidations !== undefined)
    asArgument(() => copyDataValidationRules(sheet.dataValidations));
  if (sheet.frozenRows !== undefined && !validInteger(sheet.frozenRows, 0, sheet.rowCount))
    throw new LuminaError('INVALID_ARGUMENT', '无效冻结行数');
  if (sheet.columnWidths !== undefined) {
    if (!plainRecord(sheet.columnWidths)) throw new LuminaError('INVALID_ARGUMENT', '无效列宽配置');
    for (const [key, width] of Object.entries(sheet.columnWidths))
      if (
        String(Number(key)) !== key ||
        !validInteger(Number(key), 0, sheet.colCount - 1) ||
        typeof width !== 'number' ||
        !Number.isFinite(width) ||
        width < 32 ||
        width > 2000
      )
        throw new LuminaError('INVALID_ARGUMENT', '无效列宽');
  }
  for (const [field, max, label] of [
    ['hiddenRows', sheet.rowCount - 1, '隐藏行'],
    ['hiddenColumns', sheet.colCount - 1, '隐藏列'],
  ] as const) {
    const values = sheet[field];
    if (values === undefined) continue;
    if (!Array.isArray(values) || new Set(values).size !== values.length)
      throw new LuminaError('INVALID_ARGUMENT', `无效${label}配置`);
    for (const value of values) {
      if (!validInteger(value, 0, max))
        throw new LuminaError('INVALID_ARGUMENT', `${label}坐标无效`);
    }
  }
  if (sheet.rowHeights !== undefined) {
    if (!plainRecord(sheet.rowHeights)) throw new LuminaError('INVALID_ARGUMENT', '无效行高配置');
    for (const [key, height] of Object.entries(sheet.rowHeights))
      if (
        String(Number(key)) !== key ||
        !validInteger(Number(key), 0, sheet.rowCount - 1) ||
        typeof height !== 'number' ||
        !Number.isFinite(height) ||
        height < 1 ||
        height > 600
      )
        throw new LuminaError('INVALID_ARGUMENT', '无效行高');
  }
  if (sheet.merges !== undefined) {
    if (!Array.isArray(sheet.merges)) throw new LuminaError('INVALID_ARGUMENT', '无效合并范围');
    for (const range of sheet.merges)
      if (
        !range?.start ||
        !range?.end ||
        !validInteger(range.start.row, 0, sheet.rowCount - 1) ||
        !validInteger(range.end.row, range.start.row, sheet.rowCount - 1) ||
        !validInteger(range.start.col, 0, sheet.colCount - 1) ||
        !validInteger(range.end.col, range.start.col, sheet.colCount - 1)
      )
        throw new LuminaError('INVALID_ARGUMENT', '合并范围超出工作表');
  }
}
/** SDK snapshots follow Excel coordinate limits, without the file-import cell quota. */
function copyWorkbook(input: Workbook): Workbook {
  if (
    !record(input) ||
    typeof input.id !== 'string' ||
    !input.id ||
    typeof input.name !== 'string' ||
    !Array.isArray(input.sheets) ||
    !input.sheets.length
  )
    throw new LuminaError('INVALID_ARGUMENT', '无效工作簿');
  const ids = new Set<string>(),
    names = new Set<string>();
  const sheets = input.sheets.map((sheet: Sheet) => {
    if (
      !record(sheet) ||
      typeof sheet.id !== 'string' ||
      !sheet.id ||
      typeof sheet.name !== 'string' ||
      !sheet.name.trim() ||
      !record(sheet.cells)
    )
      throw new LuminaError('INVALID_ARGUMENT', '无效工作表');
    if (ids.has(sheet.id) || names.has(sheet.name.toLocaleLowerCase()))
      throw new LuminaError('INVALID_ARGUMENT', '工作表 ID 和名称不能重复');
    ids.add(sheet.id);
    names.add(sheet.name.toLocaleLowerCase());
    validateDimensions(sheet);
    validateSheetMetadata(sheet);
    const cells: Record<string, Cell> = {};
    for (const [key, value] of Object.entries(sheet.cells)) {
      const point = parseCellKey(key);
      if (!point || point.row >= sheet.rowCount || point.col >= sheet.colCount)
        throw new LuminaError('INVALID_ARGUMENT', `单元格地址超出工作表：${key}`);
      const canonical = cellKey(point.row, point.col);
      if (Object.hasOwn(cells, canonical))
        throw new LuminaError('INVALID_ARGUMENT', `单元格地址重复：${key}`);
      cells[canonical] = copyCell(value);
    }
    return { ...structuredClone({ ...sheet, cells: {} }), cells };
  });
  if (!ids.has(input.activeSheetId)) throw new LuminaError('INVALID_ARGUMENT', '活动工作表不存在');
  return { ...structuredClone({ ...input, sheets: [] }), sheets };
}

const mountedHosts = new WeakSet<HTMLElement>();

/** Embeddable browser JavaScript API. No server, account, React host, or plugin required. */
export class LuminaSpreadsheet {
  private root: Root;
  private workbook: Workbook;
  private selection: Selection = { row: 0, col: 0 };
  private filter = '';
  private revision = 0;
  private renderRevision = 0;
  private sheetViewEpoch = 0;
  private sourceEpoch = 0;
  // View notifications also cover selection and layout. Filtering should only
  // discard computed row matches when its value source actually changes.
  private calculationVersion = 0;
  private listeners = new Set<() => void>();
  private evaluator: ReturnType<typeof createEvaluator>;
  private history: HistoryTransaction[] = [];
  private future: HistoryTransaction[] = [];
  private cache?: ReportChunkCache;
  private source?: ReportDataSource;
  private boundSheetId?: string;
  private unsubscribeCache?: () => void;
  private viewportRequest?: AbortController;
  private viewportError?: Error;
  private initialRequest?: AbortController;
  private pendingImport?: { cancel: (reason?: unknown) => void };
  private exportRequests = new Set<AbortController>();
  private lastViewport = '';
  private destroyed = false;
  private rules: ConditionalRule[];
  private previousClass: string;
  private options: SpreadsheetOptions;
  private dataNotificationPending = false;
  private dataState: DataSourceState = { status: 'idle', cachedPages: 0, loading: 0 };

  constructor(
    private host: HTMLElement,
    options: SpreadsheetOptions = {},
  ) {
    if (typeof HTMLElement === 'undefined' || !(host instanceof HTMLElement))
      throw new LuminaError('INVALID_ARGUMENT', '需要可挂载的 HTML 元素');
    if (mountedHosts.has(host))
      throw new LuminaError('INVALID_ARGUMENT', '此容器已挂载表格，请先销毁原实例');
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (options.readOnly !== undefined && typeof options.readOnly !== 'boolean') ||
      (options.zoom !== undefined &&
        (typeof options.zoom !== 'number' || !Number.isFinite(options.zoom) || options.zoom <= 0))
    )
      throw new LuminaError('INVALID_ARGUMENT', '无效表格选项');
    if (options.clipboardMode !== undefined) validateClipboardMode(options.clipboardMode);
    for (const name of [
      'onChange',
      'onStructureChange',
      'onSheetRename',
      'onActiveSheetChange',
      'onSelectionChange',
      'onError',
      'onRender',
      'onDataStateChange',
    ] as const)
      if (options[name] !== undefined && typeof options[name] !== 'function')
        throw new LuminaError('INVALID_ARGUMENT', `无效回调：${name}`);
    this.workbook = asArgument(() => copyWorkbook(options.workbook ?? createBlankWorkbook()));
    this.options = { ...options };
    this.rules = asArgument(() => copyRules(options.conditionalRules ?? []));
    this.evaluator = this.createWorkbookEvaluator();
    this.previousClass = host.className;
    mountedHosts.add(host);
    let root: Root | undefined;
    try {
      host.classList.add('lumina-sdk');
      this.root = root = createRoot(host);
      root.render(<Surface controller={this} />);
    } catch (error) {
      try {
        root?.unmount();
      } catch {
        /* Preserve the original mounting failure. */
      }
      mountedHosts.delete(host);
      host.className = this.previousClass;
      throw error;
    }
  }
  subscribe = (listener: () => void) => {
    this.assertLive();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  private reportError(error: unknown) {
    if (this.destroyed) return;
    try {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    } catch (callbackError) {
      console.error('Lumina onError callback failed', callbackError);
    }
  }
  private callback(action: () => void) {
    try {
      action();
    } catch (error) {
      this.reportError(error);
    }
  }
  private changed(contentChanged = true) {
    this.revision++;
    if (contentChanged) this.renderRevision++;
    for (const listener of this.listeners) this.callback(listener);
  }
  private assertLive() {
    if (this.destroyed) throw new LuminaError('DESTROYED', '此表格已销毁');
  }
  private assertWritable() {
    this.assertLive();
    if (this.cache || this.options.readOnly || this.currentSheet.dataSource?.kind === 'paged')
      throw new LuminaError('READ_ONLY', '当前表格为只读模式');
  }
  private createWorkbookEvaluator() {
    return createEvaluator(this.workbook, {
      managedMutations: true,
      readPagedCell: (sheet, key) => {
        if (!this.cache || sheet.id !== this.boundSheetId) return undefined;
        const point = parseCellKey(key);
        if (!point) return undefined;
        if (
          point.col >= this.cache.columnCount ||
          (this.cache.rowCount !== undefined && point.row >= this.cache.rowCount)
        )
          return null;
        const row = this.cache.peekRow(point.row);
        return row === undefined ? undefined : (row[point.col] ?? null);
      },
    });
  }
  private get currentSheet() {
    return this.workbook.sheets.find((sheet) => sheet.id === this.workbook.activeSheetId)!;
  }
  /** An isolated snapshot; mutating it cannot bypass edit history or readOnly. */
  get activeSheet() {
    this.assertLive();
    return structuredClone(this.currentSheet);
  }
  /** Constant-size metadata for toolbars; does not enumerate or clone stored cells. */
  get activeSheetInfo() {
    this.assertLive();
    const sheet = this.currentSheet;
    return {
      id: sheet.id,
      name: sheet.name,
      rowCount: sheet.rowCount,
      colCount: sheet.colCount,
      frozenRows: sheet.frozenRows ?? 0,
      readOnly: !!this.cache || !!this.options.readOnly || sheet.dataSource?.kind === 'paged',
    };
  }
  get selectedRange() {
    this.assertLive();
    return { ...this.selection };
  }
  /** Sheet directory without cloning or enumerating stored cell data. */
  get sheetInfos() {
    this.assertLive();
    return this.workbook.sheets.map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      rowCount: sheet.rowCount,
      colCount: sheet.colCount,
      readOnly: !!this.cache || !!this.options.readOnly || sheet.dataSource?.kind === 'paged',
    }));
  }
  /** View-only switch: preserves history and pending imports; resets selection/filter. */
  setActiveSheet(sheetId: string): void {
    this.assertLive();
    if (typeof sheetId !== 'string' || !this.workbook.sheets.some((sheet) => sheet.id === sheetId))
      throw new LuminaError('INVALID_ARGUMENT', '找不到工作表');
    const previousSheetId = this.workbook.activeSheetId;
    if (sheetId === previousSheetId) return;
    const epoch = ++this.sheetViewEpoch;
    const workbook = this.workbook;
    const cache = this.cache;
    const previousRequest = this.viewportRequest;
    this.viewportRequest = undefined;
    this.viewportError = undefined;
    this.lastViewport = '';
    previousRequest?.abort();
    if (
      this.destroyed ||
      this.workbook !== workbook ||
      this.cache !== cache ||
      this.sheetViewEpoch !== epoch ||
      this.viewportRequest !== undefined
    )
      return;
    this.workbook.activeSheetId = sheetId;
    this.selection = { row: 0, col: 0 };
    this.filter = '';
    if (cache) this.refreshDataState(cache);
    const revision = this.revision + 1;
    this.changed();
    if (this.destroyed || this.revision !== revision) return;
    this.callback(() => this.options.onActiveSheetChange?.({ previousSheetId, sheetId }));
    if (!this.destroyed && this.revision === revision)
      this.callback(() => this.options.onSelectionChange?.({ row: 0, col: 0 }));
  }
  /** View preference; allowed for readonly/paged instances and excluded from edit history. */
  get clipboardMode(): ClipboardMode {
    this.assertLive();
    return this.options.clipboardMode ?? 'visible';
  }
  setClipboardMode(mode: ClipboardMode) {
    this.assertLive();
    validateClipboardMode(mode);
    if (mode === this.clipboardMode) return;
    this.options.clipboardMode = mode;
    this.changed();
  }
  /** Current local row filter; it is view state and is not part of the workbook. */
  get filterText(): string {
    this.assertLive();
    return this.filter;
  }
  setFilter(text: string) {
    this.assertLive();
    if (typeof text !== 'string') throw new LuminaError('INVALID_ARGUMENT', '筛选内容必须为文本');
    const next = text.trim();
    if (next && this.currentSheet.dataSource?.kind === 'paged')
      throw new LuminaError(
        'INVALID_ARGUMENT',
        '分页数据源不能使用本地筛选；请在数据源端筛选后重新绑定',
      );
    if (next === this.filter) return;
    this.filter = next;
    this.changed();
  }
  /** Counts actual formula evaluations and cache reuse, without cloning cells. */
  get calculationStats() {
    this.assertLive();
    return this.evaluator.stats;
  }
  get dataSourceStats() {
    this.assertLive();
    return this.cache
      ? { cachedPages: this.cache.size, loading: this.cache.loading, rowCount: this.cache.rowCount }
      : null;
  }
  /** Current data binding state for loading indicators and retry controls. */
  get dataSourceState(): DataSourceState {
    this.assertLive();
    return { ...this.dataState };
  }
  /** Explicit snapshot: ordinary edits do not clone the whole workbook. */
  toJSON(): Workbook {
    this.assertLive();
    return structuredClone(this.workbook);
  }
  load(workbook: Workbook) {
    this.assertLive();
    const next = asArgument(() => copyWorkbook(workbook));
    this.cancelImport('工作簿已替换');
    const epoch = this.clearSource();
    if (this.destroyed || epoch !== this.sourceEpoch) return;
    this.commitLoadedWorkbook(next);
  }
  private commitLoadedWorkbook(next: Workbook) {
    this.workbook = next;
    this.calculationVersion++;
    this.evaluator = this.createWorkbookEvaluator();
    this.history = [];
    this.future = [];
    this.selection = { row: 0, col: 0 };
    this.filter = '';
    this.changed();
  }
  private cancelImport(reason: unknown) {
    this.pendingImport?.cancel(reason);
  }
  async import(file: File, options: ImportOptions = {}) {
    this.assertLive();
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    )
      throw new LuminaError('INVALID_ARGUMENT', '无效导入选项');
    if (options.signal?.aborted)
      throw new LuminaError(
        'IMPORT_CANCELLED',
        '导入已取消，当前工作簿未被替换。',
        options.signal.reason,
      );
    this.cancelImport('新的导入已开始');
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let cancelled = false;
      const reading = new AbortController();
      const finish = () => {
        settled = true;
        options.signal?.removeEventListener('abort', abort);
        if (this.pendingImport === operation) this.pendingImport = undefined;
      };
      const operation = {
        cancel: (reason?: unknown) => {
          if (settled) return;
          cancelled = true;
          finish();
          reading.abort();
          reject(new LuminaError('IMPORT_CANCELLED', '导入已取消，当前工作簿未被替换。', reason));
        },
      };
      const abort = () => operation.cancel(options.signal?.reason);
      this.pendingImport = operation;
      options.signal?.addEventListener('abort', abort, { once: true });
      void (async () => {
        try {
          const workbook = await importFile(file, reading.signal);
          if (settled) return;
          const next = asArgument(() => copyWorkbook(workbook));
          if (settled) return;
          // Source cancellation can synchronously trigger a newer import/load,
          // destroy the instance, or abort this import. Keep ownership until the
          // candidate actually commits, rather than treating parsing as success.
          const epoch = this.clearSource();
          if (settled) return;
          if (this.destroyed || epoch !== this.sourceEpoch) {
            operation.cancel('工作簿提交已被替换');
            return;
          }
          // Once committed, render callbacks may perform further operations;
          // those do not retroactively turn this successful import into a failure.
          finish();
          this.commitLoadedWorkbook(next);
          resolve();
        } catch (error) {
          // File parsing can outlive cancellation; consume late failures quietly.
          if (cancelled) return;
          if (!settled) finish();
          reject(
            error instanceof LuminaError
              ? error
              : new LuminaError(
                  'INVALID_ARGUMENT',
                  error instanceof Error ? error.message : String(error),
                  error,
                ),
          );
        }
      })();
    });
  }
  async export(format: 'xlsx' | 'csv' | 'pdf' | 'json', options: ExportOptions = {}) {
    this.assertLive();
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (options.onProgress !== undefined && typeof options.onProgress !== 'function') ||
      (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    )
      throw new LuminaError('INVALID_ARGUMENT', '无效导出选项');
    validateExportBudgets(options.pagedCsv);
    if (!['xlsx', 'csv', 'pdf', 'json'].includes(format))
      throw new LuminaError('INVALID_ARGUMENT', '无效导出格式');
    if (options.signal?.aborted)
      throw new LuminaError('EXPORT_CANCELLED', '导出已取消。', options.signal.reason);
    const source = this.workbook.activeSheetId === this.boundSheetId ? this.source : undefined;
    if (
      (format !== 'csv' &&
        this.workbook.sheets.some((sheet) => sheet.dataSource?.kind === 'paged')) ||
      (format === 'csv' && this.currentSheet.dataSource?.kind === 'paged' && !source)
    )
      throw new LuminaError(
        'INVALID_ARGUMENT',
        '分页数据支持完整 CSV 导出；其他格式请先生成有界报表后导出',
      );
    const controller = new AbortController();
    const externalAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', externalAbort, { once: true });
    this.exportRequests.add(controller);
    const checkAbort = () => {
      if (controller.signal.aborted || this.destroyed)
        throw new LuminaError('EXPORT_CANCELLED', '导出已取消。', controller.signal.reason);
    };
    try {
      if (source) {
        const name = this.workbook.name;
        const blob = await reportDataCsvBlob(source, {
          pageSize: options.pagedCsv?.pageSize,
          maxPageTextUnits: options.pagedCsv?.maxPageTextUnits,
          maxRows: options.pagedCsv?.maxRows,
          signal: controller.signal,
          onProgress: options.onProgress,
        });
        checkAbort();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.csv`;
        try {
          document.body.append(link);
          checkAbort();
          link.click();
        } finally {
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        return;
      }
      // An export is an explicit snapshot operation. Async chunk/page yields must
      // not observe edits made after export started, even without format rules.
      const workbook = this.toJSON();
      let frozenCsvValues: Map<string, CellValue> | undefined;
      if (format === 'csv' && workbook.sheets.some((sheet) => sheet.dataSource?.kind === 'paged')) {
        // Freeze displayed formula values while the bounded source cache still belongs
        // to this export. A later page eviction must not change an in-flight CSV.
        const snapshot = workbook.sheets.find((sheet) => sheet.id === workbook.activeSheetId)!;
        frozenCsvValues = new Map();
        for (const [key, cell] of Object.entries(snapshot.cells))
          if (typeof cell.value === 'string' && cell.value.startsWith('='))
            frozenCsvValues.set(key, this.value(this.currentSheet, key));
      }
      if (format !== 'csv' && this.rules.length) {
        // Conditional rules export as static styles, not Excel dynamic rules.
        const evaluate = createEvaluator(workbook);
        for (const sheet of workbook.sheets)
          for (const [key, cell] of Object.entries(sheet.cells)) {
            checkAbort();
            const point = parseCellKey(key)!;
            cell.style = {
              ...cell.style,
              ...conditionalStyle(
                this.rules.filter((rule) => !rule.sheetId || rule.sheetId === sheet.id),
                point.row,
                point.col,
                evaluate(sheet, key),
              ),
            };
          }
      }
      await exportWorkbook(workbook, format, {
        ...(frozenCsvValues ? { frozenCsvValues } : {}),
        signal: controller.signal,
        onProgress: options.onProgress,
      });
    } catch (error) {
      if (error instanceof LuminaError) throw error;
      if (controller.signal.aborted || (error as { name?: string })?.name === 'AbortError')
        throw new LuminaError('EXPORT_CANCELLED', '导出已取消。', error);
      if (source) throw asDataError(error);
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', externalAbort);
      this.exportRequests.delete(controller);
    }
  }
  setCell(address: string, value: CellValue, style?: Cell['style']) {
    this.assertWritable();
    const point = parseCellKey(address);
    if (!point) throw new LuminaError('INVALID_ARGUMENT', `无效地址：${address}`);
    const key = cellKey(point.row, point.col);
    const currentStyle = style ?? this.currentSheet.cells[key]?.style;
    const hyperlink = this.currentSheet.cells[key]?.hyperlink;
    this.apply(this.currentSheet.id, [
      {
        key,
        cell: {
          ...replaceCellText(this.currentSheet.cells[key], value),
          ...(currentStyle ? { style: currentStyle } : {}),
          ...(hyperlink ? { hyperlink } : {}),
        },
      },
    ]);
  }
  setCells(changes: CellChange[]) {
    this.assertWritable();
    this.apply(this.currentSheet.id, changes);
  }
  /** Stable whole-row sort in an explicit static-sheet range, committed as one edit. */
  sortRows(request: RowSortRequest): SortResult {
    this.assertWritable();
    const sheet = this.sheetForMetadata();
    const planned = asArgument(() => {
      try {
        return planWorkbookRowSort(this.workbook, sheet.id, request);
      } catch (error) {
        if (error instanceof WorkbookSortValidationError)
          throw new DataValidationError(error.failures);
        throw error;
      }
    });
    if (!planned.changes.length && !planned.relatedChanges?.length)
      return { movedRows: 0, changedCells: 0 };
    // The shared planner validates moved records with an isolated evaluator;
    // apply retains the ordinary patch validation and history contract.
    if (planned.relatedChanges?.length) {
      const groups = [{ sheetId: sheet.id, changes: planned.changes }, ...planned.relatedChanges];
      const transaction: SortTransaction = {
        type: 'sort',
        groups: groups.map((group) => {
          const source = this.workbook.sheets.find((s) => s.id === group.sheetId)!;
          return {
            sheetId: group.sheetId,
            changes: group.changes.map((c) => ({ key: c.key, cell: c.cell && copyCell(c.cell) })),
            inverse: group.changes.map((c) => ({
              key: c.key,
              cell: source.cells[c.key] ? structuredClone(source.cells[c.key]) : null,
            })),
          };
        }),
      };
      this.history.push(transaction);
      this.trimHistory();
      this.future = [];
      this.restoreSort(transaction, false);
    } else this.apply(sheet.id, planned.changes, true, undefined, undefined, true);
    return {
      movedRows: planned.movedRows,
      changedCells:
        planned.changes.length +
        (planned.relatedChanges ?? []).reduce((n, group) => n + group.changes.length, 0),
    };
  }
  private restoreSort(transaction: SortTransaction, undo: boolean) {
    const groups = transaction.groups.map((group) => ({
      sheetId: group.sheetId,
      changes: structuredClone(undo ? group.inverse : group.changes),
    }));
    this.cancelImport('工作簿已排序');
    for (const group of groups) {
      const sheet = this.workbook.sheets.find((s) => s.id === group.sheetId)!;
      for (const change of group.changes) {
        if (change.cell) sheet.cells[change.key] = change.cell;
        else delete sheet.cells[change.key];
      }
    }
    this.workbook.updatedAt = new Date().toISOString();
    this.calculationVersion++;
    this.evaluator = this.createWorkbookEvaluator();
    const revision = this.revision + 1;
    this.changed();
    for (const group of groups) {
      if (this.destroyed || this.revision !== revision) break;
      this.callback(() =>
        this.options.onChange?.({
          sheetId: group.sheetId,
          changes: structuredClone(group.changes),
        }),
      );
    }
  }
  getValue(address: string): CellValue {
    this.assertLive();
    const point = parseCellKey(address);
    if (!point) throw new LuminaError('INVALID_ARGUMENT', `无效地址：${address}`);
    return this.value(this.currentSheet, cellKey(point.row, point.col));
  }
  /** One isolated raw cell (formulas stay formulas); safe for a formula bar hot path. */
  getCell(address: string): Cell | undefined {
    this.assertLive();
    const point = parseCellKey(address);
    if (!point) throw new LuminaError('INVALID_ARGUMENT', `无效地址：${address}`);
    if (this.cache && this.currentSheet.id === this.boundSheetId) {
      if (point.col >= this.cache.columnCount) return undefined;
      const value = this.cache.read(point.row, point.col);
      return value === undefined ? undefined : { value };
    }
    const cell = this.currentSheet.cells[cellKey(point.row, point.col)];
    return cell ? structuredClone(cell) : undefined;
  }
  select(range: Selection) {
    this.assertLive();
    const sheet = this.currentSheet;
    if (!record(range)) throw new LuminaError('INVALID_ARGUMENT', '无效选区');
    for (const [row, col] of [
      [range.row, range.col],
      [range.endRow ?? range.row, range.endCol ?? range.col],
    ])
      if (!validInteger(row, 0, sheet.rowCount - 1) || !validInteger(col, 0, sheet.colCount - 1))
        throw new LuminaError('INVALID_ARGUMENT', '选区超出工作表');
    this.selection = { ...range };
    this.callback(() => this.options.onSelectionChange?.({ ...range }));
    this.changed(false);
  }
  setConditionalRules(rules: ConditionalRule[]) {
    this.assertLive();
    const next = asArgument(() => copyRules(rules));
    this.cancelImport('条件格式已修改');
    this.rules = next;
    this.changed();
  }
  getConditionalRules(): ConditionalRule[] {
    this.assertLive();
    return structuredClone(this.rules);
  }
  insertRows(index: number, count = 1) {
    this.editStructure({ axis: 'row', kind: 'insert', index, count });
  }
  deleteRows(index: number, count = 1) {
    this.editStructure({ axis: 'row', kind: 'delete', index, count });
  }
  insertColumns(index: number, count = 1) {
    this.editStructure({ axis: 'column', kind: 'insert', index, count });
  }
  deleteColumns(index: number, count = 1) {
    this.editStructure({ axis: 'column', kind: 'delete', index, count });
  }
  private trimHistory() {
    if (this.history.length > 100) this.history.splice(0, this.history.length - 100);
    // Dropping an old structural state also drops the preceding history prefix.
    // Keeping earlier edits would make their coordinates refer to the wrong sheet.
    while (
      this.history.filter((item) => item.type === 'structure' || item.type === 'rename').length > 10
    ) {
      const oldest = this.history.findIndex(
        (item) => item.type === 'structure' || item.type === 'rename',
      );
      this.history.splice(0, oldest + 1);
    }
  }
  /** Rename a static worksheet and its explicit references as one undoable edit. */
  renameSheet(name: string, sheetId?: string): void {
    this.assertWritable();
    const sheet = this.sheetForMetadata(sheetId);
    const planned = asArgument(() => planSheetRename(this.workbook, sheet.id, name));
    if (planned === this.workbook) return;
    const affected = new Set(
      planned.sheets.filter((next, index) => next !== this.workbook.sheets[index]).map((s) => s.id),
    );
    const validated = asArgument(() => copyWorkbook(planned));
    const transaction: RenameTransaction = {
      type: 'rename',
      sheetId: sheet.id,
      previousName: sheet.name,
      name,
      beforeSheets: structuredClone(this.workbook.sheets.filter((s) => affected.has(s.id))),
      afterSheets: validated.sheets.filter((s) => affected.has(s.id)),
    };
    this.history.push(transaction);
    this.trimHistory();
    this.future = [];
    this.restoreRename(transaction, 'apply');
  }
  private restoreRename(transaction: RenameTransaction, phase: SheetRenameEvent['phase']) {
    const undo = phase === 'undo';
    const sheets = structuredClone(undo ? transaction.beforeSheets : transaction.afterSheets);
    const replacement = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    this.cancelImport('工作表名称已修改');
    this.workbook.sheets = this.workbook.sheets.map((sheet) => replacement.get(sheet.id) ?? sheet);
    this.workbook.updatedAt = new Date().toISOString();
    this.calculationVersion++;
    this.evaluator = this.createWorkbookEvaluator();
    const event: SheetRenameEvent = {
      sheetId: transaction.sheetId,
      previousName: undo ? transaction.name : transaction.previousName,
      name: undo ? transaction.previousName : transaction.name,
      affectedSheetIds: sheets.map((sheet) => sheet.id),
      phase,
    };
    const revision = this.revision + 1;
    this.changed();
    if (!this.destroyed && this.revision === revision)
      this.callback(() => this.options.onSheetRename?.(event));
  }
  private editStructure(edit: StructureEdit) {
    this.assertWritable();
    const sheetId = this.currentSheet.id;
    const planned = asArgument(() => planStructureEdit(this.workbook, sheetId, edit));
    const validated = asArgument(() => copyWorkbook({ ...this.workbook, sheets: planned.sheets }));
    const affected = new Set(planned.changedSheetIds);
    const afterSheet = validated.sheets.find((sheet) => sheet.id === sheetId)!;
    const nextRules = asArgument(() =>
      copyRules(
        this.rules.flatMap((rule) => {
          const scopes = rule.sheetId
            ? [rule.sheetId]
            : this.workbook.sheets.map((sheet) => sheet.id);
          return scopes.flatMap((scope) => {
            const range = scope === sheetId ? transformRange(rule.range, edit) : rule.range;
            return range ? [{ ...rule, sheetId: scope, range }] : [];
          });
        }),
      ),
    );
    const axis = edit.axis === 'row' ? 'row' : 'col';
    const endAxis = edit.axis === 'row' ? 'endRow' : 'endCol';
    const size = edit.axis === 'row' ? afterSheet.rowCount : afterSheet.colCount;
    const move = (position: number) =>
      Math.min(size - 1, transformPosition(position, edit) ?? edit.index);
    const nextSelection = { ...this.selection, [axis]: move(this.selection[axis]) };
    const end = this.selection[endAxis];
    if (end !== undefined) nextSelection[endAxis] = move(end);
    const transaction: StructureTransaction = {
      type: 'structure',
      sheetId,
      edit: { ...edit },
      affectedSheetIds: [...planned.changedSheetIds],
      beforeSheets: structuredClone(this.workbook.sheets.filter((sheet) => affected.has(sheet.id))),
      afterSheets: validated.sheets.filter((sheet) => affected.has(sheet.id)),
      beforeRules: structuredClone(this.rules),
      afterRules: nextRules,
      beforeSelection: { ...this.selection },
      afterSelection: nextSelection,
    };
    this.history.push(transaction);
    this.trimHistory();
    this.future = [];
    this.restoreStructure(transaction, 'apply');
  }
  private restoreStructure(
    transaction: StructureTransaction,
    phase: StructureChangeEvent['phase'],
  ) {
    this.cancelImport('工作表结构已修改');
    const undo = phase === 'undo';
    const sheets = structuredClone(undo ? transaction.beforeSheets : transaction.afterSheets);
    const replacement = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    this.workbook.sheets = this.workbook.sheets.map((sheet) => replacement.get(sheet.id) ?? sheet);
    this.rules = structuredClone(undo ? transaction.beforeRules : transaction.afterRules);
    const activeTarget = this.workbook.activeSheetId === transaction.sheetId;
    if (activeTarget)
      this.selection = { ...(undo ? transaction.beforeSelection : transaction.afterSelection) };
    this.workbook.updatedAt = new Date().toISOString();
    this.calculationVersion++;
    this.evaluator = this.createWorkbookEvaluator();
    // All state/history is committed before any host callback can reenter.
    const event: StructureChangeEvent = {
      ...transaction.edit,
      sheetId: transaction.sheetId,
      affectedSheetIds: [...transaction.affectedSheetIds],
      phase,
    };
    const selection = { ...this.selection };
    const expectedRevision = this.revision + 1;
    this.changed();
    if (this.destroyed || this.revision !== expectedRevision) return;
    this.callback(() => this.options.onStructureChange?.(event));
    if (activeTarget && !this.destroyed && this.revision === expectedRevision)
      this.callback(() => this.options.onSelectionChange?.(selection));
  }
  getPrintSettings(): PrintSettings | undefined {
    this.assertLive();
    return copyPrintSettings(this.currentSheet.printSettings, this.currentSheet);
  }
  setPrintSettings(settings?: PrintSettings) {
    this.assertWritable();
    const next = asArgument(() => copyPrintSettings(settings, this.currentSheet));
    this.apply(this.currentSheet.id, [], true, undefined, {
      ...metadata(this.currentSheet),
      printSettings: next,
    });
  }
  /** Isolated sparse metadata only; this getter never reads or clones cell data. */
  getSheetLayout(sheetId?: string): SheetLayout {
    this.assertLive();
    return layoutOf(this.sheetForMetadata(sheetId, false));
  }
  /** One atomic layout edit: omitted fields are retained; explicit undefined clears them. */
  setSheetLayout(partial: Partial<SheetLayout>, sheetId?: string) {
    this.assertWritable();
    const sheet = this.sheetForMetadata(sheetId);
    if (
      !plainRecord(partial) ||
      Reflect.ownKeys(partial).some(
        (key) =>
          typeof key !== 'string' || !layoutFields.includes(key as (typeof layoutFields)[number]),
      )
    )
      throw new LuminaError('INVALID_ARGUMENT', '布局配置只能包含列宽、行高、隐藏行列和冻结行');
    const before = layoutOf(sheet);
    const next = { ...before };
    for (const field of layoutFields)
      if (Object.hasOwn(partial, field)) Object.assign(next, { [field]: partial[field] });
    validateSheetMetadata({ ...sheet, ...next });
    const copy = asArgument(() => structuredClone(next));
    if (sameLayout(before, copy)) return;
    this.apply(sheet.id, [], true, undefined, { ...metadata(sheet), ...copy });
  }
  setColumnWidth(col: number, width: number, sheetId?: string) {
    this.assertWritable();
    const sheet = this.sheetForMetadata(sheetId);
    if (!validInteger(col, 0, sheet.colCount - 1))
      throw new LuminaError('INVALID_ARGUMENT', '列坐标无效');
    if (typeof width !== 'number' || !Number.isFinite(width) || width < 32 || width > 2000)
      throw new LuminaError('INVALID_ARGUMENT', '列宽必须为 32–2000');
    this.setSheetLayout({ columnWidths: { ...sheet.columnWidths, [col]: width } }, sheet.id);
  }
  /** Set one sparse row height in CSS pixels; the layout renderer may choose its own zoom. */
  setRowHeight(row: number, height: number, sheetId?: string) {
    this.assertWritable();
    const sheet = this.sheetForMetadata(sheetId);
    if (!validInteger(row, 0, sheet.rowCount - 1))
      throw new LuminaError('INVALID_ARGUMENT', '行坐标无效');
    if (typeof height !== 'number' || !Number.isFinite(height) || height < 1 || height > 600)
      throw new LuminaError('INVALID_ARGUMENT', '行高必须为 1–600');
    this.setSheetLayout({ rowHeights: { ...sheet.rowHeights, [row]: height } }, sheet.id);
  }
  /** Hide or reveal a contiguous row range atomically. */
  setRowsHidden(start: number, count: number, hidden = true, sheetId?: string) {
    this.assertWritable();
    const sheet = this.sheetForMetadata(sheetId);
    this.validateHiddenRange(start, count, sheet.rowCount, '行');
    if (typeof hidden !== 'boolean')
      throw new LuminaError('INVALID_ARGUMENT', 'hidden 必须为布尔值');
    const before = sheet.hiddenRows ?? [];
    if (!hidden) {
      const hiddenRows = before.filter((row) => row < start || row >= start + count);
      if (hiddenRows.length === before.length) return;
      this.setSheetLayout({ hiddenRows }, sheet.id);
      return;
    }
    const values = new Set(before);
    for (let row = start; row < start + count; row++) values.add(row);
    this.setSheetLayout({ hiddenRows: [...values].sort((a, b) => a - b) }, sheet.id);
  }
  /** Hide or reveal a contiguous column range atomically. */
  setColumnsHidden(start: number, count: number, hidden = true, sheetId?: string) {
    this.assertWritable();
    const sheet = this.sheetForMetadata(sheetId);
    this.validateHiddenRange(start, count, sheet.colCount, '列');
    if (typeof hidden !== 'boolean')
      throw new LuminaError('INVALID_ARGUMENT', 'hidden 必须为布尔值');
    const before = sheet.hiddenColumns ?? [];
    if (!hidden) {
      const hiddenColumns = before.filter((col) => col < start || col >= start + count);
      if (hiddenColumns.length === before.length) return;
      this.setSheetLayout({ hiddenColumns }, sheet.id);
      return;
    }
    const values = new Set(before);
    for (let col = start; col < start + count; col++) values.add(col);
    this.setSheetLayout({ hiddenColumns: [...values].sort((a, b) => a - b) }, sheet.id);
  }
  getDataValidation(): DataValidationRule[] {
    this.assertLive();
    return copyDataValidationRules(this.currentSheet.dataValidations ?? []);
  }
  /** Rules affect subsequent direct edits; existing content is not silently rewritten. */
  setDataValidation(rules: DataValidationRule[]) {
    this.assertWritable();
    const next = asArgument(() => copyDataValidationRules(rules));
    this.apply(this.currentSheet.id, [], true, undefined, {
      ...metadata(this.currentSheet),
      dataValidations: next,
    });
  }
  validateCell(address: string): DataValidationFailure[] {
    this.assertLive();
    const point = parseCellKey(address);
    if (!point) throw new LuminaError('INVALID_ARGUMENT', `无效地址：${address}`);
    const key = cellKey(point.row, point.col);
    return checkValue(
      this.currentSheet.id,
      key,
      this.value(this.currentSheet, key),
      this.currentSheet.dataValidations ?? [],
    );
  }
  report(definition: ReportDefinition, data: ReportRecord[]) {
    this.assertLive();
    const rules = asArgument(() => copyRules(definition.conditionalRules ?? []));
    const workbook = asArgument(() => generateReport(definition, data));
    this.load(workbook);
    this.rules = rules;
    this.changed();
  }
  private apply(
    sheetId: string,
    changes: CellChange[],
    track = true,
    targetDimensions?: SheetDimensions,
    targetMetadata?: SheetMetadata,
    preserveSelection = false,
  ) {
    this.assertWritable();
    const sheet = this.workbook.sheets.find((item) => item.id === sheetId);
    if (!sheet) throw new LuminaError('INVALID_ARGUMENT', '找不到工作表');
    if (sheet.dataSource?.kind === 'paged') throw new LuminaError('READ_ONLY', '分页数据源为只读');
    if (!Array.isArray(changes) || changes.length > 100_000)
      throw new LuminaError('INVALID_ARGUMENT', '单次最多编辑 100,000 格');
    const normalized = new Map<string, Cell | null>();
    for (const change of changes) {
      const point = change && typeof change.key === 'string' ? parseCellKey(change.key) : null;
      if (!point) throw new LuminaError('INVALID_ARGUMENT', `无效地址：${change?.key}`);
      normalized.set(
        cellKey(point.row, point.col),
        change.cell === null ? null : copyCell(change.cell),
      );
    }
    const before = dimensions(sheet),
      beforeMetadata = targetMetadata ? metadata(sheet) : undefined;
    const after = targetDimensions ? { ...targetDimensions } : { ...before };
    for (const [key, cell] of normalized)
      if (cell) {
        const point = parseCellKey(key)!;
        if (targetDimensions && (point.row >= after.rowCount || point.col >= after.colCount))
          throw new LuminaError('INVALID_ARGUMENT', '编辑超出目标尺寸');
        after.rowCount = Math.max(after.rowCount, point.row + 1);
        after.colCount = Math.max(after.colCount, point.col + 1);
      }
    validateDimensions(after);
    if (targetMetadata) validateSheetMetadata({ ...sheet, ...after, ...targetMetadata });
    if (track && normalized.size && sheet.dataValidations?.length) {
      const failures = validateWorkbookCellChanges(
        this.workbook,
        sheet.id,
        [...normalized].map(([key, cell]) => ({ key, cell })),
        { dimensions: after },
      );
      if (failures.length) throw new DataValidationError(failures);
    }
    if (
      !normalized.size &&
      !targetMetadata &&
      before.rowCount === after.rowCount &&
      before.colCount === after.colCount
    )
      return;
    const forward: CellChange[] = [],
      inverse: CellChange[] = [];
    let valuesChanged = false;
    for (const [key, cell] of normalized) {
      if (!Object.is(sheet.cells[key]?.value, cell?.value)) valuesChanged = true;
      inverse.push({ key, cell: sheet.cells[key] ? structuredClone(sheet.cells[key]) : null });
      forward.push({ key, cell });
    }
    this.cancelImport('工作簿已编辑');
    for (const { key, cell } of forward) {
      if (cell) sheet.cells[key] = cell;
      else delete sheet.cells[key];
    }
    Object.assign(sheet, after);
    if (targetMetadata) Object.assign(sheet, structuredClone(targetMetadata));
    if (track) {
      this.history.push({
        type: 'cells',
        sheetId,
        changes: forward,
        inverse,
        before,
        after,
        beforeMetadata,
        afterMetadata: targetMetadata ? metadata(sheet) : undefined,
        preserveSelection,
      });
      this.trimHistory();
      this.future = [];
    }
    this.workbook.updatedAt = new Date().toISOString();
    if (valuesChanged) this.calculationVersion++;
    this.evaluator.invalidateCells(sheet.id, [...normalized.keys()], this.calculationVersion);
    if (
      !preserveSelection &&
      sheetId === this.workbook.activeSheetId &&
      (normalized.size || before.rowCount !== after.rowCount || before.colCount !== after.colCount)
    )
      this.selection = {
        row: Math.min(this.selection.row, this.currentSheet.rowCount - 1),
        col: Math.min(this.selection.col, this.currentSheet.colCount - 1),
      };
    this.callback(() => this.options.onChange?.({ sheetId, changes: structuredClone(forward) }));
    this.changed();
  }
  undo() {
    this.assertWritable();
    const transaction = this.history.pop();
    if (!transaction) return;
    this.future.push(transaction);
    try {
      if (transaction.type === 'structure') {
        this.restoreStructure(transaction, 'undo');
        return;
      }
      if (transaction.type === 'sort') {
        this.restoreSort(transaction, true);
        return;
      }
      if (transaction.type === 'rename') {
        this.restoreRename(transaction, 'undo');
        return;
      }
      this.apply(
        transaction.sheetId,
        transaction.inverse,
        false,
        transaction.before,
        transaction.beforeMetadata,
        transaction.preserveSelection,
      );
    } catch (error) {
      this.future.pop();
      this.history.push(transaction);
      throw error;
    }
  }
  redo() {
    this.assertWritable();
    const transaction = this.future.pop();
    if (!transaction) return;
    this.history.push(transaction);
    try {
      if (transaction.type === 'structure') {
        this.restoreStructure(transaction, 'redo');
        return;
      }
      if (transaction.type === 'sort') {
        this.restoreSort(transaction, false);
        return;
      }
      if (transaction.type === 'rename') {
        this.restoreRename(transaction, 'redo');
        return;
      }
      this.apply(
        transaction.sheetId,
        transaction.changes,
        false,
        transaction.after,
        transaction.afterMetadata,
        transaction.preserveSelection,
      );
    } catch (error) {
      this.history.pop();
      this.future.push(transaction);
      throw error;
    }
  }
  bindData(source: ReportDataSource, options: ChunkCacheOptions = {}) {
    this.assertLive();
    const cache = asArgument(() => new ReportChunkCache(source, options));
    const workbook = this.workbook;
    const sheet = this.currentSheet;
    this.cancelImport('数据源已替换');
    const epoch = this.clearSource();
    if (
      this.destroyed ||
      epoch !== this.sourceEpoch ||
      this.workbook !== workbook ||
      this.currentSheet !== sheet
    ) {
      cache.dispose();
      return Promise.reject(new DOMException('数据绑定已取消。', 'AbortError'));
    }
    this.filter = '';
    this.cache = cache;
    this.source = source;
    this.setDataState({
      status: 'loading',
      cachedPages: 0,
      loading: 0,
      rowCount: cache.rowCount,
      pageSize: cache.pageSize,
    });
    this.boundSheetId = sheet.id;
    sheet.rowCount = Math.max(1, source.rowCount ?? MAX_ROWS);
    sheet.colCount = source.columnCount;
    sheet.cells = {};
    sheet.merges = [];
    sheet.columnWidths = {};
    sheet.rowHeights = {};
    sheet.hiddenRows = [];
    sheet.hiddenColumns = [];
    sheet.frozenRows = 0;
    delete sheet.dataValidations;
    delete sheet.printSettings;
    sheet.dataSource = { kind: 'paged', totalRows: source.rowCount, pageSize: cache.pageSize };
    this.calculationVersion++;
    this.history = [];
    this.future = [];
    this.evaluator.invalidate();
    this.selection = { row: 0, col: 0 };
    this.unsubscribeCache = cache.subscribe(() => {
      if (this.cache !== cache || this.destroyed) return;
      if (cache.rowCount !== undefined) {
        sheet.rowCount = Math.max(1, cache.rowCount);
        sheet.dataSource!.totalRows = cache.rowCount;
        if (this.workbook.activeSheetId === sheet.id && this.selection.row >= sheet.rowCount)
          this.selection = { row: sheet.rowCount - 1, col: this.selection.col };
      }
      this.refreshDataState(cache);
      // Cached pages are external to sheet.cells. A cache notification can add,
      // evict or clear values, so consumers must refresh their value source.
      this.calculationVersion++;
      this.evaluator.invalidate(this.calculationVersion);
      this.changed();
    });
    const initialRequest = new AbortController();
    this.initialRequest = initialRequest;
    const last = Math.min(30, sheet.rowCount - 1, cache.pageSize * cache.maxPages - 1);
    this.lastViewport = `0:${last}`;
    this.changed();
    // Synchronous subscribers can replace or destroy the binding during changed().
    // Retain this operation's controller, never borrow a replacement's request.
    if (this.destroyed || this.cache !== cache || initialRequest.signal.aborted)
      return Promise.reject(new DOMException('数据绑定已取消。', 'AbortError'));
    if (cache.rowCount === 0) {
      this.setDataState({
        status: 'ready',
        cachedPages: 0,
        loading: 0,
        rowCount: 0,
        pageSize: cache.pageSize,
      });
      return Promise.resolve();
    }
    return cache.ensureRange(0, last, initialRequest.signal).catch((error) => {
      throw asDataError(error);
    });
  }
  private clearSource() {
    const epoch = ++this.sourceEpoch;
    const exports = [...this.exportRequests];
    const viewport = this.viewportRequest;
    const initial = this.initialRequest;
    const cache = this.cache;
    // Detach every old owner before abort listeners can synchronously rebind.
    // Cleanup must never borrow controllers or subscriptions from that new binding.
    this.exportRequests.clear();
    this.unsubscribeCache?.();
    this.unsubscribeCache = undefined;
    this.viewportRequest = undefined;
    this.viewportError = undefined;
    this.initialRequest = undefined;
    this.cache = undefined;
    this.source = undefined;
    this.boundSheetId = undefined;
    this.lastViewport = '';
    this.setDataState({ status: 'idle', cachedPages: 0, loading: 0 });
    for (const request of exports) request.abort();
    viewport?.abort();
    initial?.abort();
    cache?.dispose();
    return epoch;
  }
  private refreshDataState(cache: ReportChunkCache) {
    if (this.destroyed || this.cache !== cache) return;
    const error = this.viewportError ?? (cache.error ? asDataError(cache.error) : undefined);
    this.setDataState({
      status: error ? 'error' : cache.loading ? 'loading' : 'ready',
      cachedPages: cache.size,
      loading: cache.loading,
      rowCount: cache.rowCount,
      pageSize: cache.pageSize,
      ...(error ? { error } : {}),
    });
  }
  private setDataState(state: DataSourceState) {
    if (this.destroyed) return;
    this.dataState = { ...state };
    if (this.dataNotificationPending) return;
    this.dataNotificationPending = true;
    // Defer host callbacks until the complete workbook/cache transition is committed.
    // A callback may load another workbook or destroy this instance safely.
    queueMicrotask(() => {
      this.dataNotificationPending = false;
      if (!this.destroyed)
        this.callback(() => this.options.onDataStateChange?.({ ...this.dataState }));
    });
  }
  private value = (sheet: Sheet, key: string): CellValue => {
    const point = parseCellKey(key);
    if (this.cache && sheet.id === this.boundSheetId)
      return point && point.col < this.cache.columnCount
        ? (this.cache.read(point.row, point.col) ?? '')
        : '';
    return this.evaluator(sheet, key);
  };
  private cell = (sheet: Sheet, key: string): Cell | undefined => {
    const point = parseCellKey(key);
    if (!point) return;
    const bound = this.cache && sheet.id === this.boundSheetId;
    const raw = bound
      ? point.col < this.cache!.columnCount
        ? this.cache!.read(point.row, point.col)
        : undefined
      : sheet.cells[key]?.value;
    if (raw === undefined) return;
    const base = bound ? undefined : sheet.cells[key];
    return {
      ...base,
      value: raw,
      style: {
        ...base?.style,
        ...conditionalStyle(
          this.rules.filter((rule) => !rule.sheetId || rule.sheetId === sheet.id),
          point.row,
          point.col,
          this.value(sheet, key),
        ),
      },
    };
  };
  viewport = (range: { firstRow: number; lastRow: number }) => {
    this.assertLive();
    if (
      !record(range) ||
      typeof range.firstRow !== 'number' ||
      !Number.isFinite(range.firstRow) ||
      typeof range.lastRow !== 'number' ||
      !Number.isFinite(range.lastRow)
    )
      throw new LuminaError('INVALID_ARGUMENT', '视口范围必须包含有限的起止行号');
    if (!this.cache || this.workbook.activeSheetId !== this.boundSheetId) return;
    const first = Math.max(0, Math.min(this.currentSheet.rowCount - 1, Math.floor(range.firstRow)));
    const last = Math.max(
      first,
      Math.min(this.currentSheet.rowCount - 1, Math.floor(range.lastRow)),
    );
    const signature = `${first}:${last}`;
    if (signature === this.lastViewport) return;
    this.lastViewport = signature;
    const cache = this.cache;
    const previousRequest = this.viewportRequest;
    const request = new AbortController();
    this.viewportRequest = request;
    previousRequest?.abort();
    // Cancellation can synchronously notify a host which loads, switches, rebinds
    // or requests a newer viewport. Only the still-current request may proceed.
    if (
      this.destroyed ||
      this.cache !== cache ||
      this.viewportRequest !== request ||
      request.signal.aborted ||
      this.workbook.activeSheetId !== this.boundSheetId
    )
      return;
    this.viewportError = undefined;
    this.refreshDataState(cache);
    void cache.ensureRange(first, last, request.signal).catch((error) => {
      if (
        this.cache === cache &&
        this.viewportRequest === request &&
        error?.name !== 'AbortError'
      ) {
        const failure = asDataError(error);
        this.viewportError = failure;
        this.refreshDataState(cache);
        this.reportError(failure);
      }
    });
  };
  /** Explicit retry; repaint alone never loops on a failing endpoint. */
  retryData() {
    this.assertLive();
    const previous = this.lastViewport;
    this.lastViewport = '';
    if (previous) {
      const [firstRow, lastRow] = previous.split(':').map(Number);
      this.viewport({ firstRow, lastRow });
    }
  }
  /** Drops retained pages and reloads the last viewport; does not detach the source. */
  clearDataCache() {
    this.assertLive();
    const cache = this.cache;
    if (!cache) return;
    this.viewportRequest?.abort();
    if (this.destroyed || this.cache !== cache) return;
    this.initialRequest?.abort();
    if (this.destroyed || this.cache !== cache) return;
    cache.clear();
    if (this.destroyed || this.cache !== cache) return;
    this.retryData();
  }
  private replaceSheetMetadata(next: Sheet) {
    this.assertWritable();
    const sheet = this.currentSheet;
    if (next.id !== sheet.id) throw new LuminaError('INVALID_ARGUMENT', '工作表不匹配');
    validateDimensions(next);
    validateSheetMetadata(next);
    // Canvas emits full sheets only for column geometry; cell edits use onPatch.
    this.apply(sheet.id, [], true, dimensions(next), metadata(next));
  }
  private sheetForMetadata(sheetId?: string, writable = true): Sheet {
    const sheet =
      sheetId === undefined
        ? this.currentSheet
        : this.workbook.sheets.find((item) => item.id === sheetId);
    if (!sheet) throw new LuminaError('INVALID_ARGUMENT', '找不到工作表');
    if (writable && sheet.dataSource?.kind === 'paged')
      throw new LuminaError('READ_ONLY', '分页数据源为只读');
    return sheet;
  }
  private validateHiddenRange(start: number, count: number, dimension: number, label: string) {
    if (!validInteger(start, 0, dimension - 1) || !validInteger(count, 1, dimension - start))
      throw new LuminaError('INVALID_ARGUMENT', `${label}范围无效`);
  }
  surface() {
    this.assertLive();
    const renderedRevision = this.revision;
    const renderedBook = this.workbook,
      renderedSheet = this.currentSheet.id,
      epoch = this.sheetViewEpoch;
    const currentView = () =>
      !this.destroyed &&
      this.workbook === renderedBook &&
      this.currentSheet.id === renderedSheet &&
      this.sheetViewEpoch === epoch;
    const assertCurrentView = () => {
      this.assertLive();
      if (!currentView()) throw new LuminaError('INVALID_ARGUMENT', '工作表已切换，旧编辑已取消');
    };
    return (
      <Spreadsheet
        workbook={this.workbook}
        sheet={this.currentSheet}
        selection={this.selection}
        onSelect={(range) => {
          if (currentView()) this.select(range);
        }}
        onPatch={(id, changes, nextDimensions) => {
          assertCurrentView();
          if (id !== renderedSheet) throw new LuminaError('INVALID_ARGUMENT', '工作表不匹配');
          this.apply(
            id,
            changes,
            true,
            nextDimensions ? { ...dimensions(this.currentSheet), ...nextDimensions } : undefined,
          );
        }}
        onChange={(sheet) => {
          assertCurrentView();
          this.replaceSheetMetadata(sheet);
        }}
        getCell={this.cell}
        getValue={this.value}
        calculationVersion={this.calculationVersion}
        renderVersion={this.renderRevision}
        readOnly={this.activeSheetInfo.readOnly}
        onViewportChange={(range) => {
          if (currentView()) this.viewport(range);
        }}
        onRenderMetrics={(metrics) => {
          if (!this.destroyed && this.revision === renderedRevision)
            this.callback(() => this.options.onRender?.({ ...metrics }));
        }}
        onEditError={(error) => this.reportError(error)}
        onUndo={() => {
          if (currentView()) this.undo();
        }}
        onRedo={() => {
          if (currentView()) this.redo();
        }}
        zoom={this.options.zoom ?? 100}
        filter={this.filter}
        clipboardMode={this.clipboardMode}
      />
    );
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.cancelImport('表格已销毁');
      this.clearSource();
    } finally {
      try {
        this.root.unmount();
      } finally {
        this.listeners.clear();
        this.host.className = this.previousClass;
        mountedHosts.delete(this.host);
      }
    }
  }
}
function Surface({ controller }: { controller: LuminaSpreadsheet }) {
  useSyncExternalStore(controller.subscribe, controller.snapshot);
  return controller.surface();
}
export function createSpreadsheet(host: HTMLElement, options: SpreadsheetOptions = {}) {
  return new LuminaSpreadsheet(host, options);
}

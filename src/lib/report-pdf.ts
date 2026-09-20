import type { Cell, CellRange, PrintSettings, Sheet, Workbook } from './types';
import { copyPrintSettings, validatePrintSettings } from './print-settings';
import { MergeIndex } from './canvas/geometry';
import { cellKey, createEvaluator, displayCell, parseCellKey, type Evaluator } from './engine';

export interface PdfExportOptions extends PrintSettings {
  /** Safety limits reject oversized exports; they never truncate the report. */
  maxRows?: number;
  maxColumns?: number;
  maxPages?: number;
  maxCells?: number;
  /** Raster resolution, in pixels per PDF point (default 2). */
  pixelRatio?: number;
  evaluator?: Evaluator;
  signal?: AbortSignal;
  onProgress?: (completedPages: number, totalPages: number) => void;
}

export interface PdfPagePlan {
  rows: number[];
  columns: number[];
  verticalPage: number;
  horizontalPage: number;
}
export interface PdfLayout {
  width: number;
  height: number;
  columnWidths: number[];
  rowHeights: number[];
  pages: PdfPagePlan[];
  /** Effective margins in PDF points, used by both planning and drawing. */
  margins: NonNullable<PrintSettings['margins']>;
}
export interface PdfJpegPage {
  bytes: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
}
const DEFAULT_MARGIN = 28;
const TITLE_HEIGHT = 40;
const FOOTER_HEIGHT = 20;
const PADDING = 4;
const BASE_ROW_HEIGHT = 24;
const FONT_FAMILY = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif';

function abortIfNeeded(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error('PDF 导出已取消');
  error.name = 'AbortError';
  throw error;
}
function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const actual = value ?? fallback;
  if (!Number.isInteger(actual) || actual < 1) throw new Error(`${label}必须为正整数。`);
  return actual;
}
function boundsOf(sheet: Sheet) {
  let rows = 1,
    columns = 1;
  for (const key in sheet.cells) {
    const point = parseCellKey(key);
    if (!point) continue;
    rows = Math.max(rows, point.row + 1);
    columns = Math.max(columns, point.col + 1);
  }
  for (const merge of sheet.merges ?? []) {
    rows = Math.max(rows, merge.end.row + 1);
    columns = Math.max(columns, merge.end.col + 1);
  }
  return { rows, columns };
}
function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);
}
function dimension(settings: PrintSettings) {
  const portrait =
    settings.paperSize === 'A3'
      ? { width: 841.89, height: 1190.55 }
      : settings.paperSize === 'Letter'
        ? { width: 612, height: 792 }
        : { width: 595.28, height: 841.89 };
  return settings.orientation === 'portrait'
    ? portrait
    : { width: portrait.height, height: portrait.width };
}
function effectiveSettings(
  sheet: Sheet,
  options: PdfExportOptions,
  bounds: { rows: number; columns: number },
): PrintSettings {
  const settings = copyPrintSettings(sheet.printSettings) ?? {};
  const keys: (keyof PrintSettings)[] = [
    'paperSize',
    'orientation',
    'margins',
    'repeatRows',
    'repeatColumns',
    'rowBreaks',
    'columnBreaks',
  ];
  for (const key of keys) {
    if (options[key] !== undefined) Object.assign(settings, { [key]: options[key] });
  }
  // Validate before applying defaults: explicit null is invalid, not an omitted setting.
  validatePrintSettings(settings, { rowCount: bounds.rows, colCount: bounds.columns });
  // Explicit settings are never silently clamped. Only the historical frozen-row default is bounded.
  settings.repeatRows ??= Math.min(bounds.rows, sheet.frozenRows ?? 0);
  settings.repeatColumns ??= 0;
  validatePrintSettings(settings, { rowCount: bounds.rows, colCount: bounds.columns });
  return settings;
}
function widthsFor(sheet: Sheet, count: number) {
  return Array.from({ length: count }, (_, col) => {
    const px = sheet.columnWidths?.[col] ?? 120;
    if (!Number.isFinite(px) || px <= 0) throw new Error('PDF 导出遇到无效列宽。');
    return Math.max(32, px * 0.65);
  });
}

/** Greedy pagination keeps every merge wholly on a page; impossible layouts fail explicitly. */
function paginateAxis(
  sizes: number[],
  repeat: number,
  available: number,
  protectedRanges: [number, number][],
  label: string,
  breaks: number[],
  maxPages: number,
): number[][] {
  const repeated = range(0, repeat);
  const headerSize = repeated.reduce((sum, item) => sum + sizes[item], 0);
  if (headerSize > available) throw new Error(`PDF 重复标题${label}超过单页可用空间。`);
  for (const [start, end] of protectedRanges)
    if (start < repeat && end >= repeat)
      throw new Error('合并区域跨越重复标题边界；请调整重复标题范围后导出 PDF。');
  for (const position of breaks) {
    if (protectedRanges.some(([start, end]) => start < position && end >= position))
      throw new Error(`手动${label}分页跨越合并区域；请将分页移动到合并区域之前或之后。`);
  }
  if (repeat === sizes.length) return [repeated];
  const output: number[][] = [];
  let start = repeat,
    breakIndex = 0;
  while (start < sizes.length) {
    while (breakIndex < breaks.length && breaks[breakIndex] <= start) breakIndex++;
    const segmentEnd = breaks[breakIndex] ?? sizes.length;
    let end = start,
      occupied = headerSize;
    while (end < segmentEnd && occupied + sizes[end] <= available + 0.001) occupied += sizes[end++];
    let changed = true;
    while (changed) {
      changed = false;
      for (const [mergeStart, mergeEnd] of protectedRanges)
        if (mergeStart < end && mergeEnd >= end && mergeStart >= start) {
          end = mergeStart;
          changed = true;
        }
    }
    if (end === start)
      throw new Error(
        `第 ${start + 1} ${label}或其合并区域超过单页空间；请调整列宽、内容或纸张方向。`,
      );
    if (output.length >= maxPages) throw new Error(`PDF 超过 ${maxPages} 页上限；请缩小已用区域。`);
    output.push([...repeated, ...range(start, end)]);
    start = end;
  }
  return output;
}

function hiddenAxis(values: number[] | undefined, count: number, label: string): Set<number> {
  if (
    values !== undefined &&
    (!Array.isArray(values) ||
      values.some((value) => !Number.isInteger(value) || value < 0 || value >= count))
  )
    throw new Error(`PDF 隐藏${label}坐标无效。`);
  const result = new Set(values ?? []);
  if (result.size !== (values?.length ?? 0)) throw new Error(`PDF 隐藏${label}坐标重复。`);
  return result;
}
function lowerBound(values: number[], target: number): number {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function paginateVisibleAxis(
  sizes: number[],
  visible: number[],
  repeat: number,
  available: number,
  merges: [number, number][],
  label: string,
  breaks: number[],
  maxPages: number,
): number[][] {
  const compactRepeat = lowerBound(visible, repeat);
  const compactBreaks = [
    ...new Set(breaks.map((position) => lowerBound(visible, position))),
  ].filter((position) => position > compactRepeat && position < visible.length);
  const compactMerges: [number, number][] = merges.map(([start, end]) => [
    lowerBound(visible, start),
    lowerBound(visible, end + 1) - 1,
  ]);
  return paginateAxis(
    visible.map((index) => sizes[index]),
    compactRepeat,
    available,
    compactMerges,
    label,
    compactBreaks,
    maxPages,
  ).map((page) => page.map((index) => visible[index]));
}

/** Deterministic page planner. Large sparse extents are rejected instead of silently omitted. */
export function planPdfPages(
  sheet: Sheet,
  options: PdfExportOptions = {},
  measuredHeights?: number[],
): PdfLayout {
  abortIfNeeded(options.signal);
  if (sheet.dataSource?.kind === 'paged')
    throw new Error(
      '分片数据源必须先完整加载为静态工作表，才能导出 PDF；当前页缓存不能代表完整报表。',
    );
  const bounds = boundsOf(sheet);
  const maxRows = positiveInteger(options.maxRows, 5_000, 'PDF 行数上限');
  const maxColumns = positiveInteger(options.maxColumns, 256, 'PDF 列数上限');
  const maxPages = positiveInteger(options.maxPages, 200, 'PDF 页数上限');
  const maxCells = positiveInteger(options.maxCells, 200_000, 'PDF 单元格上限');
  if (
    bounds.rows > maxRows ||
    bounds.columns > maxColumns ||
    bounds.rows * bounds.columns > maxCells
  )
    throw new Error(
      `PDF 已用区域 ${bounds.rows} 行 × ${bounds.columns} 列超过导出上限（${maxRows} 行、${maxColumns} 列、${maxCells} 格），未导出任何截断内容。`,
    );
  const settings = effectiveSettings(sheet, options, bounds);
  const repeatRows = settings.repeatRows!;
  const repeatColumns = settings.repeatColumns!;
  const { width, height } = dimension(settings);
  const margins = settings.margins ?? {
    top: DEFAULT_MARGIN,
    right: DEFAULT_MARGIN,
    bottom: DEFAULT_MARGIN,
    left: DEFAULT_MARGIN,
  };
  const availableWidth = width - margins.left - margins.right;
  const availableHeight = height - margins.top - margins.bottom - TITLE_HEIGHT - FOOTER_HEIGHT;
  if (availableWidth <= 0 || availableHeight <= 0)
    throw new Error('页边距和页眉页脚超过纸张可用空间。');
  const hiddenRows = hiddenAxis(sheet.hiddenRows, sheet.rowCount, '行');
  const hiddenColumns = hiddenAxis(sheet.hiddenColumns, sheet.colCount, '列');
  for (const [row, px] of Object.entries(sheet.rowHeights ?? {}))
    if (
      !/^\d+$/.test(row) ||
      Number(row) >= sheet.rowCount ||
      !Number.isFinite(px) ||
      px < 1 ||
      px > 600
    )
      throw new Error('PDF 行高必须为有效行坐标上的 1–600 像素。');
  const columnWidths = widthsFor(sheet, bounds.columns).map((width, col) =>
    hiddenColumns.has(col) ? 0 : width,
  );
  if (measuredHeights && measuredHeights.length !== bounds.rows) throw new Error('无效 PDF 行高。');
  const rowHeights = Array.from({ length: bounds.rows }, (_, row) => {
    if (hiddenRows.has(row)) return 0;
    const height =
      measuredHeights?.[row] ??
      (sheet.rowHeights?.[row] === undefined ? BASE_ROW_HEIGHT : sheet.rowHeights[row] * 0.75);
    if (!Number.isFinite(height) || height <= 0) throw new Error('无效 PDF 行高。');
    return height;
  });
  const visibleRows = range(0, bounds.rows).filter((row) => !hiddenRows.has(row));
  const visibleColumns = range(0, bounds.columns).filter((col) => !hiddenColumns.has(col));
  if (!visibleRows.length || !visibleColumns.length)
    throw new Error('已用区域没有可打印的可见单元格。');
  const merges = sheet.merges ?? [];
  for (const merge of merges) {
    if (
      ![merge.start.row, merge.start.col, merge.end.row, merge.end.col].every(
        (n) => Number.isInteger(n) && n >= 0,
      ) ||
      merge.start.row > merge.end.row ||
      merge.start.col > merge.end.col
    )
      throw new Error('PDF 导出遇到无效合并区域。');
  }
  const mergeIndex = new MergeIndex(merges, bounds.rows, bounds.columns);
  for (const merge of merges)
    if (mergeIndex.query(merge.start.row, merge.end.row, merge.start.col, merge.end.col).length > 1)
      throw new Error('PDF 导出不支持重叠的合并区域。');
  for (const key in sheet.cells) {
    if (sheet.cells[key].value === '') continue;
    const point = parseCellKey(key);
    const merge = point ? mergeIndex.at(point.row, point.col) : undefined;
    if (merge && point && (point.row !== merge.top || point.col !== merge.left))
      throw new Error('合并区域包含被覆盖的非空单元格；请先处理隐藏内容后导出 PDF。');
  }
  // Pagination works in compact visible coordinates; page plans keep original
  // sheet coordinates, so formulas, labels and source cells never shift.
  const printableMerges = merges.filter(
    (merge) =>
      lowerBound(visibleRows, merge.start.row) < lowerBound(visibleRows, merge.end.row + 1) &&
      lowerBound(visibleColumns, merge.start.col) < lowerBound(visibleColumns, merge.end.col + 1),
  );
  const horizontal = paginateVisibleAxis(
    columnWidths,
    visibleColumns,
    repeatColumns,
    availableWidth,
    printableMerges.map((m) => [m.start.col, m.end.col]),
    '列',
    settings.columnBreaks ?? [],
    maxPages,
  );
  const vertical = paginateVisibleAxis(
    rowHeights,
    visibleRows,
    repeatRows,
    availableHeight,
    printableMerges.map((m) => [m.start.row, m.end.row]),
    '行',
    settings.rowBreaks ?? [],
    maxPages,
  );
  if (horizontal.length * vertical.length > maxPages)
    throw new Error(
      `PDF 需要 ${horizontal.length * vertical.length} 页，超过 ${maxPages} 页上限；请缩小已用区域。`,
    );
  const pages = vertical.flatMap((rows, verticalPage) =>
    horizontal.map((columns, horizontalPage) => ({ rows, columns, verticalPage, horizontalPage })),
  );
  return { width, height, columnWidths, rowHeights, pages, margins };
}

function font(cell?: Cell): string {
  return `${cell?.style?.italic ? 'italic ' : ''}${cell?.style?.bold ? 'bold ' : ''}${(cell?.style?.fontSize ?? 12) * 0.75}px ${FONT_FAMILY}`;
}
function linesFor(context: CanvasRenderingContext2D, text: string, available: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const character of paragraph) {
      if (context.measureText(character).width > available)
        throw new Error('单元格字体超过列宽，无法完整导出 PDF。');
      const candidate = line + character;
      if (line && context.measureText(candidate).width > available) {
        lines.push(line);
        line = character;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}
function mergeAt(index: MergeIndex, row: number, col: number): CellRange | undefined {
  const rect = index.at(row, col);
  return rect
    ? { start: { row: rect.top, col: rect.left }, end: { row: rect.bottom, col: rect.right } }
    : undefined;
}

function cellText(sheet: Sheet, row: number, col: number, evaluator: Evaluator) {
  const key = cellKey(row, col),
    cell = sheet.cells[key];
  return { cell, value: cell ? displayCell(cell, evaluator(sheet, key)) : '' };
}
async function yieldToBrowser(signal?: AbortSignal) {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  abortIfNeeded(signal);
}
async function measureRows(
  context: CanvasRenderingContext2D,
  sheet: Sheet,
  layout: PdfLayout,
  evaluator: Evaluator,
  signal?: AbortSignal,
) {
  const heights = layout.rowHeights.slice();
  const merges = new MergeIndex(sheet.merges, sheet.rowCount, sheet.colCount);
  const seen = new Set<string>();
  for (let row = 0; row < heights.length; row++) {
    abortIfNeeded(signal);
    if (heights[row] <= 0) continue;
    for (let col = 0; col < layout.columnWidths.length; col++) {
      if (layout.columnWidths[col] <= 0) continue;
      const merge = mergeAt(merges, row, col);
      const sourceRow = merge?.start.row ?? row,
        sourceCol = merge?.start.col ?? col;
      const key = cellKey(sourceRow, sourceCol);
      if (merge && seen.has(key)) continue;
      if (merge) seen.add(key);
      const { cell, value } = cellText(sheet, sourceRow, sourceCol, evaluator);
      if (!value) continue;
      context.font = font(cell);
      const right = merge?.end.col ?? col,
        bottom = merge?.end.row ?? row;
      let width = 0,
        allocated = 0;
      for (let c = col; c <= right; c++) width += layout.columnWidths[c];
      for (let r = row; r <= bottom; r++) allocated += heights[r];
      const lineHeight = (cell?.style?.fontSize ?? 12) * 0.75 * 1.4;
      const required =
        linesFor(context, value, width - PADDING * 2).length * lineHeight + PADDING * 2;
      if (required > allocated) {
        let lastVisible = bottom;
        while (lastVisible > row && heights[lastVisible] === 0) lastVisible--;
        heights[lastVisible] += required - allocated;
      }
    }
    if (row % 64 === 63) await yieldToBrowser(signal);
  }
  return heights;
}
function drawCell(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  cell: Cell | undefined,
  text: string,
  evaluated: unknown,
) {
  context.fillStyle = cell?.style?.background ?? '#ffffff';
  context.fillRect(x, y, width, height);
  context.strokeStyle = '#ccd4d0';
  context.lineWidth = 0.5;
  context.strokeRect(x, y, width, height);
  if (!text) return;
  context.font = font(cell);
  context.fillStyle = cell?.style?.color ?? '#192a24';
  context.textBaseline = 'top';
  const align = cell?.style?.align ?? (typeof evaluated === 'number' ? 'right' : 'left');
  context.textAlign = align;
  const lineHeight = (cell?.style?.fontSize ?? 12) * 0.75 * 1.4;
  const lines = linesFor(context, text, width - PADDING * 2);
  if (lines.length * lineHeight + PADDING * 2 > height + 0.01)
    throw new Error('PDF 单元格内容超过分页后的可用高度，导出已停止。');
  const anchor =
    align === 'center' ? x + width / 2 : align === 'right' ? x + width - PADDING : x + PADDING;
  lines.forEach((line, index) => {
    const top = y + PADDING + index * lineHeight;
    context.fillText(line, anchor, top);
    if (cell?.style?.underline && line) {
      const length = context.measureText(line).width;
      const left =
        align === 'center' ? anchor - length / 2 : align === 'right' ? anchor - length : anchor;
      context.strokeStyle = context.fillStyle;
      context.beginPath();
      context.moveTo(left, top + lineHeight * 0.85);
      context.lineTo(left + length, top + lineHeight * 0.85);
      context.stroke();
    }
  });
}
function drawPage(
  context: CanvasRenderingContext2D,
  workbook: Workbook,
  sheet: Sheet,
  layout: PdfLayout,
  page: PdfPagePlan,
  index: number,
  evaluator: Evaluator,
) {
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, layout.width, layout.height);
  context.font = `bold 13px ${FONT_FAMILY}`;
  context.fillStyle = '#192a24';
  context.textAlign = 'left';
  context.textBaseline = 'top';
  const { margins } = layout;
  const printableWidth = layout.width - margins.left - margins.right;
  const title = `${workbook.name} · ${sheet.name}`;
  // Title text is kept on one line with a fitted font; cell contents are wrapped in full.
  const width = context.measureText(title).width;
  if (width > printableWidth)
    context.font = `bold ${(13 * printableWidth) / width}px ${FONT_FAMILY}`;
  context.fillText(title, margins.left, margins.top);
  context.font = `8px ${FONT_FAMILY}`;
  const labels = (indices: number[]) => {
    const groups: string[] = [];
    let start = indices[0],
      previous = start;
    for (const value of indices.slice(1)) {
      if (value !== previous + 1) {
        groups.push(start === previous ? String(start + 1) : `${start + 1}–${previous + 1}`);
        start = value;
      }
      previous = value;
    }
    groups.push(start === previous ? String(start + 1) : `${start + 1}–${previous + 1}`);
    return groups.join('、');
  };
  const subtitle = `行 ${labels(page.rows)}  ·  列 ${labels(page.columns)}`;
  const subtitleWidth = context.measureText(subtitle).width;
  if (subtitleWidth > printableWidth)
    context.font = `${(8 * printableWidth) / subtitleWidth}px ${FONT_FAMILY}`;
  context.fillText(subtitle, margins.left, margins.top + 23);
  const xPositions = new Map<number, number>(),
    yPositions = new Map<number, number>();
  let x = margins.left,
    y = margins.top + TITLE_HEIGHT;
  for (const col of page.columns) {
    xPositions.set(col, x);
    x += layout.columnWidths[col];
  }
  for (const row of page.rows) {
    yPositions.set(row, y);
    y += layout.rowHeights[row];
  }
  const merges = new MergeIndex(sheet.merges, sheet.rowCount, sheet.colCount);
  const seen = new Set<string>();
  for (const row of page.rows)
    for (const col of page.columns) {
      const merge = mergeAt(merges, row, col);
      const sourceRow = merge?.start.row ?? row,
        sourceCol = merge?.start.col ?? col;
      const key = cellKey(sourceRow, sourceCol);
      if (merge && seen.has(key)) continue;
      if (merge) seen.add(key);
      let width = 0,
        height = 0;
      for (let c = col; c <= (merge?.end.col ?? col); c++) width += layout.columnWidths[c];
      for (let r = row; r <= (merge?.end.row ?? row); r++) height += layout.rowHeights[r];
      const { cell, value } = cellText(sheet, sourceRow, sourceCol, evaluator);
      drawCell(
        context,
        xPositions.get(col)!,
        yPositions.get(row)!,
        width,
        height,
        cell,
        value,
        cell ? evaluator(sheet, key) : '',
      );
    }
  context.font = `8px ${FONT_FAMILY}`;
  context.textAlign = 'right';
  context.fillStyle = '#63766d';
  const footer = `${index + 1} / ${layout.pages.length}`;
  const footerWidth = context.measureText(footer).width;
  if (footerWidth > printableWidth)
    context.font = `${(8 * printableWidth) / footerWidth}px ${FONT_FAMILY}`;
  context.fillText(footer, layout.width - margins.right, layout.height - margins.bottom - 8);
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
/** Binary-safe PDF writer: JPEG data is copied unchanged and xref offsets count bytes. */
export function assembleJpegPdf(
  pages: PdfJpegPage[],
  pageWidth: number,
  pageHeight: number,
): ArrayBuffer {
  if (!pages.length) throw new Error('PDF 至少需要一页。');
  const encode = (text: string) => new TextEncoder().encode(text);
  const objects: Uint8Array[] = [encode(''), encode('')];
  const pageIds: number[] = [];
  const add = (body: Uint8Array) => {
    objects.push(body);
    return objects.length;
  };
  for (const page of pages) {
    if (
      page.bytes[0] !== 0xff ||
      page.bytes[1] !== 0xd8 ||
      page.bytes.at(-2) !== 0xff ||
      page.bytes.at(-1) !== 0xd9
    )
      throw new Error('PDF 页面不是有效的 JPEG 图像。');
    const imageId = add(
      joinBytes([
        encode(
          `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
        ),
        page.bytes,
        encode('\nendstream'),
      ]),
    );
    const command = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentId = add(
      encode(`<< /Length ${encode(command).length} >>\nstream\n${command}endstream`),
    );
    pageIds.push(
      add(
        encode(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
        ),
      ),
    );
  }
  objects[0] = encode('<< /Type /Catalog /Pages 2 0 R >>');
  objects[1] = encode(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  const parts = [encode('%PDF-1.4\n%'), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 10])];
  let length = parts.reduce((sum, part) => sum + part.length, 0);
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(length);
    const part = joinBytes([encode(`${index + 1} 0 obj\n`), object, encode('\nendobj\n')]);
    parts.push(part);
    length += part.length;
  });
  const xref = length;
  parts.push(
    encode(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join(
          '',
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  return joinBytes(parts).buffer as ArrayBuffer;
}

/** Client-side raster PDF export. All cell text is wrapped; unsupported/oversized layouts fail. */
export async function workbookToPdf(
  workbook: Workbook,
  options: PdfExportOptions = {},
): Promise<ArrayBuffer> {
  abortIfNeeded(options.signal);
  const sheet =
    workbook.sheets.find((item) => item.id === workbook.activeSheetId) ?? workbook.sheets[0];
  if (!sheet) throw new Error('工作簿中没有可导出的工作表。');
  let layout = planPdfPages(sheet, options);
  if (typeof document === 'undefined') throw new Error('PDF 导出需要支持 Canvas 的浏览器。');
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  const ratio = options.pixelRatio ?? 2;
  if (!Number.isFinite(ratio) || ratio < 1 || ratio > 3)
    throw new Error('PDF pixelRatio 必须在 1–3 之间。');
  canvas.width = Math.ceil(layout.width * ratio);
  canvas.height = Math.ceil(layout.height * ratio);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建 Canvas PDF 页面。');
  context.scale(ratio, ratio);
  const evaluator = options.evaluator ?? createEvaluator(workbook);
  const heights = await measureRows(context, sheet, layout, evaluator, options.signal);
  layout = planPdfPages(sheet, options, heights);
  const pages: PdfJpegPage[] = [];
  try {
    for (const [index, page] of layout.pages.entries()) {
      abortIfNeeded(options.signal);
      drawPage(context, workbook, sheet, layout, page, index, evaluator);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('PDF 页面编码失败。'))),
          'image/jpeg',
          0.94,
        ),
      );
      if (blob.type !== 'image/jpeg') throw new Error('浏览器不支持 PDF 所需的 JPEG 编码。');
      pages.push({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
      });
      options.onProgress?.(index + 1, layout.pages.length);
      await yieldToBrowser(options.signal);
    }
    abortIfNeeded(options.signal);
    return assembleJpegPdf(pages, layout.width, layout.height);
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function workbookPdfBlob(
  workbook: Workbook,
  options: PdfExportOptions = {},
): Promise<Blob> {
  return new Blob([await workbookToPdf(workbook, options)], { type: 'application/pdf' });
}

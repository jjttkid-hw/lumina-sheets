import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useId } from 'react';
import type { ClipboardEvent, KeyboardEvent, PointerEvent } from 'react';
import type { Cell, CellValue, Selection, Sheet, Workbook } from '../lib/types';
import {
  cellKey,
  columnLabel,
  createEvaluator,
  displayCell,
  parseCellKey,
  translateFormula,
} from '../lib/engine';
import { IMPORT_LIMITS } from '../lib/io';
import {
  ColumnMetrics,
  MergeIndex,
  ROW_HEIGHT,
  HEADER_HEIGHT,
  ROW_LABEL_WIDTH,
  scrollAxis,
  pixelSize,
} from '../lib/canvas/geometry';
import { RowMetrics } from '../lib/canvas/row-metrics';
import { currentFilteredRows } from '../lib/canvas/filter-result';
import type { FilterResult } from '../lib/canvas/filter-result';
import {
  projectRange,
  projectCell,
  resolveVisibleCell,
  projectedFrozenRows,
  projectPaneFragments,
} from '../lib/canvas/projection';
import {
  moveVisibleCell,
  revealScroll,
  stableViewportSize,
  stableScrollPosition,
} from '../lib/canvas/interaction';
import type { MergeRect } from '../lib/canvas/geometry';
import {
  visibleSelection,
  visiblePasteTarget,
  visibleFillPlan,
} from '../lib/canvas/selection-operations';
import '../styles/spreadsheet.css';

export interface SpreadsheetProps {
  workbook: Workbook;
  sheet: Sheet;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onChange: (sheet: Sheet) => void;
  getValue?: (sheet: Sheet, key: string) => CellValue;
  getCell?: (sheet: Sheet, key: string) => Cell | undefined;
  onViewportChange?: (range: {
    firstRow: number;
    lastRow: number;
    firstCol: number;
    lastCol: number;
  }) => void;
  readOnly?: boolean;
  calculationVersion?: number;
  renderVersion?: number;
  clipboardMode?: 'visible' | 'all';
  onPatch?: (
    sheetId: string,
    changes: Array<{ key: string; cell: Cell | null }>,
    dimensions?: { rowCount?: number; colCount?: number },
  ) => void;
  onRenderMetrics?: (metrics: { drawMs: number; paintedCells: number; domNodes: number }) => void;
  onEditError?: (error: Error) => void;
  search?: string;
  filter?: string;
  showGrid?: boolean;
  zoom?: number;
}
interface EditState {
  row: number;
  col: number;
  text: string;
}
type Patch = { key: string; cell: Cell | null };
const MAX_INTERACTION_CELLS = 100_000;
const INTERNAL_CLIPBOARD_TYPE = 'application/x-lumina-copy';

function utf8Bytes(value: string, maximum = IMPORT_LIMITS.bytes): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
    if (bytes > maximum) return bytes;
  }
  return bytes;
}

/** Scan limits without first allocating a potentially enormous clipboard matrix. */
function clipboardDimensions(text: string, startRow: number, startCol: number) {
  if (text.length > IMPORT_LIMITS.bytes || utf8Bytes(text) > IMPORT_LIMITS.bytes)
    throw new Error('粘贴内容不能超过 20 MB');
  let rows = 0,
    columns = 0,
    width = 0,
    cells = 0,
    length = 0,
    quoted = false,
    endedRow = false;
  const field = () => {
    if (++cells > IMPORT_LIMITS.cells)
      throw new Error(`单次粘贴最多支持 ${IMPORT_LIMITS.cells.toLocaleString()} 个单元格`);
    if (startCol + ++columns > IMPORT_LIMITS.columns)
      throw new Error('粘贴后的工作表不能超过 256 列');
    length = 0;
  };
  const row = () => {
    if (startRow + ++rows > IMPORT_LIMITS.rows)
      throw new Error(`粘贴后的工作表不能超过 ${IMPORT_LIMITS.rows.toLocaleString()} 行`);
    width = Math.max(width, columns);
    columns = 0;
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    endedRow = false;
    if (char === '"' && (quoted || length === 0)) {
      if (quoted && text[index + 1] === '"') {
        length++;
        index++;
      } else quoted = !quoted;
    } else if (!quoted && char === '\t') field();
    else if (!quoted && (char === '\n' || char === '\r')) {
      field();
      row();
      endedRow = true;
      if (char === '\r' && text[index + 1] === '\n') index++;
    } else {
      length++;
      if (char === '\r' && text[index + 1] === '\n') index++;
    }
    if (length > 32767) throw new Error('单元格内容不能超过 32,767 个字符');
  }
  if (quoted) throw new Error('粘贴内容包含未闭合的引号');
  if (!endedRow || text.length === 0) {
    field();
    row();
  }
  return { rows, columns: width, cells };
}

function typedValue(value: string): CellValue {
  if (value.startsWith("'")) return value.slice(1);
  if (value === 'TRUE') return true;
  if (value === 'FALSE') return false;
  if (
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim()) &&
    Number.isFinite(Number(value))
  ) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || Number.isSafeInteger(numeric)) return numeric;
  }
  return value;
}

/** Quoted TSV supports tabs and line breaks inside cells copied from Excel. */
function parseClipboard(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"' && (quoted || value.length === 0)) {
      if (quoted && normalized[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && ch === '\t') {
      row.push(value);
      value = '';
    } else if (!quoted && ch === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else value += ch;
  }
  row.push(value);
  if (row.length > 1 || value !== '' || rows.length === 0 || !normalized.endsWith('\n'))
    rows.push(row);
  return rows;
}

function clipboardValue(value: string) {
  return /[\t\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function selectionBounds(selection: Selection) {
  return {
    top: Math.min(selection.row, selection.endRow ?? selection.row),
    bottom: Math.max(selection.row, selection.endRow ?? selection.row),
    left: Math.min(selection.col, selection.endCol ?? selection.col),
    right: Math.max(selection.col, selection.endCol ?? selection.col),
  };
}

function getStatusClass(value: string) {
  if (/超额|已完成|已达标|正常|完成|已回款/.test(value)) return 'positive';
  if (/进行|推进|跟进|处理中/.test(value)) return 'progress';
  if (/风险|滞后|未达|延期|关注|待/.test(value)) return 'warning';
  return 'neutral';
}

export default function Spreadsheet({
  workbook,
  sheet,
  selection,
  onSelect,
  onChange,
  getValue,
  getCell,
  onViewportChange,
  readOnly = false,
  calculationVersion = 0,
  renderVersion = calculationVersion,
  clipboardMode = 'visible',
  onPatch,
  onRenderMetrics,
  onEditError,
  search = '',
  filter = '',
  showGrid = true,
  zoom = 100,
}: SpreadsheetProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const editSessionRef = useRef(false);
  const drawRef = useRef<() => void>(() => {});
  const frameRef = useRef(0);
  const drawCount = useRef(0);

  const pointerRef = useRef<{
    kind: 'select' | 'fill';
    row: number;
    col: number;
    source: ReturnType<typeof selectionBounds>;
    targetRow: number;
    targetCol: number;
  } | null>(null);
  const resizeRef = useRef<{ col: number; x: number; width: number; next: number } | null>(null);
  const copiedCellsRef = useRef<{
    text: string;
    token: string;
    top: number;
    left: number;
    cells: (Cell | undefined)[][];
    coordinates: Array<Array<{ row: number; col: number } | null>>;
  } | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [temporaryWidths, setTemporaryWidths] = useState<Record<number, number>>({});
  const [clipboardNotice, setClipboardNotice] = useState('');
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [filterResult, setFilterResult] = useState<FilterResult | null>(null);
  const activeId = useId();
  const rowCount = Math.max(1, Math.min(1_048_576, sheet.rowCount || 100));
  const colCount = Math.max(1, Math.min(16_384, sheet.colCount || 16));
  const scale = Math.min(2, Math.max(0.5, zoom > 3 ? zoom / 100 : zoom));
  const bounds = selectionBounds(selection);
  const searchText = search.trim().toLocaleLowerCase();
  const filterText = filter.trim().toLocaleLowerCase();
  const metrics = useMemo(
    () => new ColumnMetrics(colCount, sheet.columnWidths, temporaryWidths, sheet.hiddenColumns),
    [colCount, sheet.columnWidths, sheet.hiddenColumns, temporaryWidths],
  );
  const merges = useMemo(
    () => new MergeIndex(sheet.merges, rowCount, colCount),
    [sheet.merges, rowCount, colCount],
  );
  const fallbackEvaluator = useMemo(
    () => (getValue ? null : createEvaluator(workbook)),
    [getValue, workbook],
  );
  const cellAt = (key: string): Cell | undefined =>
    getCell ? getCell(sheet, key) : sheet.cells[key];
  const valueAt = (key: string): CellValue =>
    getValue?.(sheet, key) ?? fallbackEvaluator?.(sheet, key) ?? '';
  const filterSource = useMemo(
    () => ({
      sheetId: sheet.id,
      cells: sheet.cells,
      text: filterText,
      frozenRows: sheet.frozenRows ?? 0,
      rowCount,
      calculationVersion,
      evaluator: getValue ?? fallbackEvaluator,
    }),
    [
      sheet.id,
      sheet.cells,
      filterText,
      sheet.frozenRows,
      rowCount,
      calculationVersion,
      getValue,
      fallbackEvaluator,
    ],
  );
  const rowIndexes = currentFilteredRows(filterResult, filterSource);
  const filterPending = !!filterText && rowIndexes === null;
  const displayCount = rowIndexes?.length ?? rowCount;
  const rowMetrics = useMemo(
    () => new RowMetrics(rowCount, sheet.rowHeights, sheet.hiddenRows, rowIndexes),
    [rowCount, sheet.rowHeights, sheet.hiddenRows, rowIndexes],
  );
  const frozenRows = projectedFrozenRows(rowMetrics, sheet.frozenRows ?? 0);
  const horizontal = scrollAxis((ROW_LABEL_WIDTH + metrics.total) * scale, size.width);
  const vertical = scrollAxis((HEADER_HEIGHT + rowMetrics.total) * scale, size.height);
  const logicalLeft = horizontal.toLogical(scroll.left) / scale;
  const logicalTop = vertical.toLogical(scroll.top) / scale;
  const rowAt = (index: number) => rowMetrics.row(index);
  const indexOfRow = (row: number) => rowMetrics.indexOfRow(row);
  const yAt = (index: number) =>
    HEADER_HEIGHT + rowMetrics.offset(index) - (index < frozenRows ? 0 : logicalTop);
  const xAt = (col: number) => ROW_LABEL_WIDTH + metrics.offsets[col] - logicalLeft;
  const scheduleDraw = useCallback(() => {
    if (!frameRef.current)
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        drawRef.current();
      });
  }, []);
  const focusGrid = useCallback(() => viewportRef.current?.focus({ preventScroll: true }), []);

  // Filtering is an explicit, debounced sparse scan, never part of scrolling or normal paints.
  useEffect(() => {
    if (!filterText) {
      setFilterResult(null);
      return;
    }
    let cancelled = false;
    let timer = window.setTimeout(() => {
      const keys = Object.keys(sheet.cells);
      const rows = new Set<number>();
      for (let row = 0; row < Math.min(rowCount, sheet.frozenRows ?? 0); row++) rows.add(row);
      let index = 0;
      const chunk = () => {
        if (cancelled) return;
        const stop = Math.min(keys.length, index + 1500);
        for (; index < stop; index++) {
          const point = parseCellKey(keys[index]);
          if (!point || point.row >= rowCount || rows.has(point.row)) continue;
          if (String(valueAt(keys[index])).toLocaleLowerCase().includes(filterText))
            rows.add(point.row);
        }
        if (index < keys.length) timer = window.setTimeout(chunk, 0);
        else {
          setFilterResult({ source: filterSource, rows: [...rows].sort((a, b) => a - b) });
        }
      };
      chunk();
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filterSource]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const width = viewport.clientWidth,
        height = viewport.clientHeight;
      setSize((previous) => stableViewportSize(previous, width, height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, []);
  useEffect(() => {
    setEditing(null);
    editSessionRef.current = false;
    pointerRef.current = null;
    resizeRef.current = null;
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
    }
    setScroll((previous) => stableScrollPosition(previous, 0, 0));
  }, [sheet.id]);
  useLayoutEffect(() => {
    if (editing) {
      editRef.current?.focus();
      editRef.current?.setSelectionRange(editing.text.length, editing.text.length);
    }
  }, [editing?.row, editing?.col]);
  useEffect(() => {
    if (editing && !projectCell(rowMetrics, metrics, merges, editing.row, editing.col)) {
      // A filter or visibility change can remove the active editor's entire
      // projection. Cancel that draft instead of retaining an invisible input.
      editSessionRef.current = false;
      setEditing(null);
    }
  }, [editing, rowMetrics, metrics, merges]);
  useEffect(() => {
    if (!clipboardNotice) return;
    const timer = window.setTimeout(() => setClipboardNotice(''), 2800);
    return () => window.clearTimeout(timer);
  }, [clipboardNotice]);

  // Wheel deltas remain natural at million-row scale, while dragging the scrollbar spans the sheet.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || (horizontal.ratio === 1 && vertical.ratio === 1)) return;
      event.preventDefault();
      const factor =
        event.deltaMode === 1 ? ROW_HEIGHT * scale : event.deltaMode === 2 ? size.height : 1;
      const dx = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * factor;
      const dy = (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * factor;
      viewport.scrollLeft = horizontal.toPhysical(horizontal.toLogical(viewport.scrollLeft) + dx);
      viewport.scrollTop = vertical.toPhysical(vertical.toLogical(viewport.scrollTop) + dy);
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [horizontal.ratio, vertical.ratio, size.height, scale]);

  function ensureVisible(row: number, col: number) {
    const viewport = viewportRef.current;
    const target = projectCell(rowMetrics, metrics, merges, row, col);
    if (!viewport || !target) return;
    const projected = target.projection;
    let left = horizontal.toLogical(viewport.scrollLeft),
      top = vertical.toLogical(viewport.scrollTop);
    const cellLeft = (ROW_LABEL_WIDTH + projected.x) * scale,
      cellRight = (ROW_LABEL_WIDTH + projected.x + projected.width) * scale;
    left = revealScroll(cellLeft, cellRight, left, size.width, ROW_LABEL_WIDTH * scale);
    if (projected.topIndex >= frozenRows) {
      const cellTop = (HEADER_HEIGHT + projected.y) * scale;
      const cellBottom = (HEADER_HEIGHT + projected.y + projected.height) * scale;
      top = revealScroll(
        cellTop,
        cellBottom,
        top,
        size.height,
        (HEADER_HEIGHT + rowMetrics.offset(frozenRows)) * scale,
      );
    }
    viewport.scrollLeft = horizontal.toPhysical(left);
    viewport.scrollTop = vertical.toPhysical(top);
  }
  useEffect(() => {
    if (!editing && !pointerRef.current)
      ensureVisible(selection.endRow ?? selection.row, selection.endCol ?? selection.col);
  }, [
    selection.row,
    selection.col,
    selection.endRow,
    selection.endCol,
    scale,
    sheet.id,
    size.width,
    size.height,
    rowMetrics,
    metrics,
    merges,
    frozenRows,
  ]);

  function applyPatch(changes: Patch[], dimensions?: { rowCount?: number; colCount?: number }) {
    if (readOnly || !changes.length) return false;
    try {
      if (onPatch) onPatch(sheet.id, changes, dimensions);
      else {
        const cells = { ...sheet.cells };
        for (const change of changes) {
          if (change.cell) cells[change.key] = change.cell;
          else delete cells[change.key];
        }
        onChange({ ...sheet, ...dimensions, cells });
      }
      setClipboardNotice('');
      return true;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      setClipboardNotice(error.message);
      onEditError?.(error);
      return false;
    }
  }
  function selectCell(row: number, col: number, extend = false) {
    row = Math.max(0, Math.min(rowCount - 1, row));
    col = Math.max(0, Math.min(colCount - 1, col));
    const target = resolveVisibleCell(rowMetrics, metrics, merges, row, col);
    if (!target) return;
    onSelect(extend ? { ...selection, endRow: target.row, endCol: target.col } : target);
  }
  function beginEditing(row = selection.row, col = selection.col, initial?: string) {
    if (readOnly) return;
    const target = projectCell(rowMetrics, metrics, merges, row, col);
    if (!target) return;
    row = target.row;
    col = target.col;
    editSessionRef.current = true;
    onSelect({ row, col });
    ensureVisible(row, col);
    setEditing({ row, col, text: initial ?? String(cellAt(cellKey(row, col))?.value ?? '') });
  }
  function commitEditing(rowDelta = 0, colDelta = 0, restoreFocus = true) {
    if (!editing || !editSessionRef.current) return;
    editSessionRef.current = false;
    const key = cellKey(editing.row, editing.col),
      cell = cellAt(key),
      value = typedValue(editing.text);
    if (editing.text.length > 32767) {
      setClipboardNotice('单元格内容不能超过 32,767 个字符');
      editSessionRef.current = true;
      return false;
    }
    if (
      cell?.value !== value &&
      (cell || value !== '') &&
      !applyPatch([{ key, cell: { ...cell, value } }])
    ) {
      editSessionRef.current = true;
      if (restoreFocus) requestAnimationFrame(() => editRef.current?.focus());
      return false;
    }
    setEditing(null);
    if (rowDelta || colDelta) {
      const next = moveVisibleCell(
        rowMetrics,
        metrics,
        merges,
        editing.row,
        editing.col,
        rowDelta,
        colDelta,
      );
      if (next) selectCell(next.row, next.col);
    }
    if (restoreFocus) requestAnimationFrame(focusGrid);
    return true;
  }
  function clearSelection() {
    if (readOnly || !interactionReady()) return;
    const changes: Patch[] = [];
    const count = (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1);
    const clear = (key: string) => {
      const cell = cellAt(key);
      if (cell) {
        if (changes.length >= MAX_INTERACTION_CELLS)
          throw new Error('单次清除最多支持 100,000 格，请缩小选区');
        changes.push({ key, cell: cell.style ? { ...cell, value: '' } : null });
      }
    };
    try {
      if (clipboardMode === 'visible') {
        const selected = visibleSelection(rowMetrics, metrics, merges, bounds);
        for (const row of selected.cells)
          for (const point of row) if (point) clear(cellKey(point.row, point.col));
        applyPatch(changes);
        return;
      }
      if (count <= MAX_INTERACTION_CELLS) {
        for (let row = bounds.top; row <= bounds.bottom; row++)
          for (let col = bounds.left; col <= bounds.right; col++) clear(cellKey(row, col));
      } else {
        for (const key in sheet.cells) {
          const point = parseCellKey(key);
          if (
            point &&
            point.row >= bounds.top &&
            point.row <= bounds.bottom &&
            point.col >= bounds.left &&
            point.col <= bounds.right
          )
            clear(key);
        }
      }
      applyPatch(changes);
    } catch (error) {
      setClipboardNotice(error instanceof Error ? error.message : '无法清除选区');
    }
  }
  function interactionReady() {
    if (clipboardMode === 'visible' && filterPending) {
      setClipboardNotice('正在筛选，请在结果完成后操作可见单元格');
      return false;
    }
    return true;
  }
  function handleCopy(event: ClipboardEvent<HTMLDivElement>) {
    if (editing) return false;
    event.preventDefault();
    if (!interactionReady()) return false;
    try {
      let coordinates: Array<Array<{ row: number; col: number } | null>>;
      if (clipboardMode === 'visible')
        coordinates = visibleSelection(rowMetrics, metrics, merges, bounds).cells;
      else {
        const count = (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1);
        if (count > MAX_INTERACTION_CELLS)
          throw new Error('单次复制最多支持 100,000 格，请缩小选区');
        coordinates = Array.from({ length: bounds.bottom - bounds.top + 1 }, (_, ri) =>
          Array.from({ length: bounds.right - bounds.left + 1 }, (_, ci) => ({
            row: bounds.top + ri,
            col: bounds.left + ci,
          })),
        );
      }
      if (!coordinates.length || !coordinates[0].length) {
        setClipboardNotice('选区中没有可见单元格');
        return false;
      }
      const count = coordinates.length * coordinates[0].length;
      const lines: string[] = [],
        sourceCells: (Cell | undefined)[][] = [];
      let bytes = 0;
      for (const row of coordinates) {
        const columns: string[] = [],
          cells: (Cell | undefined)[] = [];
        for (const point of row) {
          const key = point ? cellKey(point.row, point.col) : null,
            value = clipboardValue(key ? String(valueAt(key)) : '');
          bytes += utf8Bytes(value) + 1;
          if (bytes > IMPORT_LIMITS.bytes) {
            setClipboardNotice('复制内容不能超过 20 MB，请缩小选区');
            return false;
          }
          columns.push(value);
          const source = key ? cellAt(key) : undefined;
          cells.push(source ? structuredClone(source) : undefined);
        }
        lines.push(columns.join('\t'));
        sourceCells.push(cells);
      }
      const text = lines.join('\n');
      const token = crypto.randomUUID();
      copiedCellsRef.current = {
        text,
        token,
        top: bounds.top,
        left: bounds.left,
        cells: sourceCells,
        coordinates,
      };
      event.clipboardData.setData('text/plain', text);
      event.clipboardData.setData(INTERNAL_CLIPBOARD_TYPE, token);
      setClipboardNotice(`已复制 ${count.toLocaleString()} 个单元格`);
      return true;
    } catch (error) {
      setClipboardNotice(error instanceof Error ? error.message : '无法复制选区');
      return false;
    }
  }
  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (editing || readOnly) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text && !event.clipboardData.types.includes('text/plain')) return;
    event.preventDefault();
    if (!interactionReady()) return;
    try {
      const visible = clipboardMode === 'visible';
      const internal =
        copiedCellsRef.current?.text === text &&
        copiedCellsRef.current.token === event.clipboardData.getData(INTERNAL_CLIPBOARD_TYPE)
          ? copiedCellsRef.current
          : null;
      const dimensions = internal
        ? {
            rows: internal.cells.length,
            columns: internal.cells[0].length,
            cells: internal.cells.length * internal.cells[0].length,
          }
        : clipboardDimensions(text, visible ? 0 : selection.row, visible ? 0 : selection.col);
      if (dimensions.cells > MAX_INTERACTION_CELLS) throw new Error('单次粘贴最多支持 100,000 格');
      if (
        !visible &&
        (selection.row + dimensions.rows > IMPORT_LIMITS.rows ||
          selection.col + dimensions.columns > IMPORT_LIMITS.columns)
      )
        throw new Error('粘贴后的工作表不能超过 100,000 行或 256 列');
      const target = visible
        ? visiblePasteTarget(
            rowMetrics,
            metrics,
            merges,
            selection,
            dimensions.rows,
            dimensions.columns,
          )
        : null;
      const bottom = target ? target.rows.at(-1)! : selection.row + dimensions.rows - 1,
        right = target ? target.columns.at(-1)! : selection.col + dimensions.columns - 1;
      const overlaps = merges.query(selection.row, bottom, selection.col, right);
      if (
        !visible &&
        overlaps.length &&
        !(
          dimensions.cells === 1 &&
          overlaps[0].top === selection.row &&
          overlaps[0].left === selection.col
        )
      )
        throw new Error('粘贴范围包含合并单元格，请先取消合并');
      const rows = internal ? internal.cells.map((row) => row.map(() => '')) : parseClipboard(text);
      const changes: Patch[] = [];
      rows.forEach((row, ri) =>
        row.forEach((text, ci) => {
          const point = target?.cells[ri]?.[ci] ?? {
            row: selection.row + ri,
            col: selection.col + ci,
          };
          const key = cellKey(point.row, point.col),
            source = internal?.cells[ri]?.[ci];
          const sourcePoint = internal?.coordinates[ri]?.[ci];
          const original = internal ? (source?.value ?? '') : typedValue(text);
          const value =
            internal && sourcePoint && typeof original === 'string' && original.startsWith('=')
              ? translateFormula(original, point.row - sourcePoint.row, point.col - sourcePoint.col)
              : original;
          if (typeof value === 'string' && value.length > 32767)
            throw new Error('调整引用后的公式超过 32,767 个字符');
          changes.push({ key, cell: { ...(internal ? source : cellAt(key)), value } });
        }),
      );
      if (
        !applyPatch(changes, {
          rowCount: Math.max(rowCount, bottom + 1),
          colCount: Math.max(colCount, right + 1),
        })
      )
        return;
      onSelect({ ...selection, endRow: bottom, endCol: right });
      setClipboardNotice(`已粘贴 ${dimensions.rows} 行 × ${dimensions.columns} 列`);
    } catch (error) {
      setClipboardNotice(error instanceof Error ? error.message : '无法粘贴该内容');
    }
  }
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!editing && (event.key === 'Process' || event.nativeEvent.keyCode === 229)) {
      beginEditing(selection.row, selection.col, '');
      return;
    }
    if (editing || event.nativeEvent.isComposing || composingRef.current) return;
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      onSelect({ row: 0, col: 0, endRow: rowCount - 1, endCol: colCount - 1 });
      return;
    }
    const row = event.shiftKey ? (selection.endRow ?? selection.row) : selection.row;
    const col = event.shiftKey ? (selection.endCol ?? selection.col) : selection.col;
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      let targetRow = ctrl ? 0 : row,
        targetCol = event.key === 'Home' ? 0 : colCount - 1;
      if (ctrl && event.key === 'End') {
        for (const key in sheet.cells) {
          const point = parseCellKey(key);
          if (point) {
            targetRow = Math.max(targetRow, point.row);
            targetCol = Math.max(targetCol === colCount - 1 ? 0 : targetCol, point.col);
          }
        }
      }
      selectCell(targetRow, targetCol, event.shiftKey);
      return;
    }
    if (ctrl) return;
    const currentIndex =
      projectCell(rowMetrics, metrics, merges, row, col)?.projection.topIndex ??
      rowMetrics.indexAtOrAfter(row);
    const pageHeight = Math.max(
      1,
      size.height / scale - HEADER_HEIGHT - rowMetrics.offset(frozenRows),
    );
    const pageUp = rowMetrics.at(rowMetrics.offset(currentIndex) - pageHeight);
    const pageDown = rowMetrics.at(rowMetrics.offset(currentIndex) + pageHeight);
    const movements: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      Tab: [0, event.shiftKey ? -1 : 1],
      Enter: [event.shiftKey ? -1 : 1, 0],
      PageUp: [-Math.max(1, currentIndex - pageUp), 0],
      PageDown: [Math.max(1, pageDown - currentIndex), 0],
    };
    if (movements[event.key]) {
      event.preventDefault();
      const [dr, dc] = movements[event.key];
      const extend = event.shiftKey && !['Tab', 'Enter'].includes(event.key);
      const next = moveVisibleCell(rowMetrics, metrics, merges, row, col, dr, dc, extend);
      if (next) selectCell(next.row, next.col, extend);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      clearSelection();
    } else if (event.key === 'F2') {
      event.preventDefault();
      beginEditing();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onSelect({ row: selection.row, col: selection.col });
    } else if (event.key.length === 1 && !event.altKey) {
      event.preventDefault();
      beginEditing(selection.row, selection.col, event.key);
    }
  }

  function hitTest(clientX: number, clientY: number) {
    const rect = viewportRef.current!.getBoundingClientRect();
    const x = (clientX - rect.left) / scale,
      y = (clientY - rect.top) / scale;
    const col = metrics.at(x - ROW_LABEL_WIDTH + logicalLeft);
    const bodyY =
      y < HEADER_HEIGHT + rowMetrics.offset(frozenRows)
        ? y - HEADER_HEIGHT
        : y - HEADER_HEIGHT + logicalTop;
    const resolvedIndex = rowMetrics.at(Math.max(0, bodyY));
    const row = rowAt(resolvedIndex);
    const boundary =
      col >= 0 ? ROW_LABEL_WIDTH + metrics.offsets[col + 1] - logicalLeft : -Infinity;
    const resizeCol =
      Math.abs(boundary - x) <= 5
        ? col
        : col >= 0 && Math.abs(xAt(col) - x) <= 5
          ? metrics.previousVisible(col - 1)
          : -1;
    const header = y < HEADER_HEIGHT,
      rowHeader = x < ROW_LABEL_WIDTH;
    const target =
      !header && !rowHeader && row >= 0 && col >= 0
        ? projectCell(rowMetrics, metrics, merges, row, col)
        : null;
    return {
      x,
      y,
      row: target?.row ?? row,
      col: target?.col ?? col,
      resizeCol,
      corner: x < ROW_LABEL_WIDTH && y < HEADER_HEIGHT,
      header,
      rowHeader,
    };
  }
  function selectionRect() {
    const merge = merges.at(selection.row, selection.col);
    const single = selection.endRow === undefined && selection.endCol === undefined;
    const topRow = single && merge ? merge.top : bounds.top,
      bottomRow = single && merge ? merge.bottom : bounds.bottom;
    const leftCol = single && merge ? merge.left : bounds.left,
      rightCol = single && merge ? merge.right : bounds.right;
    const projected = projectRange(rowMetrics, metrics, {
      top: topRow,
      bottom: bottomRow,
      left: leftCol,
      right: rightCol,
    });
    if (!projected) return null;
    const { topIndex, bottomIndex, width, height } = projected;
    const fragments = projectPaneFragments(
      projected,
      rowMetrics,
      frozenRows,
      logicalTop,
      size.height / scale,
    );
    if (!fragments.length) return null;
    return {
      x: xAt(projected.leftCol),
      y: yAt(topIndex),
      width,
      height,
      bottom: yAt(bottomIndex) + rowMetrics.height(bottomIndex),
      right: xAt(projected.rightCol) + metrics.width(projected.rightCol),
      topIndex,
      fragments,
    };
  }
  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const hit = hitTest(event.clientX, event.clientY);
    if (hit.row < 0 || hit.col < 0) return;
    if (hit.x * scale >= size.width || hit.y * scale >= size.height) return;
    event.preventDefault();
    if (editing && commitEditing() === false) return;
    focusGrid();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!readOnly && hit.header && hit.resizeCol >= 0 && !hit.corner) {
      resizeRef.current = {
        col: hit.resizeCol,
        x: event.clientX,
        width: metrics.width(hit.resizeCol),
        next: metrics.width(hit.resizeCol),
      };
      return;
    }
    if (hit.corner) {
      onSelect({ row: 0, col: 0, endRow: rowCount - 1, endCol: colCount - 1 });
      return;
    }
    if (hit.header) {
      onSelect({
        row: 0,
        col: hit.col,
        endRow: rowCount - 1,
        endCol: event.shiftKey ? selection.col : hit.col,
      });
      return;
    }
    if (hit.rowHeader) {
      onSelect({
        row: hit.row,
        col: 0,
        endRow: event.shiftKey ? selection.row : hit.row,
        endCol: colCount - 1,
      });
      return;
    }
    const rect = selectionRect();
    const fill =
      !readOnly && rect && Math.abs(hit.x - rect.right) <= 6 && Math.abs(hit.y - rect.bottom) <= 6;
    if (fill && !interactionReady()) return;
    pointerRef.current = {
      kind: fill ? 'fill' : 'select',
      row: event.shiftKey ? selection.row : hit.row,
      col: event.shiftKey ? selection.col : hit.col,
      source: { ...bounds },
      targetRow: hit.row,
      targetCol: hit.col,
    };
    if (!fill) selectCell(hit.row, hit.col, event.shiftKey);
  }
  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current;
    if (resize) {
      resize.next = Math.max(48, Math.min(1000, resize.width + (event.clientX - resize.x) / scale));
      setTemporaryWidths({ [resize.col]: resize.next });
      return;
    }
    const hit = hitTest(event.clientX, event.clientY),
      drag = pointerRef.current;
    if (hit.row < 0 || hit.col < 0) return;
    const rect = selectionRect();
    event.currentTarget.style.cursor =
      hit.header && hit.resizeCol >= 0 && !hit.corner
        ? 'col-resize'
        : rect && Math.abs(hit.x - rect.right) <= 6 && Math.abs(hit.y - rect.bottom) <= 6
          ? 'crosshair'
          : 'cell';
    if (!drag || !(event.buttons & 1)) return;
    drag.targetRow = hit.row;
    drag.targetCol = hit.col;
    onSelect({
      row: drag.kind === 'fill' ? drag.source.top : drag.row,
      col: drag.kind === 'fill' ? drag.source.left : drag.col,
      endRow: hit.row,
      endCol: hit.col,
    });
    const viewport = viewportRef.current!;
    if (hit.y * scale > size.height - 20)
      viewport.scrollTop = vertical.toPhysical(
        vertical.toLogical(viewport.scrollTop) + ROW_HEIGHT * scale,
      );
    else if (hit.y < HEADER_HEIGHT + rowMetrics.offset(frozenRows) + 10)
      viewport.scrollTop = vertical.toPhysical(
        vertical.toLogical(viewport.scrollTop) - ROW_HEIGHT * scale,
      );
    if (hit.x * scale > size.width - 20)
      viewport.scrollLeft = horizontal.toPhysical(horizontal.toLogical(viewport.scrollLeft) + 32);
    else if (hit.x < ROW_LABEL_WIDTH + 10)
      viewport.scrollLeft = horizontal.toPhysical(horizontal.toLogical(viewport.scrollLeft) - 32);
  }
  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    const resize = resizeRef.current;
    resizeRef.current = null;
    if (resize) {
      setTemporaryWidths({});
      if (resize.width !== resize.next)
        onChange({ ...sheet, columnWidths: { ...sheet.columnWidths, [resize.col]: resize.next } });
      return;
    }
    const drag = pointerRef.current;
    pointerRef.current = null;
    if (readOnly || !drag || drag.kind !== 'fill') return;
    if (!interactionReady()) return;
    const top = Math.min(drag.source.top, drag.targetRow),
      bottom = Math.max(drag.source.bottom, drag.targetRow),
      left = Math.min(drag.source.left, drag.targetCol),
      right = Math.max(drag.source.right, drag.targetCol);
    if (clipboardMode === 'visible') {
      try {
        const plan = visibleFillPlan(rowMetrics, metrics, merges, drag.source, {
          top,
          bottom,
          left,
          right,
        });
        const changes: Patch[] = plan.map(({ row, col, sourceRow, sourceCol }) => {
          const source = cellAt(cellKey(sourceRow, sourceCol));
          const value = source?.value ?? '';
          const translated =
            typeof value === 'string' && value.startsWith('=')
              ? translateFormula(value, row - sourceRow, col - sourceCol)
              : value;
          if (typeof translated === 'string' && translated.length > 32767)
            throw new Error('调整引用后的公式超过 32,767 个字符');
          return { key: cellKey(row, col), cell: { ...source, value: translated } };
        });
        applyPatch(changes);
      } catch (error) {
        setClipboardNotice(error instanceof Error ? error.message : '无法填充选区');
      }
      return;
    }
    if ((bottom - top + 1) * (right - left + 1) > MAX_INTERACTION_CELLS) {
      setClipboardNotice('单次填充最多支持 100,000 格');
      return;
    }
    if (merges.query(top, bottom, left, right).length) {
      setClipboardNotice('填充范围包含合并单元格，请先取消合并');
      return;
    }
    const changes: Patch[] = [],
      height = drag.source.bottom - drag.source.top + 1,
      width = drag.source.right - drag.source.left + 1;
    for (let row = top; row <= bottom; row++)
      for (let col = left; col <= right; col++) {
        if (
          row >= drag.source.top &&
          row <= drag.source.bottom &&
          col >= drag.source.left &&
          col <= drag.source.right
        )
          continue;
        const sourceRow =
          drag.source.top + ((((row - drag.source.top) % height) + height) % height);
        const sourceCol = drag.source.left + ((((col - drag.source.left) % width) + width) % width);
        const source = cellAt(cellKey(sourceRow, sourceCol)),
          value = source?.value ?? '';
        const translated =
          typeof value === 'string' && value.startsWith('=')
            ? translateFormula(value, row - sourceRow, col - sourceCol)
            : value;
        if (typeof translated === 'string' && translated.length > 32767) {
          setClipboardNotice('调整引用后的公式超过 32,767 个字符');
          return;
        }
        changes.push({ key: cellKey(row, col), cell: { ...source, value: translated } });
      }
    applyPatch(changes);
  }
  function autoFitColumn(col: number) {
    if (readOnly) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    let width = 72;
    // Auto-fit intentionally samples 1,000 rows so a million-row sheet stays interactive.
    for (let row = 0; row < Math.min(rowCount, 1000); row++) {
      const key = cellKey(row, col),
        cell = cellAt(key);
      if (cell)
        width = Math.max(width, ctx.measureText(displayCell(cell, valueAt(key))).width + 32);
    }
    ctx.restore();
    onChange({ ...sheet, columnWidths: { ...sheet.columnWidths, [col]: Math.min(600, width) } });
  }
  // Canvas paint contains only the current viewport; a single offscreen input remains for IME and a11y.
  drawRef.current = () => {
    const canvas = canvasRef.current,
      viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    const started = performance.now(),
      dpr = window.devicePixelRatio || 1;
    const {
      width: pixelWidth,
      height: pixelHeight,
      ratio,
    } = pixelSize(size.width, size.height, dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
    ctx.clearRect(0, 0, size.width / scale, size.height / scale);
    const visible = rowMetrics.visible(logicalTop, size.height / scale, frozenRows),
      frozen = rowMetrics.visibleFrozen(size.height / scale, frozenRows),
      cols = metrics.visible(logicalLeft, size.width / scale);
    const firstCol = Math.max(0, cols.first),
      lastCol = Math.min(colCount - 1, cols.last);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size.width / scale, size.height / scale);
    ctx.textBaseline = 'middle';
    let paintedCells = 0;
    const drawCell = (row: number, col: number, x: number, y: number, w: number, h: number) => {
      const key = cellKey(row, col),
        cell = cellAt(key),
        value = valueAt(key),
        text = cell ? displayCell(cell, value) : '';
      const selected =
          row >= bounds.top && row <= bounds.bottom && col >= bounds.left && col <= bounds.right,
        active = row === selection.row && col === selection.col;
      ctx.fillStyle = cell?.style?.background ?? (selected ? '#f1f7f3' : '#fff');
      ctx.fillRect(x, y, w, h);
      if (showGrid) {
        ctx.strokeStyle = '#e9ede9';
        ctx.lineWidth = 1 / scale;
        ctx.strokeRect(x, y, w, h);
      }
      if (
        searchText &&
        String(value ?? '')
          .toLocaleLowerCase()
          .includes(searchText)
      ) {
        ctx.fillStyle = '#fff0b2';
        ctx.fillRect(x, y, w, h);
      }
      ctx.fillStyle = cell?.style?.color ?? '#39443d';
      ctx.font = `${cell?.style?.italic ? 'italic ' : ''}${cell?.style?.bold ? '650 ' : ''}${cell?.style?.fontSize ?? 12}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = cell?.style?.align ?? (typeof value === 'number' ? 'right' : 'left');
      const padding = 14;
      const textX =
        ctx.textAlign === 'right'
          ? x + w - padding
          : ctx.textAlign === 'center'
            ? x + w / 2
            : x + padding;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 1, y + 1, w - 2, h - 2);
      ctx.clip();
      ctx.fillText(text, textX, y + h / 2);
      if (cell?.style?.underline) {
        const textWidth = ctx.measureText(text).width;
        const start =
          ctx.textAlign === 'right'
            ? textX - textWidth
            : ctx.textAlign === 'center'
              ? textX - textWidth / 2
              : textX;
        ctx.fillRect(start, y + h / 2 + (cell.style.fontSize ?? 12) / 2, textWidth, 1 / scale);
      }
      ctx.restore();
      if (active) {
        ctx.strokeStyle = '#176b50';
        ctx.lineWidth = 2 / scale;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      }
      paintedCells++;
    };
    const drawRows = (first: number, last: number, clipTop: number, clipBottom: number) => {
      if (first < 0 || last < 0) return;
      first = rowMetrics.nextVisible(first);
      last = rowMetrics.nextVisible(last, -1);
      if (first < 0 || last < first || lastCol < firstCol || clipBottom <= clipTop) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        ROW_LABEL_WIDTH,
        clipTop,
        Math.max(0, size.width / scale - ROW_LABEL_WIDTH),
        clipBottom - clipTop,
      );
      ctx.clip();
      const mergeRects = merges.query(rowAt(first), rowAt(last), firstCol, lastCol);
      for (
        let index = first;
        index >= 0 && index <= last;
        index = rowMetrics.nextVisible(index + 1)
      ) {
        const row = rowAt(index);
        for (
          let col = metrics.nextVisible(firstCol);
          col >= 0 && col <= lastCol;
          col = metrics.nextVisible(col + 1)
        ) {
          if (merges.at(row, col)) continue;
          const width = metrics.width(col),
            height = rowMetrics.height(index);
          if (width > 0 && height > 0) drawCell(row, col, xAt(col), yAt(index), width, height);
        }
      }
      for (const merge of mergeRects) {
        const projected = projectRange(rowMetrics, metrics, merge);
        if (projected)
          drawCell(
            merge.top,
            merge.left,
            xAt(projected.leftCol),
            HEADER_HEIGHT + projected.y - (first < frozenRows ? 0 : logicalTop),
            projected.width,
            projected.height,
          );
      }
      ctx.restore();
    };
    drawRows(
      Math.max(frozenRows, visible.first - 1),
      visible.last,
      HEADER_HEIGHT + rowMetrics.offset(frozenRows),
      size.height / scale,
    );
    drawRows(
      frozen.first,
      frozen.last,
      HEADER_HEIGHT,
      Math.min(size.height / scale, HEADER_HEIGHT + rowMetrics.offset(frozenRows)),
    );
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      ROW_LABEL_WIDTH,
      HEADER_HEIGHT,
      Math.max(0, size.width / scale - ROW_LABEL_WIDTH),
      Math.max(0, size.height / scale - HEADER_HEIGHT),
    );
    ctx.clip();
    const rect = selectionRect();
    if (rect) {
      ctx.strokeStyle = '#176b50';
      ctx.lineWidth = 1 / scale;
      for (const fragment of rect.fragments) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(
          ROW_LABEL_WIDTH,
          fragment.y,
          Math.max(0, size.width / scale - ROW_LABEL_WIDTH),
          fragment.height,
        );
        ctx.clip();
        ctx.strokeRect(rect.x + 1, fragment.contentY + 1, rect.width - 2, rect.height - 2);
        ctx.restore();
      }
      ctx.fillStyle = '#176b50';
      if (!readOnly) ctx.fillRect(rect.right - 4, rect.bottom - 4, 7, 7);
    }
    ctx.restore();
    // Paint headers last so scrolled body cells never overwrite them.
    ctx.fillStyle = '#f7f9f7';
    ctx.fillRect(0, 0, size.width / scale, HEADER_HEIGHT);
    ctx.fillStyle = '#f8faf8';
    ctx.fillRect(0, HEADER_HEIGHT, ROW_LABEL_WIDTH, size.height / scale - HEADER_HEIGHT);
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.save();
    ctx.beginPath();
    ctx.rect(ROW_LABEL_WIDTH, 0, Math.max(0, size.width / scale - ROW_LABEL_WIDTH), HEADER_HEIGHT);
    ctx.clip();
    for (
      let col = metrics.nextVisible(firstCol);
      col >= 0 && col <= lastCol;
      col = metrics.nextVisible(col + 1)
    ) {
      const x = xAt(col),
        w = metrics.width(col),
        selected = bounds.left <= col && col <= bounds.right;
      if (w <= 0) continue;
      ctx.fillStyle = selected ? '#e6f0e9' : '#f7f9f7';
      ctx.fillRect(x, 0, w, HEADER_HEIGHT);
      ctx.fillStyle = selected ? '#176b50' : '#748078';
      ctx.fillText(columnLabel(col), x + w / 2, HEADER_HEIGHT / 2);
    }
    ctx.restore();
    const drawRowLabel = (index: number) => {
      const row = rowAt(index),
        y = yAt(index),
        selected = bounds.top <= row && row <= bounds.bottom;
      ctx.fillStyle = selected ? '#e6f0e9' : '#f8faf8';
      const height = rowMetrics.height(index);
      if (height <= 0) return;
      ctx.fillRect(0, y, ROW_LABEL_WIDTH, height);
      ctx.fillStyle = selected ? '#176b50' : '#748078';
      ctx.fillText(String(row + 1), ROW_LABEL_WIDTH / 2, y + height / 2);
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      0,
      HEADER_HEIGHT + rowMetrics.offset(frozenRows),
      ROW_LABEL_WIDTH,
      Math.max(0, size.height / scale - HEADER_HEIGHT - rowMetrics.offset(frozenRows)),
    );
    ctx.clip();
    for (
      let index = rowMetrics.nextVisible(Math.max(frozenRows, visible.first - 1));
      index >= 0 && index <= visible.last;
      index = rowMetrics.nextVisible(index + 1)
    )
      drawRowLabel(index);
    ctx.restore();
    for (
      let index = frozen.first;
      index >= 0 && index <= frozen.last;
      index = rowMetrics.nextVisible(index + 1)
    )
      drawRowLabel(index);
    ctx.strokeStyle = '#dfe6e0';
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    ctx.moveTo(0, HEADER_HEIGHT);
    ctx.lineTo(size.width / scale, HEADER_HEIGHT);
    ctx.moveTo(ROW_LABEL_WIDTH, 0);
    ctx.lineTo(ROW_LABEL_WIDTH, size.height / scale);
    ctx.stroke();
    const drawMs = performance.now() - started;
    drawCount.current += 1;
    canvas.dataset.renderMs = drawMs.toFixed(2);
    canvas.dataset.paintedCells = String(paintedCells);
    canvas.dataset.renderCount = String(drawCount.current);
    onRenderMetrics?.({ drawMs, paintedCells, domNodes: viewport.querySelectorAll('*').length });
  };
  useEffect(() => {
    scheduleDraw();
  }, [
    scheduleDraw,
    size,
    scroll,
    sheet,
    selection,
    searchText,
    showGrid,
    scale,
    rowIndexes,
    calculationVersion,
    renderVersion,
    rowMetrics,
    metrics,
    merges,
    temporaryWidths,
    getCell,
    getValue,
  ]);
  useEffect(() => {
    const rows = rowMetrics.visible(logicalTop, size.height / scale, frozenRows);
    const columns = metrics.visible(logicalLeft, size.width / scale);
    if (rows.first < 0 || columns.first < 0) return;
    onViewportChange?.({
      firstRow: rowAt(Math.max(0, rows.first - 1)),
      lastRow: rowAt(Math.max(0, rows.last)),
      firstCol: columns.first,
      lastCol: columns.last,
    });
  }, [
    logicalTop,
    logicalLeft,
    size,
    scale,
    displayCount,
    frozenRows,
    rowMetrics,
    metrics,
    onViewportChange,
  ]);
  const editRect = editing
    ? (() => {
        const target = projectCell(rowMetrics, metrics, merges, editing.row, editing.col);
        if (!target) return null;
        const projected = target.projection;
        const fragment = projectPaneFragments(
          projected,
          rowMetrics,
          frozenRows,
          logicalTop,
          size.height / scale,
        )[0];
        if (!fragment) return null;
        return {
          left: xAt(projected.leftCol) * scale,
          top: fragment.y * scale,
          width: projected.width * scale,
          height: fragment.height * scale,
        };
      })()
    : null;
  const logicalWidth = Math.max(size.width, horizontal.physicalSize),
    logicalHeight = Math.max(size.height, vertical.physicalSize);
  return (
    <div ref={shellRef} className={`spreadsheet-shell ${showGrid ? '' : 'grid-lines-hidden'}`}>
      <div
        ref={viewportRef}
        className="spreadsheet-viewport"
        tabIndex={0}
        role="region"
        aria-label={`${sheet.name}电子表格，使用方向键移动，输入内容或双击编辑`}
        onScroll={(event) => {
          const left = event.currentTarget.scrollLeft,
            top = event.currentTarget.scrollTop;
          setScroll((previous) => stableScrollPosition(previous, left, top));
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={(event) => {
          const hit = hitTest(event.clientX, event.clientY);
          if (hit.row < 0 || hit.col < 0) return;
          if (hit.header && hit.resizeCol >= 0) autoFitColumn(hit.resizeCol);
          else if (!hit.header && !hit.rowHeader && !hit.corner) beginEditing(hit.row, hit.col);
        }}
        onKeyDown={handleKeyDown}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onCut={(event) => {
          if (!editing && handleCopy(event)) clearSelection();
        }}
      >
        <div
          className="spreadsheet-canvas-stage"
          style={{ width: logicalWidth, height: logicalHeight }}
        >
          <canvas
            ref={canvasRef}
            className="spreadsheet-canvas"
            aria-hidden="true"
            style={{ width: size.width, height: size.height }}
          />
          <div
            className="sheet-a11y-proxy"
            role="gridcell"
            aria-live="polite"
            aria-label={`${cellKey(selection.row, selection.col)} ${String(valueAt(cellKey(selection.row, selection.col)) ?? '')}`}
            id={activeId}
          />
        </div>
        {editRect && editing && (
          <input
            ref={editRef}
            className="sheet-cell-editor sheet-canvas-editor"
            aria-label={`编辑单元格 ${cellKey(editing.row, editing.col)}`}
            style={{
              left: editRect.left + scroll.left,
              top: editRect.top + scroll.top,
              width: editRect.width,
              height: editRect.height,
            }}
            value={editing.text}
            onChange={(event) => setEditing({ ...editing, text: event.target.value })}
            onBlur={() => {
              if (!composingRef.current) commitEditing(0, 0, false);
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || composingRef.current) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                commitEditing(event.shiftKey ? -1 : 1);
              } else if (event.key === 'Tab') {
                event.preventDefault();
                event.stopPropagation();
                commitEditing(0, event.shiftKey ? -1 : 1);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                editSessionRef.current = false;
                setEditing(null);
                requestAnimationFrame(focusGrid);
              }
            }}
          />
        )}
      </div>
      {filterPending && (
        <div className="sheet-filter-status" role="status">
          正在筛选…
        </div>
      )}
      {clipboardNotice && (
        <div className="sheet-clipboard-notice" role="status">
          {clipboardNotice}
        </div>
      )}
    </div>
  );
}

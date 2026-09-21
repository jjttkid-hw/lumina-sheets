import type { CellValue, Sheet, Workbook } from './types';
import { cellKey, createEvaluator, parseCellKey, type Evaluator } from './engine';

/** Options for the streaming CSV exporter.
 *
 * The exporter evaluates fields incrementally without building a used-range matrix.
 * Chunk size is bounded by a text threshold plus one escaped field; source data,
 * evaluator caches and the complete Blob (if requested) have separate memory costs.
 */
export interface CsvStreamOptions {
  /** Completed-row flush threshold. Text-heavy rows can span chunks. Defaults to 256. */
  chunkRows?: number;
  /** CSV separator. Defaults to comma. */
  delimiter?: string;
  /** Line ending. Defaults to CRLF for spreadsheet interoperability. */
  lineEnding?: '\n' | '\r\n';
  /** Include a UTF-8 BOM in the first chunk. Defaults to true. */
  includeBom?: boolean;
  /** Abort a long export without waiting for the current chunk to finish. */
  signal?: AbortSignal;
  /** Reuse an evaluator owned by the caller (for batched exports). */
  evaluator?: Evaluator;
  /** Called after a row is scanned. */
  onProgress?: (completedRows: number, totalRows: number) => void;
}

export interface CsvStreamResult {
  /** Number of logical rows scanned. */
  rows: number;
  /** Number of used columns represented in each row. */
  columns: number;
}

function abortError(): Error {
  try {
    return new DOMException('CSV export aborted', 'AbortError');
  } catch {
    const error = new Error('CSV export aborted');
    error.name = 'AbortError';
    return error;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Convert one evaluated value to a safe CSV field.
 *
 * Spreadsheet formulas that begin with =, +, - or @ are prefixed with an apostrophe to
 * prevent formula injection when the exported file is opened by desktop spreadsheet apps.
 */
export function csvField(value: CellValue | null | undefined, delimiter = ','): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'boolean'
        ? value
          ? 'TRUE'
          : 'FALSE'
        : String(value);
  if (typeof value === 'string' && /^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(text)) text = `'${text}`;
  return /["\r\n]/.test(text) || text.includes(delimiter)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

function usedBounds(sheet: Sheet): { lastRow: number; lastCol: number } | null {
  let lastRow = -1;
  let lastCol = -1;
  for (const key of Object.keys(sheet.cells)) {
    const position = parseCellKey(key);
    if (!position) continue;
    if (position.row > lastRow) lastRow = position.row;
    if (position.col > lastCol) lastCol = position.col;
  }
  return lastRow < 0 || lastCol < 0 ? null : { lastRow, lastCol };
}

/**
 * Async iterator over evaluated CSV chunks for a single sheet.
 *
 * Flushes at chunkRows completed rows or the text threshold, including within wide
 * rows. Chunks end between fields, so consumers must concatenate/write them in order
 * rather than parse each chunk as a standalone CSV document.
 */
export async function* iterateCsvChunks(
  sheet: Sheet,
  workbook?: Workbook,
  options: CsvStreamOptions = {},
): AsyncGenerator<string, CsvStreamResult, void> {
  throwIfAborted(options.signal);
  if (sheet.dataSource?.kind === 'paged')
    throw new Error(
      '分页工作表缓存不能代表完整 CSV，请使用 reportDataCsvReadableStream 或 reportDataCsvBlob 导出完整数据源。',
    );
  const chunkRows = options.chunkRows ?? 256;
  if (!Number.isSafeInteger(chunkRows) || chunkRows < 1)
    throw new RangeError('CSV 分块行数必须是正安全整数。');
  const delimiter = options.delimiter ?? ',';
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || /["\r\n]/.test(delimiter))
    throw new TypeError('CSV 分隔符必须是一个非引号、非换行字符。');
  const lineEnding = options.lineEnding ?? '\r\n';
  if (!['\n', '\r\n'].includes(lineEnding)) throw new TypeError('CSV 行分隔符无效。');
  const bounds = usedBounds(sheet);
  if (!bounds) {
    if (options.includeBom !== false) yield '\uFEFF';
    throwIfAborted(options.signal);
    return { rows: 0, columns: 0 };
  }
  const evaluator = options.evaluator ?? createEvaluator(workbook);
  const totalRows = bounds.lastRow + 1;
  let chunk = options.includeBom === false ? '' : '\uFEFF';
  let chunkCompletedRows = 0;
  let completedRows = 0;

  const flush = async function* (): AsyncGenerator<string, void, void> {
    throwIfAborted(options.signal);
    if (!chunk.length) return;
    const text = chunk;
    chunk = '';
    chunkCompletedRows = 0;
    yield text;
    // Give the browser event loop an opportunity to paint and process input between chunks.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    throwIfAborted(options.signal);
  };

  for (let row = 0; row <= bounds.lastRow; row++) {
    throwIfAborted(options.signal);
    for (let col = 0; col <= bounds.lastCol; col++) {
      throwIfAborted(options.signal);
      const key = cellKey(row, col);
      const source = sheet.cells[key];
      chunk += (col ? delimiter : '') + csvField(source ? evaluator(sheet, key) : '', delimiter);
      if (chunk.length >= 256 * 1024) {
        for await (const text of flush()) yield text;
      } else if (col % 256 === 255) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        throwIfAborted(options.signal);
      }
    }
    chunk += lineEnding;
    chunkCompletedRows++;
    completedRows++;
    options.onProgress?.(completedRows, totalRows);
    throwIfAborted(options.signal);
    if (chunkCompletedRows >= chunkRows || chunk.length >= 256 * 1024) {
      for await (const text of flush()) yield text;
    } else if (completedRows % 32 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      throwIfAborted(options.signal);
    }
  }
  for await (const text of flush()) yield text;
  throwIfAborted(options.signal);
  return { rows: completedRows, columns: bounds.lastCol + 1 };
}

/** Stream the active sheet of a workbook as UTF-8 bytes. */
export function workbookCsvReadableStream(
  workbook: Workbook,
  options: CsvStreamOptions = {},
): ReadableStream<Uint8Array> {
  const sheet =
    workbook.sheets.find((candidate) => candidate.id === workbook.activeSheetId) ??
    workbook.sheets[0];
  const cancellation = new AbortController();
  const encoder = new TextEncoder();
  const iterator = iterateCsvChunks(sheet, workbook, { ...options, signal: cancellation.signal });
  let finished = false;
  let cleaned = false;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    options.signal?.removeEventListener('abort', externalAbort);
  };
  const finishIterator = () => iterator.return({ rows: 0, columns: 0 });
  const externalAbort = () => {
    if (finished) return;
    finished = true;
    cleanup();
    cancellation.abort();
    // Error the stream even while no pull is pending. Otherwise reader.closed
    // never settles and a suspended generator retains its current page/chunk.
    streamController.error(abortError());
    void finishIterator().catch(() => {});
  };
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        streamController = controller;
        options.signal?.addEventListener('abort', externalAbort, { once: true });
        if (options.signal?.aborted) externalAbort();
      },
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (finished) return;
          if (next.done) {
            finished = true;
            cleanup();
            controller.close();
          } else controller.enqueue(encoder.encode(next.value));
        } catch (error) {
          if (finished) return;
          finished = true;
          cleanup();
          controller.error(error);
        }
      },
      async cancel() {
        if (finished) return;
        finished = true;
        cleanup();
        cancellation.abort();
        await finishIterator();
      },
    },
    { highWaterMark: 0 },
  );
}

/** Convenience helper that retains the completed file in memory as a Blob. */
export async function workbookCsvBlob(
  workbook: Workbook,
  options: CsvStreamOptions = {},
): Promise<Blob> {
  const stream = workbookCsvReadableStream(workbook, options);
  return new Response(stream).blob();
}

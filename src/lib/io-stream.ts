import type { CellValue, Sheet, Workbook } from './types';
import { cellKey, createEvaluator, parseCellKey, type Evaluator } from './engine';

/** Options for the streaming CSV exporter.
 *
 * The exporter works a row at a time and yields bounded text chunks. It never builds a
 * two-dimensional array for the used range, which keeps memory stable for large sheets.
 */
export interface CsvStreamOptions {
  /** Number of rows emitted per chunk. Defaults to 256. */
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
 * Chunks end at a row boundary and contain at most `chunkRows` rows. The final chunk may
 * end in a line ending; consumers should treat the output as a text stream rather than
 * concatenate it into a giant intermediate matrix.
 */
export async function* iterateCsvChunks(
  sheet: Sheet,
  workbook?: Workbook,
  options: CsvStreamOptions = {},
): AsyncGenerator<string, CsvStreamResult, void> {
  const chunkRows = Math.max(1, Math.floor(options.chunkRows ?? 256));
  const delimiter = options.delimiter ?? ',';
  if (delimiter.length !== 1) throw new Error('CSV 分隔符必须是一个字符。');
  const lineEnding = options.lineEnding ?? '\r\n';
  const bounds = usedBounds(sheet);
  if (!bounds) {
    if (options.includeBom !== false) yield '\uFEFF';
    return { rows: 0, columns: 0 };
  }
  const evaluator = options.evaluator ?? createEvaluator(workbook);
  const totalRows = bounds.lastRow + 1;
  let chunk: string[] = [];
  let completedRows = 0;
  let emittedBom = options.includeBom === false;

  const flush = async function* (): AsyncGenerator<string, void, void> {
    if (!chunk.length) return;
    const text = `${emittedBom ? '' : '\uFEFF'}${chunk.join(lineEnding)}${lineEnding}`;
    emittedBom = true;
    chunk = [];
    yield text;
    // Give the browser event loop an opportunity to paint and process input between chunks.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };

  for (let row = 0; row <= bounds.lastRow; row++) {
    throwIfAborted(options.signal);
    const fields = new Array<string>(bounds.lastCol + 1);
    for (let col = 0; col <= bounds.lastCol; col++) {
      throwIfAborted(options.signal);
      const key = cellKey(row, col);
      const source = sheet.cells[key];
      fields[col] = csvField(source ? evaluator(sheet, key) : '', delimiter);
    }
    chunk.push(fields.join(delimiter));
    completedRows++;
    options.onProgress?.(completedRows, totalRows);
    if (chunk.length >= chunkRows) {
      for await (const text of flush()) yield text;
    }
  }
  for await (const text of flush()) yield text;
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
  const encoder = new TextEncoder();
  const iterator = iterateCsvChunks(sheet, workbook, options);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

/** Convenience helper for callers that need a Blob while retaining row-bounded work. */
export async function workbookCsvBlob(
  workbook: Workbook,
  options: CsvStreamOptions = {},
): Promise<Blob> {
  const stream = workbookCsvReadableStream(workbook, options);
  return new Response(stream).blob();
}

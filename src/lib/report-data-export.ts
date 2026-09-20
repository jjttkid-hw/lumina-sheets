import { MAX_COLUMNS, MAX_ROWS } from './engine';
import { csvField } from './io-stream';
import type { ReportDataSource, ReportPage, ReportRow } from './report-data';

export interface ReportDataCsvOptions {
  /** Maximum requested rows per page (default 256). */
  pageSize?: number;
  /** A scan ceiling, never a truncation limit (default spreadsheet MAX_ROWS). */
  maxRows?: number;
  delimiter?: string;
  lineEnding?: '\n' | '\r\n';
  includeBom?: boolean;
  signal?: AbortSignal;
  onProgress?: (completedRows: number, totalRows: number | undefined) => void;
}
export interface ReportDataCsvResult {
  rows: number;
  columns: number;
}

function integer(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`${label}必须是 ${min}–${max} 之间的整数。`);
  return value;
}
function abortError() {
  return new DOMException('数据源 CSV 导出已取消。', 'AbortError');
}
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}
function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    void work.catch(() => {});
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(abortError());
    };
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
async function yieldTask(signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  await abortable(new Promise<void>((resolve) => setTimeout(resolve, 0)), signal);
  checkAbort(signal);
}
function validatePage(raw: unknown, offset: number, limit: number, columns: number): ReportPage {
  if (!raw || typeof raw !== 'object' || !('rows' in raw) || !Array.isArray(raw.rows))
    throw new TypeError('CSV 分页响应必须包含 rows 数组。');
  if (raw.rows.length > limit) throw new RangeError('CSV 分页响应行数超过请求数量。');
  const totalRows = 'totalRows' in raw ? raw.totalRows : undefined;
  if (totalRows !== undefined) {
    if (typeof totalRows !== 'number') throw new TypeError('CSV 数据源总行数必须为整数。');
    integer(totalRows, 0, MAX_ROWS, 'CSV 数据源总行数');
    if (offset + raw.rows.length > totalRows) throw new RangeError('CSV 分页内容超过声明总行数。');
  }
  for (const row of raw.rows) {
    if (!Array.isArray(row) || row.length > columns)
      throw new TypeError('CSV 数据行必须为数组，且不得超过数据源列数。');
    for (const value of row)
      if (
        !['string', 'number', 'boolean'].includes(typeof value) ||
        (typeof value === 'number' && !Number.isFinite(value)) ||
        (typeof value === 'string' && value.length > 32767)
      )
        throw new TypeError('CSV 单元格必须是有限数字、布尔值或不超过 32,767 字符的文本。');
  }
  return { rows: raw.rows as ReportRow[], ...(totalRows !== undefined ? { totalRows } : {}) };
}

/**
 * Fetches each source page sequentially, independently of any viewport cache or Workbook.
 * Short rows have empty trailing fields. For an unknown total, only a short page proves EOF;
 * reaching maxRows with a full page is an error, never a successful partial export.
 * Source offsets must describe a stable snapshot throughout one export.
 */
export async function* iterateReportCsvChunks(
  source: ReportDataSource,
  options: ReportDataCsvOptions = {},
): AsyncGenerator<string, ReportDataCsvResult, void> {
  checkAbort(options.signal);
  const columns = integer(source.columnCount, 1, MAX_COLUMNS, 'CSV 数据源列数');
  if (typeof source.fetchPage !== 'function') throw new TypeError('CSV 数据源必须提供 fetchPage。');
  const pageSize = integer(options.pageSize ?? 256, 1, MAX_ROWS, 'CSV 分页大小');
  const maxRows = integer(options.maxRows ?? MAX_ROWS, 1, MAX_ROWS, 'CSV 最大扫描行数');
  // Bound source page allocation by cell count even for very wide tables.
  const effectivePageSize = Math.min(pageSize, Math.max(1, Math.floor(100_000 / columns)));
  const delimiter = options.delimiter ?? ',';
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || /["\r\n]/.test(delimiter))
    throw new TypeError('CSV 分隔符必须是一个非引号、非换行字符。');
  const lineEnding = options.lineEnding ?? '\r\n';
  if (!['\n', '\r\n'].includes(lineEnding)) throw new TypeError('CSV 行分隔符无效。');
  let totalRows = source.rowCount;
  if (totalRows !== undefined) integer(totalRows, 0, MAX_ROWS, 'CSV 数据源总行数');
  if (totalRows !== undefined && totalRows > maxRows)
    throw new RangeError('数据源总行数超过 CSV 扫描上限，未导出截断内容。');
  let offset = 0;
  let prefix = options.includeBom === false ? '' : '\uFEFF';
  if (totalRows === 0) {
    options.onProgress?.(0, 0);
    if (prefix) yield prefix;
    return { rows: 0, columns };
  }
  while (totalRows === undefined || offset < totalRows) {
    checkAbort(options.signal);
    if (offset >= maxRows)
      throw new RangeError(
        'CSV 已达到扫描上限，但数据源未声明总行数或返回短页；无法确认完整性，导出失败。',
      );
    const limit = Math.min(effectivePageSize, maxRows - offset, (totalRows ?? maxRows) - offset);
    const request = Promise.resolve().then(() => {
      checkAbort(options.signal);
      return source.fetchPage(offset, limit, options.signal);
    });
    const page = validatePage(await abortable(request, options.signal), offset, limit, columns);
    checkAbort(options.signal);
    if (page.totalRows !== undefined) {
      if (totalRows !== undefined && totalRows !== page.totalRows)
        throw new Error('CSV 导出期间数据源总行数发生变化，请使用稳定的数据快照重试。');
      totalRows = page.totalRows;
      if (totalRows > maxRows) throw new RangeError('数据源总行数超过 CSV 扫描上限，导出失败。');
    }
    const expected = totalRows === undefined ? undefined : Math.min(limit, totalRows - offset);
    if (expected !== undefined && page.rows.length !== expected)
      throw new Error('CSV 数据源提前结束或分页缺行；导出失败，未将部分数据标记为完整。');
    let chunk = prefix;
    prefix = '';
    for (let rowIndex = 0; rowIndex < page.rows.length; rowIndex++) {
      checkAbort(options.signal);
      const row = page.rows[rowIndex];
      const fields: string[] = [];
      for (let col = 0; col < columns; col++) fields.push(csvField(row[col] ?? '', delimiter));
      chunk += fields.join(delimiter) + lineEnding;
      if (chunk.length >= 256 * 1024) {
        yield chunk;
        chunk = '';
        await yieldTask(options.signal);
      }
      // Real task yielding allows AbortSignal events and UI input to run during serialization.
      if (rowIndex % 32 === 31) await yieldTask(options.signal);
    }
    offset += page.rows.length;
    const reachedEnd = totalRows !== undefined ? offset === totalRows : page.rows.length < limit;
    options.onProgress?.(offset, totalRows ?? (reachedEnd ? offset : undefined));
    checkAbort(options.signal);
    if (chunk) yield chunk;
    if (reachedEnd) return { rows: offset, columns };
    await yieldTask(options.signal);
  }
  return { rows: offset, columns };
}

/** Zero-prefetch stream: requests start only when a reader asks for bytes. */
export function reportDataCsvReadableStream(
  source: ReportDataSource,
  options: ReportDataCsvOptions = {},
): ReadableStream<Uint8Array> {
  const controller = new AbortController();
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const cleanup = () => options.signal?.removeEventListener('abort', externalAbort);
  const iterator = iterateReportCsvChunks(source, { ...options, signal: controller.signal });
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>(
    {
      async pull(streamController) {
        try {
          const next = await iterator.next();
          if (next.done) {
            cleanup();
            streamController.close();
          } else streamController.enqueue(encoder.encode(next.value));
        } catch (error) {
          cleanup();
          streamController.error(error);
        }
      },
      async cancel() {
        controller.abort();
        cleanup();
        await iterator.return({ rows: 0, columns: source.columnCount });
      },
    },
    { highWaterMark: 0 },
  );
}

/** Blob convenience API still holds the completed file in memory; prefer stream.pipeTo for big files. */
export async function reportDataCsvBlob(
  source: ReportDataSource,
  options: ReportDataCsvOptions = {},
): Promise<Blob> {
  return new Response(reportDataCsvReadableStream(source, options), {
    headers: { 'Content-Type': 'text/csv;charset=utf-8' },
  }).blob();
}

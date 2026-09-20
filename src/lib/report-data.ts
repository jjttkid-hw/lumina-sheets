import type { CellValue, Sheet } from './types';
import { cellKey, MAX_COLUMNS, MAX_ROWS } from './engine';

export type ReportRow = CellValue[];

export interface ReportPage {
  rows: ReportRow[];
  totalRows?: number;
}

/** A browser-side data binding contract; offsets are zero based. */
export interface ReportDataSource {
  readonly rowCount?: number;
  readonly columnCount: number;
  fetchPage(offset: number, limit: number, signal?: AbortSignal): Promise<ReportPage>;
}

export interface ChunkCacheOptions {
  pageSize?: number;
  maxPages?: number;
}

interface PendingPage {
  controller: AbortController;
  promise: Promise<ReportPage>;
  consumers: number;
}

function integer(value: number, min: number, max: number, name: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`${name}必须是 ${min}–${max} 之间的整数。`);
  return value;
}

function validateSource(source: ReportDataSource) {
  integer(source.columnCount, 1, MAX_COLUMNS, '数据源列数');
  if (source.rowCount !== undefined) integer(source.rowCount, 0, MAX_ROWS, '数据源行数');
  if (typeof source.fetchPage !== 'function') throw new TypeError('数据源必须提供 fetchPage。');
}

function abortError(): Error {
  return new DOMException('数据加载已取消。', 'AbortError');
}

/** Cancellation also settles requests whose data source ignores AbortSignal. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
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

/** Reject malformed payloads before they reach Canvas or the formula engine. */
function validatePage(input: unknown, offset: number, limit: number, columns: number): ReportPage {
  if (!input || typeof input !== 'object' || !('rows' in input) || !Array.isArray(input.rows))
    throw new TypeError('分页响应必须包含 rows 数组。');
  if (input.rows.length > limit || offset + input.rows.length > MAX_ROWS)
    throw new RangeError('分页响应超出请求范围。');
  const totalRows = 'totalRows' in input ? input.totalRows : undefined;
  if (totalRows !== undefined) {
    if (typeof totalRows !== 'number') throw new TypeError('分页总行数必须是整数。');
    integer(totalRows, 0, MAX_ROWS, '分页总行数');
    if (input.rows.length && offset + input.rows.length > totalRows)
      throw new RangeError('分页内容超过声明的总行数。');
  }
  const rows: ReportRow[] = [];
  for (const raw of input.rows) {
    if (!Array.isArray(raw) || raw.length > columns)
      throw new TypeError('分页行必须是数组且不能超过数据源列数。');
    const row: ReportRow = [];
    for (const value of raw) {
      if (
        !['string', 'number', 'boolean'].includes(typeof value) ||
        (typeof value === 'number' && !Number.isFinite(value)) ||
        (typeof value === 'string' && value.length > 32767)
      )
        throw new TypeError('分页单元格必须是有限数字、布尔值或不超过 32,767 字符的文本。');
      row.push(value);
    }
    Object.freeze(row);
    rows.push(row);
  }
  Object.freeze(rows);
  return Object.freeze({ rows, ...(totalRows !== undefined ? { totalRows } : {}) });
}

/**
 * Bounded LRU viewport cache. Pages stay outside Workbook.cells and do not enter
 * edit history or persistence. Shared requests cancel only after all consumers leave.
 */
export class ReportChunkCache {
  readonly pageSize: number;
  readonly maxPages: number;
  readonly columnCount: number;
  private pages = new Map<number, ReportPage>();
  private pending = new Map<number, PendingPage>();
  private errors = new Map<number, Error>();
  private listeners = new Set<() => void>();
  private generation = 0;
  private version = 0;
  private totalRows?: number;
  private disposed = false;

  constructor(
    private readonly source: ReportDataSource,
    options: ChunkCacheOptions = {},
  ) {
    validateSource(source);
    this.pageSize = integer(options.pageSize ?? 256, 1, MAX_ROWS, '分页大小');
    this.maxPages = integer(options.maxPages ?? 8, 1, 1024, '缓存页数');
    this.columnCount = source.columnCount;
    this.totalRows = source.rowCount;
  }

  get rowCount() {
    return this.totalRows;
  }
  get size() {
    return this.pages.size;
  }
  /** Number of in-flight pages, useful for a nonblocking loading indicator. */
  get loading() {
    return this.pending.size;
  }
  /** Most recent retained page error, if any. Useful for host status indicators. */
  get error(): Error | undefined {
    return this.errors.values().next().value;
  }
  /** Stable numeric snapshot for useSyncExternalStore. */
  get revision() {
    return this.version;
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.version++;
    for (const listener of this.listeners) {
      // One host callback cannot turn a successful data request into a failure.
      try {
        listener();
      } catch (error) {
        console.error('ReportChunkCache subscriber failed', error);
      }
    }
  }

  clear() {
    this.generation++;
    const requests = [...this.pending.values()];
    this.pending.clear();
    this.pages.clear();
    this.errors.clear();
    this.totalRows = this.source.rowCount;
    for (const request of requests) request.controller.abort();
    this.notify();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.listeners.clear();
  }

  /** Returns cached data only; never performs a network request. */
  peekRow(row: number): ReportRow | undefined {
    integer(row, 0, MAX_ROWS - 1, '行号');
    if (this.totalRows !== undefined && row >= this.totalRows) return undefined;
    const index = Math.floor(row / this.pageSize);
    const page = this.pages.get(index);
    if (!page) return undefined;
    this.pages.delete(index);
    this.pages.set(index, page);
    return page.rows[row % this.pageSize];
  }

  read(row: number, column: number): CellValue | undefined {
    integer(column, 0, this.columnCount - 1, '列号');
    return this.peekRow(row)?.[column];
  }

  errorAt(row: number): Error | undefined {
    integer(row, 0, MAX_ROWS - 1, '行号');
    return this.errors.get(Math.floor(row / this.pageSize));
  }

  private share(index: number, request: PendingPage, signal?: AbortSignal): Promise<ReportPage> {
    request.consumers++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = () => {
        if (settled) return false;
        settled = true;
        signal?.removeEventListener('abort', abort);
        request.consumers--;
        if (!request.consumers && this.pending.get(index) === request) {
          this.pending.delete(index);
          request.controller.abort();
          this.notify();
        }
        return true;
      };
      const abort = () => {
        if (release()) reject(abortError());
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      request.promise.then(
        (page) => {
          if (release()) resolve(page);
        },
        (error) => {
          if (release()) reject(error);
        },
      );
    });
  }

  async getPage(page: number, signal?: AbortSignal): Promise<ReportPage> {
    integer(page, 0, Math.ceil(MAX_ROWS / this.pageSize) - 1, '页号');
    if (this.disposed) throw new Error('分页缓存已销毁。');
    if (signal?.aborted) throw abortError();
    const offset = page * this.pageSize;
    if (this.totalRows !== undefined && offset >= this.totalRows)
      return { rows: [], totalRows: this.totalRows };
    const cached = this.pages.get(page);
    if (cached) {
      this.pages.delete(page);
      this.pages.set(page, cached);
      return cached;
    }
    const shared = this.pending.get(page);
    if (shared) return this.share(page, shared, signal);
    const controller = new AbortController();
    const generation = this.generation;
    const limit = Math.min(this.pageSize, (this.totalRows ?? MAX_ROWS) - offset);
    const request: PendingPage = { controller, promise: undefined!, consumers: 0 };
    this.pending.set(page, request);
    this.errors.delete(page);
    request.promise = (async () => {
      try {
        const payload = await abortable(
          Promise.resolve().then(() => {
            if (controller.signal.aborted) throw abortError();
            return this.source.fetchPage(offset, limit, controller.signal);
          }),
          controller.signal,
        );
        if (generation !== this.generation || controller.signal.aborted) throw abortError();
        const result = validatePage(payload, offset, limit, this.columnCount);
        this.pages.set(page, result);
        while (this.pages.size > this.maxPages) this.pages.delete(this.pages.keys().next().value!);
        if (result.totalRows !== undefined) {
          this.totalRows = result.totalRows;
          for (const key of this.pages.keys())
            if (key * this.pageSize >= result.totalRows) this.pages.delete(key);
        }
        return result;
      } catch (error) {
        if (generation === this.generation && !controller.signal.aborted) {
          this.errors.set(page, error instanceof Error ? error : new Error(String(error)));
          while (this.errors.size > this.maxPages)
            this.errors.delete(this.errors.keys().next().value!);
        }
        throw error;
      } finally {
        if (this.pending.get(page) === request) {
          this.pending.delete(page);
          this.notify();
        }
      }
    })();
    const consumer = this.share(page, request, signal);
    this.notify();
    return consumer;
  }

  async getRow(row: number, signal?: AbortSignal): Promise<ReportRow | undefined> {
    integer(row, 0, MAX_ROWS - 1, '行号');
    if (this.disposed) throw new Error('分页缓存已销毁。');
    if (signal?.aborted) throw abortError();
    if (this.totalRows !== undefined && row >= this.totalRows) return undefined;
    const page = await this.getPage(Math.floor(row / this.pageSize), signal);
    return page.rows[row % this.pageSize];
  }

  /** Inclusive row bounds. A viewport must fit inside the configured page budget. */
  async ensureRange(startRow: number, endRow: number, signal?: AbortSignal): Promise<void> {
    integer(startRow, 0, MAX_ROWS - 1, '起始行');
    integer(endRow, startRow, MAX_ROWS - 1, '结束行');
    if (this.disposed) throw new Error('分页缓存已销毁。');
    if (signal?.aborted) throw abortError();
    if (this.totalRows !== undefined) {
      if (startRow >= this.totalRows) return;
      endRow = Math.min(endRow, this.totalRows - 1);
    }
    const first = Math.floor(startRow / this.pageSize);
    const last = Math.floor(endRow / this.pageSize);
    if (last - first + 1 > this.maxPages)
      throw new RangeError('可视范围超出缓存页数，请缩小范围或增加 maxPages。');
    await Promise.all(
      Array.from({ length: last - first + 1 }, (_, index) => this.getPage(first + index, signal)),
    );
  }
}

/** Local adapter: validates and copies only the requested rows, never the full dataset. */
export function arrayDataSource(
  rows: readonly (readonly CellValue[])[],
  options: { columnCount?: number } = {},
): ReportDataSource {
  integer(rows.length, 0, MAX_ROWS, '数据源行数');
  const columnCount = options.columnCount ?? Math.max(1, rows[0]?.length ?? 0);
  integer(columnCount, 1, MAX_COLUMNS, '数据源列数');
  return {
    rowCount: rows.length,
    columnCount,
    async fetchPage(offset, limit, signal) {
      integer(offset, 0, MAX_ROWS - 1, '起始行');
      integer(limit, 1, MAX_ROWS - offset, '请求行数');
      if (signal?.aborted) throw abortError();
      return validatePage(
        { rows: rows.slice(offset, offset + limit), totalRows: rows.length },
        offset,
        limit,
        columnCount,
      );
    },
  };
}

export interface RestDataSourceOptions {
  columnCount: number;
  rowCount?: number;
  fetcher?: typeof fetch;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
}

/** GET {url}?offset=…&limit=… -> {rows,totalRows?}; no request occurs until fetchPage. */
export function restDataSource(url: string, options: RestDataSourceOptions): ReportDataSource {
  if (!url.trim()) throw new TypeError('必须显式提供数据源 URL。');
  const endpoint = new URL(url, typeof location === 'undefined' ? undefined : location.href);
  if (!['http:', 'https:'].includes(endpoint.protocol))
    throw new TypeError('数据源 URL 仅支持 HTTP 或 HTTPS。');
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new Error('当前环境没有 Fetch API。');
  const source: ReportDataSource = {
    rowCount: options.rowCount,
    columnCount: options.columnCount,
    async fetchPage(offset, limit, signal) {
      integer(offset, 0, MAX_ROWS - 1, '起始行');
      integer(limit, 1, MAX_ROWS - offset, '请求行数');
      if (signal?.aborted) throw abortError();
      const target = new URL(endpoint);
      target.searchParams.set('offset', String(offset));
      target.searchParams.set('limit', String(limit));
      const headers = new Headers(options.headers);
      if (!headers.has('Accept')) headers.set('Accept', 'application/json');
      const request = fetcher(target, {
        method: 'GET',
        signal,
        headers,
        credentials: options.credentials ?? 'same-origin',
      }).then(async (response) => {
        if (!response.ok) throw new Error(`数据源请求失败（HTTP ${response.status}）。`);
        return validatePage(await response.json(), offset, limit, source.columnCount);
      });
      return signal ? abortable(request, signal) : request;
    },
  };
  validateSource(source);
  return source;
}

/**
 * Explicit small-page import only. For interactive paging use cache.read instead,
 * so remote data never grows Workbook.cells, undo history, or IndexedDB snapshots.
 */
export async function hydrateSheetPage(
  sheet: Sheet,
  source: ReportDataSource,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<Sheet> {
  validateSource(source);
  integer(offset, 0, MAX_ROWS - 1, '起始行');
  integer(limit, 1, MAX_ROWS - offset, '请求行数');
  if (limit * source.columnCount > 100_000)
    throw new RangeError('单次显式导入最多 100,000 个单元格，请改用分页缓存。');
  if (signal?.aborted) throw abortError();
  const request = source.fetchPage(offset, limit, signal);
  const raw = await (signal ? abortable(request, signal) : request);
  const page = validatePage(raw, offset, limit, source.columnCount);
  const cells = { ...sheet.cells };
  page.rows.forEach((row, index) =>
    row.forEach((value, col) => {
      const key = cellKey(offset + index, col);
      if (value !== '') cells[key] = { value };
      else delete cells[key];
    }),
  );
  return {
    ...sheet,
    cells,
    rowCount: Math.max(sheet.rowCount, offset + page.rows.length, page.totalRows ?? 0),
    colCount: Math.max(sheet.colCount, source.columnCount),
    dataSource: {
      kind: 'paged',
      totalRows: page.totalRows ?? source.rowCount,
      pageSize: limit,
    },
  };
}

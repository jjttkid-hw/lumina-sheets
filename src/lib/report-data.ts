import type { CellValue, Sheet, Workbook } from './types';
import { cellKey, MAX_COLUMNS, MAX_ROWS } from './engine';
import { createBlankWorkbook } from './seed';

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
  /** Requested row ceiling; reduced to fit maxPageCells / columnCount. */
  pageSize?: number;
  maxPages?: number;
  /** Logical row × column slots per page; default 100,000, maximum 1,000,000. */
  maxPageCells?: number;
  /** UTF-16 text units per page; default 8,000,000, maximum 32,000,000. */
  maxPageTextUnits?: number;
}

export interface ReportSnapshotOptions {
  name?: string;
  /** Scan ceilings, never truncation limits. Maximum 100,000 rows and cells. */
  maxRows?: number;
  maxCells?: number;
  /** Maximum fetched rows per page; also bounded to 100,000 cells. */
  pageSize?: number;
  signal?: AbortSignal;
  onProgress?: (completedRows: number, totalRows: number | undefined) => void;
}

/** Materialize a complete bounded data source for static editing and file export.
 * Requires a stable source snapshot. Rejects formula-like text rather than
 * executing it, and retains at most 8 million UTF-16 text units. */
export async function workbookFromReportData(
  source: ReportDataSource,
  options: ReportSnapshotOptions = {},
): Promise<Workbook> {
  const signal = options.signal;
  const check = () => {
    if (signal?.aborted) throw abortError();
  };
  check();
  validateSource(source);
  const columns = integer(source.columnCount, 1, 256, '静态报表列数');
  const maxRows = integer(options.maxRows ?? 100_000, 1, 100_000, '静态报表行数上限');
  const maxCells = integer(options.maxCells ?? 100_000, 1, 100_000, '静态报表单元格上限');
  const pageSize = integer(options.pageSize ?? 256, 1, MAX_ROWS, '静态报表分页大小');
  const ceiling = Math.min(maxRows, Math.floor(maxCells / columns));
  if (!ceiling) throw new RangeError('静态报表单元格上限不足一行。');
  if (
    options.name !== undefined &&
    (typeof options.name !== 'string' || !options.name.trim() || options.name.length > 200)
  )
    throw new TypeError('静态报表名称必须为 1–200 字符。');
  if (options.onProgress !== undefined && typeof options.onProgress !== 'function')
    throw new TypeError('静态报表进度回调无效。');
  let total = source.rowCount;
  if (total !== undefined && total > ceiling)
    throw new RangeError('数据源超过静态报表容量，请筛选数据或使用全源 CSV 导出。');
  const book = createBlankWorkbook(options.name ?? '数据源报表');
  const sheet = book.sheets[0];
  sheet.cells = {};
  sheet.columnWidths = {};
  sheet.frozenRows = 0;
  sheet.colCount = columns;
  let offset = 0,
    textUnits = 0;
  const yieldTask = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    check();
  };
  if (total === 0) {
    options.onProgress?.(0, 0);
    check();
  }
  while (total === undefined || offset < total) {
    check();
    if (offset >= ceiling)
      throw new RangeError('已达到静态报表容量但无法确认数据源完整性，未生成截断报表。');
    const limit = Math.min(pageSize, ceiling - offset, (total ?? ceiling) - offset);
    const work = Promise.resolve().then(() => {
      check();
      return source.fetchPage(offset, limit, signal);
    });
    const raw = await (signal ? abortable(work, signal) : work);
    check();
    const page = validatePage(raw, offset, limit, columns);
    check();
    if (page.totalRows !== undefined) {
      if (page.totalRows < offset || (total !== undefined && total !== page.totalRows))
        throw new Error('生成报表期间数据源总行数变化，请使用稳定快照重试。');
      total = page.totalRows;
      if (total > ceiling) throw new RangeError('数据源超过静态报表容量，未生成截断报表。');
    }
    if (total !== undefined && page.rows.length !== Math.min(limit, Math.max(0, total - offset)))
      throw new Error('静态报表分页缺行，无法确认完整性。');
    for (let row = 0; row < page.rows.length; row++) {
      check();
      for (let col = 0; col < columns; col++) {
        const value = page.rows[row][col] ?? '';
        if (typeof value === 'string') {
          if (value.startsWith('='))
            throw new Error(
              '数据源包含以 = 开头的原始文本；静态报表不能将其作为公式执行，请使用全源 CSV 导出。',
            );
          textUnits += value.length;
          if (textUnits > 8_000_000)
            throw new RangeError('静态报表文本超过容量，请筛选数据或使用全源 CSV 导出。');
        }
        if (value !== '') sheet.cells[cellKey(offset + row, col)] = { value };
      }
      if (row % 32 === 31) await yieldTask();
    }
    offset += page.rows.length;
    const done = total !== undefined ? offset === total : page.rows.length < limit;
    options.onProgress?.(offset, total ?? (done ? offset : undefined));
    check();
    if (done) break;
    await yieldTask();
  }
  sheet.rowCount = Math.max(1, offset);
  // Static exporters use stored-cell bounds. Preserve a blank bottom-right cell
  // so trailing empty records/fields survive without materializing the rectangle.
  if (offset > 0) sheet.cells[cellKey(offset - 1, columns - 1)] ??= { value: '' };
  sheet.dataSource = { kind: 'static', totalRows: offset };
  check();
  return book;
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
function validatePage(
  input: unknown,
  offset: number,
  limit: number,
  columns: number,
  maxTextUnits = Infinity,
): ReportPage {
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
  let textUnits = 0;
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
      if (typeof value === 'string') {
        textUnits += value.length;
        if (textUnits > maxTextUnits)
          throw new RangeError(
            '分页文本超过 maxPageTextUnits 容量，请减小 pageSize 或调整文本上限。',
          );
      }
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
  readonly maxPageCells: number;
  readonly maxPageTextUnits: number;
  private pages = new Map<number, ReportPage>();
  private pending = new Map<number, PendingPage>();
  private activeRequests = 0;
  private queuedRequests = new Map<PendingPage, () => void>();
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
    const requestedPageSize = integer(options.pageSize ?? 256, 1, MAX_ROWS, '分页大小');
    this.maxPages = integer(options.maxPages ?? 8, 1, 1024, '缓存页数');
    this.columnCount = source.columnCount;
    this.maxPageCells = integer(options.maxPageCells ?? 100_000, 1, 1_000_000, '单页单元格上限');
    this.maxPageTextUnits = integer(
      options.maxPageTextUnits ?? 8_000_000,
      1,
      32_000_000,
      '单页文本上限',
    );
    if (this.maxPageCells < this.columnCount)
      throw new RangeError('maxPageCells 不足以容纳数据源的一整行。');
    this.pageSize = Math.min(requestedPageSize, Math.floor(this.maxPageCells / this.columnCount));
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
    const generation = this.generation;
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
          if (!release()) return;
          // Ready notifications run before these consumers settle. A subscriber
          // may clear/dispose the cache or start a replacement from that callback.
          // Never deliver a page from the invalidated generation to its caller.
          if (this.disposed || generation !== this.generation || request.controller.signal.aborted)
            reject(abortError());
          else resolve(page);
        },
        (error) => {
          if (!release()) return;
          if (this.disposed || generation !== this.generation || request.controller.signal.aborted)
            reject(abortError());
          else reject(error);
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
      let active = false;
      try {
        if (this.activeRequests >= this.maxPages) {
          await abortable(
            new Promise<void>((resolve) => {
              this.queuedRequests.set(request, () => {
                active = true;
                this.activeRequests++;
                resolve();
              });
            }),
            controller.signal,
          );
        } else {
          active = true;
          this.activeRequests++;
        }
        const payload = await abortable(
          Promise.resolve().then(() => {
            if (controller.signal.aborted) throw abortError();
            return this.source.fetchPage(offset, limit, controller.signal);
          }),
          controller.signal,
        );
        if (generation !== this.generation || controller.signal.aborted) throw abortError();
        const result = validatePage(
          payload,
          offset,
          limit,
          this.columnCount,
          this.maxPageTextUnits,
        );
        if (generation !== this.generation || controller.signal.aborted) throw abortError();
        const total = result.totalRows ?? this.totalRows;
        if (
          total !== undefined &&
          result.rows.length !== Math.min(limit, Math.max(0, total - offset))
        )
          throw new Error('分页响应缺行或超出已知总行数，请重试或刷新数据源。');
        const cancelled: PendingPage[] = [];
        if (result.totalRows !== undefined) {
          if (this.totalRows !== undefined && result.totalRows !== this.totalRows) {
            this.pages.clear();
            this.errors.clear();
            for (const [index, pending] of this.pending) {
              if (pending === request) continue;
              this.pending.delete(index);
              cancelled.push(pending);
            }
          }
          this.totalRows = result.totalRows;
          for (const [index, cached] of this.pages) {
            const expected = Math.min(
              this.pageSize,
              Math.max(0, result.totalRows - index * this.pageSize),
            );
            if (!expected || cached.rows.length !== expected) this.pages.delete(index);
          }
        }
        // A request made at the old tail can be shorter than the new page after
        // growth. Return its valid response, but leave the page eligible for reload.
        if (
          total === undefined ||
          (offset < total && result.rows.length === Math.min(this.pageSize, total - offset))
        )
          this.pages.set(page, result);
        while (this.pages.size > this.maxPages) this.pages.delete(this.pages.keys().next().value!);
        // Commit and detach old requests before abort listeners can reenter.
        for (const pending of cancelled) pending.controller.abort();
        if (generation !== this.generation || controller.signal.aborted) throw abortError();
        return result;
      } catch (error) {
        if (generation === this.generation && !controller.signal.aborted) {
          this.errors.set(page, error instanceof Error ? error : new Error(String(error)));
          while (this.errors.size > this.maxPages)
            this.errors.delete(this.errors.keys().next().value!);
        }
        throw error;
      } finally {
        this.queuedRequests.delete(request);
        if (active) this.activeRequests--;
        for (const [queued, start] of this.queuedRequests) {
          if (this.activeRequests >= this.maxPages) break;
          this.queuedRequests.delete(queued);
          if (!queued.controller.signal.aborted) start();
        }
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
  /** Decoded HTTP body bytes per response; default 16 MiB, maximum 64 MiB. */
  maxResponseBytes?: number;
  /** Opt-in retry policy for transient transport/HTTP failures. */
  retry?: RestRetryOptions;
  fetcher?: typeof fetch;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
}

export interface RestRetryOptions {
  /** Number of additional attempts after the first request; default 0, maximum 5. */
  retries?: number;
  /** Initial delay before the first retry in milliseconds; default 250, maximum 10,000. */
  baseDelayMs?: number;
  /** Exponential backoff ceiling in milliseconds; default 4,000. */
  maxDelayMs?: number;
  /** HTTP statuses eligible for retry; defaults to common transient statuses. */
  statuses?: readonly number[];
}

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const;

function retryPolicy(input: RestRetryOptions | undefined) {
  if (input === undefined) {
    return {
      retries: 0,
      baseDelayMs: 250,
      maxDelayMs: 4_000,
      statuses: new Set<number>(DEFAULT_RETRY_STATUSES),
    };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('REST 重试配置无效。');
  const retries = integer(input.retries ?? 0, 0, 5, 'REST 重试次数');
  const baseDelayMs = integer(input.baseDelayMs ?? 250, 0, 10_000, 'REST 重试初始等待');
  const maxDelayMs = integer(input.maxDelayMs ?? 4_000, 0, 60_000, 'REST 重试等待上限');
  if (maxDelayMs < baseDelayMs) throw new RangeError('REST 重试等待上限不能小于初始等待。');
  const statuses = input.statuses ?? DEFAULT_RETRY_STATUSES;
  if (
    !Array.isArray(statuses) ||
    !statuses.length ||
    statuses.some((status) => !Number.isSafeInteger(status) || status < 100 || status > 599)
  )
    throw new RangeError('REST 重试状态码必须为 100–599 的非空整数列表。');
  return { retries, baseDelayMs, maxDelayMs, statuses: new Set(statuses) };
}

function retryDelay(policy: ReturnType<typeof retryPolicy>, attempt: number) {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
}

function waitForRetry(delay: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (!delay) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, delay);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(abortError());
    };
    function done() {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(abortError());
      else resolve();
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Count the actual body stream; Content-Length may be absent or describe compressed bytes. */
async function readRestJson(response: Response, maxBytes: number, signal?: AbortSignal) {
  if (!response.body) return JSON.parse('');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const decode = (value?: Uint8Array, stream = false) => {
    try {
      return decoder.decode(value, { stream });
    } catch {
      throw new TypeError('REST 响应不是有效 UTF-8，无法无损读取数据。');
    }
  };
  let text = '',
    bytes = 0,
    sinceYield = 0,
    reads = 0,
    done = false;
  const cancel = () => {
    try {
      void reader.cancel().catch(() => {});
    } catch {
      /* Preserve the original error. */
    }
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw abortError();
      const next = await (signal ? abortable(reader.read(), signal) : reader.read());
      if (signal?.aborted) throw abortError();
      if (next.done) {
        done = true;
        break;
      }
      bytes += next.value.byteLength;
      if (bytes > maxBytes)
        throw new RangeError('REST 响应超过 maxResponseBytes 容量，请减小分页或调整响应上限。');
      text += decode(next.value, true);
      sinceYield += next.value.byteLength;
      if (sinceYield >= 256 * 1024 || ++reads % 256 === 0) {
        sinceYield = 0;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    text += decode();
    if (signal?.aborted) throw abortError();
    return JSON.parse(text);
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!done) cancel();
    reader.releaseLock();
  }
}

/** GET {url}?offset=…&limit=… -> {rows,totalRows?}; no request occurs until fetchPage. */
export function restDataSource(url: string, options: RestDataSourceOptions): ReportDataSource {
  if (!url.trim()) throw new TypeError('必须显式提供数据源 URL。');
  const endpoint = new URL(url, typeof location === 'undefined' ? undefined : location.href);
  if (!['http:', 'https:'].includes(endpoint.protocol))
    throw new TypeError('数据源 URL 仅支持 HTTP 或 HTTPS。');
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new Error('当前环境没有 Fetch API。');
  const maxResponseBytes = integer(
    options.maxResponseBytes ?? 16 * 1024 * 1024,
    1,
    64 * 1024 * 1024,
    'REST 响应字节上限',
  );
  const retry = retryPolicy(options.retry);
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
      const request = (async () => {
        let attempt = 0;
        while (true) {
          if (signal?.aborted) throw abortError();
          let response: Response;
          try {
            response = await fetcher(target, {
              method: 'GET',
              signal,
              headers,
              credentials: options.credentials ?? 'same-origin',
            });
          } catch (error) {
            if (signal?.aborted || (error as { name?: string })?.name === 'AbortError')
              throw abortError();
            if (attempt >= retry.retries) throw error;
            await waitForRetry(retryDelay(retry, attempt++), signal);
            continue;
          }
          const discard = () => {
            // A custom fetcher may ignore abort. Release an unused body without
            // allowing slow/failed cleanup to replace the original outcome.
            try {
              void response.body?.cancel().catch(() => {});
            } catch {
              // A locked/already consumed body cannot be cancelled here.
            }
          };
          if (signal?.aborted) {
            discard();
            throw abortError();
          }
          if (!response.ok) {
            const status = response.status;
            discard();
            if (retry.statuses.has(status) && attempt < retry.retries) {
              await waitForRetry(retryDelay(retry, attempt++), signal);
              continue;
            }
            throw new Error(`数据源请求失败（HTTP ${status}）。`);
          }
          const payload = await readRestJson(response, maxResponseBytes, signal);
          if (signal?.aborted) throw abortError();
          return validatePage(payload, offset, limit, source.columnCount);
        }
      })();
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
  const columns = source.columnCount;
  const sourceRows = source.rowCount;
  integer(offset, 0, MAX_ROWS - 1, '起始行');
  integer(limit, 1, MAX_ROWS - offset, '请求行数');
  if (limit * columns > 100_000)
    throw new RangeError('单次显式导入最多 100,000 个单元格，请改用分页缓存。');
  if (signal?.aborted) throw abortError();
  const request = source.fetchPage(offset, limit, signal);
  const raw = await (signal ? abortable(request, signal) : request);
  const page = validatePage(raw, offset, limit, columns);
  if (signal?.aborted) throw abortError();
  const totalRows = page.totalRows ?? sourceRows;
  if (
    totalRows !== undefined &&
    page.rows.length !== Math.min(limit, Math.max(0, totalRows - offset))
  )
    throw new Error('分页响应缺行或超出已知总行数，请重试或刷新数据源。');
  const cells = { ...sheet.cells };
  page.rows.forEach((row, index) => {
    for (let col = 0; col < columns; col++) {
      const value = row[col] ?? '';
      const key = cellKey(offset + index, col);
      if (value !== '') cells[key] = { value };
      else delete cells[key];
    }
  });
  return {
    ...sheet,
    cells,
    rowCount: Math.max(sheet.rowCount, offset + page.rows.length, totalRows ?? 0),
    colCount: Math.max(sheet.colCount, columns),
    dataSource: {
      kind: 'paged',
      totalRows,
      pageSize: limit,
    },
  };
}

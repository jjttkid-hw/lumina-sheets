import { describe, expect, it, vi } from 'vitest';
import { parseCsv } from '../src/lib/io';
import { arrayDataSource, type ReportDataSource } from '../src/lib/report-data';
import {
  iterateReportCsvChunks,
  reportDataCsvBlob,
  reportDataCsvReadableStream,
} from '../src/lib/report-data-export';

async function collect(
  source: ReportDataSource,
  options: Parameters<typeof iterateReportCsvChunks>[1] = {},
) {
  let text = '';
  for await (const chunk of iterateReportCsvChunks(source, options)) text += chunk;
  return text;
}

describe('complete paged-source CSV export', () => {
  it('stays lazy and fetches all pages sequentially independently of viewport state', async () => {
    const rows = Array.from({ length: 7 }, (_, index) => [index, `row ${index}`]);
    const source = arrayDataSource(rows);
    const fetch = vi.spyOn(source, 'fetchPage');
    const stream = reportDataCsvReadableStream(source, { pageSize: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).not.toHaveBeenCalled();
    const text = await new Response(stream).text();
    expect(fetch.mock.calls.map(([offset, limit]) => [offset, limit])).toEqual([
      [0, 3],
      [3, 3],
      [6, 1],
    ]);
    expect(parseCsv(text)).toEqual(rows.map((row) => row.map(String)));
  });

  it('discovers totalRows from the first response and emits useful progress', async () => {
    const progress: Array<[number, number | undefined]> = [];
    const source: ReportDataSource = {
      columnCount: 1,
      fetchPage: async (offset, limit) => ({
        rows: Array.from({ length: Math.min(limit, 5 - offset) }, (_, index) => [offset + index]),
        totalRows: 5,
      }),
    };
    const blob = await reportDataCsvBlob(source, {
      pageSize: 2,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(parseCsv(await blob.text())).toEqual([['0'], ['1'], ['2'], ['3'], ['4']]);
    expect(progress).toEqual([
      [2, 5],
      [4, 5],
      [5, 5],
    ]);
  });

  it('uses short-page EOF for unknown totals and rejects a full-page scan ceiling', async () => {
    const unknown: ReportDataSource = {
      columnCount: 1,
      fetchPage: async (offset, limit) => ({
        rows: Array.from({ length: Math.max(0, Math.min(limit, 5 - offset)) }, (_, index) => [
          offset + index,
        ]),
      }),
    };
    expect(parseCsv(await collect(unknown, { pageSize: 2, maxRows: 6 }))).toHaveLength(5);
    await expect(collect(unknown, { pageSize: 2, maxRows: 4 })).rejects.toThrow('无法确认完整性');
    // Exact ceiling without a declared total remains ambiguous and must not succeed silently.
    await expect(collect(unknown, { pageSize: 2, maxRows: 5 })).rejects.toThrow('无法确认完整性');
  });

  it('pads trailing empty fields, escapes text and preserves negative numbers', async () => {
    const source = arrayDataSource([['=SUM(A1)', -2, '引号"\n换行'], ['tail']], { columnCount: 3 });
    expect(parseCsv(await collect(source))).toEqual([
      ["'=SUM(A1)", '-2', '引号"\n换行'],
      ['tail', '', ''],
    ]);
  });

  it('rejects missing, oversized and malformed pages and unstable totals', async () => {
    const source = (response: unknown, rowCount = 3): ReportDataSource => ({
      rowCount,
      columnCount: 2,
      fetchPage: async () => response as never,
    });
    await expect(collect(source({ rows: [[1]] }))).rejects.toThrow('提前结束');
    await expect(collect(source({ rows: [[1], [2], [3], [4]] }))).rejects.toThrow('超过请求');
    await expect(collect(source({ rows: [[1, 2, 3]] }))).rejects.toThrow('列数');
    await expect(collect(source({ rows: [[NaN]] }))).rejects.toThrow('有限数字');
    await expect(collect(source({ rows: [[null]] }))).rejects.toThrow('有限数字');
    await expect(collect(source({ rows: [[undefined]] }))).rejects.toThrow('有限数字');
    await expect(collect(source({ rows: [[1]], totalRows: 4 }))).rejects.toThrow('发生变化');
    await expect(collect(source({ nope: [] }))).rejects.toThrow('rows');
  });

  it('rejects declared totals above scan budget before fetching and represents zero rows', async () => {
    const fetchPage = vi.fn(async () => ({ rows: [] }));
    await expect(
      collect({ rowCount: 5, columnCount: 1, fetchPage }, { maxRows: 4 }),
    ).rejects.toThrow('上限');
    expect(fetchPage).not.toHaveBeenCalled();
    expect(await collect({ rowCount: 0, columnCount: 1, fetchPage })).toBe('\uFEFF');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('passes cancellation to fetch and settles even if fetch ignores AbortSignal', async () => {
    let received: AbortSignal | undefined;
    let requested!: () => void;
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const source: ReportDataSource = {
      columnCount: 1,
      fetchPage: async (_offset, _limit, signal) => {
        received = signal;
        requested();
        return new Promise(() => {});
      },
    };
    const reader = reportDataCsvReadableStream(source).getReader();
    const pending = reader.read();
    await started;
    await reader.cancel();
    expect(received?.aborted).toBe(true);
    expect(await pending).toEqual({ done: true, value: undefined });
  });

  it('honors an external abort during a request and yields real tasks between pages', async () => {
    const controller = new AbortController();
    let timerRan = false;
    const source: ReportDataSource = {
      rowCount: 2,
      columnCount: 1,
      fetchPage: async (offset) => {
        if (offset === 0)
          setTimeout(() => {
            timerRan = true;
          }, 0);
        else expect(timerRan).toBe(true);
        return { rows: [[offset]] };
      },
    };
    await collect(source, { pageSize: 1 });
    const hanging: ReportDataSource = {
      columnCount: 1,
      fetchPage: async (_o, _l, signal) => {
        expect(signal).toBeDefined();
        setTimeout(() => controller.abort(), 0);
        return new Promise(() => {});
      },
    };
    await expect(reportDataCsvBlob(hanging, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it.each([true, false])(
    'honors cancellation from empty-source progress (BOM %s)',
    async (includeBom) => {
      const controller = new AbortController();
      const fetchPage = vi.fn(async () => ({ rows: [] }));
      const iterator = iterateReportCsvChunks(
        { rowCount: 0, columnCount: 1, fetchPage },
        {
          includeBom,
          signal: controller.signal,
          onProgress: () => controller.abort(),
        },
      );
      await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetchPage).not.toHaveBeenCalled();
    },
  );

  it.each(['empty', 'known', 'unknown'])(
    'honors cancellation after the final chunk for %s totals',
    async (mode) => {
      const controller = new AbortController();
      const fetchPage = vi.fn(async () => ({ rows: [[1]] }));
      const iterator = iterateReportCsvChunks(
        {
          columnCount: 1,
          fetchPage,
          ...(mode === 'unknown' ? {} : { rowCount: mode === 'empty' ? 0 : 1 }),
        },
        { signal: controller.signal },
      );
      expect((await iterator.next()).done).toBe(false);
      controller.abort();
      await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetchPage).toHaveBeenCalledTimes(mode === 'empty' ? 0 : 1);
    },
  );

  it('rejects a cancelled stream read after receiving its last bytes', async () => {
    const controller = new AbortController();
    const reader = reportDataCsvReadableStream(arrayDataSource([[1]]), {
      signal: controller.signal,
    }).getReader();
    expect((await reader.read()).done).toBe(false);
    controller.abort();
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('isolates validated page values while yielding chunks to consumers', async () => {
    const rows = Array.from({ length: 40 }, (_, index) => [String(index), 'x'.repeat(32767)]);
    const original = rows.map((row) => [...row]);
    const page = { rows, totalRows: 40 };
    const source = { columnCount: 2, rowCount: 40, fetchPage: vi.fn(async () => page) };
    const iterator = iterateReportCsvChunks(source, { pageSize: 40 });
    const first = await iterator.next();
    expect(first.done).toBe(false);
    // The producer reuses its buffers after the consumer receives the first chunk.
    rows[20][0] = 'changed';
    rows[21].push('unexpected column');
    rows[22][1] = NaN as never;
    rows.splice(23);
    page.totalRows = 23;
    let result = first.value as string;
    for await (const chunk of iterator) result += chunk;
    expect(parseCsv(result)).toEqual(original);
    expect(source.fetchPage).toHaveBeenCalledOnce();
    // Export must not freeze or mutate the source's own buffers.
    expect(rows[20][0]).toBe('changed');
    expect(Object.isFrozen(rows)).toBe(false);
  });

  it('captures each new page at arrival without copying or loading the whole source', async () => {
    const reused = { rows: [[0]], totalRows: 3 };
    const fetchPage = vi.fn(async (offset: number) => {
      reused.rows[0][0] = offset;
      return reused;
    });
    const text = await collect({ rowCount: 3, columnCount: 1, fetchPage }, { pageSize: 1 });
    expect(parseCsv(text)).toEqual([['0'], ['1'], ['2']]);
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 1, 2]);
  });
});

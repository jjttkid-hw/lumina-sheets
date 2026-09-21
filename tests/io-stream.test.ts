import { describe, expect, it, vi } from 'vitest';
import { csvToWorkbook, parseCsv } from '../src/lib/io';
import {
  csvField,
  iterateCsvChunks,
  workbookCsvBlob,
  workbookCsvReadableStream,
} from '../src/lib/io-stream';
import { createDemoWorkbook } from '../src/lib/seed';

async function readChunks(iterator: AsyncGenerator<string, unknown, void>): Promise<string> {
  let output = '';
  for await (const chunk of iterator) output += chunk;
  return output;
}

describe('streaming CSV export', () => {
  it('evaluates formulas row by row without building a matrix', async () => {
    const workbook = createDemoWorkbook();
    const sheet = workbook.sheets[0];
    const result = await readChunks(iterateCsvChunks(sheet, workbook, { chunkRows: 2 }));
    const rows = parseCsv(result);
    expect(rows[0]).toEqual([
      '月份',
      '产品线',
      '负责人',
      '营收（元）',
      '成本（元）',
      '利润（元）',
      '利润率',
      '完成率',
      '状态',
      '备注',
    ]);
    expect(rows[1][5]).toBe('78000');
    expect(Number(rows[1][6])).toBeCloseTo(0.4193548387096774, 14);
    expect(result.startsWith('\uFEFF')).toBe(true);
  });

  it('supports safe escaping, custom delimiters, progress and readable streams', async () => {
    expect(csvField('=SUM(A1)', ',')).toBe("'=SUM(A1)");
    expect(csvField('a;b', ';')).toBe('"a;b"');
    const workbook = csvToWorkbook('名称,值\n正常,1\n第二,2');
    const progress: number[] = [];
    const text = await readChunks(
      iterateCsvChunks(workbook.sheets[0], workbook, {
        chunkRows: 1,
        onProgress: (done) => progress.push(done),
      }),
    );
    expect(progress).toEqual([1, 2, 3]);
    expect(parseCsv(text)).toEqual([
      ['名称', '值'],
      ['正常', '1'],
      ['第二', '2'],
    ]);

    const stream = workbookCsvReadableStream(workbook, { chunkRows: 1 });
    const streamed = await new Response(stream).text();
    expect(parseCsv(streamed)).toEqual(parseCsv(text));
    expect(await workbookCsvBlob(workbook, { chunkRows: 2 })).toBeInstanceOf(Blob);
  });

  it('stops promptly when an AbortSignal is cancelled', async () => {
    const workbook = createDemoWorkbook();
    const controller = new AbortController();
    let progress = 0;
    const iterator = iterateCsvChunks(workbook.sheets[0], workbook, {
      chunkRows: 1,
      signal: controller.signal,
      onProgress: () => {
        progress++;
        if (progress === 1) controller.abort();
      },
    });
    await expect(readChunks(iterator)).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).toBe(1);
  });
  it('does not emit a final chunk after progress cancels the last row', async () => {
    const workbook = csvToWorkbook('one');
    const controller = new AbortController();
    const iterator = iterateCsvChunks(workbook.sheets[0], workbook, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects an already cancelled empty export without emitting a BOM', async () => {
    const workbook = csvToWorkbook('');
    const controller = new AbortController();
    controller.abort();
    await expect(workbookCsvBlob(workbook, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it.each([NaN, Infinity, 0, -1, 1.5])(
    'rejects invalid chunkRows %s before reading cells',
    async (chunkRows) => {
      const workbook = csvToWorkbook('one');
      workbook.sheets[0].cells = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('scanned');
          },
        },
      );
      await expect(
        iterateCsvChunks(workbook.sheets[0], workbook, { chunkRows }).next(),
      ).rejects.toThrow('分块');
    },
  );

  it.each(['"', '\n', '\r', ''])('rejects ambiguous delimiter %j', async (delimiter) => {
    const workbook = csvToWorkbook('one');
    await expect(workbookCsvBlob(workbook, { delimiter })).rejects.toThrow('分隔符');
  });

  it('starts no work before stream demand, including cancellation without a reader', async () => {
    const workbook = csvToWorkbook('one');
    const progress = vi.fn();
    const stream = workbookCsvReadableStream(workbook, { onProgress: progress });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(progress).not.toHaveBeenCalled();
    await stream.cancel();
    expect(progress).not.toHaveBeenCalled();
  });

  it('bounds text chunks at row boundaries even with a large requested row count', async () => {
    const workbook = csvToWorkbook(Array(30).fill('中'.repeat(10000)).join('\n'));
    const chunks: string[] = [];
    for await (const chunk of iterateCsvChunks(workbook.sheets[0], workbook, { chunkRows: 100000 }))
      chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(1);
    // UTF-16 text budget plus at most one complete row and BOM.
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(
      256 * 1024 + 10003,
    );
    expect(parseCsv(chunks.join(''))).toHaveLength(30);
  });
  it('observes timer cancellation during a large requested chunk', async () => {
    const workbook = csvToWorkbook(Array(100).fill('1').join('\n'));
    const abort = new AbortController();
    let progress = 0;
    const iterator = iterateCsvChunks(workbook.sheets[0], workbook, {
      chunkRows: 100000,
      signal: abort.signal,
      onProgress: () => {
        if (++progress === 1) setTimeout(() => abort.abort(), 0);
      },
    });
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).toBeLessThan(100);
  });

  it('rejects cancellation after the final yield before reporting completion', async () => {
    const workbook = csvToWorkbook('one');
    const abort = new AbortController();
    const iterator = iterateCsvChunks(workbook.sheets[0], workbook, { signal: abort.signal });
    expect((await iterator.next()).done).toBe(false);
    abort.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops a pending read on stream cancellation and detaches the external listener', async () => {
    const workbook = csvToWorkbook(Array(100).fill('1').join('\n'));
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    let progress = 0;
    const stream = workbookCsvReadableStream(workbook, {
      chunkRows: 100000,
      signal: abort.signal,
      onProgress: () => progress++,
    });
    const reader = stream.getReader();
    const pending = reader.read();
    await Promise.resolve();
    await reader.cancel();
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(progress).toBeLessThan(100);
    expect(remove).toHaveBeenCalledOnce();
  });

  it.each(['complete', 'error'])('detaches external abort listeners on %s', async (mode) => {
    const workbook = csvToWorkbook('one');
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const result = workbookCsvBlob(workbook, {
      signal: abort.signal,
      ...(mode === 'error' ? { lineEnding: 'bad' as never } : {}),
    });
    if (mode === 'complete') await expect(result).resolves.toBeInstanceOf(Blob);
    else await expect(result).rejects.toThrow('行分隔符');
    expect(remove).toHaveBeenCalledOnce();
  });
});

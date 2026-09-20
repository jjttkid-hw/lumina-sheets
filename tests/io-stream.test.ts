import { describe, expect, it } from 'vitest';
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
});

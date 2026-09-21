import { describe, expect, it, vi } from 'vitest';
import { iterateReportCsvChunks, reportDataCsvReadableStream } from '../src/lib/report-data-export';
import { parseCsv } from '../src/lib/io';

describe('paged CSV wide-row serialization', () => {
  it('preserves Unicode and formula-injection protection across actual encoded stream chunks', async () => {
    const row = Array.from({ length: 32 }, () => '=😀"'.repeat(6000));
    const stream = reportDataCsvReadableStream({
      columnCount: row.length,
      rowCount: 1,
      fetchPage: async () => ({ rows: [row] }),
    });
    const text = await new Response(stream).text();
    expect(text.includes('\uFFFD')).toBe(false);
    expect(parseCsv(text)).toEqual([row.map((value) => "'" + value)]);
  });
  it.each([',', ';'])(
    'bounds chunks inside a wide row and preserves escaping with %s',
    async (delimiter) => {
      const long = '"😀,;\n'.repeat(5000);
      const row = Array.from({ length: 64 }, (_, i) => (i % 2 ? long : `column ${i}`));
      const source = {
        columnCount: row.length + 2,
        rowCount: 1,
        fetchPage: async () => ({ rows: [row] }),
      };
      const chunks: string[] = [];
      for await (const chunk of iterateReportCsvChunks(source, { delimiter })) chunks.push(chunk);
      expect(chunks.length).toBeGreaterThan(1);
      // A chunk may exceed the 256 Ki threshold by at most one escaped field
      // (quotes can double all 32,767 UTF-16 units) plus its delimiter.
      expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(
        256 * 1024 + 2 * 32767 + 3,
      );
      const text = chunks.join('');
      expect(parseCsv(text, delimiter)).toEqual([[...row, '', '']]);
      expect(text.match(/\uFEFF/g)).toHaveLength(1);
    },
  );

  it('cancels after receiving part of one row without reporting that row complete', async () => {
    const abort = new AbortController();
    const onProgress = vi.fn();
    const fetchPage = vi.fn(async () => ({ rows: [Array(64).fill('x'.repeat(32767))] }));
    const iterator = iterateReportCsvChunks(
      { columnCount: 64, rowCount: 1, fetchPage },
      { signal: abort.signal, onProgress },
    );
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(String(first.value).includes('\r\n')).toBe(false);
    abort.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(onProgress).not.toHaveBeenCalled();
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it('lets a scheduled cancel interrupt a wide row even below the chunk size threshold', async () => {
    const abort = new AbortController();
    const onProgress = vi.fn();
    const iterator = iterateReportCsvChunks(
      {
        columnCount: 16384,
        rowCount: 1,
        fetchPage: async () => {
          setTimeout(() => abort.abort(), 0);
          return { rows: [[]] };
        },
      },
      { signal: abort.signal, onProgress },
    );
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(onProgress).not.toHaveBeenCalled();
  });
});

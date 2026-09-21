import { describe, expect, it, vi } from 'vitest';
import { cellKey } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import { parseCsv } from '../src/lib/io';
import { iterateCsvChunks, workbookCsvReadableStream } from '../src/lib/io-stream';

function wideBook() {
  const book = createBlankWorkbook();
  const sheet = book.sheets[0];
  sheet.cells = {};
  const text = '😀";\n'.repeat(5000);
  for (let col = 0; col < 64; col++) sheet.cells[cellKey(0, col)] = { value: text };
  sheet.cells.A2 = { value: '=1+2' };
  sheet.cells.B2 = { value: false };
  return { book, sheet, text };
}

describe('static CSV wide-row serialization', () => {
  it('splits a wide row while preserving formulas, escaping, Unicode and trailing empty fields', async () => {
    const { book, sheet, text } = wideBook();
    const chunks: string[] = [];
    const progress: number[] = [];
    const iterator = iterateCsvChunks(sheet, book, {
      delimiter: ';',
      chunkRows: 1,
      onProgress: (done) => progress.push(done),
    });
    for await (const chunk of iterator) chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(2);
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThan(330_000);
    expect(progress).toEqual([1, 2]);
    const expected = [Array(64).fill(text), ['3', 'FALSE', ...Array(62).fill('')]];
    expect(parseCsv(chunks.join(''), ';')).toEqual(expected);
    const encoded = await new Response(workbookCsvReadableStream(book, { delimiter: ';' })).text();
    expect(encoded.includes('\uFFFD')).toBe(false);
    expect(parseCsv(encoded, ';')).toEqual(expected);
  });

  it('cancels before the first wide row is complete and never reports its progress', async () => {
    const { book, sheet } = wideBook();
    const abort = new AbortController();
    const onProgress = vi.fn();
    const iterator = iterateCsvChunks(sheet, book, { signal: abort.signal, onProgress });
    expect((await iterator.next()).done).toBe(false);
    abort.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('services scheduled cancellation within a sparse row below the text threshold', async () => {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    sheet.cells = { XFD1: { value: '' } };
    const abort = new AbortController();
    const onProgress = vi.fn();
    setTimeout(() => abort.abort(), 0);
    const iterator = iterateCsvChunks(sheet, book, { signal: abort.signal, onProgress });
    const result = await iterator.next().then(
      () => 'unexpected success',
      (error: Error) => error.name,
    );
    expect(result).toBe('AbortError');
    expect(onProgress).not.toHaveBeenCalled();
  });
});

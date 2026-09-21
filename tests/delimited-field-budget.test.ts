import { afterEach, expect, it, vi } from 'vitest';
import { importFile, parseCsv } from '../src/lib/io';

afterEach(() => vi.restoreAllMocks());
it.each(['plain', 'quoted', 'escaped'])(
  'stops accumulating an oversized %s field before scanning the rest of the file',
  async (kind) => {
    const text =
      kind === 'plain'
        ? 'x'.repeat(100000)
        : kind === 'quoted'
          ? '"' + 'x'.repeat(100000) + '"'
          : '"' + '""'.repeat(100000) + '"';
    const turns = vi.spyOn(globalThis, 'setTimeout');
    await expect(importFile(new File([text], 'large.tsv'))).rejects.toThrow('单元格内容过长');
    // TSV skips auto-detection; failure must occur within the first two scan checkpoints.
    expect(turns.mock.calls.length).toBeLessThanOrEqual(2);
  },
);
it('counts decoded escaped quotes and UTF-16 units at the exact field limit', async () => {
  const value = '"'.repeat(32765) + '😀';
  const text = '"' + value.replaceAll('"', '""') + '"';
  expect(parseCsv(text, '\t')).toEqual([[value]]);
  expect((await importFile(new File([text], 'limit.tsv'))).sheets[0].cells.A1.value).toBe(value);
  expect(() => parseCsv('"' + value.replaceAll('"', '""') + 'x"', '\t')).toThrow('单元格内容过长');
});
it('rejects an oversized unterminated field at capacity before end-of-file', () => {
  expect(() => parseCsv('"' + 'x'.repeat(32768), '\t')).toThrow('单元格内容过长');
  expect(() => parseCsv('"short', '\t')).toThrow('未闭合');
});

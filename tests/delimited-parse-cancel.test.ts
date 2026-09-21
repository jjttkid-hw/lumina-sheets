import { afterEach, expect, it, vi } from 'vitest';
import { importFile, csvToWorkbook } from '../src/lib/io';
import * as engine from '../src/lib/engine';

afterEach(() => vi.restoreAllMocks());
it('constructs completed rows before later parsing checkpoints and discards cancelled work', async () => {
  const controller = new AbortController();
  const cellKey = engine.cellKey;
  let built = 0;
  vi.spyOn(engine, 'cellKey').mockImplementation((row, col) => {
    if (++built === 1) setTimeout(() => controller.abort(), 0);
    return cellKey(row, col);
  });
  const text = Array(20000).fill('value,42').join('\n');
  await expect(importFile(new File([text], 'rows.csv'), controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(built).toBeGreaterThan(0);
  expect(built).toBeLessThan(40000);
});
it('rejects a wide completed row before processing the remaining file', async () => {
  const key = vi.spyOn(engine, 'cellKey');
  const text = Array(257).fill('x').join(',') + '\n' + Array(9000).fill('later').join('\n');
  await expect(importFile(new File([text], 'wide.csv'))).rejects.toThrow('256 列');
  expect(key).not.toHaveBeenCalled();
});
it('allows cancellation while detecting the delimiter in a long quoted header', async () => {
  const controller = new AbortController();
  const decode = TextDecoder.prototype.decode;
  vi.spyOn(TextDecoder.prototype, 'decode').mockImplementation(function (
    this: TextDecoder,
    ...args
  ) {
    const result = decode.apply(this, args);
    setTimeout(() => controller.abort(), 0);
    return result;
  });
  const text = '"' + 'x'.repeat(500000) + '"\tend';
  await expect(importFile(new File([text], 'header.csv'), controller.signal)).rejects.toMatchObject(
    { name: 'AbortError' },
  );
});
it.each(['csv', 'tsv'])(
  'allows cancellation after %s decoding and before long parsing completes',
  async (ext) => {
    const controller = new AbortController();
    const decode = TextDecoder.prototype.decode;
    vi.spyOn(TextDecoder.prototype, 'decode').mockImplementation(function (
      this: TextDecoder,
      ...args
    ) {
      const result = decode.apply(this, args);
      setTimeout(() => controller.abort(), 0);
      return result;
    });
    await expect(
      importFile(
        new File([Array(20000).fill('text,1').join('\n')], `large.${ext}`),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  },
);
it('keeps quotes, escaped quotes, newlines and numeric text identical across yield boundaries', async () => {
  const values = ['"' + 'x'.repeat(32760) + '\n😀"', '"quote ""one"""', '00123', '1e-999', '42'];
  const text = '\uFEFF' + Array(6).fill(values.join(',')).join('\r\n') + '\r\n,,,,';
  const sync = csvToWorkbook(text);
  const asyncBook = await importFile(new File([text], 'boundary.csv'));
  expect(asyncBook.sheets[0].cells).toEqual(sync.sheets[0].cells);
  expect(asyncBook.sheets[0].rowCount).toBe(sync.sheets[0].rowCount);
  expect(asyncBook.sheets[0].colCount).toBe(sync.sheets[0].colCount);
});
it('keeps errors after a parsing yield explicit and allows retry', async () => {
  const prefix = Array(9000).fill('a,1').join('\n');
  await expect(importFile(new File([prefix + '\n"unterminated'], 'bad.csv'))).rejects.toThrow(
    '未闭合',
  );
  expect((await importFile(new File(['中文\t00123'], 'retry.tsv'))).sheets[0].cells.B1.value).toBe(
    '00123',
  );
});

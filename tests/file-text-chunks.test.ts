import { afterEach, expect, it, vi } from 'vitest';
import { readUtf8File } from '../src/lib/file-text';
import { importFile } from '../src/lib/io';

afterEach(() => vi.restoreAllMocks());
it.each(['中', '😀', '�'])(
  'preserves %s and BOM handling across the byte boundary',
  async (value) => {
    const text = '\uFEFF' + 'x'.repeat(256 * 1024 - 4) + value + '\uFEFFtail';
    expect(await readUtf8File(new File([text], 'boundary.txt'))).toBe(text.slice(1));
  },
);
it.each([new Uint8Array([0xe4, 0xb8]), new Uint8Array([0xe4, 0x41])])(
  'rejects incomplete or invalid multibyte text across the chunk boundary',
  async (bytes) => {
    const file = new File(['x'.repeat(256 * 1024 - 1), bytes], 'bad.txt');
    await expect(readUtf8File(file)).rejects.toThrow('UTF-8');
  },
);
it('yields during decoding and cancels before parsing a large JSON file', async () => {
  const controller = new AbortController();
  const original = TextDecoder.prototype.decode;
  let bytesRead = 0;
  vi.spyOn(TextDecoder.prototype, 'decode').mockImplementation(function (
    this: TextDecoder,
    input,
    options,
  ) {
    bytesRead += input?.byteLength ?? 0;
    if (bytesRead === 256 * 1024) setTimeout(() => controller.abort(), 0);
    return original.call(this, input, options);
  });
  const parse = vi.spyOn(JSON, 'parse');
  const file = new File(['{"text":"', 'x'.repeat(2 * 1024 * 1024), '"}'], 'large.json');
  await expect(importFile(file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(bytesRead).toBe(256 * 1024);
  expect(parse).not.toHaveBeenCalled();
});
it('keeps empty input and decoder errors distinct from cancellation', async () => {
  expect(await readUtf8File(new File([], 'empty.txt'))).toBe('');
  const controller = new AbortController();
  vi.spyOn(TextDecoder.prototype, 'decode').mockImplementation(() => {
    controller.abort();
    return '';
  });
  await expect(
    readUtf8File(new File(['value'], 'cancel.txt'), controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

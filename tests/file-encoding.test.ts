import { describe, expect, it, vi } from 'vitest';
import { importFile, IMPORT_LIMITS } from '../src/lib/io';
import { createBlankWorkbook } from '../src/lib/seed';

function textFile(ext: string, bytes: Uint8Array): File {
  if (ext !== 'json') return new File([bytes as BlobPart], `text.${ext}`);
  const book = createBlankWorkbook();
  book.sheets[0].cells.A1 = { value: 'ENCODING_FIXTURE' };
  const [prefix, suffix] = JSON.stringify(book).split('ENCODING_FIXTURE');
  return new File([prefix, bytes as BlobPart, suffix], 'text.json');
}

describe('text file byte integrity', () => {
  it.each(['csv', 'tsv', 'json', 'xlsx'])(
    'stops waiting for %s bytes and skips late decoding after cancellation',
    async (ext) => {
      const controller = new AbortController();
      const file = new File(['pending'], `slow.${ext}`);
      let finish!: (bytes: ArrayBuffer) => void;
      vi.spyOn(file, 'arrayBuffer').mockReturnValue(
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
      );
      const decode = vi.spyOn(TextDecoder.prototype, 'decode');
      try {
        const pending = importFile(file, controller.signal).catch((error) => error);
        controller.abort();
        for (let i = 0; i < 10; i++) await Promise.resolve();
        const result = await Promise.race([pending, Promise.resolve('still waiting')]);
        expect(result).toMatchObject({ name: 'AbortError' });
        finish(new TextEncoder().encode('late').buffer);
        for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(decode).not.toHaveBeenCalled();
      } finally {
        decode.mockRestore();
      }
    },
  );
  it('does not start reading an already cancelled file', async () => {
    const file = new File(['1'], 'cancelled.csv');
    const read = vi.spyOn(file, 'arrayBuffer');
    const controller = new AbortController();
    controller.abort();
    await expect(importFile(file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled();
  });
  it.each(['csv', 'tsv', 'json'])('rejects malformed UTF-8 inside %s text', async (ext) => {
    for (const bytes of [
      [0xff],
      [0x80],
      [0xc0, 0xaf],
      [0xe2, 0x28, 0xa1],
      [0xed, 0xa0, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
      [0xe4, 0xb8],
    ]) {
      await expect(importFile(textFile(ext, new Uint8Array(bytes)))).rejects.toThrow('UTF-8');
    }
  });

  it.each(['csv', 'tsv', 'json'])('keeps valid Unicode and an optional %s BOM', async (ext) => {
    const value = '中文😀�';
    const file = textFile(ext, new TextEncoder().encode(value));
    for (const withBom of [false, true]) {
      const incoming = withBom ? new File(['\uFEFF', file], file.name) : file;
      const book = await importFile(incoming);
      expect(book.sheets[0].cells.A1.value).toBe(value);
    }
  });

  it('does not mislabel file read failures as encoding errors', async () => {
    const file = new File(['value'], 'unreadable.csv');
    const error = new Error('disk read failed');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(error);
    await expect(importFile(file)).rejects.toBe(error);
  });

  it('rejects oversized files before reading their bytes', async () => {
    const file = new File([new Uint8Array(IMPORT_LIMITS.bytes + 1)], 'large.csv');
    const read = vi.spyOn(file, 'arrayBuffer');
    await expect(importFile(file)).rejects.toThrow('20 MB');
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps JSON syntax errors distinct from encoding errors', async () => {
    await expect(importFile(new File(['{"broken"'], 'invalid.json'))).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });
});

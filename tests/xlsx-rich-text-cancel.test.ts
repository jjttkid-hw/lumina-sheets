import { afterEach, expect, it, vi } from 'vitest';
import Excel from 'exceljs';
import { SaxesParser } from 'saxes';
import { readXlsxArchive, xmlChild, xmlElement } from '../src/lib/xlsx-archive';
import { readXlsxRichText } from '../src/lib/xlsx-rich-text';
import { importFile } from '../src/lib/io';

afterEach(() => vi.restoreAllMocks());
async function archive() {
  const book = new Excel.Workbook();
  book.addWorksheet('Data').getCell('A1').value = {
    richText: [{ text: '中文😀', font: { bold: true } }],
  };
  return readXlsxArchive((await book.xlsx.writeBuffer()) as ArrayBuffer);
}
it('does not read shared strings after cancellation', async () => {
  const source = await archive();
  const read = vi.spyOn(source.zip, 'file');
  const controller = new AbortController();
  controller.abort();
  await expect(readXlsxRichText(source, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(read).not.toHaveBeenCalled();
});
it('stops waiting for shared text and never parses a late result', async () => {
  const source = await archive();
  const file = source.zip.file('xl/sharedStrings.xml')!;
  let finish!: (text: string) => void;
  vi.spyOn(file, 'async').mockReturnValue(new Promise<string>((resolve) => (finish = resolve)));
  const write = vi.spyOn(SaxesParser.prototype, 'write');
  const controller = new AbortController();
  const pending = readXlsxRichText(source, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  finish('<sst/>');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(write).not.toHaveBeenCalled();
});
it('yields while reparsing a large shared string table so cancellation can stop it', async () => {
  const source = await archive();
  source.zip.file(
    'xl/sharedStrings.xml',
    '<sst><si><t>' + 'x'.repeat(512 * 1024) + '</t></si></sst>',
  );
  const controller = new AbortController();
  const original = SaxesParser.prototype.write;
  let writes = 0;
  vi.spyOn(SaxesParser.prototype, 'write').mockImplementation(function (this: SaxesParser, text) {
    writes++;
    if (writes === 1) setTimeout(() => controller.abort(), 0);
    return original.call(this, text);
  });
  await expect(readXlsxRichText(source, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(writes).toBe(1);
});
it('keeps normal rich strings unchanged with a live signal', async () => {
  const result = await readXlsxRichText(await archive(), new AbortController().signal);
  expect(result.get('Data')!.get('A1')).toEqual([{ text: '中文😀', style: { bold: true } }]);
});
async function repeatedSource(text = '中文😀') {
  const source = await archive();
  source.zip.remove('xl/sharedStrings.xml');
  xmlChild(source.sheets[0].xml, 'sheetData')!.children = Array.from({ length: 1200 }, (_, i) =>
    xmlElement('row', { r: String(i + 1) }, [
      xmlElement('c', { r: `A${i + 1}`, t: 'inlineStr' }, [
        xmlElement('is', {}, [xmlElement('r', {}, [xmlElement('t', {}, [text])])]),
      ]),
    ]),
  );
  return source;
}
it.each(['中文😀', 'x'.repeat(32767)])(
  'allows scheduled cancellation during cell extraction (%#)',
  async (text) => {
    const source = await repeatedSource(text);
    const controller = new AbortController();
    const clone = structuredClone;
    let copies = 0;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value) => {
      copies++;
      if (copies === 1) setTimeout(() => controller.abort(), 0);
      return clone(value);
    });
    await expect(readXlsxRichText(source, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(copies).toBeGreaterThan(0);
    expect(copies).toBeLessThan(1200);
  },
);
it('keeps every rich cell and independent runs across extraction yields', async () => {
  const source = await repeatedSource();
  let timerRan = false;
  setTimeout(() => {
    timerRan = true;
  }, 0);
  const result = await readXlsxRichText(source);
  expect(timerRan).toBe(true);
  const cells = result.get('Data')!;
  expect(cells.size).toBe(1200);
  expect(cells.get('A1200')).toEqual([{ text: '中文😀' }]);
  cells.get('A1')![0].text = 'changed';
  expect(cells.get('A2')).toEqual([{ text: '中文😀' }]);
});
it('passes file cancellation into the second shared-string parse before ExcelJS loading', async () => {
  const source = await archive();
  const shared = await source.zip.file('xl/sharedStrings.xml')!.async('string');
  source.zip.file(
    'xl/sharedStrings.xml',
    shared.replace('</sst>', '<!--' + 'x'.repeat(300 * 1024) + '--></sst>'),
  );
  const bytes = await source.zip.generateAsync({ type: 'arraybuffer' });
  const controller = new AbortController();
  const original = SaxesParser.prototype.write;
  let sharedParses = 0;
  vi.spyOn(SaxesParser.prototype, 'write').mockImplementation(function (this: SaxesParser, text) {
    if (typeof text === 'string' && text.includes('<sst ')) {
      sharedParses++;
      if (sharedParses === 2) setTimeout(() => controller.abort(), 0);
    }
    return original.call(this, text);
  });
  const load = vi.spyOn(Object.getPrototypeOf(new Excel.Workbook().xlsx), 'load');
  await expect(
    importFile(new File([bytes], 'shared.xlsx'), controller.signal),
  ).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(sharedParses).toBe(2);
  expect(load).not.toHaveBeenCalled();
});

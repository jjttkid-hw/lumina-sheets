import { afterEach, expect, it, vi } from 'vitest';
import { SaxesParser } from 'saxes';
import Excel from 'exceljs';
import JSZip from 'jszip';
import { importFile } from '../src/lib/io';
import { parseXlsxXml, parseXlsxXmlAsync, xmlText } from '../src/lib/xlsx-archive';

afterEach(() => vi.restoreAllMocks());
it('cancels a real XLSX during XML parsing before ExcelJS decoding starts', async () => {
  const book = new Excel.Workbook();
  book.addWorksheet('Data').getCell('A1').value = 'original';
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  zip.file('large.xml', '<large>' + 'x'.repeat(512 * 1024) + '</large>');
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  const controller = new AbortController();
  const original = SaxesParser.prototype.write;
  let largeWrites = 0;
  vi.spyOn(SaxesParser.prototype, 'write').mockImplementation(function (this: SaxesParser, text) {
    if (typeof text === 'string' && text.startsWith('<large>')) {
      largeWrites++;
      setTimeout(() => controller.abort(), 0);
    }
    return original.call(this, text);
  });
  const load = vi.spyOn(Object.getPrototypeOf(new Excel.Workbook().xlsx), 'load');
  await expect(
    importFile(new File([bytes], 'large.xlsx'), controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(largeWrites).toBe(1);
  expect(load).not.toHaveBeenCalled();
});
it('preserves XML tokens, namespaces and Unicode split across parsing chunks', async () => {
  for (const token of ['😀', '&amp;', '<![CDATA[中文😀]]>', '<x:t xmlns:x="urn:test">值</x:t>']) {
    const prefix = '<root>' + 'x'.repeat(128 * 1024 - 7);
    const source = prefix + token + '</root>';
    const actual = await parseXlsxXmlAsync(source);
    expect(actual).toEqual(parseXlsxXml(source));
    expect(xmlText(actual)).toBe(xmlText(parseXlsxXml(source)));
  }
});
it('gives scheduled cancellation a turn before parsing the rest of a large XML part', async () => {
  const controller = new AbortController();
  const original = SaxesParser.prototype.write;
  let writes = 0;
  vi.spyOn(SaxesParser.prototype, 'write').mockImplementation(function (this: SaxesParser, text) {
    writes++;
    if (writes === 1) setTimeout(() => controller.abort(), 0);
    return original.call(this, text);
  });
  const source = '<root>' + 'x'.repeat(1024 * 1024) + '</root>';
  await expect(parseXlsxXmlAsync(source, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(writes).toBe(1);
});
it('does not parse already cancelled input', async () => {
  const controller = new AbortController();
  controller.abort();
  const write = vi.spyOn(SaxesParser.prototype, 'write');
  await expect(parseXlsxXmlAsync('<root/>', controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(write).not.toHaveBeenCalled();
});
it.each([
  '<!DOCTYPE root><root/>',
  '<root><x></root>',
  '<root><?instruction bad?></root>',
  '<x>'.repeat(65) + '</x>'.repeat(65),
  '',
])('retains strict rejection for %s', async (source) => {
  expect(() => parseXlsxXml(source)).toThrow();
  await expect(parseXlsxXmlAsync(source)).rejects.toThrow();
});

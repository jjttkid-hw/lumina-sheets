import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { encodeXlsxString, decodeXlsxString } from '../src/lib/xlsx-string';
import { createBlankWorkbook } from '../src/lib/seed';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import {
  readXlsxArchive,
  writeXlsxArchive,
  xmlChild,
  xmlChildren,
  xmlElement,
  serializeXml,
  parseXlsxXml,
  xmlText,
} from '../src/lib/xlsx-archive';

describe('XLSX rich text encoding', () => {
  it('encodes known OOXML vectors and preserves every UTF-16 unit in a single pass', () => {
    expect(encodeXlsxString('_x0041_\r\u0000')).toBe('_x005F_x0041__x000D__x0000_');
    expect(decodeXlsxString('_x005F_x0041__x000D__x0000_')).toBe('_x0041_\r\u0000');
    expect(decodeXlsxString('_x005F_x005F_x005F_x0041_')).toBe('_x005F_x0041_');
    const units = Array.from({ length: 65536 }, (_, index) => String.fromCharCode(index)).join('');
    expect(decodeXlsxString(encodeXlsxString(units))).toBe(units);
    const encoded = encodeXlsxString(units);
    expect(xmlText(parseXlsxXml(serializeXml(xmlElement('t', {}, [encoded]))))).toBe(encoded);
  });
  it('preserves CR from numeric XML character references during archive reserialization', () => {
    const xml = '<t xml:space="preserve">a&#13;\nb&#13;c</t>';
    const parsed = parseXlsxXml(xml);
    expect(xmlText(parsed)).toBe('a\r\nb\rc');
    expect(xmlText(parseXlsxXml(serializeXml(parsed)))).toBe('a\r\nb\rc');
  });
  it('preserves escaped rich hyperlink labels, font names and source immutability', async () => {
    const book = createBlankWorkbook();
    const text = '_x0041_\r\n\u0001';
    const cell = {
      value: text,
      richText: [{ text, style: { fontFamily: 'Font_x0041_' } }],
      hyperlink: { target: 'https://example.com', tooltip: 'source' },
    };
    book.sheets[0].cells.A1 = cell;
    const before = structuredClone(book);
    const bytes = await workbookToXlsx(book);
    const first = await workbookFromXlsx(bytes);
    expect(first.sheets[0].cells.A1).toEqual(cell);
    const second = await workbookFromXlsx(await workbookToXlsx(first));
    expect(second.sheets[0].cells.A1).toEqual(cell);
    expect(book).toEqual(before);
  });
  it('decodes original shared rich strings once while retaining empty runs', async () => {
    const excel = new ExcelJS.Workbook();
    excel.addWorksheet('Shared').getCell('A1').value = {
      richText: [
        { text: 'placeholder', font: { bold: true } },
        { text: '', font: { italic: true } },
      ],
    };
    const archive = await readXlsxArchive(new Uint8Array(await excel.xlsx.writeBuffer()).buffer);
    const file = archive.zip.file('xl/sharedStrings.xml')!;
    archive.zip.file(
      'xl/sharedStrings.xml',
      (await file.async('string')).replace('placeholder', '_x005F_x0041_|_x000D_|_x0001_'),
    );
    const book = await workbookFromXlsx(await writeXlsxArchive(archive));
    expect(book.sheets[0].cells.A1).toEqual({
      value: '_x0041_|\r|\u0001',
      richText: [
        { text: '_x0041_|\r|\u0001', style: { bold: true } },
        { text: '', style: { italic: true } },
      ],
    });
  });
  it('decodes complete tokens formed across XML text/CDATA boundaries', async () => {
    const book = createBlankWorkbook();
    book.sheets[0].cells.A1 = { value: 'placeholder', richText: [{ text: 'placeholder' }] };
    const archive = await readXlsxArchive(await workbookToXlsx(book));
    const file = archive.zip.file(archive.sheets[0].path)!;
    const xml = await file.async('string');
    const zip = archive.zip;
    zip.file(archive.sheets[0].path, xml.replace('placeholder', '_x00<![CDATA[41_]]>'));
    const result = await workbookFromXlsx(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(result.sheets[0].cells.A1.value).toBe('A');
  });
  it.each([
    'a\r\nb\rc\nd',
    '_x0041_ _x005F_ _x000d_ & <>',
    'a\u0000b\u0001c\u000bd',
    '😀\ud800Z\udfff\ufffe\uffff',
  ])('preserves exact UTF-16 text %j through export and two independent readers', async (text) => {
    const book = createBlankWorkbook();
    const cell = { value: text, richText: [{ text, style: { bold: true } }] };
    book.sheets[0].cells.A1 = cell;
    const bytes = await workbookToXlsx(book);
    expect((await workbookFromXlsx(bytes)).sheets[0].cells.A1).toEqual(cell);
    const external = new ExcelJS.Workbook();
    await external.xlsx.load(bytes);
    const raw = external.worksheets[0].getCell('A1').value as ExcelJS.CellRichTextValue;
    expect(raw.richText.map((run) => run.text).join('')).toBe(text);
  });
  it.each([false, true])(
    'preserves ordinary text with hyperlink=%s, including XML controls and escape-shaped literals',
    async (linked) => {
      const text = '_x0041_ _x005F_\r\n\u0000\u007f\ud800\uffff';
      const book = createBlankWorkbook();
      const cell = {
        value: text,
        ...(linked ? { hyperlink: { target: 'https://example.com' } } : {}),
      };
      book.sheets[0].cells.A1 = cell;
      const bytes = await workbookToXlsx(book);
      expect((await workbookFromXlsx(bytes)).sheets[0].cells.A1).toEqual(cell);
      const external = new ExcelJS.Workbook();
      await external.xlsx.load(bytes);
      const raw = external.worksheets[0].getCell('A1').value;
      expect(linked ? (raw as ExcelJS.CellHyperlinkValue).text : raw).toBe(text);
    },
  );
  it('decodes OOXML escape tokens only once', async () => {
    const book = createBlankWorkbook();
    book.sheets[0].cells.A1 = { value: 'template', richText: [{ text: 'template' }] };
    const archive = await readXlsxArchive(await workbookToXlsx(book));
    const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
    const run = xmlChildren(xmlChild(xmlChildren(row, 'c')[0], 'is')!, 'r')[0];
    xmlChild(run, 't')!.children = ['_x005F_x0041_|_x0041_|_x000d_|_xD83D__xDE00_'];
    const result = await workbookFromXlsx(await writeXlsxArchive(archive));
    expect(result.sheets[0].cells.A1.value).toBe('_x0041_|A|\r|😀');
  });
});

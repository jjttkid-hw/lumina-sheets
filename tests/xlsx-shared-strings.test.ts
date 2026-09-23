import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { readXlsxArchive, writeXlsxArchive, xmlChild, xmlChildren } from '../src/lib/xlsx-archive';

async function input(index: string, rich = false) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Strings');
  sheet.getCell('A1').value = 'first';
  sheet.getCell('B1').value = rich
    ? { richText: [{ text: 'second', font: { bold: true } }] }
    : 'second';
  const archive = await readXlsxArchive((await book.xlsx.writeBuffer()) as ArrayBuffer);
  const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
  const cell = xmlChildren(row, 'c')[0];
  expect(cell.attributes.t).toBe('s');
  xmlChild(cell, 'v')!.children = [index];
  return writeXlsxArchive(archive);
}

describe('XLSX shared string index validation', () => {
  it.each(['', ' ', '0x1', '0b1', '1e0', '1.0', '-1', '2', '9007199254740993'])(
    'rejects an invalid shared string reference %j instead of decoding a different value',
    async (index) => {
      await expect(workbookFromXlsx(await input(index))).rejects.toThrow('共享字符串索引');
    },
  );

  it.each(['0', '1', '01', '+1', ' 1 '])(
    'accepts decimal integer reference %j consistently for plain text',
    async (index) => {
      const book = await workbookFromXlsx(await input(index));
      expect(book.sheets[0].cells.A1.value).toBe(Number(index) === 0 ? 'first' : 'second');
    },
  );

  it('keeps shared rich text and its formatting through an XLSX roundtrip', async () => {
    const book = await workbookFromXlsx(await input('+01', true));
    expect(book.sheets[0].cells.A1.value).toBe('second');
    expect(book.sheets[0].cells.A1.richText).toEqual([{ text: 'second', style: { bold: true } }]);
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[0].cells.A1).toEqual(book.sheets[0].cells.A1);
  });
});

// Real WPS saves lowercase hex in ST_Xstring. ExcelJS's decoder only recognizes
// uppercase hex, so ordinary shared/inline text must be canonicalized first.
describe('desktop producer escape spelling', () => {
  it.each(['shared', 'inline', 'hyperlink'] as const)(
    'decodes mixed-case tokens once in %s strings and retains literals on roundtrip',
    async (kind) => {
      const source = new ExcelJS.Workbook();
      const ws = source.addWorksheet('WPS');
      ws.getCell('A1').value =
        kind === 'hyperlink'
          ? { text: 'placeholder', hyperlink: 'https://example.com' }
          : 'placeholder';
      ws.getCell('B1').value = 'placeholder';
      const archive = await readXlsxArchive((await source.xlsx.writeBuffer()) as ArrayBuffer);
      const encoded = '_x005f_x0041_|_x000d_|_x000b_|_xd83d__xde00_|_X0041_|_x005f_x005f_';
      if (kind === 'inline') {
        const { xmlElement } = await import('../src/lib/xlsx-archive');
        const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
        const cell = xmlChildren(row, 'c')[0];
        cell.attributes.t = 'inlineStr';
        cell.children = [xmlElement('is', {}, [xmlElement('t', {}, [encoded])])];
      } else {
        const file = archive.zip.file('xl/sharedStrings.xml')!;
        archive.zip.file(
          'xl/sharedStrings.xml',
          (await file.async('string')).replace('placeholder', encoded),
        );
      }
      const book = await workbookFromXlsx(await writeXlsxArchive(archive));
      const expected = '_x0041_|\r|\u000b|😀|A|_x005f_';
      expect(book.sheets[0].cells.A1.value).toBe(expected);
      if (kind !== 'inline') expect(book.sheets[0].cells.B1.value).toBe(expected);
      if (kind === 'hyperlink')
        expect(book.sheets[0].cells.A1.hyperlink?.target).toBe('https://example.com');
      expect((await workbookFromXlsx(await workbookToXlsx(book))).sheets[0].cells.A1).toEqual(
        book.sheets[0].cells.A1,
      );
    },
  );
});

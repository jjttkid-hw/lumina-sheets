import { expect, it } from 'vitest';
import {
  csvToWorkbook,
  importFile,
  parseCsv,
  workbookFromXlsx,
  workbookToXlsx,
} from '../src/lib/io';
import { workbookCsvBlob } from '../src/lib/io-stream';

it.each(['1,,\r\n,,\r\n,,\r\n', ',\r\n,\r\n', '1\r\n\r\n', '""\r\n', 'a,b,c\r\none\r\n'])(
  'preserves delimited record/column bounds through workbook export (%#)',
  async (text) => {
    const book = csvToWorkbook(text);
    const expected = parseCsv(text);
    const columns = Math.max(...expected.map((row) => row.length));
    const rectangle = expected.map((row) =>
      Array.from({ length: columns }, (_, i) => row[i] ?? ''),
    );
    const exported = await (await workbookCsvBlob(book)).text();
    expect(parseCsv(exported)).toEqual(rectangle);
    // Storage stays sparse; a blank source does not allocate one object per field.
    expect(Object.keys(book.sheets[0].cells).length).toBeLessThanOrEqual(
      expected.flat().filter((value) => value !== '').length + 1,
    );
  },
);

it('preserves TSV trailing rows/columns through XLSX and CSV without exporting the padded canvas', async () => {
  const text = 'code\t\t\n001\t\t\n\t\t\n';
  const book = await importFile(new File([text], 'tail.tsv'));
  const restored = await workbookFromXlsx(await workbookToXlsx(book));
  expect(parseCsv(await (await workbookCsvBlob(restored)).text())).toEqual([
    ['code', '', ''],
    ['001', '', ''],
    ['', '', ''],
  ]);
  expect(Object.keys(book.sheets[0].cells)).toHaveLength(3);
});

it('keeps zero-record input empty and avoids a redundant corner if existing cells establish both axes', async () => {
  const empty = csvToWorkbook('');
  expect(empty.sheets[0].cells).toEqual({});
  expect(await (await workbookCsvBlob(empty)).text()).toBe('');
  const sheet = csvToWorkbook('a,b,c\n1,2,').sheets[0];
  expect(sheet.cells.C2).toBeUndefined();
  expect(Object.keys(sheet.cells)).toHaveLength(5);
});

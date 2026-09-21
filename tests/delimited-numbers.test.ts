import { expect, it } from 'vitest';
import { csvToWorkbook, importFile, workbookFromXlsx, workbookToXlsx } from '../src/lib/io';

it.each([
  '1e-999',
  '-1e-999',
  '3e-324',
  '-3e-324',
  '1e999',
  '-0',
  '-0.00',
  '00123',
  '1234567890123456789',
])('preserves numeric-looking text when conversion would lose its value: %s', async (raw) => {
  expect(csvToWorkbook(raw).sheets[0].cells.A1.value).toBe(raw);
  const tsv = await importFile(new File([raw], 'number.tsv'));
  expect(tsv.sheets[0].cells.A1.value).toBe(raw);
});

it.each([
  ['123.5', 123.5],
  ['-42', -42],
  ['1e3', 1000],
  ['1.20E+3', 1200],
  ['0.1', 0.1],
  ['1e-300', 1e-300],
  ['5e-324', 5e-324],
  ['0e-999', 0],
])('continues importing usable numeric values: %s', (raw, expected) => {
  expect(csvToWorkbook(String(raw)).sheets[0].cells.A1.value).toBe(expected);
});

it('retains rejected numeric coercions as text through XLSX encoding and decoding', async () => {
  const values = ['1e-999', '3e-324', '-0', '00123'];
  const book = csvToWorkbook(values.join(','));
  const restored = await workbookFromXlsx(await workbookToXlsx(book));
  expect(Object.values(restored.sheets[0].cells).map((cell) => cell.value)).toEqual(values);
});

import { afterEach, expect, it, vi } from 'vitest';
import Excel from 'exceljs';
import { readXlsxArchive } from '../src/lib/xlsx-archive';
import { readXlsxRichText } from '../src/lib/xlsx-rich-text';
import { workbookFromXlsx } from '../src/lib/io';

afterEach(() => vi.restoreAllMocks());
async function repeated(runs: Array<{ text: string }>, count: number, sheets = 1) {
  const book = new Excel.Workbook();
  for (let s = 0; s < sheets; s++) {
    const sheet = book.addWorksheet(`Data${s}`);
    for (let r = 1; r <= count; r++) sheet.getCell(r, 1).value = { richText: runs };
  }
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}
it('rejects cumulative shared rich text expansion across worksheets before ExcelJS decoding', async () => {
  const bytes = await repeated([{ text: 'x'.repeat(32767) }], 125, 2);
  expect(bytes.byteLength).toBeLessThan(100000);
  const load = vi.spyOn(Object.getPrototypeOf(new Excel.Workbook().xlsx), 'load');
  await expect(workbookFromXlsx(bytes)).rejects.toThrow('富文本展开');
  expect(load).not.toHaveBeenCalled();
});
it('counts empty runs as objects even when text expansion is small', async () => {
  const bytes = await repeated(
    Array.from({ length: 101 }, () => ({ text: '' })),
    1000,
  );
  const source = await readXlsxArchive(bytes);
  await expect(readXlsxRichText(source)).rejects.toThrow('富文本展开');
});
it('accepts the exact cumulative text budget and keeps shared references isolated', async () => {
  const source = await readXlsxArchive(await repeated([{ text: 'x'.repeat(32000) }], 250));
  const result = (await readXlsxRichText(source)).get('Data0')!;
  expect(result.size).toBe(250);
  expect(result.get('A250')![0].text.length).toBe(32000);
  result.get('A1')![0].text = 'changed';
  expect(result.get('A2')![0].text.length).toBe(32000);
});

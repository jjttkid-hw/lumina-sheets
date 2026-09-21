import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { createBlankWorkbook } from '../src/lib/seed';
import { readXlsxArchive, writeXlsxArchive, xmlElement, xmlChild } from '../src/lib/xlsx-archive';

async function fixture(ranges: string[][]) {
  const source = new ExcelJS.Workbook();
  ranges.forEach((_, i) => {
    source.addWorksheet(`Sheet${i + 1}`).getCell('A1').value = '保留';
  });
  const archive = await readXlsxArchive(
    (await source.xlsx.writeBuffer()) as unknown as ArrayBuffer,
  );
  ranges.forEach((refs, i) => {
    archive.sheets[i].xml.children.push(
      xmlElement(
        'mergeCells',
        {},
        refs.map((ref) => xmlElement('mergeCell', { ref })),
      ),
    );
  });
  return archive;
}
afterEach(() => vi.restoreAllMocks());
async function rejectBeforeDecode(archive: Awaited<ReturnType<typeof fixture>>, message: string) {
  const bytes = await writeXlsxArchive(archive);
  const load = vi
    .spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load')
    .mockRejectedValue(new Error('解码器不应被调用'));
  await expect(workbookFromXlsx(bytes)).rejects.toThrow(message);
  expect(load).not.toHaveBeenCalled();
}

describe('XLSX merge expansion preflight', () => {
  it.each([
    { min: '1', max: '1000000000' },
    { min: '1000000000', max: '1000000000' },
    { min: '0', max: '2' },
    { min: '3', max: '2' },
  ])('bounds visible column expansion before decoding: %j', async (attributes) => {
    const archive = await fixture([[]]);
    archive.sheets[0].xml.children.push(xmlElement('cols', {}, [xmlElement('col', attributes)]));
    await rejectBeforeDecode(archive, 'XLSX 列');
  });
  it('rejects an empty row beyond the import limit before decoding', async () => {
    const archive = await fixture([[]]);
    xmlChild(archive.sheets[0].xml, 'sheetData')!.children.push(xmlElement('row', { r: '100001' }));
    await rejectBeforeDecode(archive, '行');
  });
  it.each(['cols', 'sheetData'])(
    'rejects duplicate %s containers before decoding',
    async (name) => {
      const archive = await fixture([[]]);
      if (name === 'cols') archive.sheets[0].xml.children.push(xmlElement('cols'));
      archive.sheets[0].xml.children.push(xmlElement(name));
      await rejectBeforeDecode(archive, '容器重复');
    },
  );
  it('preserves a valid distant blank column width', async () => {
    const book = createBlankWorkbook();
    book.sheets[0].colCount = 256;
    book.sheets[0].columnWidths = { 255: 140 };
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[0].colCount).toBe(256);
    expect(restored.sheets[0].columnWidths?.[255]).toBe(140);
    expect(restored.sheets[0].cells).toEqual({});
  });
  it('rejects a huge but sparse merge before allocation', async () => {
    await rejectBeforeDecode(await fixture([['A1:IV100000']]), '10,000');
  });
  it('applies the area budget across worksheets', async () => {
    await rejectBeforeDecode(await fixture([['A1:BX100'], ['A1:BX100']]), '10,000');
  });
  it.each(['B2:A1', 'A1:XFD1048576', 'a1:B2', '$A$1:B2', 'A0:B2', 'A1:B2:C3', ''])(
    'rejects invalid merge %s before decoding',
    async (ref) => {
      await rejectBeforeDecode(await fixture([[ref]]), '范围无效');
    },
  );
  it.each([
    ['A1:B2', 'B2:C3'],
    ['A1:B2', 'A1:B2'],
  ])('rejects overlapping ranges %s, %s', async (a, b) => {
    await rejectBeforeDecode(await fixture([[a, b]]), '重叠');
  });
  it('rejects duplicate containers so the decoder cannot select different ranges', async () => {
    const archive = await fixture([['A1:B2']]);
    archive.sheets[0].xml.children.push(xmlElement('mergeCells'));
    await rejectBeforeDecode(archive, '容器不能重复');
  });
  it('rejects foreign merge namespaces', async () => {
    const archive = await fixture([['A1:B2']]);
    const container = archive.sheets[0].xml.children.at(-1)!;
    if (typeof container === 'string') throw new Error('fixture');
    container.attributes.xmlns = 'urn:foreign';
    await rejectBeforeDecode(archive, '命名空间');
  });
  it('accepts adjacent regions and a single-cell reference without losing content', async () => {
    const archive = await fixture([['A1:B2', 'C1:D2', 'E1']]);
    const book = await workbookFromXlsx(await writeXlsxArchive(archive));
    expect(book.sheets[0].merges).toEqual([
      { start: { row: 0, col: 0 }, end: { row: 1, col: 1 } },
      { start: { row: 0, col: 2 }, end: { row: 1, col: 3 } },
    ]);
    expect(book.sheets[0].cells.A1.value).toBe('保留');
    expect((await workbookFromXlsx(await workbookToXlsx(book))).sheets[0].merges).toEqual(
      book.sheets[0].merges,
    );
  });
  it('retains exactly 10,000 merged coordinates in a valid round trip', async () => {
    const book = createBlankWorkbook();
    book.sheets[0].colCount = 100;
    book.sheets[0].merges = [{ start: { row: 0, col: 0 }, end: { row: 99, col: 99 } }];
    book.sheets[0].cells.A1 = { value: '边界' };
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[0].merges).toEqual(book.sheets[0].merges);
    expect(restored.sheets[0].cells.A1.value).toBe('边界');
  });
});

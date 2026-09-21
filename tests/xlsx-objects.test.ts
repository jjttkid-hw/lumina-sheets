import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { readXlsxArchive, writeXlsxArchive, xmlElement } from '../src/lib/xlsx-archive';

afterEach(() => vi.restoreAllMocks());
async function source() {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Data').getCell('A1').value = 'keep me';
  return book;
}
async function rejectsBeforeDecode(bytes: ArrayBuffer, label: string) {
  const load = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load');
  await expect(workbookFromXlsx(bytes)).rejects.toThrow(label);
  expect(load).not.toHaveBeenCalled();
}
describe('XLSX unsupported object loss protection', () => {
  it('rejects a real ExcelJS embedded image before decoding', async () => {
    const book = await source();
    const id = book.addImage({
      base64:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      extension: 'png',
    });
    book.worksheets[0].addImage(id, 'B2:C3');
    await rejectsBeforeDecode((await book.xlsx.writeBuffer()) as unknown as ArrayBuffer, '图片');
  });
  it.each([
    'drawing',
    'legacyDrawing',
    'legacyDrawingHF',
    'picture',
    'oleObjects',
    'controls',
    'pivotTableParts',
  ])('rejects worksheet %s even without conventional part names', async (name) => {
    const book = await source();
    const archive = await readXlsxArchive(
      (await book.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    );
    archive.sheets[0].xml.children.push(xmlElement(name));
    await rejectsBeforeDecode(await writeXlsxArchive(archive), '工作表「Data」');
  });
  it.each([
    'image/png',
    'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml',
    'application/vnd.ms-office.vbaProject',
    'application/vnd.openxmlformats-officedocument.oleObject',
    'application/vnd.ms-office.activeX+xml',
  ])('rejects declared %s at arbitrary paths without sheet references', async (type) => {
    const book = await source();
    const archive = await readXlsxArchive(
      (await book.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    );
    const manifest = await archive.zip.file('[Content_Types].xml')!.async('string');
    archive.zip.file(
      '[Content_Types].xml',
      manifest.replace(
        '</Types>',
        `<Override PartName="/custom/payload.bin" ContentType="${type}"/></Types>`,
      ),
    );
    archive.zip.file('custom/payload.bin', new Uint8Array([1, 2, 3]));
    await rejectsBeforeDecode(await writeXlsxArchive(archive), '避免内容丢失');
  });
  it('rejects workbook pivot caches before decoding', async () => {
    const book = await source();
    const archive = await readXlsxArchive(
      (await book.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    );
    archive.workbook.children.push(xmlElement('pivotCaches'));
    await rejectsBeforeDecode(await writeXlsxArchive(archive), '数据透视缓存');
  });
  it('continues importing and exporting plain cell workbooks', async () => {
    const book = await source();
    const imported = await workbookFromXlsx(
      (await book.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    );
    const restored = await workbookFromXlsx(await workbookToXlsx(imported));
    expect(restored.sheets[0].cells.A1.value).toBe('keep me');
  });
});

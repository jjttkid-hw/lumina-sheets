import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { readXlsxArchive, writeXlsxArchive, xmlChild, xmlChildren } from '../src/lib/xlsx-archive';
import { readXlsxStoredCells } from '../src/lib/xlsx-cells';

async function template() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('输入模板');
  sheet.getCell('A1').value = '金额';
  sheet.getCell('C4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  sheet.getCell('C4').numFmt = '0.0%';
  sheet.getCell('IV100000').font = { bold: true, color: { argb: 'FF123456' } };
  return (await book.xlsx.writeBuffer()) as unknown as ArrayBuffer;
}

describe('sparse XLSX stored cells', () => {
  it('retains style-only template cells at the import bounds without creating a dense rectangle', async () => {
    const book = await workbookFromXlsx(await template());
    const sheet = book.sheets[0];
    expect(Object.keys(sheet.cells)).toEqual(['A1', 'C4', 'IV100000']);
    expect(sheet.cells.C4).toEqual({
      value: '',
      style: { background: '#F1F5F9', format: 'percent', fontSize: 11 },
    });
    expect(sheet.cells.IV100000).toEqual({ value: '', style: { bold: true, color: '#123456' } });
    expect([sheet.rowCount, sheet.colCount]).toEqual([100000, 256]);
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[0].cells).toEqual(sheet.cells);
  });

  it('keeps blank merge masters but does not import merge followers as stored data', async () => {
    const raw = new ExcelJS.Workbook();
    const sheet = raw.addWorksheet('合并输入区');
    sheet.mergeCells('B2:D3');
    sheet.getCell('B2').font = { bold: true };
    const book = await workbookFromXlsx((await raw.xlsx.writeBuffer()) as unknown as ArrayBuffer);
    expect(book.sheets[0].cells).toEqual({ B2: { value: '', style: { bold: true } } });
    expect(book.sheets[0].merges).toEqual([{ start: { row: 1, col: 1 }, end: { row: 2, col: 3 } }]);
  });

  it('counts stored blanks across sheets before downstream decoding', async () => {
    const archive = await readXlsxArchive(await template());
    expect(() => readXlsxStoredCells(archive, { rows: 100000, columns: 256, cells: 2 })).toThrow(
      '存储单元格',
    );
    archive.sheets.push({ ...archive.sheets[0], name: '第二张' });
    expect(() => readXlsxStoredCells(archive, { rows: 100000, columns: 256, cells: 5 })).toThrow(
      '存储单元格',
    );
  });

  it.each(['A0', 'A2', 'IW1', 'A100001', 'a1'])(
    'rejects malformed or out-of-range stored coordinate %s',
    async (address) => {
      const archive = await readXlsxArchive(await template());
      const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
      xmlChildren(row, 'c')[0].attributes.r = address;
      await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toThrow(
        'XLSX 单元格',
      );
    },
  );

  it('rejects duplicate XML cell addresses instead of accepting a last-writer value', async () => {
    const archive = await readXlsxArchive(await template());
    const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
    row.children.push(xmlChildren(row, 'c')[0]);
    await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toThrow('重复');
  });

  it('rejects an out-of-range styled blank even when its row reference agrees', async () => {
    const archive = await readXlsxArchive(await template());
    const rows = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row');
    const last = rows[rows.length - 1];
    last.attributes.r = '100001';
    xmlChildren(last, 'c')[0].attributes.r = 'IV100001';
    await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toThrow('100,000 行');
  });
});

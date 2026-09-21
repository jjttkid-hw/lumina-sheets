import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { evaluateCell } from '../src/lib/engine';
import {
  readXlsxArchive,
  writeXlsxArchive,
  xmlChild,
  xmlChildren,
  xmlElement,
} from '../src/lib/xlsx-archive';

async function dates(serials: number[]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Dates');
  serials.forEach((value, index) => {
    sheet.getCell(index + 1, 1).value = value;
    sheet.getCell(index + 1, 1).numFmt = 'yyyy-mm-dd hh:mm:ss';
  });
  sheet.getCell('B1').value = { formula: 'DAY(A1)', result: 29 };
  return (await book.xlsx.writeBuffer()) as unknown as ArrayBuffer;
}
afterEach(() => vi.restoreAllMocks());
async function isoDate(text: string) {
  const archive = await readXlsxArchive(await dates([1]));
  const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
  const cell = xmlChildren(row, 'c')[0];
  cell.attributes.t = 'd';
  xmlChild(cell, 'v')!.children = [text];
  return writeXlsxArchive(archive);
}
describe('XLSX 1900 date serial fidelity', () => {
  it.each([
    ['1900-01-01', 1],
    ['1900-02-28T12:00:00', 59.5],
    ['1900-03-01T00:00:00Z', 61],
    ['1900-02-28T24:00:00', 61],
    ['1900-03-01T00:00:00+01:00', 59 + 23 / 24],
    ['2024-01-01T18:00:00+08:00', 45292 + 10 / 24],
    ['2024-01-01T00:00:00-05:00', 45292 + 5 / 24],
    ['2024-02-29T12:00:00.125Z', 45351.5 + 0.125 / 86400],
  ] as const)(
    'imports ISO date %s as a 1900 serial and preserves XLSX round trips',
    async (text, serial) => {
      const book = await workbookFromXlsx(await isoDate(text));
      expect(book.sheets[0].cells.A1.value).toBeCloseTo(serial, 9);
      const restored = await workbookFromXlsx(await workbookToXlsx(book));
      expect(restored.sheets[0].cells.A1.value).toBe(book.sheets[0].cells.A1.value);
    },
  );
  it.each([
    '2024-02-30',
    '1900-02-29',
    '2023-02-29',
    '2024-13-01',
    '2024-01-01T25:00:00',
    '2024-01-01T00:00:00+15:00',
    '2024-01-01junk',
    '',
  ])('rejects invalid ISO date %j before decoding', async (text) => {
    const bytes = await isoDate(text);
    const load = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load');
    await expect(workbookFromXlsx(bytes)).rejects.toThrow('日期');
    expect(load).not.toHaveBeenCalled();
  });
  it('preserves early dates, fictional leap day and fractional serials over XLSX round trips', async () => {
    const serials = [60, 0, 1, 59, 59.5, 60.25, 61, 61.123456789, 45292.75];
    const imported = await workbookFromXlsx(await dates(serials));
    expect(serials.map((_, i) => imported.sheets[0].cells[`A${i + 1}`].value)).toEqual(serials);
    expect(evaluateCell(imported.sheets[0], 'B1', imported)).toBe(29);
    const restored = await workbookFromXlsx(await workbookToXlsx(imported));
    expect(serials.map((_, i) => restored.sheets[0].cells[`A${i + 1}`].value)).toEqual(serials);
    expect(restored.sheets[0].cells.B1.value).toBe('=DAY(A1)');
  });
  it('keeps numeric formula caches as formulas, not captured date serials', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Formula');
    sheet.getCell('A1').value = { formula: 'DATE(1900,2,29)', result: 60 };
    sheet.getCell('A1').numFmt = 'yyyy-mm-dd';
    const result = await workbookFromXlsx(
      (await book.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    );
    expect(result.sheets[0].cells.A1.value).toBe('=DATE(1900,2,29)');
    expect(evaluateCell(result.sheets[0], 'A1', result)).toBe(60);
  });
  it.each(['1', 'true', 'invalid'])(
    'rejects unsupported or invalid date1904=%s before ExcelJS decoding',
    async (setting) => {
      const archive = await readXlsxArchive(await dates([1]));
      const properties = xmlChild(archive.workbook, 'workbookPr')!;
      properties.attributes.date1904 = setting;
      const bytes = await writeXlsxArchive(archive);
      const load = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load');
      await expect(workbookFromXlsx(bytes)).rejects.toThrow('1904');
      expect(load).not.toHaveBeenCalled();
    },
  );
  it.each(['0', 'false'])('accepts explicit 1900 date system %s', async (setting) => {
    const archive = await readXlsxArchive(await dates([60]));
    xmlChild(archive.workbook, 'workbookPr')!.attributes.date1904 = setting;
    const imported = await workbookFromXlsx(await writeXlsxArchive(archive));
    expect(imported.sheets[0].cells.A1.value).toBe(60);
  });
  it('rejects ambiguous duplicate workbook properties', async () => {
    const archive = await readXlsxArchive(await dates([1]));
    archive.workbook.children.push(xmlElement('workbookPr', { date1904: 'true' }));
    const bytes = await writeXlsxArchive(archive);
    const load = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load');
    await expect(workbookFromXlsx(bytes)).rejects.toThrow('属性重复');
    expect(load).not.toHaveBeenCalled();
  });
});

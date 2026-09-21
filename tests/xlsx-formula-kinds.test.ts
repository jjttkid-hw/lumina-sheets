import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { createEvaluator } from '../src/lib/engine';
import { readXlsxArchive, writeXlsxArchive, xmlChild, xmlChildren } from '../src/lib/xlsx-archive';

afterEach(() => vi.restoreAllMocks());
async function arrayInput() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Data');
  sheet.getCell('A1').value = 2;
  sheet.getCell('A2').value = 3;
  // ExcelJS runtime supports array metadata omitted from its published types.
  const formula = { formula: 'A1:A2*2', result: 4, shareType: 'array', ref: 'B1:B2' };
  sheet.getCell('B1').value = formula;
  sheet.getCell('B2').value = 6;
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}
describe('XLSX formula storage semantics', () => {
  it.each(['missing-master', 'duplicate-master', 'invalid-id', 'outside-range', 'missing-range'])(
    'rejects damaged shared formula group %s before decoding',
    async (fault) => {
      const external = new ExcelJS.Workbook();
      external.addWorksheet('Data').fillFormula('B1:B2', 'A1+1', [1, 2]);
      const archive = await readXlsxArchive((await external.xlsx.writeBuffer()) as ArrayBuffer);
      const rows = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row');
      const master = xmlChild(xmlChildren(rows[0], 'c')[0], 'f')!;
      const child = xmlChild(xmlChildren(rows[1], 'c')[0], 'f')!;
      if (fault === 'missing-master') master.children = [];
      if (fault === 'duplicate-master') child.children = ['A2+1'];
      if (fault === 'invalid-id') child.attributes.si = '0x0';
      if (fault === 'outside-range') master.attributes.ref = 'B1';
      if (fault === 'missing-range') delete master.attributes.ref;
      const bytes = await writeXlsxArchive(archive);
      const load = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load');
      await expect(workbookFromXlsx(bytes)).rejects.toThrow('共享公式');
      expect(load).not.toHaveBeenCalled();
    },
  );

  it('resolves shared masters independently of serialized row order and worksheet-local IDs', async () => {
    const external = new ExcelJS.Workbook();
    for (const name of ['First', 'Second']) {
      const sheet = external.addWorksheet(name);
      sheet.fillFormula('B1:B2', name === 'First' ? 'A1+1' : 'A1+2', [1, 2]);
    }
    const archive = await readXlsxArchive((await external.xlsx.writeBuffer()) as ArrayBuffer);
    for (const sheet of archive.sheets) {
      const data = xmlChild(sheet.xml, 'sheetData')!;
      data.children.reverse();
    }
    const book = await workbookFromXlsx(await writeXlsxArchive(archive));
    expect(book.sheets[0].cells.B2.value).toBe('=A2+1');
    expect(book.sheets[1].cells.B2.value).toBe('=A2+2');
  });

  it('preserves text literals and quoted sheet names while expanding shared references', async () => {
    const external = new ExcelJS.Workbook();
    const data = external.addWorksheet('Data');
    const other = external.addWorksheet('A1');
    other.getCell('A1').value = 4;
    other.getCell('A2').value = 7;
    data.fillFormula('B1:B2', '"A1"&" / "&\'A1\'!A1', (row) => (row === 1 ? 'A1 / 4' : 'A1 / 7'));
    const book = await workbookFromXlsx((await external.xlsx.writeBuffer()) as ArrayBuffer);
    expect(book.sheets[0].cells.B2.value).toBe('="A1"&" / "&\'A1\'!A2');
    expect(createEvaluator(book)(book.sheets[0], 'B2')).toBe('A1 / 7');
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[0].cells.B2.value).toBe(book.sheets[0].cells.B2.value);
  });
  it('rejects an array formula before the decoder flattens its dependent cells to constants', async () => {
    const bytes = await arrayInput();
    const load = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load');
    await expect(workbookFromXlsx(bytes)).rejects.toThrow('数组公式');
    expect(load).not.toHaveBeenCalled();
  });

  it.each(['dataTable', 'futureFormula'])(
    'rejects unsupported formula type %s before decoding',
    async (type) => {
      const archive = await readXlsxArchive(await arrayInput());
      const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
      const formula = xmlChild(xmlChildren(row, 'c')[1], 'f')!;
      formula.attributes.t = type;
      const bytes = await writeXlsxArchive(archive);
      const load = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load');
      await expect(workbookFromXlsx(bytes)).rejects.toThrow('公式类型');
      expect(load).not.toHaveBeenCalled();
    },
  );

  it('expands supported shared formulas and retains relative/absolute references on roundtrip', async () => {
    const external = new ExcelJS.Workbook();
    const sheet = external.addWorksheet('Data');
    sheet.getCell('A1').value = 2;
    sheet.getCell('A2').value = 3;
    sheet.getCell('C1').value = 10;
    sheet.fillFormula('B1:B2', 'A1+$C$1', [12, 13]);
    const book = await workbookFromXlsx((await external.xlsx.writeBuffer()) as ArrayBuffer);
    expect(book.sheets[0].cells.B1.value).toBe('=A1+$C$1');
    expect(book.sheets[0].cells.B2.value).toBe('=A2+$C$1');
    book.sheets[0].cells.A2.value = 7;
    expect(createEvaluator(book)(book.sheets[0], 'B2')).toBe(17);
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    expect(restored.sheets[0].cells.B2.value).toBe('=A2+$C$1');
    expect(createEvaluator(restored)(restored.sheets[0], 'B2')).toBe(17);
  });
});

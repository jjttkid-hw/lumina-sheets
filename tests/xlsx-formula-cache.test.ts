import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { createBlankWorkbook } from '../src/lib/seed';
import { createEvaluator } from '../src/lib/engine';
import { decodeXlsxString } from '../src/lib/xlsx-string';
import { readXlsxArchive, xmlChild, xmlChildren, xmlText } from '../src/lib/xlsx-archive';

const formulaNode = async (bytes: ArrayBuffer, address: string) => {
  const archive = await readXlsxArchive(bytes);
  const rows = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row');
  return rows
    .flatMap((row) => xmlChildren(row, 'c'))
    .find((cell) => cell.attributes.r === address)!;
};
describe('XLSX formula string caches', () => {
  it.each([
    'a\r\nb\rc\nd',
    '_x0041_ _x005F_ _x000d_ & <>',
    'a\u0000b\u0001c\u007fd',
    '😀\ud800Z\udfff\ufffe\uffff',
    '',
  ])('writes an exact OOXML string cache for referenced text %j', async (text) => {
    const book = createBlankWorkbook();
    book.sheets[0].cells = { A1: { value: text }, B1: { value: '=A1&""' } };
    const before = structuredClone(book);
    const bytes = await workbookToXlsx(book);
    const node = await formulaNode(bytes, 'B1');
    expect(node.attributes.t).toBe('str');
    expect(xmlText(xmlChild(node, 'f')!)).toBe('A1&""');
    expect(decodeXlsxString(xmlText(xmlChild(node, 'v')!))).toBe(text);
    const restored = await workbookFromXlsx(bytes);
    expect(restored.sheets[0].cells.B1.value).toBe('=A1&""');
    expect(createEvaluator(restored)(restored.sheets[0], 'B1')).toBe(text);
    expect(book).toEqual(before);
  });
  it('retains encoded caches through rich-text and print archive rewriting and refreshes after input changes', async () => {
    const book = createBlankWorkbook();
    const sheet = book.sheets[0];
    sheet.printSettings = { paperSize: 'A4', orientation: 'landscape' };
    sheet.hiddenRows = [3];
    sheet.cells = {
      A1: { value: '_x0041_\r\n\u0001' },
      B1: { value: '=A1&""' },
      C1: { value: 'rich', richText: [{ text: 'rich', style: { bold: true } }] },
    };
    const bytes = await workbookToXlsx(book);
    const firstNode = await formulaNode(bytes, 'B1');
    expect(decodeXlsxString(xmlText(xmlChild(firstNode, 'v')!))).toBe(sheet.cells.A1.value);
    const external = new ExcelJS.Workbook();
    await external.xlsx.load(bytes);
    const raw = external.worksheets[0].getCell('B1').value as ExcelJS.CellFormulaValue;
    // ExcelJS omits ST_Xstring decoding for formula caches; keep the limitation explicit.
    expect(decodeXlsxString(String(raw.result))).toBe(sheet.cells.A1.value);
    expect(raw.formula).toBe('A1&""');
    const loaded = await workbookFromXlsx(bytes);
    loaded.sheets[0].cells.A1.value = 'new\r\n_x0042_';
    const next = await workbookToXlsx(loaded);
    expect(decodeXlsxString(xmlText(xmlChild(await formulaNode(next, 'B1'), 'v')!))).toBe(
      'new\r\n_x0042_',
    );
    expect((await workbookFromXlsx(next)).sheets[0].cells.B1.value).toBe('=A1&""');
  });
  it.each(['#N/A', '#REF!', '#NAME?', '#DIV/0!', '#NULL!', '#VALUE!', '#NUM!'])(
    'keeps formula-returned %s text distinct from an actual error',
    async (text) => {
      const book = createBlankWorkbook();
      book.sheets[0].cells = {
        A1: { value: `="${text}"` },
        B1: { value: `=${text}` },
        C1: { value: '=A1' },
        D1: { value: '=IFERROR(B1,A1)' },
      };
      const bytes = await workbookToXlsx(book);
      for (const address of ['A1', 'C1', 'D1']) {
        const cell = await formulaNode(bytes, address);
        expect(cell.attributes.t).toBe('str');
        expect(xmlText(xmlChild(cell, 'v')!)).toBe(text);
      }
      expect((await formulaNode(bytes, 'B1')).attributes.t).toBe('e');
      const restored = await workbookFromXlsx(bytes);
      expect(restored.sheets[0].cells).toMatchObject(book.sheets[0].cells);
      const external = new ExcelJS.Workbook();
      await external.xlsx.load(bytes);
      expect((external.worksheets[0].getCell('A1').value as ExcelJS.CellFormulaValue).result).toBe(
        text,
      );
      expect(
        (external.worksheets[0].getCell('B1').value as ExcelJS.CellFormulaValue).result,
      ).toEqual({ error: text });
    },
  );

  it('retains numeric, boolean and error cache types and requests host recalculation', async () => {
    const book = createBlankWorkbook();
    book.sheets[0].cells = {
      A1: { value: '=2+3' },
      B1: { value: '=1=1' },
      C1: { value: '=1/0' },
      D1: { value: '=0' },
      E1: { value: '=1=2' },
    };
    const bytes = await workbookToXlsx(book);
    const a = await formulaNode(bytes, 'A1'),
      b = await formulaNode(bytes, 'B1'),
      c = await formulaNode(bytes, 'C1');
    expect(a.attributes.t).toBeUndefined();
    expect(xmlText(xmlChild(a, 'v')!)).toBe('5');
    expect(b.attributes.t).toBe('b');
    expect(xmlText(xmlChild(b, 'v')!)).toBe('1');
    expect(c.attributes.t).toBe('e');
    expect(xmlText(xmlChild(c, 'v')!)).toBe('#DIV/0!');
    expect(xmlText(xmlChild(await formulaNode(bytes, 'D1'), 'v')!)).toBe('0');
    const falseNode = await formulaNode(bytes, 'E1');
    expect(falseNode.attributes.t).toBe('b');
    expect(xmlText(xmlChild(falseNode, 'v')!)).toBe('0');
    const archive = await readXlsxArchive(bytes);
    expect(xmlChild(archive.workbook, 'calcPr')?.attributes.fullCalcOnLoad).toBe('1');
  });
});

it.each(['=A1', '=('])(
  'omits unsupported error cache codes for %s and retains the original formula',
  async (formula) => {
    const book = createBlankWorkbook();
    book.sheets[0].cells = { A1: { value: formula } };
    const bytes = await workbookToXlsx(book);
    const node = await formulaNode(bytes, 'A1');
    expect(xmlText(xmlChild(node, 'f')!)).toBe(formula.slice(1));
    expect(xmlChild(node, 'v')).toBeUndefined();
    expect(node.attributes.t).not.toBe('str');
    expect((await workbookFromXlsx(bytes)).sheets[0].cells.A1.value).toBe(formula);
  },
);

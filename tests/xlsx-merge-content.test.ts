import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { createBlankWorkbook } from '../src/lib/seed';
import {
  readXlsxArchive,
  writeXlsxArchive,
  xmlElement,
  xmlChild,
  xmlChildren,
} from '../src/lib/xlsx-archive';

const range = { start: { row: 0, col: 0 }, end: { row: 1, col: 1 } };
afterEach(() => vi.restoreAllMocks());
describe('XLSX merged subordinate content protection', () => {
  it.each([0, false, 'text', '=1+2', ' '])(
    'rejects export losing subordinate value %j',
    async (value) => {
      const book = createBlankWorkbook();
      book.sheets[0].merges = [range];
      book.sheets[0].cells = { A1: { value: 'master' }, B2: { value } };
      const before = structuredClone(book);
      const write = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'writeBuffer');
      await expect(workbookToXlsx(book)).rejects.toThrow('!B2');
      expect(write).not.toHaveBeenCalled();
      expect(book).toEqual(before);
    },
  );
  it('allows absent and empty subordinate cells without mutating the source', async () => {
    const book = createBlankWorkbook();
    book.sheets[0].merges = [range];
    book.sheets[0].cells = { A1: { value: 0 }, B2: { value: '' } };
    const before = structuredClone(book);
    const imported = await workbookFromXlsx(await workbookToXlsx(book));
    expect(imported.sheets[0].cells.A1.value).toBe(0);
    expect(imported.sheets[0].merges).toEqual([range]);
    expect(book).toEqual(before);
  });
  it.each(['number', 'boolean', 'shared-string', 'inline-string', 'formula'])(
    'rejects subordinate %s payload before the decoder clears it',
    async (kind) => {
      const source = new ExcelJS.Workbook();
      source.addWorksheet('Data').getCell('A1').value = 'master';
      const archive = await readXlsxArchive(
        (await source.xlsx.writeBuffer()) as unknown as ArrayBuffer,
      );
      let cell = xmlElement('c', { r: 'B2' }, [xmlElement('v', {}, ['0'])]);
      if (kind === 'boolean') cell.attributes.t = 'b';
      if (kind === 'shared-string') cell.attributes.t = 's';
      if (kind === 'inline-string')
        cell = xmlElement('c', { r: 'B2', t: 'inlineStr' }, [
          xmlElement('is', {}, [xmlElement('t', {}, ['other'])]),
        ]);
      if (kind === 'formula') cell = xmlElement('c', { r: 'B2' }, [xmlElement('f', {}, ['1+2'])]);
      xmlChild(archive.sheets[0].xml, 'sheetData')!.children.push(
        xmlElement('row', { r: '2' }, [cell]),
      );
      archive.sheets[0].xml.children.push(
        xmlElement('mergeCells', { count: '1' }, [xmlElement('mergeCell', { ref: 'A1:B2' })]),
      );
      const bytes = await writeXlsxArchive(archive);
      const load = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load');
      await expect(workbookFromXlsx(bytes)).rejects.toThrow('Data!B2');
      expect(load).not.toHaveBeenCalled();
    },
  );
  it('preserves a styled blank merge master with empty serialized followers', async () => {
    const source = new ExcelJS.Workbook();
    const sheet = source.addWorksheet('Data');
    sheet.mergeCells('A1:B2');
    sheet.getCell('A1').font = { bold: true };
    const archive = await readXlsxArchive(
      (await source.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    );
    const rows = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row');
    const follower = xmlChildren(rows[1], 'c').find((c) => c.attributes.r === 'B2')!;
    follower.children.push(xmlElement('v'));
    const imported = await workbookFromXlsx(await writeXlsxArchive(archive));
    expect(imported.sheets[0].cells.A1).toEqual({ value: '', style: { bold: true } });
  });
});

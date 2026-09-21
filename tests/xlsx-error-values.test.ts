import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromXlsx, workbookToXlsx, validateWorkbook } from '../src/lib/io';
import { createEvaluator } from '../src/lib/engine';
import { readXlsxArchive, writeXlsxArchive, xmlChild, xmlChildren } from '../src/lib/xlsx-archive';

async function fixture(error: ExcelJS.CellErrorValue['error']) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Errors');
  sheet.getCell('A1').value = { error };
  sheet.getCell('A1').font = { bold: true };
  sheet.getCell('B1').value = { formula: 'IFERROR(A1,42)' };
  sheet.getCell('C1').value = error;
  sheet.getCell('D1').value = { formula: 'IFERROR(C1,42)' };
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}

describe('XLSX constant error semantics', () => {
  it.each(['#N/A', '#REF!', '#NAME?', '#DIV/0!', '#NULL!', '#VALUE!', '#NUM!'] as const)(
    'retains %s as an error literal while identical text stays text',
    async (error) => {
      const imported = await workbookFromXlsx(await fixture(error));
      const sheet = imported.sheets[0],
        evaluate = createEvaluator(imported);
      expect(sheet.cells.A1).toMatchObject({ value: `=${error}`, style: { bold: true } });
      expect(sheet.cells.C1.value).toBe(error);
      expect(evaluate.result(sheet, 'A1')).toEqual({ kind: 'error', error });
      expect(evaluate(sheet, 'B1')).toBe(42);
      expect(evaluate(sheet, 'D1')).toBe(error);
      const json = validateWorkbook(JSON.parse(JSON.stringify(imported)));
      expect(createEvaluator(json).result(json.sheets[0], 'A1')).toEqual({ kind: 'error', error });
      const bytes = await workbookToXlsx(imported);
      const external = new ExcelJS.Workbook();
      await external.xlsx.load(bytes);
      // Lumina's scalar model encodes a constant error as a literal formula.
      expect(external.worksheets[0].getCell('A1').value).toMatchObject({
        formula: error,
        result: { error },
      });
      const again = await workbookFromXlsx(bytes);
      expect(createEvaluator(again)(again.sheets[0], 'B1')).toBe(42);
    },
  );
  it.each(['#SPILL!', '#UNKNOWN!', ''])(
    'rejects an unsupported constant error %j instead of importing text or blank',
    async (error) => {
      const archive = await readXlsxArchive(await fixture('#N/A'));
      const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
      const cell = xmlChildren(row, 'c').find((node) => node.attributes.r === 'A1')!;
      const value = xmlChild(cell, 'v')!;
      value.children = [error];
      await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toThrow('错误');
    },
  );
});

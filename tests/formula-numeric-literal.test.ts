import { describe, expect, it } from 'vitest';
import { createEvaluator } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import { workbookCsvBlob } from '../src/lib/io-stream';
import { workbookToXlsx, workbookFromXlsx } from '../src/lib/io';
import { readXlsxArchive, xmlChild, xmlChildren, xmlText } from '../src/lib/xlsx-archive';

function setup(formula: string) {
  const book = createBlankWorkbook();
  book.sheets[0].cells = { A1: { value: formula } };
  return { book, sheet: book.sheets[0], evaluate: createEvaluator(book) };
}

describe('non-finite numeric formula literals', () => {
  it.each(['=1e999', '=-1e999', '=1e999&""', '=1e999=1e999', '=IF(1e999,1,0)', '=MAX(1e999,2)'])(
    'reports a numeric error when evaluating %s',
    (formula) => {
      const { sheet, evaluate } = setup(formula);
      expect(evaluate(sheet, 'A1')).toBe('#NUM!');
    },
  );
  it.each([
    ['=IFERROR(1e999,42)', 42],
    ['=IFERROR(-1e999,42)', 42],
    ['=IF(FALSE,1e999,7)', 7],
    ['=IF(TRUE,7,1e999)', 7],
    ['=IFERROR(1,1e999)', 1],
    ['=1e308', 1e308],
  ])('keeps lazy error handling for %s', (formula, value) => {
    const { sheet, evaluate } = setup(formula as string);
    expect(evaluate(sheet, 'A1')).toBe(value);
  });
  it('propagates the numeric error through references and refreshes cached dependents', () => {
    const { book, sheet } = setup('=1e999');
    sheet.cells.B1 = { value: '=IFERROR(A1,5)' };
    sheet.cells.C1 = { value: '=A1' };
    const evaluate = createEvaluator(book, { managedMutations: true });
    expect(evaluate(sheet, 'B1')).toBe(5);
    expect(evaluate(sheet, 'C1')).toBe('#NUM!');
    sheet.cells.A1.value = '=12';
    evaluate.invalidateCells(sheet.id, ['A1']);
    expect(evaluate(sheet, 'B1')).toBe(12);
    expect(evaluate(sheet, 'C1')).toBe(12);
  });
  it('exports an error instead of Infinity in CSV and XLSX caches, preserving formula text', async () => {
    const { book } = setup('=1e999');
    expect(await (await workbookCsvBlob(book)).text()).toBe('#NUM!\r\n');
    const bytes = await workbookToXlsx(book);
    const archive = await readXlsxArchive(bytes);
    const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
    const cell = xmlChildren(row, 'c')[0];
    expect(cell.attributes.t).toBe('e');
    expect(xmlText(xmlChild(cell, 'f')!)).toBe('1e999');
    expect(xmlText(xmlChild(cell, 'v')!)).toBe('#NUM!');
    const restored = await workbookFromXlsx(bytes);
    expect(restored.sheets[0].cells.A1.value).toBe('=1e999');
    expect(createEvaluator(restored)(restored.sheets[0], 'A1')).toBe('#NUM!');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromXlsx } from '../src/lib/io';
import { expandXlsxSharedFormulas } from '../src/lib/xlsx-formulas';
import { xmlElement, type XlsxArchive } from '../src/lib/xlsx-archive';

afterEach(() => vi.restoreAllMocks());
function fixture(count: number, formula: string, shared = true) {
  const nodes = Array.from({ length: count }, (_, i) =>
    xmlElement(
      'f',
      shared ? { t: 'shared', si: '0', ...(i === 0 ? { ref: `A1:A${count}` } : {}) } : {},
      i === 0 || !shared ? [formula] : [],
    ),
  );
  const xml = xmlElement('worksheet', {}, [
    xmlElement(
      'sheetData',
      {},
      nodes.map((f, i) =>
        xmlElement('row', { r: String(i + 1) }, [xmlElement('c', { r: `A${i + 1}` }, [f])]),
      ),
    ),
  ]);
  return { nodes, sheet: { name: 'Data', path: 'xl/worksheets/sheet1.xml', xml } };
}
function archive(sheets: XlsxArchive['sheets']) {
  return { sheets } as XlsxArchive;
}

describe('XLSX expanded formula capacity', () => {
  it('accepts the exact per-cell limit including the formula prefix', () => {
    const { sheet, nodes } = fixture(1, '1'.repeat(32766));
    expandXlsxSharedFormulas(archive([sheet]));
    expect(nodes[0].children[0]).toHaveLength(32766);
  });
  it.each([true, false])('rejects oversized shared=%s formula before decoding', async (shared) => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Data');
    const formula = '1'.repeat(32767);
    if (shared) sheet.fillFormula('A1:A2', formula, [1, 1]);
    else sheet.getCell('A1').value = { formula, result: 1 };
    const bytes = await book.xlsx.writeBuffer();
    const load = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load');
    await expect(workbookFromXlsx(bytes as ArrayBuffer)).rejects.toThrow('单格公式');
    expect(load).not.toHaveBeenCalled();
  });
  it('bounds shared expansion and leaves later followers unexpanded on rejection', () => {
    const { sheet, nodes } = fixture(300, '"' + 'x'.repeat(31997) + '"');
    expect(() => expandXlsxSharedFormulas(archive([sheet]))).toThrow('展开后公式文本');
    expect(nodes[249].attributes.t).toBeUndefined();
    expect(nodes[250].attributes.t).toBe('shared');
    expect(nodes[299].children).toEqual([]);
  });
  it('rejects a compact XLSX whose shared formulas exceed expanded capacity before decoding', async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Data').fillFormula('A1:A251', '"' + 'x'.repeat(31997) + '"');
    const bytes = await book.xlsx.writeBuffer();
    expect(bytes.byteLength).toBeLessThan(100_000);
    const load = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load');
    await expect(workbookFromXlsx(bytes as ArrayBuffer)).rejects.toThrow('展开后公式文本');
    expect(load).not.toHaveBeenCalled();
  });
  it('counts ordinary formulas across worksheets rather than resetting the total', () => {
    const first = fixture(125, '1'.repeat(31999), false);
    const second = fixture(125, '1'.repeat(31999), false);
    expandXlsxSharedFormulas(archive([first.sheet, second.sheet]));
    const extra = fixture(1, '1', false);
    expect(() =>
      expandXlsxSharedFormulas(archive([first.sheet, second.sheet, extra.sheet])),
    ).toThrow('展开后公式文本');
  });
  it('checks length after reference expansion when a row gains a digit', () => {
    const { sheet } = fixture(10, '"' + 'x'.repeat(32761) + '"&B1');
    expect(() => expandXlsxSharedFormulas(archive([sheet]))).toThrow('单格公式');
  });
});

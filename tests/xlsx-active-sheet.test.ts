import { describe, expect, it } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import {
  readXlsxArchive,
  writeXlsxArchive,
  xmlChildren,
  xmlElement,
} from '../src/lib/xlsx-archive';

function fixture(frozen = false) {
  const book = createBlankWorkbook();
  const source = book.sheets[0];
  book.sheets = [0, 1, 2].map((i) => ({
    ...structuredClone(source),
    id: `sheet-${i}`,
    name: `报表${i + 1}`,
    cells: { A1: { value: `原值${i}` } },
    frozenRows: frozen ? 1 : 0,
  }));
  book.activeSheetId = book.sheets[2].id;
  return book;
}

describe('XLSX active sheet', () => {
  it.each([false, true])(
    'retains the active tab without grouping worksheets (frozen=%s)',
    async (frozen) => {
      const book = fixture(frozen);
      const bytes = await workbookToXlsx(book);
      const archive = await readXlsxArchive(bytes);
      const view = xmlChildren(xmlChildren(archive.workbook, 'bookViews')[0], 'workbookView')[0];
      expect(view.attributes.activeTab).toBe('2');
      expect(
        archive.sheets.map(
          (s) =>
            xmlChildren(xmlChildren(s.xml, 'sheetViews')[0], 'sheetView')[0].attributes
              .tabSelected === '1',
        ),
      ).toEqual([false, false, true]);
      const restored = await workbookFromXlsx(bytes);
      expect(restored.activeSheetId).toBe(restored.sheets[2].id);
      expect(restored.sheets.map((s) => s.cells.A1.value)).toEqual(['原值0', '原值1', '原值2']);
      if (frozen) expect(restored.sheets.map((s) => s.frozenRows)).toEqual([1, 1, 1]);
    },
  );
  it('defaults missing activeTab to the first sheet and uses the first workbook view', async () => {
    const archive = await readXlsxArchive(await workbookToXlsx(fixture()));
    archive.workbook.children = archive.workbook.children.filter(
      (node) => typeof node === 'string' || node.name !== 'bookViews',
    );
    const defaultBook = await workbookFromXlsx(await writeXlsxArchive(archive));
    expect(defaultBook.activeSheetId).toBe(defaultBook.sheets[0].id);
    archive.workbook.children.unshift(
      xmlElement('bookViews', {}, [
        xmlElement('workbookView', { activeTab: '1' }),
        xmlElement('workbookView', { activeTab: '2' }),
      ]),
    );
    const restored = await workbookFromXlsx(await writeXlsxArchive(archive));
    expect(restored.activeSheetId).toBe(restored.sheets[1].id);
  });
  it.each(['-1', '3', '1.5', '2bad', '9007199254740993'])(
    'rejects malformed/out-of-range activeTab %s',
    async (activeTab) => {
      const archive = await readXlsxArchive(await workbookToXlsx(fixture()));
      archive.workbook.children = archive.workbook.children.filter(
        (node) => typeof node === 'string' || node.name !== 'bookViews',
      );
      archive.workbook.children.unshift(
        xmlElement('bookViews', {}, [xmlElement('workbookView', { activeTab })]),
      );
      await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toThrow(/活动工作表/);
    },
  );
});

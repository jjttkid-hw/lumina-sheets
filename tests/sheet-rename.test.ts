import { describe, expect, it } from 'vitest';
import { planSheetRename } from '../src/lib/sheet-rename';
import { createBlankWorkbook } from '../src/lib/seed';
import { evaluateCell } from '../src/lib/engine';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';

function fixture() {
  const book = createBlankWorkbook(),
    sheet = book.sheets[0];
  sheet.name = 'Data';
  sheet.cells = { A1: { value: 3 }, A2: { value: 4 }, B1: { value: '=Data!A1+A2' } };
  const other = createBlankWorkbook().sheets[0];
  other.name = 'Summary';
  other.cells = {
    A1: { value: '=SUM(Data!$A$1:data!A2)' },
    B1: { value: '="Data!A1"' },
    C1: { value: 'link', hyperlink: { target: "#'DATA'!$A$1", tooltip: 'hint' } },
    D1: { value: 'local', hyperlink: { target: '#A1' } },
    E1: { value: 'web', hyperlink: { target: 'https://example.com/Data!A1' } },
  };
  book.sheets.push(other);
  return { book, sheet };
}
describe('atomic worksheet rename', () => {
  it('rewrites qualifiers in formulas and single-cell links while preserving text and identities', async () => {
    const { book, sheet } = fixture(),
      before = structuredClone(book);
    const next = planSheetRename(book, sheet.id, "O'Brien 数据");
    expect(book).toEqual(before);
    expect(next.sheets[0].id).toBe(sheet.id);
    expect(next.sheets[0].cells.B1.value).toBe("='O''Brien 数据'!A1+A2");
    expect(next.sheets[1].cells.A1.value).toBe("=SUM('O''Brien 数据'!$A$1:'O''Brien 数据'!A2)");
    expect(next.sheets[1].cells.B1.value).toBe('="Data!A1"');
    expect(next.sheets[1].cells.C1.hyperlink).toEqual({
      target: "#'O''Brien 数据'!$A$1",
      tooltip: 'hint',
    });
    expect(next.sheets[1].cells.D1.hyperlink?.target).toBe('#A1');
    expect(next.sheets[1].cells.E1).toEqual(book.sheets[1].cells.E1);
    expect(evaluateCell(next.sheets[1], 'A1', next)).toBe(7);
    const restored = await workbookFromXlsx(await workbookToXlsx(next));
    expect(evaluateCell(restored.sheets[1], 'A1', restored)).toBe(7);
    expect(restored.sheets[1].cells.C1.hyperlink).toEqual(next.sheets[1].cells.C1.hyperlink);
  });
  it('handles case-only renames and no-op without touching identities', () => {
    const { book, sheet } = fixture();
    expect(planSheetRename(book, sheet.id, 'Data')).toBe(book);
    expect(planSheetRename(book, sheet.id, 'data').sheets[1].cells.A1.value).toBe(
      "=SUM('data'!$A$1:'data'!A2)",
    );
  });
  it('rejects invalid, duplicate, readonly and unsupported references without mutation', () => {
    const { book, sheet } = fixture(),
      before = structuredClone(book);
    for (const name of ['', ' ', 'History', 'a'.repeat(32), 'a/b', "'Data", 'Summary'])
      expect(() => planSheetRename(book, sheet.id, name)).toThrow();
    expect(() => planSheetRename(book, 'missing', 'New')).toThrow();
    expect(book).toEqual(before);
    book.sheets[1].dataSource = { kind: 'paged' };
    expect(() => planSheetRename(book, sheet.id, 'New')).toThrow('只读');
    delete book.sheets[1].dataSource;
    book.sheets[1].cells.A1.value = '=Table1[Amount]';
    expect(() => planSheetRename(book, sheet.id, 'New')).toThrow('structured references');
    expect(book.sheets[0].name).toBe('Data');
  });
});

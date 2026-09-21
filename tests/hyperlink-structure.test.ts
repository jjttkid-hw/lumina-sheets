import { describe, expect, it } from 'vitest';
import { rewriteHyperlinkTarget } from '../src/lib/hyperlink-structure';
import { planStructureEdit } from '../src/lib/structure-edit';
import { createBlankWorkbook } from '../src/lib/seed';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';

const context = {
  formulaSheetName: 'Data',
  targetSheetName: 'Data',
  edit: { axis: 'row' as const, kind: 'insert' as const, index: 1, count: 2 },
};
describe('internal hyperlink structure tracking', () => {
  it('moves local and explicitly qualified A1 targets including absolute addresses', () => {
    expect(rewriteHyperlinkTarget('#A2', context)).toBe('#A4');
    expect(rewriteHyperlinkTarget('#$A$2', context)).toBe('#$A$4');
    expect(rewriteHyperlinkTarget('#Data!B3', context)).toBe('#Data!B5');
    expect(rewriteHyperlinkTarget('#Other!B3', context)).toBe('#Other!B3');
    expect(rewriteHyperlinkTarget('#B3', { ...context, formulaSheetName: 'Other' })).toBe('#B3');
    expect(
      rewriteHyperlinkTarget("#'O''Brien 数据'!A2", {
        ...context,
        targetSheetName: "O'Brien 数据",
      }),
    ).toBe("#'O''Brien 数据'!A4");
  });
  it('marks deleted targets broken and leaves unrelated destinations literal', () => {
    const deletion = { ...context, edit: { ...context.edit, kind: 'delete' as const } };
    expect(rewriteHyperlinkTarget('#Data!A2', deletion)).toBe('#REF!');
    expect(rewriteHyperlinkTarget('#Data!A5', deletion)).toBe('#Data!A3');
    for (const target of [
      'https://example.com/#A2',
      'file:///book.xlsx#A2',
      '#NamedRange',
      '#A2:B3',
      '#[Other.xlsx]Data!A2',
      '#REF!',
      '#not valid',
    ])
      expect(rewriteHyperlinkTarget(target, context)).toBe(target);
    expect(rewriteHyperlinkTarget("#'#REF!'!A2", context)).toBe("#'#REF!'!A2");
  });
  it('moves columns and rejects out-of-grid destinations', () => {
    const column = {
      ...context,
      edit: { axis: 'column' as const, kind: 'insert' as const, index: 0, count: 1 },
    };
    expect(rewriteHyperlinkTarget('#B$3', column)).toBe('#C$3');
    expect(() => rewriteHyperlinkTarget('#XFD1', column)).toThrow('exceeds spreadsheet limits');
  });
  it('updates links on other sheets atomically and preserves them through XLSX', async () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.name = 'Data';
    sheet.cells.A2 = { value: 'destination' };
    book.sheets.push({
      ...sheet,
      id: 'links',
      name: 'Links',
      cells: {
        A1: { value: 'go', hyperlink: { target: '#Data!$A$2', tooltip: 'source' } },
      },
    });
    const before = structuredClone(book);
    const plan = planStructureEdit(book, sheet.id, context.edit);
    expect(plan.changedSheetIds).toEqual([sheet.id, 'links']);
    expect(plan.sheets[1].cells.A1.hyperlink).toEqual({ target: '#Data!$A$4', tooltip: 'source' });
    expect(book).toEqual(before);
    const restored = await workbookFromXlsx(await workbookToXlsx({ ...book, sheets: plan.sheets }));
    expect(restored.sheets[1].cells.A1.hyperlink?.target).toBe('#Data!$A$4');
  });
});

import { describe, expect, it } from 'vitest';
import { externalHyperlinkUrl, resolveInternalHyperlink } from '../src/lib/hyperlink-navigation';
import { createBlankWorkbook } from '../src/lib/seed';

describe('hyperlink navigation', () => {
  it.each(['hiddenRows', 'hiddenColumns'] as const)(
    'checks the resolved merge master against %s without changing workbook data',
    (axis) => {
      const book = createBlankWorkbook(),
        sheet = book.sheets[0];
      sheet.merges = [{ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } }];
      sheet[axis] = [0];
      const before = structuredClone(book);
      expect(() => resolveInternalHyperlink(book, sheet.id, '#B2')).toThrow('主格');
      expect(book).toEqual(before);
      sheet[axis] = [];
      expect(resolveInternalHyperlink(book, sheet.id, '#B2')).toEqual({
        sheetId: sheet.id,
        row: 0,
        col: 0,
      });
      sheet[axis] = [1];
      expect(() => resolveInternalHyperlink(book, sheet.id, '#B2')).toThrow('隐藏');
    },
  );
  it('allows explicit web and mail destinations without enabling arbitrary schemes', () => {
    expect(externalHyperlinkUrl('https://example.com/中文')).toBe(
      'https://example.com/%E4%B8%AD%E6%96%87',
    );
    expect(externalHyperlinkUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,hello',
      'file:///tmp/a',
      '//example.com',
      ' https://example.com',
      'https://example.com\n',
      'https:\\example.com',
      'https://user:pass@example.com',
      'mailto:',
      '#A1',
    ])
      expect(externalHyperlinkUrl(value)).toBeUndefined();
  });
  it('resolves local, quoted, case-insensitive and absolute addresses', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.name = "O'Brien 数据";
    expect(resolveInternalHyperlink(book, sheet.id, '#$B$3')).toEqual({
      sheetId: sheet.id,
      row: 2,
      col: 1,
    });
    expect(resolveInternalHyperlink(book, 'other', "#'o''brien 数据'!C4")).toEqual({
      sheetId: sheet.id,
      row: 3,
      col: 2,
    });
  });
  it('rejects missing, hidden and unsupported destinations, and selects merge masters', () => {
    const book = createBlankWorkbook(),
      sheet = book.sheets[0];
    sheet.hiddenRows = [2];
    sheet.hiddenColumns = [2];
    for (const value of [
      '#REF!',
      '#Missing!A1',
      '#A100000',
      '#A1:B2',
      '#NamedRange',
      '#[Other]Data!A1',
      '#A3',
      '#C1',
    ])
      expect(() => resolveInternalHyperlink(book, sheet.id, value)).toThrow();
    sheet.merges = [{ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } }];
    expect(resolveInternalHyperlink(book, sheet.id, '#B2')).toEqual({
      sheetId: sheet.id,
      row: 0,
      col: 0,
    });
  });
});

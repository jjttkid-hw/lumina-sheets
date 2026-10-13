import { describe, expect, it } from 'vitest';
import { findStoredCells, replaceStoredCells } from '../src/lib/search-replace';
import { createBlankWorkbook } from '../src/lib/seed';

function sheet(cells: Record<string, { value: string | number }>) {
  const result = createBlankWorkbook().sheets[0];
  result.cells = cells;
  result.rowCount = 1_048_576;
  result.colCount = 16_384;
  return result;
}
describe('bounded stored-cell search and replace', () => {
  it('returns row-major non-overlapping matches on sparse million-row sheets', () => {
    const s = sheet({ C9: { value: 'aa' }, B4: { value: '=aa' }, A1: { value: 'aaaa' } });
    expect(findStoredCells(s, 'aa')).toMatchObject([
      { key: 'A1', index: 0, length: 2 },
      { key: 'A1', index: 2, length: 2 },
      { key: 'C9', index: 0 },
    ]);
    expect(findStoredCells(s, 'aa', { includeFormulas: true })).toHaveLength(4);
    expect(findStoredCells(s, 'aa', { wholeCell: true })).toMatchObject([{ key: 'C9' }]);
  });
  it('matches Unicode source offsets without locale expansion and uses literal syntax', () => {
    const s = sheet({ A1: { value: 'İi Kk ſS 😀.*' } });
    expect(findStoredCells(s, 'i').map((m) => m.index)).toEqual([1]);
    expect(findStoredCells(s, 'k').map((m) => m.index)).toEqual([3, 4]);
    expect(findStoredCells(s, 's').map((m) => m.index)).toEqual([6, 7]);
    expect(findStoredCells(s, '.*')).toMatchObject([{ index: 11, length: 2 }]);
    expect(findStoredCells(s, 'k', { matchCase: true })).toMatchObject([{ index: 4 }]);
    expect(
      replaceStoredCells(s, { search: 'k', replacement: "$&$$$'" }).changes[0].cell.value,
    ).toBe("İi $&$$$'$&$$$' ſS 😀.*");
  });
  it('allows deletion, preserves metadata and clears changed rich text', () => {
    const s = sheet({ A1: { value: 'alpha beta' }, B1: { value: '=alpha' } });
    s.cells.A1.style = { bold: true };
    s.cells.A1.richText = [{ text: 'alpha beta', style: { italic: true } }];
    s.cells.A1.hyperlink = { target: 'https://example.com' };
    const result = replaceStoredCells(s, { search: 'alpha', replacement: '' });
    expect(result).toMatchObject({ matches: 1, changedCells: 1 });
    expect(result.changes[0].cell).toEqual({
      value: ' beta',
      style: { bold: true },
      hyperlink: s.cells.A1.hyperlink,
    });
    expect(s.cells.A1.value).toBe('alpha beta');
    expect(s.cells.A1.richText).toHaveLength(1);
    expect(replaceStoredCells(s, { search: 'alpha', replacement: 'alpha' }).changes).toEqual([]);
  });
  it('rejects budget overflow even without matches and never truncates', () => {
    const s = sheet({ A1: { value: 'aaaa' }, A2: { value: 'aaaa' } });
    expect(findStoredCells(s, 'a', { maxMatches: 8 })).toHaveLength(8);
    expect(() => replaceStoredCells(s, { search: 'a', replacement: 'b', maxMatches: 7 })).toThrow(
      '匹配数量',
    );
    expect(() => findStoredCells(s, 'z', { maxCells: 1 })).toThrow('单元格数量');
    expect(() => findStoredCells(s, 'z', { maxTextUnits: 7 })).toThrow('字符数量');
    expect(s.cells.A1.value).toBe('aaaa');
  });
  it('rejects unsafe formulas, text growth, invalid input and paged sources', () => {
    const s = sheet({ A1: { value: 'x' }, A2: { value: 'xx' } });
    expect(() => replaceStoredCells(s, { search: 'x', replacement: '=1' })).toThrow('转换为公式');
    expect(() => replaceStoredCells(s, { search: 'x', replacement: 'b'.repeat(32767) })).toThrow(
      '32,767',
    );
    expect(() => findStoredCells(s, '')).toThrow('查找内容');
    for (const options of [
      null,
      [],
      { maxMatches: 100001 },
      { matchCase: 'yes' },
      { maxCells: 0 },
      { maxTextUnits: NaN },
    ])
      expect(() => findStoredCells(s, 'x', options as never)).toThrow();
    expect(() => replaceStoredCells(s, null as never)).toThrow('请求');
    s.dataSource = { kind: 'paged', rowCount: 10, pageSize: 10, columnCount: 2 } as never;
    expect(() => findStoredCells(s, 'x')).toThrow('服务端');
  });
  it('edits formula source only when explicitly enabled', () => {
    const s = sheet({ A1: { value: '=SUM(B1:B3)' } });
    expect(findStoredCells(s, 'SUM')).toEqual([]);
    expect(
      replaceStoredCells(s, { search: 'SUM', replacement: 'MAX', includeFormulas: true }).changes[0]
        .cell.value,
    ).toBe('=MAX(B1:B3)');
  });
});

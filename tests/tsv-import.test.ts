import { describe, expect, it } from 'vitest';
import { csvToWorkbook, importFile, parseCsv } from '../src/lib/io';

describe('delimited file import', () => {
  it('uses the TSV extension even with unquoted commas in the header and values', async () => {
    const book = await importFile(new File(['地区,城市\t金额\r\n中国,上海\t12'], 'sales.TSV'));
    expect(book.name).toBe('sales');
    expect(book.sheets[0].cells).toMatchObject({
      A1: { value: '地区,城市' },
      B1: { value: '金额' },
      A2: { value: '中国,上海' },
      B2: { value: 12 },
    });
    expect(book.sheets[0].cells.C1).toBeUndefined();
  });
  it('retains commas in a single-column TSV instead of inventing extra columns', async () => {
    const book = await importFile(new File(['a,b\n1,2'], 'single.tsv'));
    expect(book.sheets[0].cells).toEqual({ A1: { value: 'a,b' }, A2: { value: '1,2' } });
  });
  it('supports BOM, quoted tabs/newlines, escaped quotes and empty trailing fields', async () => {
    const book = await importFile(
      new File(['\uFEFF"a,b"\t"note\tvalue"\tend\r\n00123\t"line1\nline2 ""ok"""\t'], 'quoted.tsv'),
    );
    const cells = book.sheets[0].cells;
    expect(cells.A1.value).toBe('a,b');
    expect(cells.B1.value).toBe('note\tvalue');
    expect(cells.A2.value).toBe('00123');
    expect(cells.B2.value).toBe('line1\nline2 "ok"');
    expect(cells.C2).toBeUndefined();
  });
  it('detects tab separation after quoted commas and multiline headers', () => {
    expect(parseCsv('"name,region\nsecond line"\tamount\n001\t10')).toEqual([
      ['name,region\nsecond line', 'amount'],
      ['001', '10'],
    ]);
    expect(csvToWorkbook('"a,b"\tc\ntext\t12').sheets[0].cells.B2.value).toBe(12);
  });
  it('does not misdetect quoted tabs in comma-delimited input', () => {
    expect(parseCsv('"a\tb",c\n"x,y",2')).toEqual([
      ['a\tb', 'c'],
      ['x,y', '2'],
    ]);
    expect(parseCsv('"a\t b"\rplain')).toEqual([['a\t b'], ['plain']]);
  });
  it('retains CSV auto-detection and explicit parse delimiters', async () => {
    const book = await importFile(new File(['a\tb\n1\t2'], 'legacy.csv'));
    expect(book.sheets[0].cells.B2.value).toBe(2);
    expect(parseCsv('a,b\tc', '\t')).toEqual([['a,b', 'c']]);
    expect(parseCsv('a;b\n1;2', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('imports 100,000 rows without expanding the row count into call arguments', async () => {
    const book = await importFile(new File([Array(100_000).fill('1').join('\n')], 'large.tsv'));
    expect(book.sheets[0].rowCount).toBe(100_000);
    expect(book.sheets[0].cells.A100000.value).toBe(1);
    expect(Object.keys(book.sheets[0].cells)).toHaveLength(100_000);
  });
  it('keeps malformed quoting and column quotas enforced on TSV', async () => {
    await expect(importFile(new File(['"unterminated'], 'bad.tsv'))).rejects.toThrow('未闭合');
    await expect(
      importFile(new File([Array(257).fill('x').join('\t')], 'wide.tsv')),
    ).rejects.toThrow('256 列');
  });
});

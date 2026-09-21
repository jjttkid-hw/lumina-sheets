import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { workbookFromXlsx } from '../src/lib/io';
import {
  readXlsxArchive,
  writeXlsxArchive,
  xmlChild,
  xmlChildren,
  xmlElement,
} from '../src/lib/xlsx-archive';

async function input(type: string, text: string, duplicate = false) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Values').getCell('A1').value = 1;
  const archive = await readXlsxArchive((await book.xlsx.writeBuffer()) as ArrayBuffer);
  const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
  const cell = xmlChildren(row, 'c')[0];
  cell.attributes.t = type;
  const value = xmlChild(cell, 'v')!;
  value.children = [text];
  if (duplicate) cell.children.push(structuredClone(value));
  return writeXlsxArchive(archive);
}

describe('XLSX scalar lexical validation', () => {
  it.each(['number', 'N', '', ' n ', 'custom'])(
    'rejects unknown cell type %j instead of interpreting its payload as a number',
    async (type) => {
      await expect(workbookFromXlsx(await input(type, '123tail'))).rejects.toThrow('单元格类型');
    },
  );
  it('keeps string values distinct from numbers and permits omitted numeric type', async () => {
    const string = await workbookFromXlsx(await input('str', '123tail'));
    expect(string.sheets[0].cells.A1.value).toBe('123tail');
    const archive = await readXlsxArchive(await input('n', '123'));
    const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
    delete xmlChildren(row, 'c')[0].attributes.t;
    const number = await workbookFromXlsx(await writeXlsxArchive(archive));
    expect(number.sheets[0].cells.A1.value).toBe(123);
  });
  it.each(['duplicate-inline', 'inline-value', 'numeric-inline', 'inline-formula'])(
    'rejects conflicting cell payloads instead of discarding content: %s',
    async (kind) => {
      const archive = await readXlsxArchive(await input('n', '1'));
      const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
      const cell = xmlChildren(row, 'c')[0];
      const inline = xmlElement('is', {}, [xmlElement('t', {}, ['must not disappear'])]);
      if (kind === 'numeric-inline') cell.children.push(inline);
      else {
        cell.attributes.t = 'inlineStr';
        cell.children = [inline];
        if (kind === 'duplicate-inline') cell.children.push(structuredClone(inline));
        if (kind === 'inline-value') cell.children.push(xmlElement('v', {}, ['123']));
        if (kind === 'inline-formula') cell.children.push(xmlElement('f', {}, ['1+1']));
      }
      await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toThrow(/重复|冲突/);
    },
  );
  it.each(['', 'plain text', '中文\ntext'])(
    'preserves a valid single inline string %j',
    async (text) => {
      const archive = await readXlsxArchive(await input('n', '1'));
      const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
      const cell = xmlChildren(row, 'c')[0];
      cell.attributes.t = 'inlineStr';
      cell.children = [xmlElement('is', {}, [xmlElement('t', {}, [text])])];
      const result = await workbookFromXlsx(await writeXlsxArchive(archive));
      expect(result.sheets[0].cells.A1?.value ?? '').toBe(text);
    },
  );
  it.each(['12oops', '0x10', '1e', '1,5', '1 2', 'Infinity', 'NaN', '1e999'])(
    'rejects malformed numeric value %j without partial parsing',
    async (text) => {
      await expect(workbookFromXlsx(await input('n', text))).rejects.toThrow('数值');
    },
  );
  it.each(['2', '-1', '1x', 'TRUE', 'falsey', ''])(
    'rejects malformed boolean value %j',
    async (text) => {
      await expect(workbookFromXlsx(await input('b', text))).rejects.toThrow('布尔');
    },
  );
  it.each([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
    [' true ', true],
  ] as const)('decodes valid boolean %j as %s', async (text, value) => {
    const book = await workbookFromXlsx(await input('b', text));
    expect(book.sheets[0].cells.A1.value).toBe(value);
  });
  it.each([
    ['+1.25e2', 125],
    ['.5', 0.5],
    ['1.', 1],
    [' 12 ', 12],
    ['-2.5E-2', -0.025],
  ] as const)('retains valid numeric XML spelling %j', async (text, value) => {
    const book = await workbookFromXlsx(await input('n', text));
    expect(book.sheets[0].cells.A1.value).toBe(value);
  });
  it.each(['n', 'b'])('rejects multiple value nodes for %s', async (type) => {
    await expect(workbookFromXlsx(await input(type, '1', true))).rejects.toThrow('重复');
  });
});

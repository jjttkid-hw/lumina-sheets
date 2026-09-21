import { describe, expect, it } from 'vitest';
import Excel from 'exceljs';
import { workbookFromXlsx } from '../src/lib/io';
import {
  readXlsxArchive,
  writeXlsxArchive,
  xmlChild,
  xmlChildren,
  xmlElement,
  parseXlsxXml,
  serializeXml,
} from '../src/lib/xlsx-archive';

async function input(storage: string, kind: string) {
  const book = new Excel.Workbook();
  book.addWorksheet('Data').getCell('A1').value = 'original';
  const archive = await readXlsxArchive((await book.xlsx.writeBuffer()) as ArrayBuffer);
  const shared = parseXlsxXml(await archive.zip.file('xl/sharedStrings.xml')!.async('string'));
  const container = xmlChildren(shared, 'si')[0];
  if (kind === 'duplicate') container.children.push(xmlElement('t', {}, ['extra']));
  if (kind === 'phonetic')
    container.children.push(
      xmlElement('rPh', { sb: '0', eb: '1' }, [xmlElement('t', {}, ['reading'])]),
    );
  if (kind === 'nested') xmlChild(container, 't')!.children = [xmlElement('t', {}, ['nested'])];
  if (kind === 'empty') container.children = [];
  if (storage === 'inline') {
    const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
    const cell = xmlChildren(row, 'c')[0];
    cell.attributes.t = 'inlineStr';
    cell.children = [xmlElement('is', {}, container.children)];
  } else archive.zip.file('xl/sharedStrings.xml', serializeXml(shared));
  return writeXlsxArchive(archive);
}
describe.each(['shared', 'inline'])('%s plain string structures', (storage) => {
  it.each(['duplicate', 'phonetic', 'nested'])(
    'rejects %s content instead of silently changing it',
    async (kind) => {
      await expect(workbookFromXlsx(await input(storage, kind))).rejects.toThrow(/文字|拼音/);
    },
  );
  it.each(['plain', 'empty'])('preserves valid %s content', async (kind) => {
    const result = await workbookFromXlsx(await input(storage, kind));
    expect(result.sheets[0].cells.A1?.value ?? '').toBe(kind === 'empty' ? '' : 'original');
  });
});

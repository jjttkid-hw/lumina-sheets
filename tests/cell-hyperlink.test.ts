import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { copyHyperlink } from '../src/lib/cell-hyperlink';
import { validateWorkbook, workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { createBlankWorkbook } from '../src/lib/seed';
import { planWorkspaceCellChanges } from '../src/lib/workspace-edit';
import { readXlsxArchive, writeXlsxArchive, xmlChild, xmlChildren } from '../src/lib/xlsx-archive';

describe('cell hyperlink metadata', () => {
  it.each(['https://example.com/a?x=1&y=2', "#'Data'!C3"])(
    'preserves an empty label and %s without serializing a placeholder or object as text',
    async (target) => {
      const book = createBlankWorkbook();
      book.sheets[0].name = 'Data';
      book.sheets[0].cells = {
        A1: { value: '', hyperlink: { target, tooltip: '空文字' } },
        B1: { value: ' ' },
        C1: { value: '普通文字' },
      };
      const bytes = await workbookToXlsx(book);
      const archive = await readXlsxArchive(bytes);
      const { xmlText } = await import('../src/lib/xlsx-archive');
      const row = xmlChildren(xmlChild(archive.sheets[0].xml, 'sheetData')!, 'row')[0];
      const cell = xmlChildren(row, 'c').find((node) => node.attributes.r === 'A1')!;
      expect(cell.attributes.t).toBe('inlineStr');
      expect(xmlText(xmlChild(cell, 'is')!)).toBe('');
      const { readXlsxHyperlinks } = await import('../src/lib/xlsx-hyperlinks');
      expect((await readXlsxHyperlinks(archive)).get('Data')!.get('A1')).toEqual({
        target,
        tooltip: '空文字',
      });
      const excel = new ExcelJS.Workbook();
      await excel.xlsx.load(bytes);
      // ExcelJS itself exposes an empty inline hyperlink label as undefined.
      expect(excel.worksheets[0].getCell('A1').text ?? '').toBe('');
      expect(excel.worksheets[0].getCell('A1').hyperlink).toBe(target);
      const restored = await workbookFromXlsx(bytes);
      expect(restored.sheets[0].cells.A1).toEqual(book.sheets[0].cells.A1);
      expect(restored.sheets[0].cells.B1.value).toBe(' ');
      expect(restored.sheets[0].cells.C1.value).toBe('普通文字');
    },
  );
  it('reads native internal location links and rejects ambiguous or missing-cell targets', async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Data').getCell('A1').value = {
      text: 'internal',
      hyperlink: 'https://example.com',
    };
    const archive = await readXlsxArchive(
      (await book.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    );
    const container = xmlChild(archive.sheets[0].xml, 'hyperlinks')!;
    const link = xmlChildren(container)[0];
    delete link.attributes['r:id'];
    link.attributes.location = "'Data'!B2";
    const imported = await workbookFromXlsx(await writeXlsxArchive(archive));
    expect(imported.sheets[0].cells.A1.hyperlink?.target).toBe("#'Data'!B2");
    expect(imported.sheets[0].cells.A1.value).toBe('internal');
    link.attributes.ref = 'B2';
    await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toThrow(
      '对应存储单元格',
    );
    link.attributes.ref = 'A1:B2';
    await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toThrow('超链接定义');
    link.attributes.ref = 'A1';
    container.children.push(structuredClone(link));
    await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toThrow('超链接定义');
  });
  it('rejects merged follower hyperlinks even when the follower has no text payload', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Data');
    sheet.getCell('A1').value = 'master';
    sheet.getCell('B1').value = { text: '', hyperlink: 'https://example.com' };
    const archive = await readXlsxArchive(
      (await book.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    );
    const { xmlElement } = await import('../src/lib/xlsx-archive');
    archive.sheets[0].xml.children.push(
      xmlElement('mergeCells', { count: '1' }, [xmlElement('mergeCell', { ref: 'A1:B1' })]),
    );
    await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toThrow('合并区域');
  });
  it.each([
    'https://example.com/a?q=中文&b=1',
    'mailto:hello@example.com',
    "#'Data'!A1",
    'file:///example/file.xlsx',
  ])('preserves %s and tooltip through ExcelJS, JSON and XLSX', async (target) => {
    const source = new ExcelJS.Workbook();
    source.addWorksheet('Data').getCell('A1').value = {
      text: '查看详情',
      hyperlink: target,
      tooltip: '打开来源',
    };
    const imported = await workbookFromXlsx(
      (await source.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    );
    expect(imported.sheets[0].cells.A1).toMatchObject({
      value: '查看详情',
      hyperlink: { target, tooltip: '打开来源' },
    });
    const json = validateWorkbook(JSON.parse(JSON.stringify(imported)));
    const bytes = await workbookToXlsx(json);
    const excel = new ExcelJS.Workbook();
    await excel.xlsx.load(bytes);
    expect(excel.worksheets[0].getCell('A1').value).toMatchObject({
      text: '查看详情',
      hyperlink: target,
    });
    const restored = await workbookFromXlsx(bytes);
    expect(restored.sheets[0].cells.A1.hyperlink).toEqual({ target, tooltip: '打开来源' });
  });
  it('copies link metadata and retains it through workspace patches', () => {
    const link = { target: 'https://example.com', tooltip: 'hint' };
    const book = createBlankWorkbook();
    book.sheets[0].cells.A1 = { value: 'link', hyperlink: link };
    const validated = validateWorkbook(book);
    link.target = 'changed';
    expect(validated.sheets[0].cells.A1.hyperlink?.target).toBe('https://example.com');
    const plan = planWorkspaceCellChanges(validated, validated.sheets[0].id, [
      { key: 'A1', cell: { ...validated.sheets[0].cells.A1, value: 'new label' } },
    ]);
    expect(plan?.changes[0].cell?.hyperlink).toEqual({
      target: 'https://example.com',
      tooltip: 'hint',
    });
  });
  it('rejects invalid metadata or unsupported formula/numeric link cells', async () => {
    for (const link of [
      null,
      {},
      { target: '' },
      { target: 'bad\nlink' },
      { target: 'x'.repeat(32768) },
      { target: 'x', tooltip: 1 },
      { target: 'x', extra: true },
    ])
      expect(() => copyHyperlink(link, 'text')).toThrow();
    for (const value of [1, true, '=1+2']) {
      const book = createBlankWorkbook();
      book.sheets[0].cells.A1 = { value, hyperlink: { target: 'https://example.com' } };
      expect(() => validateWorkbook(book)).toThrow('普通文本');
      await expect(workbookToXlsx(book)).rejects.toThrow('普通文本');
      expect(() =>
        planWorkspaceCellChanges(book, book.sheets[0].id, [
          { key: 'A1', cell: book.sheets[0].cells.A1 },
        ]),
      ).toThrow('普通文本');
    }
  });
  it('does not discard a hyperlink on a blank merged follower during export', async () => {
    const book = createBlankWorkbook();
    book.sheets[0].cells.B1 = { value: '', hyperlink: { target: 'https://example.com' } };
    book.sheets[0].merges = [{ start: { row: 0, col: 0 }, end: { row: 0, col: 1 } }];
    await expect(workbookToXlsx(book)).rejects.toThrow('合并区域');
  });
});

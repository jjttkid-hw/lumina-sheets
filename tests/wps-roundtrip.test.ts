import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { createEvaluator } from '../src/lib/engine';

it('preserves WPS 12.1.26055 saved text, formulas, validation and layout', async () => {
  const bytes = await readFile(new URL('./fixtures/wps/edited-report.xlsx', import.meta.url));
  const first = await workbookFromXlsx(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const second = await workbookFromXlsx(await workbookToXlsx(first));
  for (const book of [first, second]) {
    const [sheet, summary] = book.sheets;
    expect(sheet.name).toBe('业务 数据');
    expect(sheet.cells.A2.value).toBe(200);
    expect(sheet.cells.B5.value).toBe('_x0041_\r\n中文😀');
    expect(sheet.cells.C2.value).toBe('=A2-B2');
    expect(summary.cells.A1.value).toBe("='业务 数据'!C2*2");
    const evaluate = createEvaluator(book);
    expect(evaluate(sheet, 'C2')).toBe(170);
    expect(evaluate(summary, 'A1')).toBe(340);
    expect(sheet.cells.A1.richText?.map((r) => r.text).join('')).toBe('销售报告');
    expect(sheet.cells.A1.richText?.[0].style).toMatchObject({ bold: true, color: '#23644D' });
    expect(sheet.cells.D2.hyperlink).toEqual({
      target: 'https://example.com/lumina',
      tooltip: '打开项目',
    });
    expect(sheet.cells.A5.value).toBe(true);
    expect(sheet.cells.C5).toMatchObject({ value: 45292, style: { format: 'date' } });
    expect(sheet.merges).toEqual([{ start: { row: 3, col: 0 }, end: { row: 3, col: 1 } }]);
    expect(sheet.hiddenRows).toEqual([6]);
    expect(sheet.hiddenColumns).toEqual([5]);
    expect(sheet.frozenRows).toBe(1);
    expect(sheet.dataValidations?.[0]).toMatchObject({ kind: 'whole', min: 0, max: 1000 });
    expect(sheet.dataValidations?.[1]).toMatchObject({
      kind: 'list',
      values: ['待审核', '已确认', '已取消'],
    });
    expect(sheet.printSettings).toMatchObject({
      paperSize: 'A4',
      orientation: 'landscape',
      repeatRows: 1,
      rowBreaks: [20],
      columnBreaks: [8],
    });
  }
});

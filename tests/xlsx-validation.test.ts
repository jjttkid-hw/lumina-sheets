import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  readXlsxArchive,
  writeXlsxArchive,
  xmlElement,
  xmlChildren,
  xmlText,
} from '../src/lib/xlsx-archive';
import {
  exportXlsxValidationRules,
  extractXlsxValidationRules,
  importXlsxValidationRules,
  XlsxValidationError,
} from '../src/lib/xlsx-validation';
import { checkValue, type DataValidationRule } from '../src/lib/data-validation';

type ModelWorksheet = ExcelJS.Worksheet & {
  dataValidations: { model: Record<string, unknown>; add(address: string, value: unknown): void };
};
const range = (row: number, endRow = row, col = 0) => ({
  start: { row, col },
  end: { row: endRow, col },
});
const rules: DataValidationRule[] = [
  {
    id: 'int',
    kind: 'whole',
    range: range(0, 4),
    operator: 'between',
    min: 1,
    max: 10,
    allowBlank: false,
    message: '整数为 1 到 10',
  },
  {
    id: 'decimal',
    kind: 'decimal',
    range: range(5),
    operator: 'greaterThanOrEqual',
    value: 1.25,
    allowBlank: true,
  },
  {
    id: 'len',
    kind: 'textLength',
    range: range(6),
    operator: 'lessThanOrEqual',
    value: 8,
    allowBlank: false,
  },
  {
    id: 'list',
    kind: 'list',
    range: range(7, 9),
    values: ['待审核', '已通过', '拒绝'],
    allowBlank: false,
    message: '请选择状态',
  },
];
async function workbookBytes(entries: DataValidationRule[] = rules) {
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet('业务报表');
  ws.getCell('B1').value = 'only stored cell';
  exportXlsxValidationRules(ws, { id: 'sheet', dataValidations: entries });
  return {
    book,
    ws: ws as ModelWorksheet,
    bytes: (await book.xlsx.writeBuffer()) as unknown as ArrayBuffer,
  };
}
async function rawValidation(attributes: Record<string, string>, formulae: string[]) {
  const { bytes } = await workbookBytes([]);
  const archive = await readXlsxArchive(bytes);
  archive.sheets[0].xml.children.push(
    xmlElement('dataValidations', { count: '1' }, [
      xmlElement(
        'dataValidation',
        { showErrorMessage: '1', ...attributes },
        formulae.map((text, i) => xmlElement(`formula${i + 1}`, {}, [text])),
      ),
    ]),
  );
  return writeXlsxArchive(archive);
}

describe('XLSX data-validation interoperability', () => {
  it('roundtrips supported rules through a real XLSX file without materializing blank cells', async () => {
    const { ws, bytes } = await workbookBytes();
    expect(Object.keys(ws.dataValidations.model)).toEqual(['A1:A5', 'A6', 'A7', 'A8:A10']);
    expect(ws.actualRowCount).toBe(1);
    const extracted = (await extractXlsxValidationRules(bytes)).get('业务报表')!;
    expect(extracted.map(({ id: _id, ...rule }) => rule)).toEqual(
      rules.map(({ id: _id, ...rule }) => rule),
    );
    const imported = new ExcelJS.Workbook();
    await imported.xlsx.load(bytes, { ignoreNodes: ['dataValidations'] });
    const target = imported.getWorksheet('业务报表')!;
    expect(target.actualRowCount).toBe(1);
    expect(target.actualColumnCount).toBe(1);
    expect(target.getRow(8).hasValues).toBe(false);
    expect(checkValue('new-id', 'A1', 11, extracted)[0].code).toBe('OUT_OF_RANGE');
    expect(checkValue('new-id', 'A8', '已通过', extracted)).toEqual([]);
    const second = await workbookBytes(extracted);
    const twice = (await extractXlsxValidationRules(second.bytes)).get('业务报表')!;
    expect(twice).toEqual(extracted);
  });

  it('keeps a million-row validation as one range during export and raw import', async () => {
    const million: DataValidationRule[] = [{ ...rules[0], range: range(0, 1_048_575) }];
    const { ws, bytes } = await workbookBytes(million);
    expect(Object.keys(ws.dataValidations.model)).toEqual(['A1:A1048576']);
    expect(ws.actualRowCount).toBe(1);
    const imported = (await extractXlsxValidationRules(bytes)).get('业务报表')!;
    expect(imported).toHaveLength(1);
    expect(imported[0].range.end.row).toBe(1_048_575);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(bytes, { ignoreNodes: ['dataValidations'] });
    expect(loaded.worksheets[0].actualRowCount).toBe(1);
  });

  it('imports disjoint sqref fragments without filling the gap', async () => {
    const bytes = await rawValidation(
      {
        type: 'whole',
        operator: 'equal',
        sqref: '$A$1:$A$3 C5 D7:D8',
        allowBlank: '1',
        showErrorMessage: '1',
      },
      ['3'],
    );
    const imported = (await extractXlsxValidationRules(bytes)).get('业务报表')!;
    expect(imported.map((rule) => rule.range)).toEqual([
      range(0, 2),
      range(4, 4, 2),
      range(6, 7, 3),
    ]);
    expect(checkValue('id', 'B1', 99, imported)).toEqual([]);
    expect(checkValue('id', 'C5', 99, imported)[0].code).toBe('OUT_OF_RANGE');
  });

  it('compacts the expanded ExcelJS model back to rectangles and retains rules', async () => {
    const { bytes } = await workbookBytes();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(bytes);
    const imported = importXlsxValidationRules(loaded.worksheets[0], 'loaded');
    expect(imported).toHaveLength(4);
    expect(imported[0].range).toEqual(range(0, 4));
    expect(imported.every((rule) => rule.sheetId === 'loaded')).toBe(true);
  });

  it('writes literal Unicode inline list XML and retains messages and blank flags', async () => {
    const { bytes } = await workbookBytes();
    const archive = await readXlsxArchive(bytes);
    const validations = xmlChildren(archive.sheets[0].xml, 'dataValidations')[0];
    const list = xmlChildren(validations).find((item) => item.attributes.type === 'list')!;
    expect(xmlText(xmlChildren(list, 'formula1')[0])).toBe('"待审核,已通过,拒绝"');
    expect(list.attributes.error).toBe('请选择状态');
    expect(list.attributes.showErrorMessage).toBe('1');
    expect(list.attributes.errorStyle).toBe('stop');
    expect(list.attributes.allowBlank).toBeUndefined();
  });

  it.each(
    [[1, 2], [false, true], ['a,b'], ['a"b'], [''], ['a\nb'], ['x'.repeat(254)]].map((values) => [
      values,
    ]),
  )('rejects an inline list that cannot preserve literal string values: %j', (values) => {
    const book = new ExcelJS.Workbook(),
      ws = book.addWorksheet('Sheet');
    expect(() =>
      exportXlsxValidationRules(ws, {
        id: 'sheet',
        dataValidations: [{ ...rules[3], values } as DataValidationRule],
      }),
    ).toThrow(XlsxValidationError);
    expect(Object.keys((ws as ModelWorksheet).dataValidations.model)).toHaveLength(0);
  });

  it('rejects overlapping constraints atomically even when one rule is otherwise valid', () => {
    const book = new ExcelJS.Workbook(),
      ws = book.addWorksheet('Sheet') as ModelWorksheet;
    expect(() =>
      exportXlsxValidationRules(ws, {
        id: 'sheet',
        dataValidations: [rules[0], { ...rules[1], range: range(2) }],
      }),
    ).toThrow('重叠');
    expect(ws.dataValidations.model).toEqual({});
    expect(() =>
      exportXlsxValidationRules(ws, {
        id: 'sheet',
        dataValidations: [{ ...rules[0], message: 'x'.repeat(226) }],
      }),
    ).toThrow('225');
    expect(ws.dataValidations.model).toEqual({});
    expect(() =>
      exportXlsxValidationRules(ws, {
        id: 'sheet',
        dataValidations: [{ ...rules[0], sheetId: 'other' }],
      }),
    ).toThrow('其他工作表');
  });

  it.each([
    [{ type: 'custom' }, ['A1>2']],
    [{ type: 'date' }, ['1', '10']],
    [{ type: 'whole' }, ['1+2', '10']],
    [{ type: 'decimal' }, ['2E2+1', '500']],
    [{ type: 'whole' }, ['A1', '10']],
    [{ type: 'list' }, ['Sheet2!$A$1:$A$3']],
    [{ type: 'list' }, ['[other.xlsx]Sheet1!A1']],
    [{ type: 'list' }, ['"a,""b"""']],
    [{ type: 'whole', showErrorMessage: '0' }, ['1', '10']],
    [{ type: 'whole', errorStyle: 'warning' }, ['1', '10']],
    [{ type: 'whole', prompt: '请填写', showInputMessage: '1' }, ['1', '10']],
    [{ type: 'whole', showDropDown: '1' }, ['1', '10']],
  ] as [Record<string, string>, string[]][])(
    'rejects unsupported original XML without silent coercion: %j',
    async (attributes, formulas) => {
      const bytes = await rawValidation({ sqref: 'A1:A3', ...attributes }, formulas);
      await expect(extractXlsxValidationRules(bytes)).rejects.toBeInstanceOf(XlsxValidationError);
    },
  );

  it('rejects overlapping sqref fragments and validation extensions', async () => {
    const overlap = await rawValidation({ sqref: 'A1:A3 A2', type: 'whole' }, ['1', '10']);
    await expect(extractXlsxValidationRules(overlap)).rejects.toThrow('重叠');
    const bytes = await rawValidation({ sqref: 'A1', type: 'whole' }, ['1', '10']);
    const archive = await readXlsxArchive(bytes);
    archive.sheets[0].xml.children.push({
      name: 'dataValidations',
      qualifiedName: 'x14:dataValidations',
      uri: 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main',
      attributes: { 'xmlns:x14': 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main' },
      children: [],
    });
    await expect(extractXlsxValidationRules(await writeXlsxArchive(archive))).rejects.toThrow(
      '扩展',
    );
  });

  it('does not modify or alias caller rules during either direction', async () => {
    const input = structuredClone(rules),
      snapshot = structuredClone(input);
    const { ws, bytes } = await workbookBytes(input);
    const imported = (await extractXlsxValidationRules(bytes)).get('业务报表')!;
    imported[0].range.end.row = 20;
    expect(input).toEqual(snapshot);
    expect(ws.dataValidations.model['A1:A5']).toMatchObject({ formulae: [1, 10] });
  });
});

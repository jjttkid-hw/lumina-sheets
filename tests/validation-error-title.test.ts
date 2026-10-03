import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { copyDataValidationRules, checkValue } from '../src/lib/data-validation';
import { workbookFromXlsx, workbookToXlsx, validateWorkbook } from '../src/lib/io';
import { planWorkspaceCellChanges } from '../src/lib/workspace-edit';
import { readXlsxArchive, writeXlsxArchive, xmlChildren } from '../src/lib/xlsx-archive';
import { encodeXlsxString } from '../src/lib/xlsx-string';

describe('validation error titles', () => {
  it('imports the retained WPS title and preserves it through JSON and XLSX', async () => {
    const bytes = await readFile(
      'docs/acceptance/wps-business-2026-10-03-r34/wps-custom-title.xlsx',
    );
    const imported = await workbookFromXlsx(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    );
    const rule = imported.sheets[2].dataValidations![0];
    expect(rule.errorTitle).toBe('审批状态');
    expect(rule.message).toBe('请选择通过、待审或拒绝');
    const json = validateWorkbook(JSON.parse(JSON.stringify(imported)));
    expect(json.sheets[2].dataValidations![0].errorTitle).toBe('审批状态');
    const failure = checkValue(json.sheets[2].id, 'D2', '无效', json.sheets[2].dataValidations!)[0];
    expect(failure.errorTitle).toBe('审批状态');
    expect(failure.message).toBe('请选择通过、待审或拒绝');
    expect(() =>
      planWorkspaceCellChanges(json, json.sheets[2].id, [{ key: 'D2', cell: { value: '无效' } }]),
    ).toThrow('审批状态');
    const exported = await workbookToXlsx(json);
    const external = new ExcelJS.Workbook();
    await external.xlsx.load(exported);
    expect(external.worksheets[2].getCell('D2').dataValidation.errorTitle).toBe('审批状态');
    const restored = await workbookFromXlsx(exported);
    expect(restored.sheets[2].dataValidations![0].errorTitle).toBe('审批状态');
  });
  it('validates explicit title bounds and keeps default failures unchanged', () => {
    const base = {
      id: 'list',
      kind: 'list',
      range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      values: ['有效'],
    };
    for (const errorTitle of ['', '审'.repeat(32)]) {
      const rules = copyDataValidationRules([{ ...base, errorTitle }]);
      expect(checkValue('s', 'A1', '无效', rules)[0].errorTitle).toBe(errorTitle);
    }
    for (const errorTitle of [null, 123, '审'.repeat(33)])
      expect(() => copyDataValidationRules([{ ...base, errorTitle }])).toThrow('errorTitle');
    expect(checkValue('s', 'A1', '无效', copyDataValidationRules([base]))[0]).not.toHaveProperty(
      'errorTitle',
    );
  });
  it('rejects oversized XLSX titles before importing and retains Unicode/control escapes', async () => {
    const bytes = await readFile(
      'docs/acceptance/wps-business-2026-10-03-r34/wps-custom-title.xlsx',
    );
    const archive = await readXlsxArchive(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    );
    const rules = xmlChildren(archive.sheets[2].xml, 'dataValidations')[0];
    const rule = xmlChildren(rules, 'dataValidation')[0];
    rule.attributes.errorTitle = 'x'.repeat(33);
    await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toThrow('32');
    const title = '审批😀\r\n\t_x0041_\u0001';
    const message = '请选择\r\n\t_x000D_\u0002😀';
    rule.attributes.errorTitle = encodeXlsxString(title);
    rule.attributes.error = encodeXlsxString(message);
    const imported = await workbookFromXlsx(await writeXlsxArchive(archive));
    const restored = await workbookFromXlsx(await workbookToXlsx(imported));
    expect(imported.sheets[2].dataValidations![0].errorTitle).toBe(title);
    expect(imported.sheets[2].dataValidations![0].message).toBe(message);
    expect(restored.sheets[2].dataValidations![0].errorTitle).toBe(title);
    expect(restored.sheets[2].dataValidations![0].message).toBe(message);
  });
});

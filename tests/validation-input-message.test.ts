import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { copyDataValidationRules } from '../src/lib/data-validation';
import { workbookFromXlsx, workbookToXlsx } from '../src/lib/io';
import { readXlsxArchive, writeXlsxArchive, xmlChildren } from '../src/lib/xlsx-archive';
import { encodeXlsxString } from '../src/lib/xlsx-string';

const fixture = 'docs/acceptance/wps-business-2026-10-03-r34/wps-custom-title.xlsx';
describe('validation selection input messages', () => {
  it('imports and roundtrips enabled and disabled input messages without changing Stop errors', async () => {
    for (const enabled of [true, false]) {
      const archive = await readXlsxArchive(await readFile(fixture));
      const raw = xmlChildren(
        xmlChildren(archive.sheets[2].xml, 'dataValidations')[0],
        'dataValidation',
      )[0];
      raw.attributes.showInputMessage = enabled ? '1' : '0';
      const promptTitle = '审批说明😀';
      const prompt = '请选择审批状态\r\n\t_x0041_';
      raw.attributes.promptTitle = encodeXlsxString(promptTitle);
      raw.attributes.prompt = encodeXlsxString(prompt);
      const book = await workbookFromXlsx(await writeXlsxArchive(archive));
      const rule = book.sheets[2].dataValidations![0];
      expect(rule).toMatchObject({
        promptTitle,
        prompt,
        showInputMessage: enabled,
        errorTitle: '审批状态',
      });
      const restored = await workbookFromXlsx(await workbookToXlsx(book));
      expect(restored.sheets[2].dataValidations![0]).toEqual(rule);
    }
  });
  it('rejects malformed original XML metadata before loading workbook cells', async () => {
    for (const [key, value] of [
      ['promptTitle', 'x'.repeat(33)],
      ['prompt', 'x'.repeat(256)],
      ['showInputMessage', 'yes'],
    ]) {
      const archive = await readXlsxArchive(await readFile(fixture));
      const raw = xmlChildren(
        xmlChildren(archive.sheets[2].xml, 'dataValidations')[0],
        'dataValidation',
      )[0];
      raw.attributes[key] = value;
      await expect(workbookFromXlsx(await writeXlsxArchive(archive))).rejects.toMatchObject({
        code: 'XLSX_VALIDATION_UNSUPPORTED',
      });
    }
  });
  it('retains empty prompts and an omitted display flag across XLSX', async () => {
    const book = await workbookFromXlsx(await readFile(fixture));
    Object.assign(book.sheets[2].dataValidations![0], { promptTitle: '', prompt: '' });
    const restored = await workbookFromXlsx(await workbookToXlsx(book));
    const rule = restored.sheets[2].dataValidations![0];
    expect(rule).toMatchObject({ promptTitle: '', prompt: '' });
    expect(rule).not.toHaveProperty('showInputMessage');
  });
  it('preserves the native WPS-saved prompt and all source cell values', async () => {
    const root = 'docs/acceptance/browser-candidate-2026-10-03-r36';
    const before = await workbookFromXlsx(
      await readFile(`${root}/input-prompts/chromium/enabled-prompt.xlsx`),
    );
    const after = await workbookFromXlsx(
      await readFile(`${root}/native-wps-input-prompt/wps-saved.xlsx`),
    );
    expect(after.sheets.map((sheet) => sheet.name)).toEqual(
      before.sheets.map((sheet) => sheet.name),
    );
    for (let index = 0; index < before.sheets.length; index++) {
      const original = before.sheets[index];
      const restored = after.sheets[index];
      const values = (sheet: typeof original) =>
        Object.fromEntries(Object.entries(sheet.cells).map(([key, cell]) => [key, cell.value]));
      expect(values(restored)).toEqual(values(original));
      expect(restored.dataValidations).toEqual(original.dataValidations);
    }
    const rule = after.sheets[2].dataValidations![0];
    expect(rule).toMatchObject({
      promptTitle: '审批说明😀',
      prompt: '请选择审批状态\n请先核对金额 <b>原文</b> _x0041_',
      showInputMessage: true,
    });
    const again = await workbookFromXlsx(await workbookToXlsx(after));
    expect(again.sheets[2].dataValidations).toEqual(after.sheets[2].dataValidations);
  });
  it('validates title, prompt and visibility bounds without mutating callers', () => {
    const base = {
      id: 'rule',
      kind: 'list',
      range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      values: ['a'],
    };
    expect(
      copyDataValidationRules([
        { ...base, promptTitle: 'x'.repeat(32), prompt: 'x'.repeat(255), showInputMessage: false },
      ])[0],
    ).toMatchObject({ showInputMessage: false });
    for (const invalid of [
      { promptTitle: 'x'.repeat(33) },
      { prompt: 'x'.repeat(256) },
      { prompt: null },
      { promptTitle: 1 },
      { showInputMessage: 'true' },
    ])
      expect(() => copyDataValidationRules([{ ...base, ...invalid }])).toThrow();
    expect(copyDataValidationRules([base])[0]).not.toHaveProperty('showInputMessage');
  });
});

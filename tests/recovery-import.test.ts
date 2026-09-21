import { describe, expect, it } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import { readRecoveryImport, restoreRecoveryWorkbook } from '../src/lib/recovery-import';
import { independentWorkbookCopy } from '../src/lib/workbook-copy';
import { checkValue } from '../src/lib/data-validation';
import { validateWorkbook } from '../src/lib/io';

function workbook() {
  const book = createBlankWorkbook('恢复模板');
  const sheet = book.sheets[0];
  sheet.cells = { A1: { value: 5 }, B1: { value: '=A1*2' } };
  sheet.dataValidations = [
    {
      id: 'rule',
      sheetId: sheet.id,
      kind: 'whole',
      operator: 'greaterThan',
      value: 0,
      range: { start: { row: 0, col: 0 }, end: { row: 5, col: 0 } },
    },
  ];
  return book;
}
describe('recovery file selection and independent copies', () => {
  it('recovers historical snapshots even when the current workbook and another revision are damaged', () => {
    const book = workbook();
    const input = {
      format: 'lumina-recovery',
      version: 1,
      complete: false,
      records: [
        {
          workbook: null,
          revisions: [null, { name: '关账前', createdAt: '2026-09-20T00:00:00Z', workbook: book }],
        },
      ],
    };
    const before = structuredClone(input);
    const backup = readRecoveryImport(input)!;
    expect(backup.records.map((r) => r.source)).toEqual(['工作空间', '历史版本', '历史版本']);
    expect(backup.records[2].detail).toBe('关账前 · 2026-09-20T00:00:00.000Z');
    expect(() => restoreRecoveryWorkbook(backup, 1)).toThrow();
    const copy = restoreRecoveryWorkbook(backup, 2);
    expect(copy.id).not.toBe(book.id);
    expect(copy.sheets[0].cells).toEqual(book.sheets[0].cells);
    expect(copy.sheets[0].dataValidations![0].sheetId).toBe(copy.sheets[0].id);
    expect(input).toEqual(before);
  });
  it('offers legacy-only historical versions and reports damaged history containers', () => {
    const book = workbook();
    const backup = readRecoveryImport({
      format: 'lumina-recovery',
      version: 1,
      complete: true,
      records: [],
      legacy: {
        'lumina.v1.history.first': '{broken',
        'lumina.v1.history.second': JSON.stringify([
          { name: 42, createdAt: 'invalid', workbook: book },
        ]),
      },
    })!;
    expect(backup.partial).toBe(true);
    expect(backup.directoryWarnings).toHaveLength(1);
    expect(backup.records[0].source).toBe('旧版历史');
    expect(backup.records[0].detail).toBe('未命名版本 · 时间未知');
    expect(restoreRecoveryWorkbook(backup, 0).name).toBe('恢复模板（恢复副本）');
  });
  it('applies the combined snapshot limit to histories and does not hide malformed current history', () => {
    const input = {
      format: 'lumina-recovery',
      version: 1,
      complete: true,
      records: [{ workbook: workbook(), revisions: null }],
    };
    expect(readRecoveryImport(input)!.partial).toBe(true);
    const revisions = Array(999).fill({ workbook: null });
    expect(
      readRecoveryImport({ ...input, records: [{ ...input.records[0], revisions }] })!.records,
    ).toHaveLength(1000);
    revisions.push({ workbook: null });
    expect(() =>
      readRecoveryImport({ ...input, records: [{ ...input.records[0], revisions }] }),
    ).toThrow('合计最多');
  });
  it('restores legacy-only and trash snapshots without merging versions of the same ID', () => {
    const source = workbook();
    const archived = structuredClone(source);
    archived.sheets[0].cells.A1.value = 99;
    const input = {
      format: 'lumina-recovery',
      version: 1,
      complete: false,
      records: [],
      warnings: ['工作簿存储无法读取'],
      legacy: {
        'lumina.v1.workbooks': JSON.stringify([source]),
        'lumina.v1.trash': JSON.stringify([null, archived]),
        'lumina.v1.settings': '{broken',
      },
    };
    const before = structuredClone(input);
    const backup = readRecoveryImport(input)!;
    expect(backup.records.map((r) => r.source)).toEqual(['旧版文档', '回收站', '回收站']);
    expect(() => restoreRecoveryWorkbook(backup, 1)).toThrow();
    const old = restoreRecoveryWorkbook(backup, 0);
    const copy = restoreRecoveryWorkbook(backup, 2);
    expect(old.sheets[0].cells.A1.value).toBe(5);
    expect(copy.sheets[0].cells.A1.value).toBe(99);
    expect(copy.id).not.toBe(source.id);
    expect(copy.id).not.toBe(old.id);
    expect(copy.sheets[0].dataValidations![0].sheetId).toBe(copy.sheets[0].id);
    expect(input).toEqual(before);
  });
  it.each(['{broken', '{}', 'null', 42])(
    'keeps other sources selectable with a damaged legacy list %s',
    (raw) => {
      const source = workbook();
      const backup = readRecoveryImport({
        format: 'lumina-recovery',
        version: 1,
        complete: true,
        records: [{ workbook: source }],
        legacy: { 'lumina.v1.workbooks': raw, 'lumina.v1.trash': JSON.stringify([source]) },
      })!;
      expect(backup.partial).toBe(true);
      expect(backup.warningCount).toBe(1);
      expect(backup.directoryWarnings[0]).toContain('旧版文档');
      expect(backup.records.map((r) => r.source)).toEqual(['工作空间', '回收站']);
      expect(restoreRecoveryWorkbook(backup, 1).sheets[0].cells).toEqual(source.sheets[0].cells);
    },
  );
  it('warns on a malformed legacy container and counts the combined directory before restoring', () => {
    const base = {
      format: 'lumina-recovery',
      version: 1,
      complete: true,
      records: [{ workbook: workbook() }],
    };
    expect(readRecoveryImport({ ...base, legacy: [] })!.directoryWarnings).toHaveLength(1);
    const input = {
      ...base,
      legacy: {
        'lumina.v1.workbooks': JSON.stringify(Array(499).fill(null)),
        'lumina.v1.trash': JSON.stringify(Array(500).fill(null)),
      },
    };
    expect(readRecoveryImport(input)!.records).toHaveLength(1000);
    input.legacy['lumina.v1.trash'] = JSON.stringify(Array(501).fill(null));
    expect(() => readRecoveryImport(input)).toThrow('合计最多');
  });
  it('preserves the recovery suffix and whole Unicode characters at the name limit', () => {
    const source = workbook();
    source.name = `${'x'.repeat(192)}😀tail`;
    const backup = readRecoveryImport({
      format: 'lumina-recovery',
      version: 1,
      records: [{ workbook: source }],
    })!;
    const copy = restoreRecoveryWorkbook(backup, 0);
    expect(copy.name).toBe(`${'x'.repeat(192)}😀（恢复副本）`);
    expect(validateWorkbook(copy).name).toBe(copy.name);
  });
  it('remaps sheet-scoped rules without changing the original or formula text', () => {
    const source = workbook();
    const before = structuredClone(source);
    const second = { ...structuredClone(source.sheets[0]), id: 'second', name: '第二页' };
    source.sheets.push(second);
    const copy = independentWorkbookCopy(source);
    expect(copy.id).not.toBe(source.id);
    expect(copy.activeSheetId).toBe(copy.sheets[0].id);
    expect(copy.sheets[0].dataValidations![0].sheetId).toBe(copy.sheets[0].id);
    expect(copy.sheets[1].dataValidations![0].sheetId).toBe(copy.sheets[0].id);
    expect(checkValue(copy.sheets[0].id, 'A1', -1, copy.sheets[0].dataValidations!)).toHaveLength(
      1,
    );
    expect(copy.sheets[0].cells.B1.value).toBe('=A1*2');
    expect(source.sheets[0]).toEqual(before.sheets[0]);
    copy.sheets[0].cells.A1.value = 100;
    expect(source.sheets[0].cells.A1.value).toBe(5);
  });
  it('selects a valid record from a partial backup even when another record is corrupt', () => {
    const source = workbook();
    const backup = readRecoveryImport({
      format: 'lumina-recovery',
      version: 1,
      complete: false,
      warnings: ['无法读取批注'],
      records: [
        { workbook: { name: '损坏' } },
        { workbook: source, comments: null, revisions: null },
      ],
      legacy: { 'lumina.v1.activeWorkbook': 'untrusted' },
    })!;
    expect(backup.partial).toBe(true);
    expect(backup.warningCount).toBe(2);
    expect(backup.directoryWarnings[0]).toContain('历史版本');
    expect(() => restoreRecoveryWorkbook(backup, 0)).toThrow();
    const recovered = restoreRecoveryWorkbook(backup, 1);
    expect(recovered.name).toBe(`${source.name}（恢复副本）`);
    expect(recovered.id).not.toBe(source.id);
    expect(recovered.sheets[0].cells).toEqual(source.sheets[0].cells);
    expect(recovered.sheets[0].dataValidations![0].sheetId).toBe(recovered.activeSheetId);
  });
  it.each([-1, 0.5, 1, NaN])('rejects invalid selected index %s', (index) => {
    const backup = readRecoveryImport({
      format: 'lumina-recovery',
      version: 1,
      records: [{ workbook: workbook() }],
    })!;
    expect(() => restoreRecoveryWorkbook(backup, index)).toThrow('请选择');
  });
  it('distinguishes ordinary files and rejects unsupported or oversized backup directories', () => {
    expect(readRecoveryImport(workbook())).toBeNull();
    expect(readRecoveryImport(null)).toBeNull();
    for (const input of [
      { version: 2, records: [{}] },
      { version: 1, records: 'bad' },
      { version: 1, records: Array(1001).fill({}) },
    ])
      expect(() => readRecoveryImport({ format: 'lumina-recovery', ...input })).toThrow('无效');
    expect(() =>
      readRecoveryImport({ format: 'lumina-recovery', version: 1, records: [] }),
    ).toThrow('legacy');
  });
});

import { describe, expect, it } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import { importFile, validateWorkbook, workbookToXlsx } from '../src/lib/io';
import { readRecoveryImport, restoreRecoveryWorkbook } from '../src/lib/recovery-import';
import { planWorkspaceCellChanges } from '../src/lib/workspace-edit';
import { MAX_ROWS } from '../src/lib/engine';

describe('paged snapshot metadata', () => {
  it('preserves validated paging metadata and isolates the source', () => {
    const book = createBlankWorkbook();
    book.sheets[0].dataSource = { kind: 'paged', totalRows: MAX_ROWS, pageSize: 256 };
    const result = validateWorkbook(book);
    expect(result.sheets[0].dataSource).toEqual(book.sheets[0].dataSource);
    expect(result.sheets[0].dataSource).not.toBe(book.sheets[0].dataSource);
    expect(result.sheets[0].rowCount).toBe(book.sheets[0].rowCount);
  });

  it.each([
    null,
    [],
    'paged',
    {},
    { kind: 'remote' },
    { kind: 'paged', totalRows: -1 },
    { kind: 'paged', totalRows: NaN },
    { kind: 'paged', totalRows: MAX_ROWS + 1 },
    { kind: 'paged', totalRows: '10' },
    { kind: 'paged', pageSize: 0 },
    { kind: 'paged', pageSize: 1.5 },
    { kind: 'static', pageSize: Infinity },
  ])('rejects malformed metadata (%#)', (dataSource) => {
    const book = createBlankWorkbook();
    Object.assign(book.sheets[0], { dataSource });
    expect(() => validateWorkbook(book)).toThrow(/数据源|分页/);
  });

  it.each([{ kind: 'static' }, { kind: 'paged' }, { kind: 'paged', totalRows: 0, pageSize: 1 }])(
    'retains optional metadata without inventing counts (%#)',
    (dataSource) => {
      const book = createBlankWorkbook();
      Object.assign(book.sheets[0], { dataSource });
      expect(validateWorkbook(book).sheets[0].dataSource).toEqual(dataSource);
    },
  );

  it('keeps JSON-imported and recovered partial snapshots readonly and nonexportable', async () => {
    const book = createBlankWorkbook();
    book.sheets[0].dataSource = { kind: 'paged', totalRows: 1000 };
    book.sheets[0].cells.A1 = { value: 'partial' };
    const imported = await importFile(new File([JSON.stringify(book)], 'snapshot.json'));
    const backup = readRecoveryImport({
      format: 'lumina-recovery',
      version: 1,
      complete: true,
      records: [{ workbook: book }],
    })!;
    const restored = restoreRecoveryWorkbook(backup, 0);
    expect(restored.id).not.toBe(book.id);
    for (const candidate of [imported, restored]) {
      expect(candidate.sheets[0].dataSource).toEqual(book.sheets[0].dataSource);
      expect(() =>
        planWorkspaceCellChanges(candidate, candidate.activeSheetId, [
          { key: 'A1', cell: { value: 'overwrite' } },
        ]),
      ).toThrow('只读');
      await expect(workbookToXlsx(candidate)).rejects.toThrow('分页');
    }
    expect(book.sheets[0].cells.A1.value).toBe('partial');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { hydrateSheetPage, type ReportDataSource } from '../src/lib/report-data';
import { createBlankWorkbook } from '../src/lib/seed';

const make = () => {
  const sheet = createBlankWorkbook().sheets[0];
  sheet.cells = {
    A1: { value: 'outside row' },
    A2: { value: 'old' },
    B2: { value: '=1+2', style: { bold: true } },
    C2: { value: 'outside column' },
    A3: { value: 3 },
    B3: { value: 4 },
    A4: { value: 'after page' },
  };
  return sheet;
};
describe('explicit page hydration', () => {
  it('replaces short and empty rows across the declared columns without changing surrounding data', async () => {
    const sheet = make();
    const before = structuredClone(sheet);
    const result = await hydrateSheetPage(
      sheet,
      {
        columnCount: 2,
        fetchPage: async () => ({ rows: [['new'], []] }),
      },
      1,
      2,
    );
    expect(result.cells).toEqual({
      A1: { value: 'outside row' },
      A2: { value: 'new' },
      C2: { value: 'outside column' },
      A4: { value: 'after page' },
    });
    expect(sheet).toEqual(before);
  });
  it('preserves false and zero while clearing explicit and implicit blanks', async () => {
    const result = await hydrateSheetPage(
      make(),
      {
        columnCount: 2,
        fetchPage: async () => ({ rows: [[false, 0], ['']] }),
      },
      1,
      2,
    );
    expect(result.cells.A2.value).toBe(false);
    expect(result.cells.B2.value).toBe(0);
    expect(result.cells.A3).toBeUndefined();
    expect(result.cells.B3).toBeUndefined();
  });
  it.each(['source', 'response'])(
    'rejects missing rows against a total from %s atomically',
    async (kind) => {
      const sheet = make();
      const before = structuredClone(sheet);
      const source: ReportDataSource = {
        columnCount: 2,
        ...(kind === 'source' ? { rowCount: 10 } : {}),
        fetchPage: async () => ({ rows: [[9]], ...(kind === 'response' ? { totalRows: 10 } : {}) }),
      };
      await expect(hydrateSheetPage(sheet, source, 1, 2)).rejects.toThrow('缺行');
      expect(sheet).toEqual(before);
    },
  );
  it('retains rows outside a partial final response and keeps source dimensions', async () => {
    const sheet = make();
    const result = await hydrateSheetPage(
      sheet,
      {
        columnCount: 2,
        rowCount: 2,
        fetchPage: async () => ({ rows: [[9]], totalRows: 2 }),
      },
      1,
      2,
    );
    expect(result.cells.A2.value).toBe(9);
    expect(result.cells.B2).toBeUndefined();
    expect(result.cells.A3.value).toBe(3);
    expect(result.dataSource?.totalRows).toBe(2);
    expect(result.rowCount).toBe(sheet.rowCount);
  });
  it('uses declared source dimensions even when the response omits its total', async () => {
    const sheet = make();
    const result = await hydrateSheetPage(
      sheet,
      {
        rowCount: 1000,
        columnCount: 1,
        fetchPage: async () => ({ rows: [[1]] }),
      },
      0,
      1,
    );
    expect(result.rowCount).toBe(1000);
    expect(result.dataSource?.totalRows).toBe(1000);
    expect(result.cells.B2).toEqual(sheet.cells.B2);
  });
  it('rejects cancellation while reading the validated payload before copying sheet cells', async () => {
    const controller = new AbortController();
    const sheet = make();
    const scan = vi.fn();
    const cells = sheet.cells;
    sheet.cells = new Proxy(cells, {
      ownKeys: () => {
        scan();
        return Reflect.ownKeys(cells);
      },
    });
    const row: number[] = [];
    Object.defineProperty(row, '0', {
      get() {
        controller.abort();
        return 1;
      },
      enumerable: true,
    });
    await expect(
      hydrateSheetPage(
        sheet,
        { columnCount: 1, fetchPage: async () => ({ rows: [row] }) },
        0,
        1,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(scan).not.toHaveBeenCalled();
  });
});

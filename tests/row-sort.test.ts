import { describe, expect, it, vi } from 'vitest';
import { cellKey, createEvaluator } from '../src/lib/engine';
import { planRowSort } from '../src/lib/row-sort';
import type { RowSortRequest } from '../src/lib/row-sort';
import type { CellValue, Sheet } from '../src/lib/types';

function sheet(cells: Sheet['cells'] = {}, rowCount = 10, colCount = 5): Sheet {
  return { id: 'sort', name: 'Data', cells, rowCount, colCount };
}
const request = (rowCount: number, extra: Partial<RowSortRequest> = {}): RowSortRequest => ({
  startRow: 0,
  rowCount,
  keys: [{ column: 0, direction: 'asc' }],
  ...extra,
});
const values =
  (source: Sheet) =>
  (key: string): CellValue =>
    source.cells[key]?.value ?? '';
const applied = (source: Sheet, plan: ReturnType<typeof planRowSort>) => {
  const result = { ...source.cells };
  for (const change of plan.changes) {
    if (change.cell) result[change.key] = change.cell;
    else delete result[change.key];
  }
  return result;
};

describe('atomic sparse row sorting', () => {
  it.each(['target', 'tooltip', 'absent'] as const)(
    'moves identical labels with different link %s metadata',
    (difference) => {
      const first = { target: 'https://example.com/first', tooltip: 'first' };
      const second = difference === 'absent' ? undefined : { ...first, [difference]: 'second' };
      const source = sheet({
        A1: { value: 2 },
        A2: { value: 1 },
        B1: { value: 'details', hyperlink: first },
        B2: { value: 'details', ...(second ? { hyperlink: second } : {}) },
      });
      const before = structuredClone(source);
      const plan = planRowSort(source, request(2), values(source));
      const result = applied(source, plan);
      expect(result.B1.hyperlink).toEqual(second);
      expect(result.B2.hyperlink).toEqual(first);
      expect(plan.changes.map((change) => change.key)).toContain('B1');
      expect(plan.changes.map((change) => change.key)).toContain('B2');
      result.B2.hyperlink!.target = 'mutated candidate';
      expect(source).toEqual(before);
    },
  );
  it('stably orders multiple keys and reads each row/key at most once', () => {
    const source = sheet({
      A1: { value: '组2' },
      B1: { value: 1 },
      C1: { value: 'first' },
      A2: { value: '组2' },
      B2: { value: 3 },
      C2: { value: 'second' },
      A3: { value: '组2' },
      B3: { value: 3 },
      C3: { value: 'third' },
      A4: { value: '组10' },
      B4: { value: 8 },
      C4: { value: 'fourth' },
    });
    const read = vi.fn(values(source));
    const plan = planRowSort(
      source,
      request(4, {
        keys: [
          { column: 0, direction: 'asc' },
          { column: 1, direction: 'desc' },
        ],
      }),
      read,
    );
    expect(plan.rowOrder).toEqual([1, 2, 0, 3]);
    expect(plan.targetRows).toEqual([0, 1, 2, 3]);
    expect(plan.movedRows).toBe(3);
    expect(applied(source, plan).C1.value).toBe('second');
    expect(applied(source, plan).C2.value).toBe('third');
    expect(read).toHaveBeenCalledTimes(8);
    expect(new Set(read.mock.calls.map(([key]) => key)).size).toBe(8);
    expect(plan.changes.some(({ key }) => key.endsWith('4'))).toBe(false);
  });

  it('keeps blank cells last in both directions and sorts number/text/boolean by type', () => {
    const source = sheet({
      A1: { value: true },
      A2: { value: '10' },
      A3: { value: 2 },
      A4: { value: '' },
      A5: { value: false },
      A6: { value: 1 },
      A7: { value: '#REF!' },
    });
    expect(planRowSort(source, request(8), values(source)).rowOrder).toEqual([
      5, 2, 6, 1, 4, 0, 3, 7,
    ]);
    expect(
      planRowSort(source, request(8, { keys: [{ column: 0, direction: 'desc' }] }), values(source))
        .rowOrder,
    ).toEqual([0, 4, 1, 6, 2, 5, 3, 7]);
  });

  it('leaves hidden rows and metadata in place unless includeHidden is explicit', () => {
    const source = sheet({
      A1: { value: 3 },
      A2: { value: 1 },
      A3: { value: 2 },
      C2: { value: 'hidden' },
    });
    source.hiddenRows = [1];
    source.rowHeights = { 0: 60, 1: 10 };
    source.printSettings = { rowBreaks: [2] };
    const before = structuredClone(source);
    const plan = planRowSort(source, request(3), values(source));
    expect(plan.targetRows).toEqual([0, 2]);
    expect(plan.rowOrder).toEqual([2, 0]);
    expect(plan.changes.some(({ key }) => key.endsWith('2'))).toBe(false);
    expect(
      planRowSort(source, request(3, { includeHidden: true }), values(source)).rowOrder,
    ).toEqual([1, 2, 0]);
    expect(source).toEqual(before);
  });

  it('moves all sparse cells with their row, translates formulas, and isolates styles', () => {
    const source = sheet({
      A1: { value: 2 },
      B1: { value: '=A1+$A$1+A$1+$A1' },
      E1: { value: 'right', style: { bold: true, color: '#123' } },
      A2: { value: 1 },
      C2: { value: 'second' },
      D8: { value: '=A1' },
    });
    const before = structuredClone(source);
    const plan = planRowSort(source, request(2), values(source));
    const cells = applied(source, plan);
    expect(cells.B2.value).toBe('=A2+$A$1+A$1+$A2');
    expect(cells.B1).toBeUndefined();
    expect(cells.C1.value).toBe('second');
    expect(cells.C2).toBeUndefined();
    expect(cells.E2.style).toEqual({ bold: true, color: '#123' });
    cells.E2.style!.bold = false;
    expect(source).toEqual(before);
    expect(plan.changes.some(({ key }) => key === 'D8')).toBe(false);
  });

  it('sorts evaluated formula keys, keeping formulas outside the request coordinate based', () => {
    const source = sheet({
      A1: { value: '=C1*2' },
      C1: { value: 4 },
      A2: { value: '=C2*2' },
      C2: { value: 1 },
      D8: { value: '=A1' },
    });
    const book = {
      id: 'book',
      name: 'Book',
      description: '',
      sheets: [source],
      activeSheetId: source.id,
      createdAt: '',
      updatedAt: '',
    };
    const evaluate = createEvaluator(book);
    const plan = planRowSort(source, request(2), (key) => evaluate(source, key));
    const cells = applied(source, plan);
    expect(plan.rowOrder).toEqual([1, 0]);
    expect(cells.A1.value).toBe('=C1*2');
    expect(cells.A2.value).toBe('=C2*2');
    expect(cells.D8.value).toBe('=A1');
  });

  it('does not expand the logical row × column grid for a sparse million-row sheet', () => {
    const source = sheet(
      {
        A500001: { value: 3 },
        A500002: { value: 1 },
        XFD500001: { value: 'edge' },
        A1000000: { value: 'outside' },
      },
      1_048_576,
      16_384,
    );
    const read = vi.fn(values(source));
    const plan = planRowSort(source, request(3, { startRow: 500_000 }), read);
    expect(plan.rowOrder).toEqual([500_001, 500_000, 500_002]);
    expect(plan.changes).toHaveLength(4);
    expect(applied(source, plan).XFD500002.value).toBe('edge');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('returns a no-op without cloning cells when rows are already sorted or all excluded', () => {
    const source = sheet({
      A1: { value: 'alpha' },
      A2: { value: 'ALPHA' },
      C1: { value: '=Table1[A1]' },
    });
    expect(planRowSort(source, request(2), values(source))).toEqual({
      changes: [],
      rowOrder: [0, 1],
      targetRows: [0, 1],
      movedRows: 0,
    });
    source.hiddenRows = [0, 1];
    const read = vi.fn(values(source));
    expect(planRowSort(source, request(2), read)).toEqual({
      changes: [],
      rowOrder: [],
      targetRows: [],
      movedRows: 0,
    });
    expect(read).not.toHaveBeenCalled();
    expect(planRowSort(source, request(1, { includeHidden: true }), read).changes).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects invalid schemas, bounds, keys and frozen/merged ranges before evaluation', () => {
    const source = sheet();
    const read = vi.fn(values(source));
    const invalid: unknown[] = [
      null,
      [],
      {},
      { ...request(2), extra: 1 },
      { ...request(2), includeHidden: undefined },
      request(100_001),
      request(2, { startRow: 9 }),
      request(0),
      request(2, { startRow: 0.5 }),
      request(2, { keys: [] }),
      request(2, { keys: [{ column: 5, direction: 'asc' }] }),
      request(2, {
        keys: [
          { column: 0, direction: 'asc' },
          { column: 0, direction: 'desc' },
        ],
      }),
      { ...request(2), keys: [{ column: 0, direction: 'asc', typo: true }] },
      { ...request(2), keys: new Array(2) },
    ];
    for (const candidate of invalid)
      expect(() => planRowSort(source, candidate as RowSortRequest, read)).toThrow('行排序');
    const accessor = { ...request(2) };
    Object.defineProperty(accessor, 'startRow', {
      get() {
        throw new Error('must not execute');
      },
    });
    expect(() => planRowSort(source, accessor, read)).toThrow('访问器');
    source.frozenRows = 1;
    expect(() => planRowSort(source, request(2), read)).toThrow('冻结');
    source.frozenRows = 0;
    source.merges = [{ start: { row: 1, col: 4 }, end: { row: 3, col: 4 } }];
    expect(() => planRowSort(source, request(2), read)).toThrow('合并');
    expect(read).not.toHaveBeenCalled();
  });

  it('fails atomically on evaluator errors and unsupported moved formula syntax', () => {
    const source = sheet({ A1: { value: 2 }, A2: { value: 1 }, B1: { value: '=SUM(1:3)' } });
    const before = structuredClone(source);
    expect(() =>
      planRowSort(source, request(2), () => {
        throw new Error('eval failed');
      }),
    ).toThrow('eval failed');
    expect(() => planRowSort(source, request(2), () => NaN)).toThrow('无效值');
    expect(() => planRowSort(source, request(2), values(source))).toThrow('不支持的引用');
    expect(source).toEqual(before);
  });

  it('rejects oversized final patches instead of returning a partial permutation', () => {
    const source = sheet({}, 40, 2_501);
    for (let row = 0; row < 40; row++)
      for (let col = 0; col < 2_501; col++) source.cells[cellKey(row, col)] = { value: 40 - row };
    const before = source.cells.A1;
    expect(() => planRowSort(source, request(40), values(source))).toThrow('最终变更超过');
    expect(source.cells.A1).toBe(before);
    expect(source.cells.A1.value).toBe(40);
    expect(source.cells.A40.value).toBe(1);
  });
});

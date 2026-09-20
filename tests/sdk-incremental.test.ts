import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankWorkbook } from '../src/lib/seed';
import type { Workbook } from '../src/lib/types';

const mounting = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => mounting) }));
import { LuminaSpreadsheet } from '../src/sdk';

class TestElement {
  className = 'host';
  classList = {
    add: (name: string) => {
      this.className += ` ${name}`;
    },
  };
}
const instances: LuminaSpreadsheet[] = [];
function mount(workbook: Workbook) {
  const instance = new LuminaSpreadsheet(new TestElement() as unknown as HTMLElement, { workbook });
  instances.push(instance);
  return instance;
}
beforeEach(() => {
  vi.stubGlobal('HTMLElement', TestElement);
  vi.clearAllMocks();
});
afterEach(() => {
  for (const instance of instances.splice(0)) instance.destroy();
  vi.unstubAllGlobals();
});

function independentBook(count = 1000) {
  const book = createBlankWorkbook();
  const sheet = book.sheets[0];
  sheet.rowCount = count;
  for (let row = 1; row <= count; row++) {
    sheet.cells[`A${row}`] = { value: row };
    sheet.cells[`B${row}`] = { value: `=A${row}*2` };
  }
  return book;
}

describe('SDK incremental calculation integration', () => {
  it('preserves independent formula caches through setCell, undo and redo', () => {
    const instance = mount(independentBook());
    for (let row = 1; row <= 1000; row++) expect(instance.getValue(`B${row}`)).toBe(row * 2);
    const initial = instance.calculationStats;
    expect(initial).toMatchObject({
      cacheEntries: 1000,
      formulaEvaluations: 1000,
      dependencyChecks: 0,
    });

    instance.setCell('A500', 7);
    expect(instance.calculationStats).toMatchObject({ cacheEntries: 999, invalidatedEntries: 1 });
    expect(instance.getValue('B1000')).toBe(2000);
    expect(instance.calculationStats.formulaEvaluations).toBe(initial.formulaEvaluations);
    expect(instance.getValue('B500')).toBe(14);
    expect(instance.calculationStats.formulaEvaluations).toBe(initial.formulaEvaluations + 1);

    instance.undo();
    expect(instance.calculationStats.cacheEntries).toBe(999);
    expect(instance.getValue('B500')).toBe(1000);
    expect(instance.calculationStats.formulaEvaluations).toBe(initial.formulaEvaluations + 2);
    instance.redo();
    expect(instance.calculationStats.cacheEntries).toBe(999);
    expect(instance.getValue('B500')).toBe(14);
    expect(instance.calculationStats).toMatchObject({
      formulaEvaluations: 1003,
      invalidatedEntries: 3,
      dependencyChecks: 0,
    });
  });

  it('invalidates cross-sheet transitive formulas after load and active-sheet batches', () => {
    const book = createBlankWorkbook();
    const source = book.sheets[0];
    source.name = 'Source';
    source.cells = {
      A1: { value: 3 },
      A2: { value: 4 },
      C1: { value: "='Report'!B1+1" },
      D1: { value: '=100' },
    };
    const report = {
      ...source,
      id: 'report',
      name: 'Report',
      cells: {
        A1: { value: "='Source'!A1+'Source'!A2" },
        B1: { value: '=A1*2' },
        C1: { value: '=200' },
      },
    };
    book.sheets.push(report);
    book.activeSheetId = source.id;
    const instance = mount(createBlankWorkbook());
    instance.load(book);
    expect(instance.getValue('C1')).toBe(15);
    expect(instance.getValue('D1')).toBe(100);
    expect(instance.calculationStats.cacheEntries).toBe(4);
    instance.setCells([
      { key: 'A1', cell: { value: 5 } },
      { key: 'A2', cell: { value: 6 } },
    ]);
    expect(instance.calculationStats).toMatchObject({ cacheEntries: 1, invalidatedEntries: 3 });
    expect(instance.getValue('D1')).toBe(100);
    expect(instance.getValue('C1')).toBe(23);
    instance.undo();
    expect(instance.getValue('C1')).toBe(15);
    instance.redo();
    expect(instance.getValue('C1')).toBe(23);

    const snapshot = instance.toJSON();
    snapshot.activeSheetId = report.id;
    instance.load(snapshot);
    expect(instance.calculationStats.cacheEntries).toBe(0);
    expect(instance.getValue('B1')).toBe(22);
    expect(instance.getValue('C1')).toBe(200);
    instance.setCells([{ key: 'A1', cell: { value: "='Source'!A1*3" } }]);
    expect(instance.calculationStats).toMatchObject({ cacheEntries: 1, invalidatedEntries: 2 });
    expect(instance.getValue('B1')).toBe(30);
    expect(instance.getValue('C1')).toBe(200);
    expect(instance.calculationStats.dependencyChecks).toBe(0);
  });

  it('retains calculation caches for print, validation and display metadata edits', () => {
    const instance = mount(independentBook(10));
    expect(instance.getValue('B1')).toBe(2);
    expect(instance.getValue('B2')).toBe(4);
    const baseline = instance.calculationStats;
    instance.setPrintSettings({ orientation: 'portrait', paperSize: 'A4' });
    instance.setDataValidation([
      {
        id: 'positive',
        kind: 'whole',
        operator: 'greaterThan',
        value: 0,
        range: { start: { row: 0, col: 0 }, end: { row: 9, col: 0 } },
      },
    ]);
    instance.setConditionalRules([
      {
        operator: 'greaterThan',
        value: 0,
        range: { start: { row: 0, col: 1 }, end: { row: 9, col: 1 } },
        style: { bold: true },
      },
    ]);
    instance.select({ row: 1, col: 1 });
    expect(instance.calculationStats).toEqual(baseline);
    expect(instance.getValue('B1')).toBe(2);
    expect(instance.getValue('B2')).toBe(4);
    expect(instance.calculationStats.formulaEvaluations).toBe(baseline.formulaEvaluations);
    expect(instance.calculationStats.cacheHits).toBe(baseline.cacheHits + 2);

    // Undo/redo metadata transactions must keep results and graph intact too.
    instance.undo();
    instance.undo();
    instance.redo();
    instance.redo();
    expect(instance.calculationStats).toMatchObject({
      cacheEntries: 2,
      invalidatedEntries: 0,
      formulaEvaluations: 2,
    });
  });

  it('rejects an invalid validated batch without invalidating retained calculations', () => {
    const instance = mount(independentBook(10));
    expect(instance.getValue('B1')).toBe(2);
    instance.setDataValidation([
      {
        id: 'positive',
        kind: 'whole',
        operator: 'greaterThan',
        value: 0,
        range: { start: { row: 0, col: 0 }, end: { row: 9, col: 0 } },
      },
    ]);
    const before = instance.calculationStats;
    expect(() => instance.setCells([{ key: 'A1', cell: { value: -1 } }])).toThrow();
    expect(instance.calculationStats).toEqual(before);
    expect(instance.getValue('B1')).toBe(2);
    expect(instance.calculationStats.formulaEvaluations).toBe(before.formulaEvaluations);
  });
});

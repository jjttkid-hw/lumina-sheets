import { describe, expect, it } from 'vitest';
import { createEvaluator } from '../src/lib/engine';
import { createBlankWorkbook } from '../src/lib/seed';
import type { CellValue, Sheet } from '../src/lib/types';

function fixture(values: Record<string, CellValue> = {}, managedMutations = true) {
  const book = createBlankWorkbook();
  const sheet = book.sheets[0];
  sheet.cells = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }]));
  const evaluate = createEvaluator(book, { managedMutations, revision: 0 });
  const patch = (changes: Record<string, CellValue | undefined>, target = sheet) => {
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete target.cells[key];
      else target.cells[key] = { value };
    }
    evaluate.invalidateCells(target.id, Object.keys(changes));
  };
  return { book, sheet, evaluate, patch };
}

describe('managed incremental evaluator', () => {
  it('keeps independent cached formulas and does no dependency traversal on cache hits', () => {
    const { sheet, evaluate, patch } = fixture({
      A1: 2,
      B1: '=A1*2',
      C1: '=B1+1',
      E1: 10,
      F1: '=E1*3',
    });
    expect(evaluate(sheet, 'C1')).toBe(5);
    expect(evaluate(sheet, 'F1')).toBe(30);
    expect(evaluate.stats.cacheEntries).toBe(3);
    evaluate.resetStats();
    expect(evaluate(sheet, 'C1')).toBe(5);
    expect(evaluate.stats).toMatchObject({
      formulaEvaluations: 0,
      cacheHits: 1,
      dependencyChecks: 0,
    });
    patch({ A1: 4 });
    expect(evaluate.stats).toMatchObject({ cacheEntries: 1, invalidatedEntries: 2 });
    expect(evaluate(sheet, 'F1')).toBe(30);
    expect(evaluate(sheet, 'C1')).toBe(9);
    expect(evaluate.stats).toMatchObject({
      formulaEvaluations: 2,
      dependencyChecks: 0,
      cacheEntries: 3,
    });
  });

  it('invalidates cross-sheet and transitive dependencies', () => {
    const { book, sheet, evaluate, patch } = fixture({ A1: 3 });
    const other: Sheet = {
      ...sheet,
      id: 'other',
      name: '报表',
      cells: { A1: { value: `='${sheet.name}'!A1*2` }, B1: { value: '=A1+1' } },
    };
    book.sheets.push(other);
    expect(evaluate(other, 'B1')).toBe(7);
    evaluate.resetStats();
    patch({ A1: 5 });
    expect(evaluate.stats.invalidatedEntries).toBe(2);
    expect(evaluate(other, 'B1')).toBe(11);
    expect(evaluate.stats.formulaEvaluations).toBe(2);
  });

  it('replaces dependencies when an IF branch changes', () => {
    const { sheet, evaluate, patch } = fixture({
      A1: true,
      B1: 7,
      C1: 9,
      D1: '=IF(A1,B1,C1)',
      E1: '=D1*2',
    });
    expect(evaluate(sheet, 'E1')).toBe(14);
    evaluate.resetStats();
    patch({ C1: 11 });
    expect(evaluate.stats.invalidatedEntries).toBe(0);
    expect(evaluate(sheet, 'E1')).toBe(14);
    patch({ A1: false });
    expect(evaluate(sheet, 'E1')).toBe(22);
    evaluate.resetStats();
    patch({ B1: 99 });
    expect(evaluate.stats.invalidatedEntries).toBe(0);
    patch({ C1: 12 });
    expect(evaluate(sheet, 'E1')).toBe(24);
    expect(evaluate.stats.invalidatedEntries).toBe(2);
  });

  it('tracks blank inputs, deletions, and replacement of formulas with values', () => {
    const { sheet, evaluate, patch } = fixture({ B1: '=A1+2', C1: '=B1*2' });
    expect(evaluate(sheet, 'C1')).toBe(4);
    patch({ A1: 5 });
    expect(evaluate(sheet, 'C1')).toBe(14);
    patch({ A1: undefined });
    expect(evaluate(sheet, 'C1')).toBe(4);
    patch({ B1: 8 });
    expect(evaluate(sheet, 'C1')).toBe(16);
    evaluate.resetStats();
    patch({ A1: 100 });
    expect(evaluate.stats.invalidatedEntries).toBe(0);
    expect(evaluate(sheet, 'C1')).toBe(16);
    patch({ B1: '=A1+1' });
    expect(evaluate(sheet, 'C1')).toBe(202);
  });

  it('caches typed errors without confusing them with literal error-looking strings', () => {
    const { sheet, evaluate, patch } = fixture({
      A1: 0,
      B1: '=1/A1',
      C1: '=IFERROR(B1,"fallback")',
    });
    expect(evaluate(sheet, 'C1')).toBe('fallback');
    evaluate.resetStats();
    expect(evaluate(sheet, 'B1')).toBe('#DIV/0!');
    expect(evaluate(sheet, 'C1')).toBe('fallback');
    expect(evaluate.stats.formulaEvaluations).toBe(0);
    patch({ A1: 2 });
    expect(evaluate(sheet, 'C1')).toBe(0.5);
    patch({ B1: '#DIV/0!' });
    expect(evaluate(sheet, 'C1')).toBe('#DIV/0!');
  });

  it('repairs cached cyclic graphs after editing or deleting a cycle member', () => {
    const { sheet, evaluate, patch } = fixture({ A1: '=B1+1', B1: '=A1+1', C1: '=IFERROR(A1,0)' });
    expect(evaluate(sheet, 'C1')).toBe(0);
    expect(evaluate(sheet, 'A1')).toBe('#CYCLE!');
    evaluate.resetStats();
    patch({ B1: 10 });
    expect(evaluate.stats.invalidatedEntries).toBe(3);
    expect(evaluate(sheet, 'C1')).toBe(11);
    patch({ B1: '=A1+1' });
    expect(evaluate(sheet, 'C1')).toBe(0);
    patch({ B1: undefined });
    expect(evaluate(sheet, 'C1')).toBe(1);
  });

  it('stores a range rectangle rather than an edge per range member', () => {
    const { sheet, evaluate, patch } = fixture({ A1: 2, B1: '=SUM(A1:A100000)', C1: '=B1+1' });
    expect(evaluate(sheet, 'C1')).toBe(3);
    expect(evaluate.stats).toMatchObject({ directDependencyEdges: 1, rangeDependencyEdges: 1 });
    evaluate.resetStats();
    expect(evaluate(sheet, 'C1')).toBe(3);
    expect(evaluate.stats).toMatchObject({ dependencyChecks: 0, formulaEvaluations: 0 });
    patch({ A99999: 5 });
    expect(evaluate(sheet, 'C1')).toBe(8);
    expect(evaluate.stats).toMatchObject({
      invalidatedEntries: 2,
      formulaEvaluations: 2,
      rangeDependencyEdges: 1,
    });
    evaluate.resetStats();
    patch({ A100001: 50 });
    expect(evaluate.stats.invalidatedEntries).toBe(0);
  });

  it('propagates a changed formula inside a range and tracks ranges that currently error', () => {
    const { sheet, evaluate, patch } = fixture({
      D1: 2,
      A1: '=D1*2',
      A2: '=1/0',
      B1: '=IFERROR(SUM(A1:A4),-1)',
    });
    expect(evaluate(sheet, 'B1')).toBe(-1);
    patch({ A2: 1 });
    expect(evaluate(sheet, 'B1')).toBe(5);
    patch({ D1: 4 });
    expect(evaluate(sheet, 'B1')).toBe(9);
    patch({ A4: 3 });
    expect(evaluate(sheet, 'B1')).toBe(12);
  });

  it('removes obsolete range subscriptions and deduplicates patches', () => {
    const { sheet, evaluate, patch } = fixture({ A1: 1, B1: 2, C1: '=SUM(A1:A3)' });
    expect(evaluate(sheet, 'C1')).toBe(1);
    patch({ C1: '=SUM(B1:B3)' });
    expect(evaluate(sheet, 'C1')).toBe(2);
    expect(evaluate.stats.rangeDependencyEdges).toBe(1);
    evaluate.resetStats();
    patch({ A2: 3 });
    expect(evaluate.stats.invalidatedEntries).toBe(0);
    sheet.cells.B1.value = 5;
    evaluate.invalidateCells(sheet.id, ['$B$1', 'b1', 'B1'], 7);
    expect(evaluate.stats.invalidatedEntries).toBe(1);
    expect(evaluate.revision).toBe(7);
    expect(evaluate(sheet, 'C1')).toBe(5);
  });

  it('provides a full reset for structural changes and detached stats snapshots', () => {
    const { sheet, evaluate } = fixture({ A1: 2, B1: '=A1+1' });
    expect(evaluate(sheet, 'B1')).toBe(3);
    const snapshot = evaluate.stats;
    sheet.cells.A1.value = 8;
    evaluate.invalidate(10);
    expect(evaluate.stats).toMatchObject({
      cacheEntries: 0,
      directDependencyEdges: 0,
      rangeDependencyEdges: 0,
    });
    expect(snapshot.cacheEntries).toBe(1);
    expect(evaluate(sheet, 'B1')).toBe(9);
    expect(evaluate.revision).toBe(10);
    evaluate.resetStats();
    expect(evaluate.stats).toMatchObject({
      cacheEntries: 1,
      formulaEvaluations: 0,
      invalidatedEntries: 0,
    });
  });

  it('keeps thousands of independent results while recomputing one edited chain', () => {
    const values: Record<string, CellValue> = {};
    for (let row = 1; row <= 2000; row++) {
      values[`A${row}`] = row;
      values[`B${row}`] = `=A${row}*2`;
    }
    const { sheet, evaluate, patch } = fixture(values);
    for (let row = 1; row <= 2000; row++) expect(evaluate(sheet, `B${row}`)).toBe(row * 2);
    evaluate.resetStats();
    patch({ A1000: 7 });
    expect(evaluate.stats).toMatchObject({ invalidatedEntries: 1, cacheEntries: 1999 });
    expect(evaluate(sheet, 'B1000')).toBe(14);
    expect(evaluate(sheet, 'B2000')).toBe(4000);
    expect(evaluate.stats).toMatchObject({
      formulaEvaluations: 1,
      cacheHits: 1,
      dependencyChecks: 0,
    });
  });

  it('does not cache a stack-limit error in a valid tail formula', () => {
    const values: Record<string, CellValue> = { A300: 1 };
    for (let row = 1; row < 300; row++) values[`A${row}`] = `=A${row + 1}+1`;
    const { sheet, evaluate } = fixture(values);
    expect(evaluate(sheet, 'A1')).toBe('#NUM!');
    expect(evaluate(sheet, 'A200')).toBe(101);
  });

  it('bounds historical parsed expressions during repeated edits and reparses evicted formulas', () => {
    const { sheet, evaluate, patch } = fixture({ A1: '=0+1' });
    expect(evaluate(sheet, 'A1')).toBe(1);
    for (let edit = 1; edit <= 5000; edit++) {
      patch({ A1: `=${edit}+1` });
      expect(evaluate(sheet, 'A1')).toBe(edit + 1);
    }
    expect(evaluate.stats).toMatchObject({ parsedExpressions: 4096, cacheEntries: 1 });
    patch({ A1: '=0+1' });
    expect(evaluate(sheet, 'A1')).toBe(1);
    expect(evaluate.stats.parsedExpressions).toBe(4096);
    evaluate.invalidate();
    evaluate.resetStats();
    expect(evaluate.stats).toMatchObject({ parsedExpressions: 4096, cacheEntries: 0 });
    expect(evaluate(sheet, 'A1')).toBe(1);
  });

  it('indexes 10,000 independent ranges without scanning every subscription on edit', () => {
    const values: Record<string, CellValue> = {};
    for (let row = 1; row <= 10_000; row++) {
      values[`A${row * 2}`] = row;
      values[`C${row}`] = `=SUM(A${row * 2}:A${row * 2})`;
    }
    const { sheet, evaluate, patch } = fixture(values);
    for (let row = 1; row <= 10_000; row++) expect(evaluate(sheet, `C${row}`)).toBe(row);
    expect(evaluate.stats).toMatchObject({ rangeIndexNodes: 10_000, rangeDependencyEdges: 10_000 });
    evaluate.resetStats();
    patch({ A10000: 7 });
    expect(evaluate.stats).toMatchObject({
      invalidatedEntries: 1,
      cacheEntries: 9999,
      rangeIndexNodes: 9999,
    });
    expect(evaluate.stats.rangeCandidateChecks).toBeLessThan(32);
    expect(evaluate.stats.rangeNodeVisits).toBeLessThan(64);
    expect(evaluate(sheet, 'C5000')).toBe(7);
    expect(evaluate(sheet, 'C9999')).toBe(9999);
    expect(evaluate.stats.formulaEvaluations).toBe(1);
    evaluate.invalidate();
    expect(evaluate.stats).toMatchObject({ rangeIndexNodes: 0, rangeDependencyEdges: 0 });
  });

  it('handles indexed cross-sheet ranges, transitive formulas and releases changed branches', () => {
    const { book, sheet, evaluate, patch } = fixture({ A1: 2, A2: 3, B1: 10, B2: 20 });
    sheet.name = 'Inputs';
    const report: Sheet = {
      ...sheet,
      id: 'report-index',
      name: 'Report',
      cells: {
        A1: { value: true },
        B1: { value: '=IF(A1,SUM(Inputs!A1:A2),SUM(Inputs!B1:B2))' },
        C1: { value: '=B1*2' },
        D1: { value: '=SUM(C1:C1)' },
      },
    };
    book.sheets.push(report);
    expect(evaluate(report, 'D1')).toBe(10);
    expect(evaluate.stats.rangeIndexNodes).toBe(2);
    evaluate.resetStats();
    patch({ A1: 4, A2: 6 });
    expect(evaluate.stats.invalidatedEntries).toBe(3);
    expect(evaluate.stats.rangeIndexNodes).toBe(0);
    expect(evaluate(report, 'D1')).toBe(20);
    patch({ A1: false }, report);
    expect(evaluate(report, 'D1')).toBe(60);
    expect(evaluate.stats.rangeIndexNodes).toBe(2);
    evaluate.resetStats();
    patch({ A1: 100 });
    expect(evaluate.stats.invalidatedEntries).toBe(0);
    patch({ B1: 15 });
    expect(evaluate(report, 'D1')).toBe(70);
    patch({ B1: 9 }, report);
    expect(evaluate(report, 'D1')).toBe(18);
    expect(evaluate.stats.rangeIndexNodes).toBe(1);
    evaluate.resetStats();
    patch({ B2: 500 });
    expect(evaluate.stats).toMatchObject({
      invalidatedEntries: 0,
      rangeCandidateChecks: 0,
      rangeNodeVisits: 0,
    });
  });
});

describe('default mutable workbook compatibility', () => {
  it('observes direct mutable edits, nested IF branches and blank range members without notifications', () => {
    const { sheet, evaluate } = fixture(
      { A1: true, B1: 2, C1: 5, D1: '=IF(A1,B1,C1)', E1: '=SUM(D1:D3)' },
      false,
    );
    expect(evaluate(sheet, 'E1')).toBe(2);
    sheet.cells.B1.value = 3;
    expect(evaluate(sheet, 'E1')).toBe(3);
    sheet.cells.A1.value = false;
    expect(evaluate(sheet, 'E1')).toBe(5);
    sheet.cells.D3 = { value: 7 };
    expect(evaluate(sheet, 'E1')).toBe(12);
    delete sheet.cells.C1;
    expect(evaluate(sheet, 'E1')).toBe(7);
    expect(evaluate.stats.dependencyChecks).toBeGreaterThan(0);
  });

  it('recovers errors and cycles without explicit invalidation', () => {
    const { sheet, evaluate } = fixture({ A1: '=B1', B1: '=A1', C1: '=IFERROR(A1,"bad")' }, false);
    expect(evaluate(sheet, 'C1')).toBe('bad');
    expect(evaluate(sheet, 'C1')).toBe('bad');
    sheet.cells.B1.value = 4;
    expect(evaluate(sheet, 'C1')).toBe(4);
    sheet.cells.B1.value = '=1/0';
    expect(evaluate(sheet, 'C1')).toBe('bad');
    sheet.cells.B1.value = '#DIV/0!';
    expect(evaluate(sheet, 'C1')).toBe('#DIV/0!');
  });
});

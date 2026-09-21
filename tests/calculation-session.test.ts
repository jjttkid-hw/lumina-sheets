import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalculationSession } from '../src/lib/calculation-session';
import { CalculationTransferSender } from '../src/lib/calculation-transfer';
import { calculateSync, type CalculationRequest } from '../src/lib/calculation';
import { createBlankWorkbook } from '../src/lib/seed';

function fixture() {
  const book = createBlankWorkbook();
  const sheet = book.sheets[0];
  sheet.name = 'Input';
  sheet.rowCount = 3000;
  for (let i = 1; i <= 2000; i++) {
    sheet.cells[`A${i}`] = { value: i };
    sheet.cells[`B${i}`] = { value: `=A${i}*2` };
  }
  const sender = new CalculationTransferSender(),
    session = new CalculationSession();
  let id = 0;
  const run = (workbook = book, keys = Array.from({ length: 2000 }, (_, i) => `B${i + 1}`)) => {
    const request: CalculationRequest = {
      type: 'calculate',
      revision: ++id,
      workbook,
      targets: keys.map((key) => ({ sheetId: sheet.id, key })),
    };
    const message = structuredClone(sender.prepare(request, id));
    const result = session.calculate(message);
    sender.commit(request, id);
    expect(result.values).toEqual(calculateSync(request).values);
    return result;
  };
  return { book, sheet, session, sender, run };
}
afterEach(() => vi.useRealTimers());
describe('worker incremental calculation session', () => {
  it('matches fresh calculation through changing IF branches and repaired formula errors', () => {
    const { book, sheet, run } = fixture();
    sheet.cells = {
      A1: { value: 1 },
      A2: { value: 0 },
      A3: { value: 5 },
      B1: { value: '=IF(A1,A2,A3)' },
      C1: { value: '=IFERROR(10/B1,99)' },
      D1: { value: '=C1+1' },
    };
    run(book, ['B1', 'C1', 'D1']);
    let next = book;
    for (const [key, value] of [
      ['A1', 0],
      ['A3', 2],
      ['A2', 4],
      ['A1', 1],
      ['B1', '=D1'],
      ['B1', '=A3'],
      ['A3', 0],
    ] as const) {
      next = {
        ...next,
        sheets: [{ ...next.sheets[0], cells: { ...next.sheets[0].cells, [key]: { value } } }],
      };
      run(next, ['B1', 'C1', 'D1']);
    }
  });
  it('executes one of 2000 independent formulas after one input patch', () => {
    const { book, sheet, session, run } = fixture();
    run();
    expect(session.stats!.formulaEvaluations).toBe(2000);
    const next = { ...book, sheets: [{ ...sheet, cells: { ...sheet.cells, A1: { value: 42 } } }] };
    run(next);
    expect(session.stats!.formulaEvaluations).toBe(1);
    expect(session.stats!.cacheHits).toBe(1999);
    expect(session.stats!.dependencyChecks).toBe(0);
    run(next);
    expect(session.stats!.formulaEvaluations).toBe(0);
  });
  it('invalidates ranges, cross-sheet dependents, deletions and formula replacements', () => {
    const { book, sheet, session, run } = fixture();
    sheet.cells = { A1: { value: 2 }, B1: { value: '=SUM(A1:A3)' }, C1: { value: '=Other!A1' } };
    const other = { ...sheet, id: 'other', name: 'Other', cells: { A1: { value: '=Input!B1*2' } } };
    book.sheets.push(other);
    run(book, ['B1', 'C1']);
    const next = {
      ...book,
      sheets: [{ ...sheet, cells: { ...sheet.cells, A2: { value: 5 } } }, other],
    };
    run(next, ['B1', 'C1']);
    expect(session.stats!.formulaEvaluations).toBe(3);
    const last = {
      ...book,
      sheets: [{ ...sheet, cells: { B1: { value: 9 }, C1: sheet.cells.C1 } }, other],
    };
    run(last, ['B1', 'C1']);
    expect(session.stats!.formulaEvaluations).toBe(2);
  });
  it('resets after structural changes and full resynchronization', () => {
    const { book, sheet, session, sender, run } = fixture();
    run();
    const renamed = { ...book, sheets: [{ ...sheet, name: 'Renamed' }] };
    run(renamed);
    expect(session.stats!.formulaEvaluations).toBe(2000);
    sender.reset();
    run(renamed);
    expect(session.stats!.formulaEvaluations).toBe(2000);
  });
  it('refreshes TODAY and its dependents across a local calendar day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 12));
    const { book, sheet, session, run } = fixture();
    sheet.cells = { A1: { value: '=TODAY()' }, B1: { value: '=A1+1' } };
    const before = run(book, ['A1', 'B1']);
    vi.setSystemTime(new Date(2026, 8, 21, 12));
    const after = run(book, ['A1', 'B1']);
    expect(after.values[`${sheet.id}:B1`]).toBe(Number(before.values[`${sheet.id}:B1`]) + 1);
    expect(session.stats!.formulaEvaluations).toBe(2);
  });
  it('leaves valid cached values intact after an invalid patch', () => {
    const { book, sheet, session, run } = fixture();
    run();
    expect(() =>
      session.calculate({
        type: 'calculate-sheets',
        id: 2,
        baseId: 1,
        revision: 2,
        workbookId: book.id,
        sheetIds: [sheet.id],
        sheets: [],
        sheetPatches: [{ sheetId: sheet.id, cells: [{ key: 'A0', cell: { value: 8 } }] }],
        targets: [],
      }),
    ).toThrow();
    run();
    expect(session.stats!.formulaEvaluations).toBe(0);
  });
});

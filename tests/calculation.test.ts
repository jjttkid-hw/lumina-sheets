import { describe, expect, it } from 'vitest';
import { calculateSync, createCalculationRuntime } from '../src/lib/calculation';
import { createDemoWorkbook } from '../src/lib/seed';

describe('calculation runtime', () => {
  it('calculates requested targets with a revision envelope', () => {
    const workbook = createDemoWorkbook();
    const [revenue, goals] = workbook.sheets;
    const result = calculateSync({
      type: 'calculate',
      revision: 7,
      workbook,
      targets: [
        { sheetId: revenue.id, key: 'F2' },
        { sheetId: goals.id, key: 'C2' },
      ],
    });
    expect(result.revision).toBe(7);
    expect(result.values[`${revenue.id}:F2`]).toBe(78000);
    expect(result.values[`${goals.id}:C2`]).toBe(434000);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('provides a synchronous runtime for SSR and test environments', async () => {
    const workbook = createDemoWorkbook();
    const runtime = createCalculationRuntime({ useWorker: false });
    const result = await runtime.calculate(
      workbook,
      [{ sheetId: workbook.sheets[0].id, key: 'F2' }],
      3,
    );
    expect(result.values[`${workbook.sheets[0].id}:F2`]).toBe(78000);
    runtime.dispose();
  });
});

import { describe, expect, it } from 'vitest';
import { runRangeBenchmark } from '../src/lib/performance/range-benchmark';

describe('range benchmark correctness and measurement scope', () => {
  it('proves independent formulas remain cached while both strategies return exact sums', async () => {
    const report = await runRangeBenchmark({ formulaCount: 100, iterations: 5 });
    expect(report.storedCells).toBe(500);
    expect(report.samples.map((sample) => sample.checksum)).toEqual([401, 402, 403, 404, 405]);
    for (const sample of report.samples) {
      expect(sample.retainedCaches).toBe(99);
      expect(sample.incremental.formulaEvaluations).toBe(1);
      expect(sample.full.formulaEvaluations).toBe(100);
      expect(sample.incremental.rangeCandidateChecks).toBeLessThan(25);
    }
  });
  it('reports all affected formulas for overlapping ranges instead of implying selective savings', async () => {
    const report = await runRangeBenchmark({
      formulaCount: 100,
      iterations: 3,
      layout: 'overlapping',
    });
    expect(report.storedCells).toBe(104);
    expect(report.samples.map((sample) => sample.checksum)).toEqual([500, 600, 700]);
    expect(report.summary.meanRecomputedFormulas).toBe(100);
    expect(report.samples.every((sample) => sample.retainedCaches === 0)).toBe(true);
  });
  it('rejects invalid workloads and does not return a complete report after cancellation', async () => {
    await expect(runRangeBenchmark({ iterations: 0 })).rejects.toThrow();
    const controller = new AbortController();
    await expect(
      runRangeBenchmark({
        formulaCount: 5,
        iterations: 5,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toHaveProperty('name', 'AbortError');
  });
});

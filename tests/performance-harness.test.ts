import { describe, expect, it } from 'vitest';
import {
  benchmarkCalculations,
  benchmarkEditLatency,
  benchmarkPatches,
  benchmarkViewport,
  createBenchmarkWorkbook,
  formatBenchmarkReport,
  RenderMetricsCollector,
  runPerformanceBenchmark,
  sampleMemory,
} from '../src/lib/performance/harness';

describe('performance harness', () => {
  it('creates a sparse million-row workbook without allocating every row', () => {
    const workbook = createBenchmarkWorkbook({
      rows: 1_000_000,
      cols: 16_384,
      populatedRows: 20,
      populatedCols: 4,
    });
    const sheet = workbook.sheets[0];
    expect(sheet.rowCount).toBe(1_000_000);
    expect(sheet.colCount).toBe(16_384);
    expect(Object.keys(sheet.cells)).toHaveLength(80);
  });

  it('measures viewport geometry with bounded visible work', () => {
    const workbook = createBenchmarkWorkbook({ rows: 1_000_000, cols: 16_384, populatedRows: 100 });
    const metric = benchmarkViewport(workbook, { iterations: 12, warmupIterations: 1 });
    expect(metric.iterations).toBe(12);
    expect(metric.p95Ms).toBeGreaterThanOrEqual(0);
    expect(metric.details?.logicalRows).toBe(1_000_000);
    expect(Number(metric.details?.averagePaintedCells)).toBeLessThan(2_000);
  });

  it('benchmarks formula targets and incremental patches', () => {
    const workbook = createBenchmarkWorkbook({
      rows: 100,
      cols: 8,
      populatedRows: 50,
      populatedCols: 4,
    });
    const formulas = benchmarkCalculations(workbook, { targetCount: 25 });
    const edit = benchmarkEditLatency(workbook, { iterations: 5 });
    const patches = benchmarkPatches(workbook, { patchCount: 10 });
    expect(formulas.details?.targets).toBe(25);
    expect(formulas.details?.returnedValues).toBe(25);
    expect(edit.p95Ms).toBeGreaterThanOrEqual(0);
    expect(patches.throughput).toBeGreaterThan(0);
    expect(patches.details?.patches).toBe(10);
  });

  it('collects frame p95 and emits a report with optional budgets', () => {
    const collector = new RenderMetricsCollector();
    collector.record({ durationMs: 3, paintedCells: 40, domNodes: 1 });
    collector.record({ durationMs: 9, paintedCells: 60, domNodes: 1 });
    expect(collector.summary().p95Ms).toBe(9);
    const report = runPerformanceBenchmark({
      workbookOptions: { rows: 100, cols: 8, populatedRows: 20, populatedCols: 4 },
      viewport: { iterations: 4, warmupIterations: 0 },
      calculation: { targetCount: 10 },
      patches: { patchCount: 3 },
      budget: { viewportP95Ms: 1000, calculationMs: 1000 },
    });
    expect(report.passed).toBe(true);
    expect(formatBenchmarkReport(report)).toContain('Lumina 性能基准 PASS');
    expect(sampleMemory()).toBeTypeOf('object');
  });

  it('reports measurements without claiming a pass when no budgets are configured', () => {
    const report = runPerformanceBenchmark({
      workbookOptions: { rows: 4, cols: 4, populatedRows: 2, populatedCols: 4 },
      viewport: { iterations: 2, warmupIterations: 0 },
      calculation: { targetCount: 2 },
      edit: { iterations: 2 },
      patches: { patchCount: 2 },
    });
    expect(report.passed).toBeNull();
    expect(report.budgetStatus).toBe('not-configured');
    expect(formatBenchmarkReport(report)).toContain('MEASURED');
    expect(report.metrics.at(-1)?.name).toBe('persistence-patch-replay');
    const collector = new RenderMetricsCollector();
    collector.record({ durationMs: -1, paintedCells: 1, domNodes: 1 });
    collector.record({ durationMs: Number.NaN, paintedCells: 1, domNodes: 1 });
    expect(collector.size).toBe(0);
    expect(collector.summary()).not.toHaveProperty('estimatedFps');
  });
});

it.each([NaN, Infinity, -1, '16'])(
  'rejects invalid performance budgets before measuring: %s',
  (value) => {
    const options = {
      budget: { viewportP95Ms: value },
      get workbook() {
        throw Error('measurement started');
      },
    };
    expect(() => runPerformanceBenchmark(options as never)).toThrow('预算');
  },
);

it('rejects unknown budget keys rather than reporting a pass with no comparisons', () => {
  expect(() => runPerformanceBenchmark({ budget: { fps: 60 } } as never)).toThrow('预算');
});

it('retains a bounded chronological sample set and reports discarded measurements', () => {
  const collector = new RenderMetricsCollector(3);
  for (let i = 1; i <= 5; i++) collector.record({ durationMs: i, paintedCells: 10, domNodes: 1 });
  expect(collector.values().map((sample) => sample.durationMs)).toEqual([3, 4, 5]);
  expect(collector.summary()).toMatchObject({
    frames: 3,
    observedFrames: 5,
    droppedFrames: 2,
    sampleLimit: 3,
    maxMs: 5,
    p50Ms: 4,
  });
  collector.reset();
  expect(collector.summary()).toMatchObject({ frames: 0, observedFrames: 0, droppedFrames: 0 });
});

it('rejects invalid frame metadata and returns isolated sample copies', () => {
  const collector = new RenderMetricsCollector();
  for (const bad of [NaN, Infinity, -1]) {
    collector.record({ durationMs: 1, paintedCells: bad, domNodes: 1 });
    collector.record({ durationMs: 1, paintedCells: 1, domNodes: bad });
    collector.record({ durationMs: 1, paintedCells: 1, domNodes: 1, timestamp: bad });
  }
  expect(collector.size).toBe(0);
  collector.record({ durationMs: 1, paintedCells: 2, domNodes: 1 });
  collector.values()[0].durationMs = 999;
  expect(collector.summary().maxMs).toBe(1);
});

it.each([0, -1, 1.5, Infinity, 100001])('rejects invalid collector capacity %s', (capacity) => {
  expect(() => new RenderMetricsCollector(capacity)).toThrow();
});

it.each([null, [], 16, 'fast'])('rejects malformed budget containers (%#)', (budget) => {
  expect(() => runPerformanceBenchmark({ budget } as never)).toThrow('预算');
});

it('handles several ring rotations and keeps the observed count separate from retained frames', () => {
  const collector = new RenderMetricsCollector(2);
  for (let i = 0; i < 7; i++) collector.record({ durationMs: i, paintedCells: 1, domNodes: 1 });
  expect(collector.values().map((sample) => sample.durationMs)).toEqual([5, 6]);
  expect(collector.summary()).toMatchObject({
    frames: 2,
    observedFrames: 7,
    droppedFrames: 5,
    averageMs: 5.5,
  });
});

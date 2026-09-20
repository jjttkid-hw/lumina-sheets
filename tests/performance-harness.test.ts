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

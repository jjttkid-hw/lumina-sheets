import { applyWorkbookPatch, type WorkbookPatch } from '../persistence';
import { calculateSync, type CalculationTarget } from '../calculation';
import { cellKey, createEvaluator } from '../engine';
import { createBlankWorkbook } from '../seed';
import type { Cell, CellValue, Workbook } from '../types';
import {
  ColumnMetrics,
  HEADER_HEIGHT,
  MergeIndex,
  ROW_HEIGHT,
  ROW_LABEL_WIDTH,
  visibleRowWindow,
} from '../canvas/geometry';

/** A frame sample can be recorded from Spreadsheet's onRenderMetrics callback. */
export interface RenderFrameSample {
  durationMs: number;
  paintedCells: number;
  domNodes: number;
  timestamp?: number;
}

export interface RenderMetricsSummary {
  frames: number;
  observedFrames: number;
  droppedFrames: number;
  sampleLimit: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  averagePaintedCells: number;
  averageDomNodes: number;
}

function percentile(values: number[], rank: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(rank * sorted.length) - 1));
  return sorted[index];
}

/** Collects real canvas frame timings without depending on React or the DOM. */
export class RenderMetricsCollector {
  private samples: RenderFrameSample[] = [];
  private observed = 0;
  private cursor = 0;

  constructor(private readonly sampleLimit = 10_000) {
    if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 100_000)
      throw new RangeError('绘制样本上限必须为 1–100,000 的整数。');
  }

  record(sample: RenderFrameSample): void {
    if (
      [sample.durationMs, sample.paintedCells, sample.domNodes].some(
        (value) => !Number.isFinite(value) || value < 0,
      ) ||
      (sample.timestamp !== undefined &&
        (!Number.isFinite(sample.timestamp) || sample.timestamp < 0))
    )
      return;
    const copy = {
      durationMs: sample.durationMs,
      paintedCells: Math.max(0, Math.floor(sample.paintedCells)),
      domNodes: Math.max(0, Math.floor(sample.domNodes)),
      timestamp: sample.timestamp,
    };
    this.observed++;
    if (this.samples.length < this.sampleLimit) this.samples.push(copy);
    else {
      this.samples[this.cursor] = copy;
      this.cursor = (this.cursor + 1) % this.sampleLimit;
    }
  }

  get size(): number {
    return this.samples.length;
  }

  values(): RenderFrameSample[] {
    return [...this.samples.slice(this.cursor), ...this.samples.slice(0, this.cursor)].map(
      (sample) => ({ ...sample }),
    );
  }

  reset(): void {
    this.samples = [];
    this.observed = 0;
    this.cursor = 0;
  }

  summary(): RenderMetricsSummary {
    const durations = this.samples.map((sample) => sample.durationMs);
    const average = (values: number[]) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const averageMs = average(durations);
    return {
      frames: this.samples.length,
      observedFrames: this.observed,
      droppedFrames: this.observed - this.samples.length,
      sampleLimit: this.sampleLimit,
      averageMs,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      maxMs: durations.reduce((maximum, value) => Math.max(maximum, value), 0),
      averagePaintedCells: average(this.samples.map((sample) => sample.paintedCells)),
      averageDomNodes: average(this.samples.map((sample) => sample.domNodes)),
    };
  }
}

export interface MemorySample {
  /** Browser performance.memory is exposed only by Chromium with the relevant flag. */
  usedJsHeapSize?: number;
  totalJsHeapSize?: number;
  jsHeapSizeLimit?: number;
  rss?: number;
  heapUsed?: number;
  external?: number;
}

/** Read optional browser or Node memory counters without requiring either runtime. */
export function sampleMemory(): MemorySample {
  const root = globalThis as typeof globalThis & {
    performance?: Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    };
    process?: { memoryUsage?: () => { rss: number; heapUsed: number; external: number } };
  };
  const memory = root.performance?.memory;
  const nodeMemory = root.process?.memoryUsage?.();
  return {
    ...(memory
      ? {
          usedJsHeapSize: memory.usedJSHeapSize,
          totalJsHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit,
        }
      : {}),
    ...(nodeMemory
      ? { rss: nodeMemory.rss, heapUsed: nodeMemory.heapUsed, external: nodeMemory.external }
      : {}),
  };
}

export interface BenchmarkWorkbookOptions {
  /** Logical row count. This can be one million without allocating one million rows. */
  rows?: number;
  /** Logical column count (up to the spreadsheet's XFD boundary). */
  cols?: number;
  /** Number of rows to populate with data. Defaults to at most 10,000 logical rows. */
  populatedRows?: number;
  /** Number of leading columns to populate. Formula is written in the final populated column. */
  populatedCols?: number;
  /** Add a deterministic formula for every populated row. */
  formulas?: boolean;
}

/** Build deterministic data for repeatable large-sheet and calculation benchmarks. */
export function createBenchmarkWorkbook(options: BenchmarkWorkbookOptions = {}): Workbook {
  const rows = Math.max(1, Math.min(1_048_576, Math.floor(options.rows ?? 1_000_000)));
  const cols = Math.max(1, Math.min(16_384, Math.floor(options.cols ?? 256)));
  const populatedRows = Math.max(
    0,
    Math.min(rows, Math.floor(options.populatedRows ?? Math.min(rows, 10_000))),
  );
  const populatedCols = Math.max(1, Math.min(cols, Math.floor(options.populatedCols ?? 4)));
  const workbook = createBlankWorkbook('Lumina 性能基准');
  const sheet = workbook.sheets[0];
  sheet.rowCount = rows;
  sheet.colCount = cols;
  sheet.cells = {};
  for (let row = 0; row < populatedRows; row++) {
    for (let col = 0; col < populatedCols; col++) {
      let value: CellValue = (row + 1) * (col + 1);
      if (options.formulas !== false && col === populatedCols - 1 && populatedCols >= 3) {
        value = `=A${row + 1}+B${row + 1}`;
      }
      sheet.cells[cellKey(row, col)] = { value };
    }
  }
  return workbook;
}

export interface BenchmarkMetric {
  name: string;
  durationMs: number;
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  iterations: number;
  throughput?: number;
  details?: Record<string, number | string | boolean>;
}

export interface ViewportBenchmarkOptions {
  iterations?: number;
  warmupIterations?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  frozenRows?: number;
  zoom?: number;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function metricFromSamples(
  name: string,
  samples: number[],
  iterations: number,
  details?: Record<string, number | string | boolean>,
): BenchmarkMetric {
  const total = samples.reduce((sum, sample) => sum + sample, 0);
  return {
    name,
    durationMs: total,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
    iterations,
    details,
  };
}

/** Benchmarks row/column virtualization and hit-test geometry without allocating DOM nodes. */
export function benchmarkViewport(
  workbook: Workbook,
  options: ViewportBenchmarkOptions = {},
): BenchmarkMetric {
  const sheet = workbook.sheets[0];
  const iterations = Math.max(1, Math.floor(options.iterations ?? 120));
  const warmupIterations = Math.max(0, Math.floor(options.warmupIterations ?? 8));
  const width = Math.max(320, options.viewportWidth ?? 1_280);
  const height = Math.max(180, options.viewportHeight ?? 640);
  const zoom = Math.max(0.5, Math.min(2, options.zoom ?? 1));
  const frozenRows = Math.max(
    0,
    Math.min(sheet.rowCount, options.frozenRows ?? sheet.frozenRows ?? 1),
  );
  const metrics = new ColumnMetrics(sheet.colCount, sheet.columnWidths);
  const merges = new MergeIndex(sheet.merges, sheet.rowCount, sheet.colCount);
  const logicalWidth = Math.max(0, width / zoom - ROW_LABEL_WIDTH);
  const logicalHeight = Math.max(0, height / zoom - HEADER_HEIGHT);
  const maxScroll = Math.max(0, sheet.rowCount * ROW_HEIGHT - logicalHeight);
  const samples: number[] = [];
  let paintedCells = 0;
  const run = (index: number) => {
    const started = now();
    const scrollTop = maxScroll
      ? ((index % Math.max(1, iterations)) / Math.max(1, iterations - 1)) * maxScroll
      : 0;
    const scrollLeft =
      metrics.total > logicalWidth ? (index * 97) % (metrics.total - logicalWidth) : 0;
    const rows = visibleRowWindow(sheet.rowCount, frozenRows, scrollTop, logicalHeight);
    const columns = metrics.visible(scrollLeft, logicalWidth);
    const rowCount = Math.max(0, rows.last - rows.first + 1) + frozenRows;
    const colCount = Math.max(0, columns.last - columns.first + 1);
    // Querying merges exercises the same spatial index as a canvas paint.
    const rowAt = Math.min(
      sheet.rowCount - 1,
      Math.max(0, frozenRows + Math.floor(scrollTop / ROW_HEIGHT)),
    );
    const mergeCount = merges.query(
      rowAt,
      Math.min(sheet.rowCount - 1, rowAt + rowCount),
      columns.first,
      columns.last,
    ).length;
    paintedCells += rowCount * colCount + mergeCount;
    samples.push(Math.max(0, now() - started));
  };
  for (let index = 0; index < warmupIterations; index++) run(index);
  samples.length = 0;
  paintedCells = 0;
  for (let index = 0; index < iterations; index++) run(index);
  const metric = metricFromSamples('viewport-geometry', samples, iterations, {
    logicalRows: sheet.rowCount,
    logicalColumns: sheet.colCount,
    averagePaintedCells: Math.round(paintedCells / Math.max(1, iterations)),
    viewportWidth: width,
    viewportHeight: height,
  });
  metric.throughput = iterations / Math.max(0.001, metric.durationMs / 1000);
  return metric;
}

export interface CalculationBenchmarkOptions {
  targetCount?: number;
  warmupIterations?: number;
}

/** Benchmarks the same safe evaluator used by the calculation worker. */
export function benchmarkCalculations(
  workbook: Workbook,
  options: CalculationBenchmarkOptions = {},
): BenchmarkMetric {
  const sheet = workbook.sheets[0];
  const targets: CalculationTarget[] = Object.entries(sheet.cells)
    .filter(([, cell]) => typeof cell.value === 'string' && cell.value.startsWith('='))
    .slice(0, Math.max(1, Math.floor(options.targetCount ?? 10_000)))
    .map(([key]) => ({ sheetId: sheet.id, key }));
  if (!targets.length) {
    // Keep the benchmark meaningful for a data-only fixture.
    targets.push({ sheetId: sheet.id, key: cellKey(0, 0) });
  }
  const warmup = Math.max(0, Math.floor(options.warmupIterations ?? 1));
  for (let index = 0; index < warmup; index++)
    calculateSync({ type: 'calculate', revision: index, workbook, targets });
  const started = now();
  const response = calculateSync({ type: 'calculate', revision: warmup + 1, workbook, targets });
  const durationMs = Math.max(0, now() - started);
  // Touch the values so optimizing runtimes cannot discard the calculation work.
  const valueCount = Object.keys(response.values).length;
  return {
    name: 'formula-calculation',
    durationMs,
    iterations: 1,
    throughput: targets.length / Math.max(0.001, durationMs / 1000),
    details: { targets: targets.length, returnedValues: valueCount, workerEquivalent: true },
  };
}

export interface EditLatencyOptions {
  iterations?: number;
  editKey?: string;
  targetKeys?: string[];
}

/** Measures a value edit plus dependent formula reads on one in-memory workbook. */
export function benchmarkEditLatency(
  workbook: Workbook,
  options: EditLatencyOptions = {},
): BenchmarkMetric {
  const sheet = workbook.sheets[0];
  const iterations = Math.max(1, Math.floor(options.iterations ?? 100));
  const editKey = options.editKey ?? cellKey(0, 0);
  const formulaKeys = Object.entries(sheet.cells)
    .filter(([, cell]) => typeof cell.value === 'string' && cell.value.startsWith('='))
    .map(([key]) => key);
  const targetKeys = (options.targetKeys ?? formulaKeys.slice(0, 16)).slice(0, 128);
  const evaluator = createEvaluator(workbook);
  const original: Cell | null = sheet.cells[editKey] ?? null;
  const samples: number[] = [];
  for (let index = 0; index < iterations; index++) {
    const started = now();
    sheet.cells[editKey] = { value: index };
    for (const key of targetKeys) evaluator(sheet, key);
    samples.push(Math.max(0, now() - started));
  }
  if (original) sheet.cells[editKey] = original;
  else delete sheet.cells[editKey];
  const metric = metricFromSamples('edit-latency', samples, iterations, {
    editKey,
    dependentTargets: targetKeys.length,
  });
  metric.throughput = iterations / Math.max(0.001, metric.durationMs / 1000);
  return metric;
}

export interface PatchBenchmarkOptions {
  patchCount?: number;
}

/** Measures persistence journal replay. This is not the editor's paint or keypress path. */
export function benchmarkPatches(
  workbook: Workbook,
  options: PatchBenchmarkOptions = {},
): BenchmarkMetric {
  const sheet = workbook.sheets[0];
  const count = Math.max(1, Math.floor(options.patchCount ?? 100));
  const patches: WorkbookPatch[] = [];
  for (let index = 0; index < count; index++) {
    const key = cellKey(index % Math.max(1, sheet.rowCount), 0);
    const before: Cell | null = sheet.cells[key] ?? null;
    patches.push({ kind: 'cell', sheetId: sheet.id, key, cell: { value: index } });
    // Keep inverse data available to callers that want to build a transaction.
    void before;
  }
  let current = workbook;
  const samples: number[] = [];
  for (const patch of patches) {
    const started = now();
    current = applyWorkbookPatch(current, patch);
    samples.push(Math.max(0, now() - started));
  }
  const durationMs = samples.reduce((sum, value) => sum + value, 0);
  const metric = metricFromSamples('persistence-patch-replay', samples, count, {
    scope: 'persistence journal replay; excludes editor paint',
    patches: count,
    finalCellValue: String(
      current.sheets[0].cells[cellKey((count - 1) % Math.max(1, sheet.rowCount), 0)]?.value ?? '',
    ),
  });
  metric.throughput = count / Math.max(0.001, durationMs / 1000);
  return metric;
}

export interface PerformanceBudget {
  viewportP95Ms?: number;
  calculationMs?: number;
  patchP95Ms?: number;
}

export interface PerformanceBenchmarkOptions {
  workbook?: Workbook;
  workbookOptions?: BenchmarkWorkbookOptions;
  viewport?: ViewportBenchmarkOptions;
  calculation?: CalculationBenchmarkOptions;
  edit?: EditLatencyOptions;
  patches?: PatchBenchmarkOptions;
  budget?: PerformanceBudget;
}

export interface PerformanceBenchmarkReport {
  startedAt: string;
  finishedAt: string;
  environment: { userAgent?: string; hardwareConcurrency?: number; memory: MemorySample };
  metrics: BenchmarkMetric[];
  passed: boolean | null;
  budgetStatus: 'not-configured' | 'passed' | 'failed';
  failures: string[];
}

/** Run a deterministic local benchmark suite suitable for CI, devtools, or a diagnostics panel. */
export function runPerformanceBenchmark(
  options: PerformanceBenchmarkOptions = {},
): PerformanceBenchmarkReport {
  const budget = options.budget === undefined ? {} : options.budget;
  if (!budget || typeof budget !== 'object' || Array.isArray(budget))
    throw new TypeError('性能预算必须是对象。');
  for (const [key, value] of Object.entries(budget)) {
    if (!['viewportP95Ms', 'calculationMs', 'patchP95Ms'].includes(key))
      throw new TypeError(`未知性能预算：${key}`);
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))
      throw new RangeError(`性能预算 ${key} 必须是有限非负数。`);
  }
  const startedAt = new Date().toISOString();
  const workbook = options.workbook ?? createBenchmarkWorkbook(options.workbookOptions);
  const before = sampleMemory();
  const viewport = benchmarkViewport(workbook, options.viewport);
  const calculation = benchmarkCalculations(workbook, options.calculation);
  const edit = benchmarkEditLatency(workbook, options.edit);
  const patches = benchmarkPatches(workbook, options.patches);
  const after = sampleMemory();
  const failures: string[] = [];
  if (budget.viewportP95Ms !== undefined && (viewport.p95Ms ?? 0) > budget.viewportP95Ms)
    failures.push(`viewport p95 ${viewport.p95Ms?.toFixed(2)}ms > ${budget.viewportP95Ms}ms`);
  if (budget.calculationMs !== undefined && calculation.durationMs > budget.calculationMs)
    failures.push(`calculation ${calculation.durationMs.toFixed(2)}ms > ${budget.calculationMs}ms`);
  if (budget.patchP95Ms !== undefined && (patches.p95Ms ?? patches.durationMs) > budget.patchP95Ms)
    failures.push(
      `patch p95 ${(patches.p95Ms ?? patches.durationMs).toFixed(2)}ms > ${budget.patchP95Ms}ms`,
    );
  // Final observable counters; when a runtime omits a field, retain the initial reading.
  const memory = { ...before, ...after };
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      hardwareConcurrency:
        typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
      memory,
    },
    metrics: [viewport, calculation, edit, patches],
    passed: Object.values(budget).some((value) => value !== undefined)
      ? failures.length === 0
      : null,
    budgetStatus: Object.values(budget).some((value) => value !== undefined)
      ? failures.length
        ? 'failed'
        : 'passed'
      : 'not-configured',
    failures,
  };
}

/** A compact human-readable summary for diagnostics panels and benchmark artifacts. */
export function formatBenchmarkReport(report: PerformanceBenchmarkReport): string {
  const lines = report.metrics.map((metric) => {
    const p95 = metric.p95Ms === undefined ? '' : ` p95=${metric.p95Ms.toFixed(2)}ms`;
    const throughput =
      metric.throughput === undefined ? '' : ` throughput=${metric.throughput.toFixed(1)}/s`;
    return `${metric.name}: ${metric.durationMs.toFixed(2)}ms${p95}${throughput}`;
  });
  return [
    `Lumina 性能基准 ${report.passed === null ? 'MEASURED（未设置预算）' : report.passed ? 'PASS（自定义预算）' : 'FAIL（自定义预算）'}`,
    ...lines,
    ...report.failures,
  ].join('\n');
}

// Keep these constants in the public module so integrations can state the measured viewport budget.
export const DEFAULT_VIEWPORT_BUDGET = {
  headerHeight: HEADER_HEIGHT,
  rowHeight: ROW_HEIGHT,
  rowLabelWidth: ROW_LABEL_WIDTH,
};

// This import is intentionally exercised in type-checking benchmarks where a caller creates an evaluator.
export function evaluateBenchmarkCell(workbook: Workbook, key: string): CellValue {
  const evaluator = createEvaluator(workbook);
  return evaluator(workbook.sheets[0], key);
}

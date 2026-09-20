import { createEvaluator, type EvaluatorStats } from '../engine';
import { createBlankWorkbook } from '../seed';

export interface RangeBenchmarkSample {
  inputRow: number;
  invalidationMs: number;
  incrementalReadMs: number;
  fullRecalculationMs: number;
  retainedCaches: number;
  incremental: Readonly<EvaluatorStats>;
  full: Readonly<EvaluatorStats>;
  checksum: number;
}
export interface RangeBenchmarkReport {
  version: '0.5';
  measuredAt: string;
  layout: 'disjoint' | 'overlapping';
  formulaCount: number;
  storedCells: number;
  iterations: number;
  preparationMs: number;
  samples: RangeBenchmarkSample[];
  summary: {
    invalidationP50Ms: number;
    invalidationP95Ms: number;
    incrementalReadP50Ms: number;
    incrementalReadP95Ms: number;
    fullRecalculationP50Ms: number;
    fullRecalculationP95Ms: number;
    meanRecomputedFormulas: number;
    meanCandidateChecks: number;
    meanIndexVisits: number;
  };
}
export interface RangeBenchmarkOptions {
  formulaCount?: number;
  iterations?: number;
  layout?: 'disjoint' | 'overlapping';
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}
function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('范围基准已取消', 'AbortError');
}
async function yieldTask(signal?: AbortSignal) {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  abort(signal);
}

/** Isolated engine workload. No Canvas, network, SLA, or third-party baseline. */
export async function runRangeBenchmark(
  options: RangeBenchmarkOptions = {},
): Promise<RangeBenchmarkReport> {
  const formulaCount = options.formulaCount ?? 10000;
  const iterations = options.iterations ?? 30;
  const layout = options.layout ?? 'disjoint';
  if (
    !Number.isSafeInteger(formulaCount) ||
    formulaCount < 1 ||
    formulaCount > 20000 ||
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > 100 ||
    !['disjoint', 'overlapping'].includes(layout)
  )
    throw new RangeError('无效范围基准参数');
  abort(options.signal);
  const started = performance.now();
  const workbook = createBlankWorkbook('范围公式增量基准');
  const sheet = workbook.sheets[0];
  sheet.rowCount = Math.max(100, formulaCount * 4);
  const inputCount = layout === 'disjoint' ? formulaCount * 4 : 4;
  for (let row = 1; row <= inputCount; row++) sheet.cells[`A${row}`] = { value: 1 };
  for (let row = 1; row <= formulaCount; row++) {
    const start = layout === 'disjoint' ? (row - 1) * 4 + 1 : 1;
    sheet.cells[`B${row}`] = { value: `=SUM(A${start}:A${start + 3})` };
  }
  const incremental = createEvaluator(workbook, { managedMutations: true });
  const full = createEvaluator(workbook, { managedMutations: true });
  for (let row = 1; row <= formulaCount; row++) {
    if (incremental(sheet, `B${row}`) !== 4 || full(sheet, `B${row}`) !== 4)
      throw new Error('预热公式校验失败');
    if (row % 500 === 0) await yieldTask(options.signal);
  }
  const preparationMs = performance.now() - started;
  const samples: RangeBenchmarkSample[] = [];
  let expectedChecksum = formulaCount * 4;
  for (let index = 0; index < iterations; index++) {
    abort(options.signal);
    const target = layout === 'disjoint' ? Math.floor((index * formulaCount) / iterations) : 0;
    const inputRow = target * 4 + 1;
    sheet.cells[`A${inputRow}`].value = Number(sheet.cells[`A${inputRow}`].value) + 1;
    expectedChecksum += layout === 'disjoint' ? 1 : formulaCount;
    incremental.resetStats();
    full.resetStats();
    const invalidateStart = performance.now();
    incremental.invalidateCells(sheet.id, [`A${inputRow}`]);
    const invalidationMs = performance.now() - invalidateStart;
    const retainedCaches = incremental.stats.cacheEntries;
    const incrementalStart = performance.now();
    let checksum = 0;
    for (let row = 1; row <= formulaCount; row++) checksum += Number(incremental(sheet, `B${row}`));
    const incrementalReadMs = performance.now() - incrementalStart;
    const fullStart = performance.now();
    full.invalidate();
    let fullChecksum = 0;
    for (let row = 1; row <= formulaCount; row++) fullChecksum += Number(full(sheet, `B${row}`));
    const fullRecalculationMs = performance.now() - fullStart;
    if (checksum !== expectedChecksum || fullChecksum !== expectedChecksum)
      throw new Error('增量与全量计算结果不一致');
    samples.push({
      inputRow,
      invalidationMs,
      incrementalReadMs,
      fullRecalculationMs,
      retainedCaches,
      incremental: incremental.stats,
      full: full.stats,
      checksum,
    });
    options.onProgress?.(index + 1, iterations);
    await yieldTask(options.signal);
  }
  const percentile = (values: number[], rank: number) =>
    values.slice().sort((a, b) => a - b)[Math.ceil(values.length * rank) - 1];
  const p = (field: 'invalidationMs' | 'incrementalReadMs' | 'fullRecalculationMs', rank: number) =>
    percentile(
      samples.map((sample) => sample[field]),
      rank,
    );
  const mean = (field: keyof EvaluatorStats) =>
    samples.reduce((sum, sample) => sum + sample.incremental[field], 0) / samples.length;
  return {
    version: '0.5',
    measuredAt: new Date().toISOString(),
    layout,
    formulaCount,
    storedCells: inputCount + formulaCount,
    iterations,
    preparationMs,
    samples,
    summary: {
      invalidationP50Ms: p('invalidationMs', 0.5),
      invalidationP95Ms: p('invalidationMs', 0.95),
      incrementalReadP50Ms: p('incrementalReadMs', 0.5),
      incrementalReadP95Ms: p('incrementalReadMs', 0.95),
      fullRecalculationP50Ms: p('fullRecalculationMs', 0.5),
      fullRecalculationP95Ms: p('fullRecalculationMs', 0.95),
      meanRecomputedFormulas: mean('formulaEvaluations'),
      meanCandidateChecks: mean('rangeCandidateChecks'),
      meanIndexVisits: mean('rangeNodeVisits'),
    },
  };
}

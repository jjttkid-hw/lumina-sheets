import assert from 'node:assert/strict';

const metrics = ['firstDrawMs', 'canvasP95Ms', 'editP95Ms', 'workerRoundTripMs'];
const number = (value, label) => {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= 0, `Invalid ${label}`);
  return value;
};
export function validateBrowserPerformanceBudget(budget) {
  assert(budget?.schema === 1, 'Performance budget must use schema 1');
  for (const field of ['name', 'scope'])
    assert(typeof budget[field] === 'string' && budget[field].trim(), `Missing budget ${field}`);
  assert.deepEqual(Object.keys(budget.fixtures ?? {}).sort(), ['100000', '1000000'], 'Budget requires both fixture sizes');
  for (const [size, limits] of Object.entries(budget.fixtures)) {
    assert.deepEqual(Object.keys(limits).sort(), [...metrics].sort(), `Incomplete or unknown budget metrics: ${size}`);
    for (const metric of metrics) number(limits[metric], `${size}/${metric} limit`);
  }
  return budget;
}

function p95(summary, minimum, label) {
  assert(Array.isArray(summary?.samples) && summary.samples.length >= minimum, `Insufficient ${label} samples (minimum ${minimum})`);
  assert(summary.frames === summary.samples.length && summary.observedFrames === summary.frames && summary.droppedFrames === 0, `Incomplete ${label} samples`);
  const durations = summary.samples.map(sample => number(sample.durationMs, `${label} duration`)).sort((a, b) => a - b);
  const value = durations[Math.ceil(durations.length * .95) - 1];
  assert(summary.p95Ms === value, `Incorrect ${label} p95 summary`);
  return value;
}

/** Judge raw browser samples, never substitute missing samples with a zero latency. */
export function evaluateBrowserPerformanceBudget(report, budget) {
  validateBrowserPerformanceBudget(budget);
  assert(report?.schema === 1 && report.build?.mode === 'production', 'Performance evidence must be a production report');
  const size = report.fixture?.storedCells;
  assert(size === 100000 || size === 1000000, 'Unsupported performance fixture');
  assert(report.fixture.formulaCount === size / 10 && report.fixture.logicalRows === 1000000 && report.fixture.populatedColumns === 10, 'Incorrect fixture workload');
  assert(report.scrollSampling?.status === 'complete' && report.scrollSampling.completed === 40 && report.scrollSampling.planned === 40, 'Scroll sampling is incomplete');
  const ready = number(report.fixture.dataReadyMs, 'data ready time');
  const first = number(report.fixture.firstDrawMs, 'first draw time');
  assert(first >= ready, 'First draw precedes data readiness');
  assert(report.workerCalculation?.targets === size / 10 && report.workerCalculation.firstValue === 54 && report.workerCalculation.lastValue === size / 2, 'Calculation sentinel mismatch');
  const worker = number(report.workerCalculation.roundTripMs, 'worker round trip');
  assert(worker >= number(report.workerCalculation.calculationMs, 'worker calculation'), 'Worker round trip precedes calculation');
  const measured = {
    firstDrawMs: first,
    canvasP95Ms: p95(report.canvas, 40, 'Canvas'),
    editP95Ms: p95(report.editToCanvas, 30, 'edit'),
    workerRoundTripMs: worker,
  };
  const limits = budget.fixtures[String(size)];
  const failures = metrics.filter(metric => measured[metric] > limits[metric])
    .map(metric => ({ metric, measuredMs: measured[metric], limitMs: limits[metric] }));
  return { storedCells: size, status: failures.length ? 'failed' : 'passed', measured, limits, failures };
}

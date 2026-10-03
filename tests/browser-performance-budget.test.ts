import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
// @ts-expect-error Node acceptance tooling has no SDK declarations
import * as performancePolicy from '../scripts/browser-performance-budget.mjs';
const { evaluateBrowserPerformanceBudget, validateBrowserPerformanceBudget } = performancePolicy;

const budget = JSON.parse(readFileSync('scripts/fixtures/performance-local-budget.json', 'utf8'));
function fixture(size = 100000) {
  const series = (count: number) => ({
    frames: count,
    observedFrames: count,
    droppedFrames: 0,
    samples: Array.from({ length: count }, (_, index) => ({ durationMs: index + 1 })),
    p95Ms: Math.ceil(count * 0.95),
  });
  return {
    schema: 1,
    build: { mode: 'production' },
    fixture: {
      storedCells: size,
      formulaCount: size / 10,
      logicalRows: 1000000,
      populatedColumns: 10,
      dataReadyMs: 50,
      firstDrawMs: 100,
    },
    scrollSampling: { status: 'complete', completed: 40, planned: 40 },
    canvas: {
      ...series(40),
      samples: Array.from({ length: 40 }, () => ({ durationMs: 10 })),
      p95Ms: 10,
    },
    editToCanvas: series(30),
    workerCalculation: {
      targets: size / 10,
      firstValue: 54,
      lastValue: size / 2,
      roundTripMs: 100,
      calculationMs: 90,
    },
  };
}
describe('real browser performance budgets', () => {
  it('independently verifies raw downloads and rejects a rehashed failed measurement', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'lumina-perf-evidence-'));
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    const profile = JSON.stringify(budget);
    const result = {
      schema: 1,
      status: 'passed',
      version: '0.29.0',
      engine: 'chromium',
      siteSha256: 'a'.repeat(64),
      artifactSha256: 'b'.repeat(64),
      validation: { pageErrorCount: 0, consoleErrorCount: 0, runErrorCount: 0 },
      performanceBudget: {
        status: 'passed',
        profile: budget,
        profileSha256: hash(profile),
        fixtures: [] as any[],
      },
    };
    const write = (name: string, bytes: string) => writeFileSync(path.join(folder, name), bytes);
    const save = () => write('result.json', JSON.stringify(result));
    const run = () =>
      spawnSync(
        process.execPath,
        [path.resolve('scripts/check-browser-performance-evidence.mjs'), folder],
        { encoding: 'utf8' },
      );
    try {
      write('budget.json', profile);
      for (const size of [100000, 1000000]) {
        const report = fixture(size);
        Object.assign(report.build, { version: result.version });
        const bytes = JSON.stringify(report);
        const file = `fixture-${size}-after-edit.json`;
        write(file, bytes);
        result.performanceBudget.fixtures.push({
          ...evaluateBrowserPerformanceBudget(report, budget),
          evidence: { file, sha256: hash(bytes) },
        });
      }
      save();
      expect(run().status).toBe(0);
      write('budget.json', profile + ' ');
      expect(run().stderr).toContain('profile digest');
      write('budget.json', profile);
      const report = fixture();
      Object.assign(report.build, { version: result.version });
      report.fixture.firstDrawMs = 1501;
      const bytes = JSON.stringify(report);
      write('fixture-100000-after-edit.json', bytes);
      expect(run().stderr).toContain('report digest');
      result.performanceBudget.fixtures[0].evidence.sha256 = hash(bytes);
      save();
      expect(run().stderr).toContain('exceed');
      result.performanceBudget.status = 'not-configured';
      save();
      expect(run().stderr).toContain('not configured');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it.each([100000, 1000000])('checks all measured metrics for %s stored cells', (size) => {
    expect(evaluateBrowserPerformanceBudget(fixture(size), budget).status).toBe('passed');
    const report = fixture(size);
    report.fixture.firstDrawMs = budget.fixtures[String(size)].firstDrawMs + 1;
    expect(evaluateBrowserPerformanceBudget(report, budget).failures).toEqual([
      {
        metric: 'firstDrawMs',
        measuredMs: report.fixture.firstDrawMs,
        limitMs: budget.fixtures[String(size)].firstDrawMs,
      },
    ]);
  });
  it('rejects incomplete, inconsistent, cancelled and nonfinite evidence', () => {
    for (const mutate of [
      (r: ReturnType<typeof fixture>) => {
        r.editToCanvas.samples = r.editToCanvas.samples.slice(0, 5);
        r.editToCanvas.frames = 5;
        r.editToCanvas.observedFrames = 5;
      },
      (r: ReturnType<typeof fixture>) => {
        r.canvas.p95Ms = 0;
      },
      (r: ReturnType<typeof fixture>) => {
        r.canvas.droppedFrames = 1;
      },
      (r: ReturnType<typeof fixture>) => {
        r.scrollSampling.status = 'cancelled';
      },
      (r: ReturnType<typeof fixture>) => {
        r.fixture.firstDrawMs = Number.NaN;
      },
      (r: ReturnType<typeof fixture>) => {
        r.workerCalculation.firstValue = 5;
      },
      (r: ReturnType<typeof fixture>) => {
        r.workerCalculation.roundTripMs = 0;
      },
      (r: ReturnType<typeof fixture>) => {
        r.canvas.samples[0].durationMs = -1;
      },
      (r: ReturnType<typeof fixture>) => {
        r.build.mode = 'development';
      },
    ]) {
      const report = fixture();
      mutate(report);
      expect(() => evaluateBrowserPerformanceBudget(report, budget)).toThrow();
    }
  });
  it('requires every supported fixture and metric to have a finite explicit budget', () => {
    for (const mutate of [
      (b: typeof budget) => {
        delete b.fixtures['100000'];
      },
      (b: typeof budget) => {
        delete b.fixtures['100000'].editP95Ms;
      },
      (b: typeof budget) => {
        b.fixtures['100000'].editP95Ms = '50';
      },
      (b: typeof budget) => {
        b.fixtures['100000'].canvasP95Ms = Infinity;
      },
      (b: typeof budget) => {
        b.fixtures['100000'].FPS = 60;
      },
      (b: typeof budget) => {
        b.scope = '';
      },
    ]) {
      const value = structuredClone(budget);
      mutate(value);
      expect(() => validateBrowserPerformanceBudget(value)).toThrow();
    }
  });
  it('allows equality at the ceiling and reports simultaneous regressions', () => {
    const report = fixture();
    report.fixture.firstDrawMs = 1500;
    report.workerCalculation.roundTripMs = 1000;
    expect(evaluateBrowserPerformanceBudget(report, budget).status).toBe('passed');
    report.fixture.firstDrawMs++;
    report.workerCalculation.roundTripMs++;
    expect(
      evaluateBrowserPerformanceBudget(report, budget).failures.map(
        (f: { metric: string }) => f.metric,
      ),
    ).toEqual(['firstDrawMs', 'workerRoundTripMs']);
  });
});

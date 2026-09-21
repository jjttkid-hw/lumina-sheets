import { describe, expect, it } from 'vitest';
// @ts-expect-error Node-only browser evidence helper
import { finalizeBrowserReport } from '../scripts/browser-report.mjs';

type Report = {
  checks: Array<{ name: string; status: string; error?: string }>;
  pageErrors: string[];
  consoleErrors: unknown[];
  runErrors?: unknown[];
  status?: string;
  statusReason?: string;
  validation?: {
    expectedChecks: string[];
    actualChecks: string[];
    missingChecks: string[];
    unexpectedChecks: string[];
    duplicateChecks: string[];
    failedChecks: Array<{ name: string; status: string; error?: string }>;
    pageErrorCount: number;
    consoleErrorCount: number;
    runErrorCount: number;
  };
};

function report(overrides: Partial<Report> = {}): Report {
  return { checks: [], pageErrors: [], consoleErrors: [], ...overrides };
}

describe('real-browser report finalization', () => {
  it('rejects an interrupted run with missing checks', () => {
    const result = report();
    expect(finalizeBrowserReport(result, ['render', 'edit'])).toBe('failed');
    expect(result.validation).toMatchObject({
      missingChecks: ['render', 'edit'],
      actualChecks: [],
    });
    expect(result.statusReason).toContain('missing checks');
  });

  it('rejects duplicates, unexpected checks and failed checks', () => {
    const result = report({
      checks: [
        { name: 'render', status: 'passed' },
        { name: 'render', status: 'passed' },
        { name: 'extra', status: 'passed' },
        { name: 'edit', status: 'failed', error: 'fixture failed' },
      ],
    });
    expect(finalizeBrowserReport(result, ['render', 'edit'])).toBe('failed');
    expect(result.validation!.duplicateChecks).toEqual(['render']);
    expect(result.validation!.unexpectedChecks).toEqual(['extra']);
    expect(result.validation!.failedChecks).toEqual([
      { name: 'edit', status: 'failed', error: 'fixture failed' },
    ]);
  });

  it('passes only when every declared check and browser error channel is clean', () => {
    const result = report({
      checks: [
        { name: 'render', status: 'passed' },
        { name: 'edit', status: 'passed' },
      ],
    });
    expect(finalizeBrowserReport(result, ['render', 'edit'])).toBe('passed');
    result.consoleErrors.push({ text: 'late error' });
    expect(finalizeBrowserReport(result, ['render', 'edit'])).toBe('failed');
    expect(result.validation!.consoleErrorCount).toBe(1);
  });

  it('rejects a run-level failure after all individual checks passed', () => {
    const result = report({
      checks: [{ name: 'render', status: 'passed' }],
      runErrors: [{ message: 'fixture teardown failed' }],
    });
    expect(finalizeBrowserReport(result, ['render'])).toBe('failed');
    expect(result.validation!.runErrorCount).toBe(1);
    expect(result.statusReason).toContain('run errors');
  });

  it('rejects an empty or duplicated declared plan', () => {
    expect(finalizeBrowserReport(report(), [])).toBe('failed');
    const result = report({ checks: [{ name: 'render', status: 'passed' }] });
    expect(finalizeBrowserReport(result, ['render', 'render'])).toBe('failed');
    expect(result.statusReason).toContain('duplicate expected checks');
  });
});

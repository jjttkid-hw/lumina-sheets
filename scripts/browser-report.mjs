/**
 * Validate the bookkeeping of a real-browser report before it is written.
 *
 * An empty Array.prototype.every() is true, which used to let a navigation or
 * fixture setup exception produce a misleading `passed` report.  Browser
 * scripts must provide the checks they intend to execute so missing, duplicate
 * or unexpected entries are recorded as a failed run.
 */
export function finalizeBrowserReport(report, expectedChecks) {
  const expected = [...expectedChecks];
  const actual = report.checks.map((check) => check.name);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const duplicateChecks = actual.filter((name, index) => actual.indexOf(name) !== index);
  const missingChecks = expected.filter((name) => !actualSet.has(name));
  const unexpectedChecks = actual.filter((name) => !expectedSet.has(name));
  const failedChecks = report.checks
    .filter((check) => check.status !== 'passed')
    .map((check) => ({ name: check.name, status: check.status, error: check.error }));
  const errors = [];
  if (!expected.length) errors.push('empty expected checks');
  if (expectedSet.size !== expected.length) errors.push('duplicate expected checks');
  if (missingChecks.length) errors.push('missing checks');
  if (unexpectedChecks.length) errors.push('unexpected checks');
  if (duplicateChecks.length) errors.push('duplicate checks');
  if (failedChecks.length) errors.push('failed checks');
  if (report.pageErrors.length) errors.push('page errors');
  if (report.consoleErrors.length) errors.push('console errors');
  if (report.runErrors?.length) errors.push('run errors');
  report.validation = {
    expectedChecks: expected,
    actualChecks: actual,
    missingChecks,
    unexpectedChecks,
    duplicateChecks: [...new Set(duplicateChecks)],
    failedChecks,
    pageErrorCount: report.pageErrors.length,
    consoleErrorCount: report.consoleErrors.length,
    runErrorCount: report.runErrors?.length ?? 0,
  };
  report.status = errors.length ? 'failed' : 'passed';
  if (errors.length) report.statusReason = errors.join(', ');
  else delete report.statusReason;
  return report.status;
}

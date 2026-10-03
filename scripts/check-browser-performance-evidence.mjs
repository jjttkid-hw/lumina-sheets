import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { evaluateBrowserPerformanceBudget } from './browser-performance-budget.mjs';

assert(process.argv.length === 3, 'Usage: node scripts/check-browser-performance-evidence.mjs <engine-report-directory>');
const root = path.resolve(process.argv[2]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => readFile(path.join(root, name));
const result = JSON.parse((await read('result.json')).toString('utf8'));
assert(result.schema === 1 && result.status === 'passed', 'Browser performance run did not pass');
assert(['chromium', 'firefox', 'webkit'].includes(result.engine), 'Unknown browser engine');
for (const key of ['siteSha256', 'artifactSha256']) assert(/^[a-f0-9]{64}$/.test(result[key]), `Missing ${key}`);
assert(result.validation?.pageErrorCount === 0 && result.validation?.consoleErrorCount === 0 && result.validation?.runErrorCount === 0, 'Browser run contains errors');
const judged = result.performanceBudget;
assert(judged?.status === 'passed', 'Performance budget was not configured or did not pass');
const budgetBytes = await read('budget.json');
assert(judged.profileSha256 === hash(budgetBytes), 'Budget profile digest mismatch');
const budget = JSON.parse(budgetBytes.toString('utf8'));
assert.deepEqual(judged.profile, budget, 'Budget profile differs from recorded bytes');
assert(Array.isArray(judged.fixtures) && judged.fixtures.length === 2, 'Missing budget fixtures');
for (const [index, size] of [100000, 1000000].entries()) {
  const value = judged.fixtures[index];
  const filename = `fixture-${size}-after-edit.json`;
  assert(value.evidence?.file === filename, 'Unexpected raw performance report path');
  const bytes = await read(filename);
  assert(value.evidence.sha256 === hash(bytes), 'Raw performance report digest mismatch');
  const report = JSON.parse(bytes.toString('utf8'));
  assert(report.build?.version === result.version, 'Raw report version mismatch');
  const evaluated = evaluateBrowserPerformanceBudget(report, budget);
  assert(evaluated.storedCells === size, 'Raw report fixture size mismatch');
  assert(evaluated.status === 'passed', 'Raw performance samples exceed the budget');
  assert.deepEqual(value, { ...evaluated, evidence: value.evidence }, 'Recorded budget judgement differs from raw samples');
}
console.log(`${result.engine}: raw performance evidence and configured budget verified (${budget.name})`);

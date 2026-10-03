import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const runtime = path.resolve('scripts/fixtures/frameworks/node_modules');
let zipModule;
try {
  zipModule = createRequire(import.meta.url).resolve('jszip');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  zipModule = path.join(runtime, 'jszip/lib/index.js');
}
const { default: JSZip } = await import(pathToFileURL(zipModule));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const validationWorkspaceChecks = Object.freeze([
  'imported-rule-preserved',
  'title-edit-history',
  'rule-reload-download',
  'empty-title-download',
  'narrow-dialog-keyboard',
  'metadata-whitespace-preserved',
]);

/** Check original downloads as well as bookkeeping; never manufacture browser results. */
export async function verifyValidationWorkspaceEvidence(directory, identity) {
  const root = await realpath(directory);
  const read = async (name) => {
    assert(
      typeof name === 'string' && name !== '' && !name.includes('..') && !path.isAbsolute(name),
      'Unsafe evidence filename',
    );
    const filename = path.join(root, name);
    const resolved = await realpath(filename);
    assert(resolved.startsWith(root + path.sep), 'Evidence escapes directory');
    const stat = await lstat(filename);
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Evidence must be a regular file');
    return readFile(filename);
  };
  const report = JSON.parse(await read('result.json'));
  assert.equal(report.schema, 1);
  assert.equal(report.status, 'passed', 'Browser run failed');
  for (const key of ['version', 'engine', 'siteSha256', 'artifactSha256', 'fixtureSha256'])
    assert.equal(report[key], identity[key], `${key} mismatch`);
  assert(
    typeof report.browserVersion === 'string' && report.browserVersion.length > 0,
    'Missing browser version',
  );
  assert(Number.isFinite(Date.parse(report.executedAt)), 'Missing execution time');
  for (const key of ['pageErrors', 'consoleErrors', 'runErrors'])
    assert.deepEqual(report[key], [], `Unexpected ${key}`);
  assert.deepEqual(
    report.checks.map((c) => c.name),
    validationWorkspaceChecks,
    'Missing or duplicate checks',
  );
  for (const check of report.checks) {
    assert.equal(check.status, 'passed', `Failed ${check.name}`);
    assert(Number.isFinite(check.elapsedMs) && check.elapsedMs > 0, 'Invalid check duration');
  }
  assert.deepEqual(report.validation.expectedChecks, validationWorkspaceChecks);
  assert.deepEqual(report.validation.actualChecks, validationWorkspaceChecks);
  for (const key of ['missingChecks', 'unexpectedChecks', 'duplicateChecks', 'failedChecks'])
    assert.deepEqual(report.validation[key], []);
  for (const key of ['pageErrorCount', 'consoleErrorCount', 'runErrorCount'])
    assert.equal(report.validation[key], 0);
  const expectedDownloads = [
    ['edited-title.xlsx', 'edited-title.json'],
    ['empty-title.xlsx', 'empty-title.json'],
    [
      'metadata-title-after-edit.json',
      'metadata-title-after-edit.xlsx',
      'metadata-title-restored.json',
    ],
  ];
  const downloaded = new Map();
  for (const [index, names] of expectedDownloads.entries()) {
    const entries = report.checks[[2, 3, 5][index]].details.downloads;
    assert.deepEqual(
      entries.map((e) => e.filename),
      names,
      'Missing download',
    );
    for (const entry of entries) {
      const bytes = await read(entry.filename);
      assert.equal(hash(bytes), entry.sha256, 'Download digest mismatch');
      downloaded.set(entry.filename, bytes);
    }
  }
  const source = report.checks[5].details.source;
  assert.equal(source.filename, 'metadata-title.xlsx');
  const sourceBytes = await read(source.filename);
  assert.equal(hash(sourceBytes), source.sha256, 'Source digest mismatch');
  const titles = [
    ['edited-title', '审批要求', '请选择通过、待审或拒绝'],
    ['empty-title', '', '请选择通过、待审或拒绝'],
    ['metadata-title-after-edit', '审批😀\r\n\t_x0041_', '请选择\r\n\t_x000D_'],
    ['metadata-title-restored', '审批😀\r\n\t_x0041_', '请选择\r\n\t_x000D_'],
  ];
  for (const [prefix, title, message] of titles) {
    const workbook = JSON.parse(downloaded.get(prefix + '.json'));
    const sheet = workbook.sheets.find((s) => s.name === '项目费用');
    assert(sheet, 'Missing project sheet');
    const rule = sheet.dataValidations[0];
    assert.equal(sheet.dataValidations.length, 1);
    assert.equal(rule.errorTitle, title, 'Rule title mismatch');
    assert.equal(rule.message, message, 'Rule message mismatch');
    assert.equal(rule.allowBlank, true, 'Rule blank flag mismatch');
    assert.equal(rule.kind, 'list');
    assert.deepEqual(rule.values, ['通过', '待审', '拒绝']);
    assert.deepEqual(rule.range, { start: { row: 1, col: 3 }, end: { row: 1, col: 3 } });
    assert.equal(sheet.cells.D2.value, '通过');
  }
  // Read original XML independently of the SDK import path used in the browser.
  const decode = (text) =>
    text
      .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_m, value) =>
        String.fromCodePoint(
          value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value),
        ),
      )
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/_x([0-9a-f]{4})_/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  const inspect = async (bytes, title, message, allowBlank) => {
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/worksheets/sheet3.xml').async('string');
    const node = xml.match(/<dataValidation\b[^>]*\bsqref="D2"[^>]*>/)?.[0];
    assert(node, 'Missing validation XML');
    const attrs = Object.fromEntries(
      [...node.matchAll(/\b(\w+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]),
    );
    assert.equal(attrs.errorTitle, title, 'XLSX title mismatch');
    assert.equal(attrs.error, message, 'XLSX message mismatch');
    assert.equal(attrs.allowBlank ?? '0', allowBlank);
    assert.equal(attrs.showErrorMessage, '1');
    assert.equal(attrs.errorStyle ?? 'stop', 'stop');
    assert.equal(attrs.type, 'list');
  };
  for (const [prefix, title, message] of titles.slice(0, 3))
    await inspect(downloaded.get(prefix + '.xlsx'), title, message, '1');
  await inspect(sourceBytes, titles[2][1], titles[2][2], '0');
  const screenshot = await read('narrow.png');
  assert.equal(screenshot.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Invalid screenshot');
  assert.equal(screenshot.readUInt32BE(16), 390, 'Screenshot width mismatch');
  assert(screenshot.readUInt32BE(20) >= 844, 'Screenshot height mismatch');
  return {
    engine: report.engine,
    browserVersion: report.browserVersion,
    checks: report.checks.length,
    downloads: downloaded.size,
  };
}

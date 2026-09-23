import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { finalizeBrowserReport } from './browser-report.mjs';
import { siteDigest } from './site-evidence.mjs';
import { verifySiteHttp } from './site-runtime.mjs';

// This suite uses the browser's native IndexedDB implementation. It covers
// migration, reload and damaged-storage containment rather than a mocked adapter.
const driver = process.env.PLAYWRIGHT_MODULE;
if (!driver) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const { chromium, firefox, webkit } = await import(pathToFileURL(path.resolve(driver)).href);
const engine = process.env.BROWSER_ENGINE ?? 'chromium';
const engines = { chromium, firefox, webkit };
assert(engines[engine], 'Unsupported BROWSER_ENGINE');
const origin = new URL(process.env.BROWSER_TEST_URL ?? 'http://127.0.0.1:4273/lumina-sheets/');
assert(
  ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
    origin.origin === 'https://jjttkid-hw.github.io',
  'Use a local candidate server or the official Pages deployment',
);
const output = path.resolve(`artifacts/browser-recovery/${engine}`);
await mkdir(output, { recursive: true });
const site = await siteDigest('dist');
await verifySiteHttp('dist', origin.origin);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const archive = await readFile(`artifacts/lumina-report-sdk-${version}.tgz`);
const browser = await engines[engine].launch({
  headless: process.env.BROWSER_HEADED !== '1',
  ...(engine === 'chromium' && process.env.BROWSER_CHANNEL !== 'bundled'
    ? { channel: process.env.BROWSER_CHANNEL ?? 'chrome' }
    : {}),
  // Only local candidate traffic skips system proxies; remote runs keep normal routing.
  ...(engine === 'firefox' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
    ? { firefoxUserPrefs: { 'network.proxy.type': 0 } }
    : {}),
});
const report = {
  schema: 1,
  version,
  engine,
  browserVersion: browser.version(),
  executedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    headless: process.env.BROWSER_HEADED !== '1',
  },
  runnerSha256: createHash('sha256')
    .update(await readFile('scripts/browser-recovery.mjs'))
    .digest('hex'),
  siteSha256: site.sha256,
  artifactSha256: createHash('sha256').update(archive).digest('hex'),
  scope:
    'Native IndexedDB recovery download, file import, explicit snapshot selection and persisted independent copies. Synthetic damaged stores; not physical crash recovery or cross-device sync certification.',
  checks: [],
  pageErrors: [],
  consoleErrors: [],
  runErrors: [],
};
function track(page, label) {
  page.on('pageerror', (error) => report.pageErrors.push(`${label}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error')
      report.consoleErrors.push({
        text: `${label}: ${message.text()}`,
        location: message.location(),
      });
  });
  return page;
}
async function check(name, action) {
  const started = Date.now();
  try {
    const details = await action();
    report.checks.push({ name, status: 'passed', elapsedMs: Date.now() - started, details });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({
      name,
      status: 'failed',
      elapsedMs: Date.now() - started,
      error: error.message,
    });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
const book = (id, name, value) => ({
  id,
  name,
  description: '浏览器原生持久化验收',
  sheets: [
    {
      id: `${id}-sheet`,
      name: '工作表 1',
      cells: { A1: { value } },
      rowCount: 100,
      colCount: 16,
      columnWidths: {},
    },
  ],
  activeSheetId: `${id}-sheet`,
  createdAt: '2026-09-23T00:00:00.000Z',
  updatedAt: '2026-09-23T00:00:00.000Z',
  category: '验收',
  starred: false,
});
const validBook = book('native-valid', '有效工作簿', '安全内容');
async function inspectDatabase(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('lumina.v2', 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const stores = ['workbooks', 'patches', 'revisions', 'comments', 'meta'];
          const tx = db.transaction(stores, 'readonly');
          const result = {};
          for (const store of stores) {
            const read = tx.objectStore(store).getAll();
            read.onsuccess = () => {
              result[store] = read.result;
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB inspection aborted'));
        };
      }),
  );
}
async function seedDatabase(page, { workbooks, patches = [] }) {
  await page.evaluate(
    ({ workbooks, patches }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('lumina.v2', 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('workbooks'))
            db.createObjectStore('workbooks', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('patches')) {
            const store = db.createObjectStore('patches', { keyPath: 'key' });
            store.createIndex('by-workbook', 'workbookId', { unique: false });
          }
          if (!db.objectStoreNames.contains('revisions'))
            db.createObjectStore('revisions', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('comments'))
            db.createObjectStore('comments', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('meta'))
            db.createObjectStore('meta', { keyPath: 'key' });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['workbooks', 'patches'], 'readwrite');
          for (const row of workbooks) tx.objectStore('workbooks').put(row);
          for (const row of patches) tx.objectStore('patches').put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB seed aborted'));
        };
      }),
    { workbooks, patches },
  );
}
async function selectCell(page, key) {
  const address = page.getByRole('textbox', { name: '单元格地址', exact: true });
  await address.fill(key);
  await address.press('Enter');
  await page.waitForFunction(
    (value) => document.querySelector('[role=gridcell]')?.textContent?.startsWith(`${value} `),
    key,
  );
}
async function workspace(context, name = validBook.name) {
  const page = track(await context.newPage(), name);
  await page.goto(new URL('sdk/example.html', origin).href);
  await seedDatabase(page, { workbooks: [{ id: validBook.id, workbook: validBook }] });
  await page.goto(origin.href);
  await page.getByRole('heading', { name, exact: true }).waitFor();
  return page;
}
async function importBackup(page, filename) {
  await page.locator('input[type=file]').setInputFiles(filename);
  await page.getByRole('dialog', { name: '从备份恢复工作簿' }).waitFor();
}
async function expectCopy(page, original, expectedValue) {
  const name = `${original.name}（恢复副本）`;
  await page.getByRole('heading', { name, exact: true }).waitFor();
  await page.getByText('已保存到本地', { exact: true }).waitFor();
  await selectCell(page, 'A1');
  assert.equal(
    await page.getByRole('textbox', { name: '公式编辑栏', exact: true }).inputValue(),
    expectedValue,
  );
  const state = await inspectDatabase(page);
  const row = state.workbooks.find((row) => row.workbook?.name === name);
  assert(row, 'Restored copy must be in IndexedDB');
  assert.notEqual(row.id, original.id);
  assert.notEqual(row.workbook.sheets[0].id, original.sheets[0].id);
  assert.equal(row.workbook.activeSheetId, row.workbook.sheets[0].id);
  // Reload then explicitly open the saved copy if the application chooses another workbook.
  await page.reload();
  await page.getByRole('heading', { level: 1 }).waitFor();
  const heading = page.getByRole('heading', { name, exact: true });
  if (!(await heading.isVisible())) {
    await page.getByText(name, { exact: true }).first().click();
    await heading.waitFor();
  }
  await selectCell(page, 'A1');
  assert.equal(
    await page.getByRole('textbox', { name: '公式编辑栏', exact: true }).inputValue(),
    expectedValue,
  );
  return { copyId: row.id, name, expectedValue, persistedAfterReload: true };
}
const expected = [
  'damaged-journal-download-and-raw-snapshot-restore',
  'partial-backup-invalid-selection-search-and-cancel',
  'historical-snapshot-restores-independent-copy',
];
try {
  await check(expected[0], async () => {
    const sourceContext = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 800 },
    });
    const targetContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const page = track(await sourceContext.newPage(), expected[0]);
      await page.goto(new URL('sdk/example.html', origin).href);
      const damaged = {
        key: JSON.stringify([validBook.id, 'broken']),
        operationId: 'broken',
        workbookId: validBook.id,
        seq: 'invalid',
        at: 0,
        patch: {
          kind: 'cell',
          sheetId: validBook.sheets[0].id,
          key: 'A1',
          cell: { value: '不可重放' },
        },
      };
      await seedDatabase(page, {
        workbooks: [{ id: validBook.id, workbook: validBook }],
        patches: [damaged],
      });
      await page.goto(origin.href);
      await page.getByText('本地工作空间读取失败', { exact: false }).waitFor();
      const before = await inspectDatabase(page);
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载恢复备份', exact: true }).click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), 'Lumina-恢复备份.json');
      const filename = path.join(output, 'damaged-journal-backup.json');
      await download.saveAs(filename);
      assert.equal(await download.failure(), null);
      const bytes = await readFile(filename);
      const backup = JSON.parse(bytes);
      assert.equal(backup.format, 'lumina-recovery');
      assert.equal(backup.complete, false);
      assert(backup.warnings.some((warning) => warning.includes('原始快照未重放日志')));
      assert.equal(backup.rawStorage.backend, 'indexeddb');
      assert.deepEqual(backup.rawStorage.stores.workbooks, before.workbooks);
      assert.deepEqual(backup.rawStorage.stores.patches, before.patches);
      assert.deepEqual(
        await inspectDatabase(page),
        before,
        'Downloading rescue must preserve source stores',
      );
      await page.getByText('已导出部分数据', { exact: false }).waitFor();
      await page.screenshot({ path: path.join(output, 'startup-rescue.png') });
      const target = await workspace(targetContext);
      const targetBefore = await inspectDatabase(target);
      await importBackup(target, filename);
      await target.getByText('原始快照未重放日志，可能缺少后续编辑', { exact: false }).waitFor();
      const option = target.getByRole('combobox', { name: '待恢复工作簿' }).locator('option');
      assert(
        (await option.allTextContents()).some((text) => text.includes('原始快照（未重放日志）')),
      );
      await target.getByRole('button', { name: '恢复为新工作簿' }).click();
      const details = await expectCopy(target, validBook, '安全内容');
      const after = await inspectDatabase(target);
      assert.deepEqual(
        after.workbooks.find((row) => row.id === validBook.id),
        targetBefore.workbooks.find((row) => row.id === validBook.id),
      );
      assert.equal(after.patches.length, 0, 'Damaged source journal must not be imported');
      assert.deepEqual(await inspectDatabase(page), before);
      return {
        ...details,
        backupSha256: createHash('sha256').update(bytes).digest('hex'),
        rawJournalRetained: true,
        sourceUnchanged: true,
      };
    } finally {
      await sourceContext.close();
      await targetContext.close();
    }
  });
  await check(expected[1], async () => {
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 800 },
    });
    try {
      const page = track(await context.newPage(), expected[1]);
      await page.goto(new URL('sdk/example.html', origin).href);
      await seedDatabase(page, {
        workbooks: [
          { id: 'a-damaged', workbook: null },
          { id: validBook.id, workbook: validBook },
        ],
      });
      await page.goto(origin.href);
      await page.getByRole('heading', { name: validBook.name, exact: true }).waitFor();
      const before = await inspectDatabase(page);
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载恢复备份' }).click();
      const download = await downloadPromise;
      const filename = path.join(output, 'partial-backup.json');
      await download.saveAs(filename);
      const backup = JSON.parse(await readFile(filename));
      assert.equal(backup.complete, false);
      assert(
        backup.records.some(
          (record) => record.workbook === null || record.workbook?.id === 'a-damaged',
        ),
      );
      assert(backup.records.some((record) => record.workbook?.id === validBook.id));
      await importBackup(page, filename);
      const select = page.getByRole('combobox', { name: '待恢复工作簿' });
      await select.selectOption('0');
      await page.getByRole('button', { name: '恢复为新工作簿' }).click();
      await page.getByRole('dialog').getByRole('alert').waitFor();
      assert.deepEqual(await inspectDatabase(page), before, 'Invalid snapshot must not write');
      const search = page.getByRole('searchbox', { name: '搜索备份快照' });
      await search.fill(validBook.name);
      assert.equal(await select.inputValue(), '');
      assert.equal(await page.getByRole('button', { name: '恢复为新工作簿' }).isDisabled(), true);
      await search.press('Enter');
      assert.deepEqual(await inspectDatabase(page), before, 'Search Enter must not restore');
      const value = await select
        .locator('option')
        .filter({ hasText: validBook.name })
        .getAttribute('value');
      await select.selectOption(value);
      await search.fill('没有这个快照');
      assert.equal(await select.isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: '恢复为新工作簿' }).isDisabled(), true);
      await search.fill('');
      assert.equal(await select.inputValue(), value, 'Clearing search retains explicit selection');
      await page.getByRole('button', { name: '取消', exact: true }).click();
      assert.deepEqual(await inspectDatabase(page), before, 'Cancel must not write');
      await importBackup(page, filename);
      await select.selectOption(value);
      await page.getByRole('button', { name: '恢复为新工作簿' }).click();
      const details = await expectCopy(page, validBook, '安全内容');
      const after = await inspectDatabase(page);
      assert.deepEqual(
        after.workbooks.find((row) => row.id === 'a-damaged'),
        before.workbooks.find((row) => row.id === 'a-damaged'),
      );
      assert.deepEqual(
        after.workbooks.find((row) => row.id === validBook.id),
        before.workbooks.find((row) => row.id === validBook.id),
      );
      return {
        ...details,
        invalidRejected: true,
        searchEnterDidNotRestore: true,
        cancelDidNotWrite: true,
        damagedSourceRetained: true,
      };
    } finally {
      await context.close();
    }
  });
  await check(expected[2], async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await workspace(context);
      const snapshot = book('history-source', '历史业务报表', '历史版本正文');
      snapshot.sheets[0].cells.B1 = { value: '=1+2' };
      snapshot.sheets[0].dataValidations = [
        {
          id: 'history-rule',
          sheetId: snapshot.sheets[0].id,
          range: { start: { row: 1, col: 0 }, end: { row: 2, col: 0 } },
          kind: 'whole',
          operator: 'between',
          min: 0,
          max: 100,
        },
      ];
      const backup = {
        format: 'lumina-recovery',
        version: 1,
        complete: false,
        warnings: ['合成损坏当前快照'],
        legacy: {},
        records: [
          {
            workbook: null,
            comments: [],
            revisions: [
              {
                id: 'r1',
                name: '月末已确认版本',
                createdAt: '2026-09-01T00:00:00.000Z',
                workbook: snapshot,
              },
            ],
          },
        ],
      };
      const filename = path.join(output, 'history-backup.json');
      await writeFile(filename, JSON.stringify(backup));
      const before = await inspectDatabase(page);
      await importBackup(page, filename);
      await page.getByRole('searchbox', { name: '搜索备份快照' }).fill('月末已确认');
      const select = page.getByRole('combobox', { name: '待恢复工作簿' });
      assert.equal(await select.inputValue(), '');
      const value = await select
        .locator('option')
        .filter({ hasText: '历史版本' })
        .getAttribute('value');
      await select.selectOption(value);
      await page.screenshot({ path: path.join(output, 'history-selection.png') });
      await page.getByRole('button', { name: '恢复为新工作簿' }).click();
      const details = await expectCopy(page, snapshot, '历史版本正文');
      await selectCell(page, 'B1');
      assert.equal(await page.getByRole('textbox', { name: '公式编辑栏' }).inputValue(), '=1+2');
      const after = await inspectDatabase(page);
      const copy = after.workbooks.find((row) => row.id === details.copyId).workbook;
      assert.equal(copy.sheets[0].dataValidations[0].sheetId, copy.sheets[0].id);
      assert.deepEqual(after.comments, before.comments);
      assert.deepEqual(after.revisions, before.revisions);
      assert.deepEqual(
        after.workbooks.find((row) => row.id === validBook.id),
        before.workbooks.find((row) => row.id === validBook.id),
      );
      return {
        ...details,
        formulaRetained: true,
        validationSheetRemapped: true,
        auxiliaryHistoryNotMerged: true,
      };
    } finally {
      await context.close();
    }
  });
} catch (error) {
  report.runErrors.push({ message: error.message, stack: error.stack });
} finally {
  finalizeBrowserReport(report, expected);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  if (report.status !== 'passed') process.exitCode = 1;
}

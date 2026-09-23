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
const output = path.resolve(`artifacts/browser-persistence/${engine}`);
await mkdir(output, { recursive: true });
const site = await siteDigest('dist');
await verifySiteHttp('dist', origin.origin);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const archive = await readFile(`artifacts/lumina-report-sdk-${version}.tgz`);
const browser = await engines[engine].launch({
  headless: process.env.BROWSER_HEADED !== '1',
  ...(engine === 'chromium' ? { channel: process.env.BROWSER_CHANNEL ?? 'chrome' } : {}),
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
  siteSha256: site.sha256,
  artifactSha256: createHash('sha256').update(archive).digest('hex'),
  scope:
    'Native browser IndexedDB/localStorage workspace migration, reload and damaged-storage containment. This is isolated single-device persistence, not cross-device sync or crash-consistency certification.',
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
const legacyBook = book('native-legacy', '原生迁移工作簿', '旧版正文');
const validBook = book('native-valid', '有效工作簿', '安全内容');
const revisions = [
  {
    id: 'native-revision',
    name: '旧版恢复点',
    createdAt: '2026-09-23T00:00:00.000Z',
    workbook: legacyBook,
  },
];
const comments = [
  {
    id: 'native-comment',
    workbookId: legacyBook.id,
    sheetId: legacyBook.sheets[0].id,
    cellKey: 'A1',
    author: '验收',
    text: '旧版批注',
    createdAt: '2026-09-23T00:00:00.000Z',
    resolved: false,
  },
];
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
try {
  if (origin.origin === 'https://jjttkid-hw.github.io') {
    const context = await browser.newContext();
    const page = track(await context.newPage(), 'identity');
    await page.goto(new URL('sdk/example.html', origin).href, { waitUntil: 'domcontentloaded' });
    const identity = await page.evaluate(async () => {
      const response = await fetch('../build-info.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`build-info returned ${response.status}`);
      return response.json();
    });
    assert.equal(identity.siteSha256, site.sha256, 'Pages deployment belongs to another build');
    assert.equal(identity.version, version, 'Pages deployment belongs to another version');
    await context.close();
  }
  await check('native-legacy-migration-reload', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(
      ({ legacyBook, revisions, comments }) => {
        localStorage.setItem('lumina.v1.workbooks', JSON.stringify([legacyBook]));
        localStorage.setItem(`lumina.v1.history.${legacyBook.id}`, JSON.stringify(revisions));
        localStorage.setItem(`lumina.v1.comments.${legacyBook.id}`, JSON.stringify(comments));
      },
      { legacyBook, revisions, comments },
    );
    const page = track(await context.newPage(), 'native-legacy-migration-reload');
    await page.goto(origin.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('heading', { name: legacyBook.name, exact: true }).waitFor();
    await selectCell(page, 'A1');
    const formula = page.getByRole('textbox', { name: '公式编辑栏', exact: true });
    assert.equal(await formula.inputValue(), '旧版正文');
    await formula.fill('迁移后编辑');
    await formula.press('Enter');
    await page.getByText('已保存到本地', { exact: true }).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: legacyBook.name, exact: true }).waitFor();
    await selectCell(page, 'A1');
    assert.equal(await formula.inputValue(), '迁移后编辑');
    const state = await inspectDatabase(page);
    assert.equal(state.workbooks.length, 1);
    assert.equal(state.revisions.length, 1);
    assert.equal(state.comments.length, 1);
    assert.equal(state.meta.find((row) => row.key === 'legacy-v1-migrated')?.value, true);
    assert.equal(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('lumina.v1.workbooks'))[0].sheets[0].cells.A1.value,
      ),
      '旧版正文',
    );
    const details = {
      storedWorkbooks: state.workbooks.length,
      journalEntries: state.patches.length,
      revisions: state.revisions[0].revisions.length,
      comments: state.comments[0].comments.length,
      marker: true,
      reloadedValue: await formula.inputValue(),
      legacySourceRetained: true,
    };
    await context.close();
    return details;
  });
  await check('native-concurrent-migration-single-commit', async () => {
    const context = await browser.newContext({ viewport: { width: 1100, height: 720 } });
    await context.addInitScript(
      ({ legacyBook, revisions, comments }) => {
        localStorage.setItem('lumina.v1.workbooks', JSON.stringify([legacyBook]));
        localStorage.setItem(`lumina.v1.history.${legacyBook.id}`, JSON.stringify(revisions));
        localStorage.setItem(`lumina.v1.comments.${legacyBook.id}`, JSON.stringify(comments));
      },
      { legacyBook, revisions, comments },
    );
    const pages = [
      track(await context.newPage(), 'native-concurrent-migration-page-1'),
      track(await context.newPage(), 'native-concurrent-migration-page-2'),
    ];
    await Promise.all(
      pages.map((page) => page.goto(origin.href, { waitUntil: 'domcontentloaded', timeout: 60_000 })),
    );
    await Promise.all(
      pages.map((page) =>
        page.getByRole('heading', { name: legacyBook.name, exact: true }).waitFor(),
      ),
    );
    const state = await inspectDatabase(pages[0]);
    assert.equal(state.workbooks.length, 1);
    assert.equal(state.revisions.length, 1);
    assert.equal(state.comments.length, 1);
    assert.equal(
      state.meta.filter((row) => row.key === 'legacy-v1-migrated' && row.value === true).length,
      1,
    );
    const details = {
      pages: pages.length,
      storedWorkbooks: state.workbooks.length,
      revisions: state.revisions.length,
      comments: state.comments.length,
      migrationMarkers: 1,
    };
    await context.close();
    return details;
  });
  await check('native-damaged-workbook-isolation', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = track(await context.newPage(), 'native-damaged-workbook-isolation');
    await page.goto(new URL('sdk/example.html', origin).href, { waitUntil: 'domcontentloaded' });
    await seedDatabase(page, {
      workbooks: [
        { id: validBook.id, workbook: validBook },
        { id: 'native-damaged', workbook: null },
      ],
    });
    await page.goto(origin.href, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: validBook.name, exact: true }).waitFor();
    await page.getByText('1 本工作簿未能打开', { exact: false }).waitFor();
    await selectCell(page, 'A1');
    assert.equal(
      await page.getByRole('textbox', { name: '公式编辑栏', exact: true }).inputValue(),
      '安全内容',
    );
    const state = await inspectDatabase(page);
    assert.equal(state.workbooks.length, 2, 'Damaged row must remain available for recovery');
    assert(state.workbooks.some((row) => row.id === 'native-damaged' && row.workbook === null));
    const details = {
      visibleWorkbook: validBook.name,
      retainedRows: state.workbooks.length,
      damagedRowRetained: true,
      recoveryActionVisible: await page.getByRole('button', { name: '下载恢复备份' }).isVisible(),
    };
    assert.equal(details.recoveryActionVisible, true);
    await context.close();
    return details;
  });
  await check('native-damaged-journal-fails-closed', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = track(await context.newPage(), 'native-damaged-journal-fails-closed');
    await page.goto(new URL('sdk/example.html', origin).href, { waitUntil: 'domcontentloaded' });
    await seedDatabase(page, {
      workbooks: [{ id: validBook.id, workbook: validBook }],
      patches: [
        {
          key: JSON.stringify([validBook.id, 'damaged-operation']),
          operationId: 'damaged-operation',
          workbookId: validBook.id,
          seq: 'invalid',
          at: 0,
          patch: {
            kind: 'cell',
            sheetId: validBook.sheets[0].id,
            key: 'A1',
            cell: { value: '不得应用' },
          },
        },
      ],
    });
    await page.goto(origin.href, { waitUntil: 'domcontentloaded' });
    await page.getByText('本地工作空间读取失败', { exact: false }).waitFor();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('grid').count(), 0);
    const state = await inspectDatabase(page);
    assert.equal(state.workbooks.length, 1);
    assert.equal(state.patches.length, 1);
    assert.equal(state.workbooks[0].workbook.sheets[0].cells.A1.value, '安全内容');
    assert.equal(state.patches[0].patch.cell.value, '不得应用');
    const details = {
      workspaceOpened: false,
      storedValue: state.workbooks[0].workbook.sheets[0].cells.A1.value,
      damagedJournalRetained: state.patches.length === 1,
      retryVisible: await page.getByRole('button', { name: '重试读取' }).isVisible(),
      recoveryActionVisible: await page.getByRole('button', { name: '下载恢复备份' }).isVisible(),
    };
    assert.equal(details.retryVisible, true);
    assert.equal(details.recoveryActionVisible, true);
    await context.close();
    return details;
  });
} catch (error) {
  report.runErrors.push({
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack,
  });
  throw error;
} finally {
  finalizeBrowserReport(report, [
    'native-legacy-migration-reload',
    'native-concurrent-migration-single-commit',
    'native-damaged-workbook-isolation',
    'native-damaged-journal-fails-closed',
  ]);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  if (report.status !== 'passed') process.exitCode = 1;
}

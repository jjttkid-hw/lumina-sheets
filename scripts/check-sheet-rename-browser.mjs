import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { siteDigest } from './site-evidence.mjs';
import { verifySiteHttp } from './site-runtime.mjs';
import { finalizeBrowserReport } from './browser-report.mjs';

const runtime = path.resolve('scripts/fixtures/frameworks/node_modules');
const { preview } = await import(pathToFileURL(path.join(runtime, 'vite/dist/node/index.js')));
const engines = await import(pathToFileURL(path.join(runtime, 'playwright/index.mjs')));
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const site = await siteDigest('dist');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const artifactSha256 = hash(await readFile(`artifacts/lumina-report-sdk-${version}.tgz`));
const checks = [
  'cancel-and-invalid-name',
  'rename-cross-sheet-references',
  'rename-undo-redo',
  'rename-persistent-reload',
  'rename-xlsx-roundtrip',
  'narrow-keyboard-focus',
];
const renamed = "O'Brien 数据";
const fixture = {
  id: 'rename-browser',
  name: '重命名验收',
  description: 'Synthetic browser fixture',
  activeSheetId: 'data',
  createdAt: '2026-10-05T00:00:00Z',
  updatedAt: '2026-10-05T00:00:00Z',
  sheets: [
    {
      id: 'data',
      name: 'Data',
      rowCount: 100,
      colCount: 16,
      cells: { A1: { value: 3 }, A2: { value: 4 }, B1: { value: '=Data!A1+A2' } },
    },
    {
      id: 'summary',
      name: 'Summary',
      rowCount: 100,
      colCount: 16,
      cells: {
        A1: { value: '=SUM(Data!$A$1:data!A2)' },
        B1: { value: '="Data!A1"' },
        C1: { value: 'link', hyperlink: { target: "#'DATA'!$A$1", tooltip: 'hint' } },
        D1: { value: 'local', hyperlink: { target: '#A1' } },
        E1: { value: 'web', hyperlink: { target: 'https://example.com/Data!A1' } },
      },
    },
  ],
};
const server = await preview({
  configFile: false,
  base: '/lumina-sheets/',
  preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
});
try {
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await verifySiteHttp('dist', origin);
  for (const engine of ['chromium', 'firefox', 'webkit']) {
    const output = path.resolve(`artifacts/browser-sheet-rename/${engine}`);
    await mkdir(output, { recursive: true });
    const browser = await engines[engine].launch({
      headless: true,
      ...(engine === 'firefox' ? { firefoxUserPrefs: { 'network.proxy.type': 0 } } : {}),
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const report = {
      schema: 1,
      version,
      engine,
      browserVersion: browser.version(),
      executedAt: new Date().toISOString(),
      siteSha256: site.sha256,
      artifactSha256,
      runnerSha256: hash(await readFile('scripts/check-sheet-rename-browser.mjs')),
      environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        headless: true,
      },
      fixtureSha256: hash(JSON.stringify(fixture)),
      scope:
        'Shipped workspace rename controls, history, IndexedDB reload and actual JSON/XLSX downloads. Synthetic corpus; not native IME, screen reader or physical touch certification.',
      checks: [],
      pageErrors: [],
      consoleErrors: [],
      runErrors: [],
    };
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') report.consoleErrors.push(message.text());
    });
    const trigger = page.getByRole('button', { name: '重命名当前工作表', exact: true });
    const dialog = page.getByRole('dialog', { name: '重命名工作表', exact: true });
    const input = dialog.getByRole('textbox', { name: '工作表名称', exact: true });
    const open = async () => {
      const closeNav = page.getByRole('button', { name: '关闭导航', exact: true });
      if (await closeNav.isVisible()) await closeNav.click({ position: { x: 375, y: 420 } });
      await trigger.click();
      await dialog.waitFor();
    };
    const save = async () => {
      await dialog.getByRole('button', { name: '保存名称', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    };
    const select = async (key) => {
      const address = page.getByRole('textbox', { name: '单元格地址', exact: true });
      await address.fill(key);
      await address.press('Enter');
      await page.waitForFunction(
        (key) => document.querySelector('[role=gridcell]')?.textContent?.startsWith(`${key} `),
        key,
      );
    };
    const download = async (format, label) => {
      await page.getByRole('button', { name: '导出', exact: true }).click();
      const pending = page.waitForEvent('download');
      await page
        .getByRole('button', { name: format === 'xlsx' ? /Excel 工作簿/ : /完整数据与样式/ })
        .click();
      const item = await pending;
      const filename = `${label}.${format}`;
      await item.saveAs(path.join(output, filename));
      assert.equal(await item.failure(), null);
      const bytes = await readFile(path.join(output, filename));
      return { filename, sha256: hash(bytes), bytes };
    };
    const verifyRenamed = (book) => {
      assert.equal(book.sheets[0].name, renamed);
      assert.equal(book.sheets[0].cells.B1.value, "='O''Brien 数据'!A1+A2");
      const cells = book.sheets[1].cells;
      assert.equal(cells.A1.value, "=SUM('O''Brien 数据'!$A$1:'O''Brien 数据'!A2)");
      assert.equal(cells.B1.value, '="Data!A1"');
      assert.deepEqual(cells.C1.hyperlink, { target: "#'O''Brien 数据'!$A$1", tooltip: 'hint' });
      assert.equal(cells.D1.hyperlink.target, '#A1');
      assert.equal(cells.E1.hyperlink.target, 'https://example.com/Data!A1');
    };
    const check = async (name, action) => {
      const started = Date.now();
      try {
        const details = await action();
        report.checks.push({ name, status: 'passed', elapsedMs: Date.now() - started, details });
        console.log(`PASS ${engine}/${name}`);
      } catch (error) {
        report.checks.push({ name, status: 'failed', error: error.message });
        throw error;
      }
    };
    try {
      await page.goto(`${origin}/lumina-sheets/`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('grid').waitFor();
      await page.locator('input[type=file]').setInputFiles({
        name: 'rename-fixture.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(fixture)),
      });
      await page.getByRole('button', { name: 'Data', exact: true }).waitFor();
      await check(checks[0], async () => {
        await open();
        await input.fill('Cancelled');
        await input.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Data', exact: true }).waitFor();
        await open();
        await input.fill('Summary');
        await dialog.getByRole('button', { name: '保存名称', exact: true }).click();
        await dialog.getByRole('alert').waitFor();
        assert.equal(await input.inputValue(), 'Summary');
        await input.fill('invalid/name');
        await dialog.getByRole('button', { name: '保存名称', exact: true }).click();
        await dialog.getByRole('alert').waitFor();
        await input.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        const item = await download('json', 'rejected-unchanged');
        const book = JSON.parse(item.bytes);
        assert.deepEqual(
          book.sheets.map((s) => s.cells),
          fixture.sheets.map((s) => s.cells),
        );
        assert.deepEqual(
          book.sheets.map((s) => s.name),
          ['Data', 'Summary'],
        );
        return { download: { filename: item.filename, sha256: item.sha256 } };
      });
      await check(checks[1], async () => {
        await open();
        await input.fill(renamed);
        await save();
        await page.getByRole('button', { name: renamed, exact: true }).waitFor();
        await page.getByRole('button', { name: 'Summary', exact: true }).click();
        await select('A1');
        await page.waitForFunction(
          () => document.querySelector('[role=gridcell]')?.textContent === 'A1 7',
        );
        const item = await download('json', 'renamed');
        verifyRenamed(JSON.parse(item.bytes));
        return { download: { filename: item.filename, sha256: item.sha256 } };
      });
      await check(checks[2], async () => {
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        await page.getByRole('button', { name: 'Data', exact: true }).waitFor();
        const item = await download('json', 'undo');
        assert.deepEqual(
          JSON.parse(item.bytes).sheets.map((s) => s.cells),
          fixture.sheets.map((s) => s.cells),
        );
        await page.getByRole('button', { name: '重做', exact: true }).click();
        await page.getByRole('button', { name: renamed, exact: true }).waitFor();
        const redo = await download('json', 'redo');
        verifyRenamed(JSON.parse(redo.bytes));
        return { downloads: [item, redo].map(({ filename, sha256 }) => ({ filename, sha256 })) };
      });
      await check(checks[3], async () => {
        await page.getByText('已保存到本地', { exact: true }).waitFor();
        await page.reload();
        await page.getByRole('grid').waitFor();
        await page.getByRole('button', { name: renamed, exact: true }).waitFor();
        const item = await download('json', 'reload');
        verifyRenamed(JSON.parse(item.bytes));
        return { download: { filename: item.filename, sha256: item.sha256 } };
      });
      await check(checks[4], async () => {
        const item = await download('xlsx', 'rename-roundtrip');
        await page.locator('input[type=file]').setInputFiles(path.join(output, item.filename));
        await page.getByRole('heading', { name: 'rename-roundtrip', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Summary', exact: true }).click();
        await select('A1');
        await page.waitForFunction(
          () => document.querySelector('[role=gridcell]')?.textContent === 'A1 7',
        );
        const json = await download('json', 'xlsx-restored');
        verifyRenamed(JSON.parse(json.bytes));
        return { downloads: [item, json].map(({ filename, sha256 }) => ({ filename, sha256 })) };
      });
      await check(checks[5], async () => {
        await page.getByRole('button', { name: '关闭数据洞察', exact: true }).click();
        await open();
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true);
        await page.keyboard.press('Tab');
        assert.equal(await input.evaluate((el) => el === document.activeElement), true);
        await input.fill('Summary Keyboard');
        await input.press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Summary Keyboard', exact: true }).waitFor();
        await open();
        await page.waitForFunction(() =>
          document
            .querySelector('.modal-backdrop')
            ?.getAnimations({ subtree: true })
            .every((animation) => animation.playState === 'finished'),
        );
        await page.screenshot({ path: path.join(output, 'narrow.png'), fullPage: true });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          ),
        );
        assert(
          await dialog.evaluate((el) => {
            const box = el.getBoundingClientRect();
            return box.left >= 0 && box.right <= innerWidth;
          }),
        );
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        return {
          screenshot: 'narrow.png',
          sha256: hash(await readFile(path.join(output, 'narrow.png'))),
        };
      });
    } catch (error) {
      report.runErrors.push({ message: error.message });
      console.error(`FAIL ${engine}: ${error.message}`);
      await page
        .screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
        .catch(() => {});
    } finally {
      finalizeBrowserReport(report, checks);
      await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
      await browser.close();
      if (report.status !== 'passed') process.exitCode = 1;
    }
  }
} finally {
  await new Promise((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
    server.httpServer.closeAllConnections();
  });
}

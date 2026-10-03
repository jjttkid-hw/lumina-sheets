import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { siteDigest } from './site-evidence.mjs';
import { verifySiteHttp } from './site-runtime.mjs';
import { finalizeBrowserReport } from './browser-report.mjs';

// Operate shipped workspace controls. Page evaluation only observes visible state.
const runtime = path.resolve('scripts/fixtures/frameworks/node_modules');
const { preview } = await import(pathToFileURL(path.join(runtime, 'vite/dist/node/index.js')));
const engines = await import(pathToFileURL(path.join(runtime, 'playwright/index.mjs')));
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const site = await siteDigest('dist');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const artifactSha256 = hash(await readFile(`artifacts/lumina-report-sdk-${version}.tgz`));
const fixture = 'docs/acceptance/wps-business-2026-10-03-r34/wps-custom-title.xlsx';
const fixtureSha256 = hash(await readFile(fixture));
const checks = [
  'imported-rule-preserved',
  'title-edit-history',
  'rule-reload-download',
  'empty-title-download',
  'narrow-dialog-keyboard',
  'metadata-whitespace-preserved',
];
const server = await preview({
  configFile: false,
  base: '/lumina-sheets/',
  preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
});
try {
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await verifySiteHttp('dist', origin);
  for (const engine of ['chromium', 'firefox', 'webkit']) {
    const output = path.resolve(`artifacts/browser-validation-workspace/${engine}`);
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
      fixtureSha256,
      scope:
        'Shipped workspace rule dialog, edit errors, undo/redo, real IndexedDB reload and downloaded XLSX/JSON. Native IME, screen reader and physical touch remain unverified.',
      checks: [],
      pageErrors: [],
      consoleErrors: [],
      runErrors: [],
    };
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') report.consoleErrors.push(message.text());
    });
    const dialog = page.getByRole('dialog', { name: '数据验证', exact: true });
    const title = dialog.getByRole('textbox', { name: '输入错误标题（可选）', exact: true });
    const message = dialog.getByRole('textbox', { name: '输入错误提示（可选）', exact: true });
    const open = async () => {
      const closeNav = page.getByRole('button', { name: '关闭导航', exact: true });
      if (await closeNav.isVisible()) await closeNav.click({ position: { x: 375, y: 420 } });
      await page.getByRole('button', { name: '数据验证', exact: true }).click();
      await dialog.waitFor();
    };
    const save = async () => {
      await dialog.getByRole('button', { name: '保存规则', exact: true }).click();
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
    const formula = page.getByRole('textbox', { name: '公式编辑栏', exact: true });
    const reject = async (heading) => {
      await select('D2');
      await formula.fill('无效');
      await formula.press('Enter');
      await page
        .getByText(`D2：${heading ? heading + '：' : ''}请选择通过、待审或拒绝`, { exact: true })
        .last()
        .waitFor();
      assert.equal(await formula.inputValue(), '无效');
      await formula.press('Escape');
      assert.equal(await formula.inputValue(), '通过');
    };
    const download = async (format, label) => {
      await page.getByRole('button', { name: '导出', exact: true }).click();
      const pending = page.waitForEvent('download');
      await page
        .getByRole('button', { name: format === 'xlsx' ? /Excel 工作簿/ : /完整数据与样式/ })
        .click();
      const result = await pending;
      const filename = `${label}.${format}`;
      await result.saveAs(path.join(output, filename));
      assert.equal(await result.failure(), null);
      const bytes = await readFile(path.join(output, filename));
      return { filename, bytes, sha256: hash(bytes) };
    };
    const check = async (name, action) => {
      const started = Date.now();
      try {
        const details = await action();
        report.checks.push({
          name,
          status: 'passed',
          elapsedMs: Date.now() - started,
          details,
        });
        console.log(`PASS ${engine}/${name}`);
      } catch (error) {
        report.checks.push({ name, status: 'failed', error: error.message });
        throw error;
      }
    };
    try {
      await page.goto(`${origin}/lumina-sheets/`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('grid').waitFor();
      await page.locator('input[type=file]').setInputFiles(fixture);
      await page.getByRole('button', { name: '项目费用', exact: true }).waitFor();
      await page.getByRole('button', { name: '项目费用', exact: true }).click();
      await check(checks[0], async () => {
        await open();
        assert.equal(await title.inputValue(), '审批状态');
        assert.equal(await message.inputValue(), '请选择通过、待审或拒绝');
        assert.equal(await dialog.getByLabel('应用范围', { exact: true }).inputValue(), 'D2');
        assert.equal(
          await dialog.getByRole('textbox', { name: '允许的选项', exact: true }).inputValue(),
          '通过\n待审\n拒绝',
        );
        await dialog.getByLabel('允许空白', { exact: true }).check();
        await save();
        await reject('审批状态');
      });
      await check(checks[1], async () => {
        await open();
        await title.fill('审批要求');
        await save();
        await reject('审批要求');
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        await reject('审批状态');
        await page.getByRole('button', { name: '重做', exact: true }).click();
        await reject('审批要求');
      });
      await check(checks[2], async () => {
        await page.getByText('已保存到本地', { exact: true }).waitFor();
        await page.reload();
        await page.getByRole('grid').waitFor();
        await page.getByRole('button', { name: '项目费用', exact: true }).click();
        await open();
        assert.equal(await title.inputValue(), '审批要求');
        assert.equal(await message.inputValue(), '请选择通过、待审或拒绝');
        assert.equal(await dialog.getByLabel('允许空白', { exact: true }).isChecked(), true);
        await save();
        const xlsx = await download('xlsx', 'edited-title');
        const external = new ExcelJS.Workbook();
        await external.xlsx.load(xlsx.bytes);
        assert.equal(
          external.getWorksheet('项目费用').getCell('D2').dataValidation.errorTitle,
          '审批要求',
        );
        assert.equal(
          external.getWorksheet('项目费用').getCell('D2').dataValidation.error,
          '请选择通过、待审或拒绝',
        );
        const json = await download('json', 'edited-title');
        const rule = JSON.parse(json.bytes).sheets[2].dataValidations[0];
        assert.equal(rule.errorTitle, '审批要求');
        assert.equal(rule.allowBlank, true);
        return {
          downloads: [
            { filename: xlsx.filename, sha256: xlsx.sha256 },
            { filename: json.filename, sha256: json.sha256 },
          ],
        };
      });
      await check(checks[3], async () => {
        await open();
        await title.fill('');
        await save();
        await reject('');
        const json = await download('json', 'empty-title');
        assert.equal(JSON.parse(json.bytes).sheets[2].dataValidations[0].errorTitle, '');
        const xlsx = await download('xlsx', 'empty-title');
        await page.locator('input[type=file]').setInputFiles(path.join(output, xlsx.filename));
        await page.getByRole('heading', { name: 'empty-title', exact: true }).waitFor();
        await page.getByRole('button', { name: '项目费用', exact: true }).click();
        await open();
        assert.equal(await title.inputValue(), '');
        assert.equal(await message.inputValue(), '请选择通过、待审或拒绝');
        await save();
        await reject('');
        return {
          downloads: [
            { filename: xlsx.filename, sha256: xlsx.sha256 },
            { filename: json.filename, sha256: json.sha256 },
          ],
        };
      });
      await check(checks[4], async () => {
        await page.getByRole('button', { name: '关闭数据洞察', exact: true }).click();
        await open();
        await page.setViewportSize({ width: 390, height: 844 });
        await title.fill('审'.repeat(32));
        await title.press('End');
        await title.press('x');
        assert.equal((await title.inputValue()).length, 32);
        await title.press('Tab');
        await message.fill('请选择通过、待审或拒绝');
        await page.screenshot({ path: path.join(output, 'narrow.png'), fullPage: true });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          ),
        );
        await dialog.getByRole('button', { name: '保存规则', exact: true }).focus();
        await page.keyboard.press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        await open();
        assert.equal(await title.inputValue(), '审'.repeat(32));
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
      });
      await check(checks[5], async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        const zip = await JSZip.loadAsync(await readFile(fixture));
        const sheet = 'xl/worksheets/sheet3.xml';
        const xml = (await zip.file(sheet).async('string'))
          .replace(/errorTitle="[^"]*"/, 'errorTitle="审批😀_x000D_&#10;&#9;_x005F_x0041_"')
          .replace(/error="[^"]*"/, 'error="请选择_x000D_&#10;&#9;_x005F_x000D_"');
        zip.file(sheet, xml);
        const bytes = await zip.generateAsync({ type: 'nodebuffer' });
        const inputPath = path.join(output, 'metadata-title.xlsx');
        await writeFile(inputPath, bytes);
        await page.locator('input[type=file]').setInputFiles(inputPath);
        await page.getByRole('heading', { name: 'metadata-title', exact: true }).waitFor();
        await page.getByRole('button', { name: '项目费用', exact: true }).click();
        await open();
        await dialog.getByLabel('允许空白', { exact: true }).check();
        await save();
        const verify = (bytes) => {
          const rule = JSON.parse(bytes).sheets[2].dataValidations[0];
          assert.equal(rule.errorTitle, '审批😀\r\n\t_x0041_');
          assert.equal(rule.message, '请选择\r\n\t_x000D_');
          assert.equal(rule.allowBlank, true);
        };
        const json = await download('json', 'metadata-title-after-edit');
        verify(json.bytes);
        const xlsx = await download('xlsx', 'metadata-title-after-edit');
        await page.locator('input[type=file]').setInputFiles(path.join(output, xlsx.filename));
        await page
          .getByRole('heading', { name: 'metadata-title-after-edit', exact: true })
          .waitFor();
        const restored = await download('json', 'metadata-title-restored');
        verify(restored.bytes);
        return {
          source: { filename: 'metadata-title.xlsx', sha256: hash(bytes) },
          downloads: [json, xlsx, restored].map(({ filename, sha256 }) => ({ filename, sha256 })),
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

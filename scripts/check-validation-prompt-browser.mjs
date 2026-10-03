import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { siteDigest } from './site-evidence.mjs';
import { verifySiteHttp } from './site-runtime.mjs';
import { finalizeBrowserReport } from './browser-report.mjs';

// Operate shipped workspace controls. Page evaluation only observes visible state.
const runtime = path.resolve('scripts/fixtures/frameworks/node_modules');
const { default: JSZip } = await import(pathToFileURL(path.join(runtime, 'jszip/lib/index.js')));
const { preview } = await import(pathToFileURL(path.join(runtime, 'vite/dist/node/index.js')));
const engines = await import(pathToFileURL(path.join(runtime, 'playwright/index.mjs')));
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const site = await siteDigest('dist');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const artifactSha256 = hash(await readFile(`artifacts/lumina-report-sdk-${version}.tgz`));
const fixture = 'docs/acceptance/wps-business-2026-10-03-r34/wps-custom-title.xlsx';
const fixtureSha256 = hash(await readFile(fixture));
const checks = [
  'configure-prompt',
  'selection-and-editing',
  'reload-download',
  'disabled-roundtrip',
  'overlapping-and-range',
  'narrow-prompt',
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
    const output = path.resolve(`artifacts/browser-validation-prompts/${engine}`);
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
        'Input prompt configuration, Canvas selection, persisted reload, disabled XLSX/JSON roundtrip, overlapping rules and narrow viewport. Automated browser input only.',
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
      const prompt = page.getByRole('complementary', { name: '单元格输入说明', exact: true });
      const enabled = dialog.getByLabel('选中单元格时显示输入说明', { exact: true });
      const promptTitle = dialog.getByRole('textbox', {
        name: '输入说明标题（可选）',
        exact: true,
      });
      const promptBody = dialog.getByRole('textbox', { name: '输入说明（可选）', exact: true });
      const heading = '审批说明😀';
      const body = '请选择审批状态\n请先核对金额 <b>原文</b> _x0041_';
      const downloads = (...items) => items.map(({ filename, sha256 }) => ({ filename, sha256 }));
      const verifyRule = (bytes, show) => {
        const rule = JSON.parse(bytes).sheets[2].dataValidations[0];
        assert.equal(rule.promptTitle, heading);
        assert.equal(rule.prompt, body);
        assert.equal(rule.showInputMessage, show);
        assert.equal(rule.errorTitle, '审批状态');
      };
      await check(checks[0], async () => {
        await select('D2');
        await open();
        await enabled.check();
        await promptTitle.fill(heading);
        await promptBody.fill(body);
        await save();
        await prompt.waitFor();
        assert.equal(await prompt.locator('strong').textContent(), heading);
        assert.equal(await prompt.locator('p').textContent(), body);
        assert.equal(await prompt.locator('b').count(), 0);
        const description = await page.getByRole('grid').getAttribute('aria-describedby');
        assert.equal(description, await prompt.getAttribute('id'));
      });
      await check(checks[1], async () => {
        await select('D3');
        await prompt.waitFor({ state: 'hidden' });
        await select('D2');
        await prompt.waitFor();
        await formula.fill('无效');
        await formula.press('Enter');
        await page
          .getByText('D2：审批状态：请选择通过、待审或拒绝', { exact: true })
          .last()
          .waitFor();
        await formula.press('Escape');
        assert.equal(await formula.inputValue(), '通过');
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        await prompt.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: '重做', exact: true }).click();
        await prompt.waitFor();
      });
      await check(checks[2], async () => {
        await page.getByText('已保存到本地', { exact: true }).waitFor();
        await page.reload();
        await page.getByRole('grid').waitFor();
        await page.getByRole('button', { name: '项目费用', exact: true }).click();
        await select('D2');
        await prompt.waitFor();
        const json = await download('json', 'enabled-prompt');
        verifyRule(json.bytes, true);
        const xlsx = await download('xlsx', 'enabled-prompt');
        const archive = await JSZip.loadAsync(xlsx.bytes);
        const xml = await archive.file('xl/worksheets/sheet3.xml').async('string');
        assert.match(xml, /showInputMessage="1"/);
        assert.match(xml, /promptTitle="审批说明😀"/);
        await page.screenshot({ path: path.join(output, 'enabled.png') });
        return { downloads: downloads(json, xlsx) };
      });
      await check(checks[3], async () => {
        await open();
        await enabled.uncheck();
        await save();
        await prompt.waitFor({ state: 'hidden' });
        const json = await download('json', 'disabled-prompt');
        verifyRule(json.bytes, false);
        const xlsx = await download('xlsx', 'disabled-prompt');
        const archive = await JSZip.loadAsync(xlsx.bytes);
        const xml = await archive.file('xl/worksheets/sheet3.xml').async('string');
        assert.match(xml, /showInputMessage="0"/);
        await page.locator('input[type=file]').setInputFiles(path.join(output, xlsx.filename));
        await page.getByRole('heading', { name: 'disabled-prompt', exact: true }).waitFor();
        await page.getByRole('button', { name: '项目费用', exact: true }).click();
        await select('D2');
        await prompt.waitFor({ state: 'hidden' });
        const restored = await download('json', 'restored-prompt');
        verifyRule(restored.bytes, false);
        await open();
        assert.equal(await enabled.isChecked(), false);
        assert.equal(await promptTitle.inputValue(), heading);
        assert.equal(await promptBody.inputValue(), body);
        await enabled.check();
        await save();
        await prompt.waitFor();
        return { downloads: downloads(json, xlsx, restored) };
      });
      await check(checks[4], async () => {
        const json = await download('json', 'overlap-source');
        const book = JSON.parse(json.bytes);
        const rules = book.sheets[2].dataValidations;
        rules.push({
          ...rules[0],
          id: 'second-prompt',
          promptTitle: '第二条说明',
          prompt: '重叠范围',
        });
        rules.push({
          ...rules[0],
          id: 'disabled-prompt',
          promptTitle: '不应显示',
          showInputMessage: false,
        });
        rules.push({
          ...rules[0],
          id: 'wrong-sheet',
          sheetId: 'another-sheet',
          promptTitle: '不应显示',
        });
        const bytes = Buffer.from(JSON.stringify(book));
        await writeFile(path.join(output, 'overlapping.json'), bytes);
        await page
          .locator('input[type=file]')
          .setInputFiles({ name: 'overlapping.json', mimeType: 'application/json', buffer: bytes });
        await page.getByRole('grid').waitFor();
        await page.getByRole('button', { name: '项目费用', exact: true }).click();
        await select('D2');
        await page.waitForFunction(
          () => document.querySelectorAll('.sheet-input-prompt > div').length === 2,
        );
        assert.deepEqual(await prompt.locator('strong').allTextContents(), [heading, '第二条说明']);
        await page.getByRole('grid').focus();
        await page.keyboard.press('Shift+ArrowDown');
        await prompt.waitFor({ state: 'hidden' });
        await select('D2');
        await prompt.waitFor();
        return {
          source: { filename: 'overlapping.json', sha256: hash(bytes) },
          downloads: downloads(json),
        };
      });
      await check(checks[5], async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        const closeNav = page.getByRole('button', { name: '关闭导航', exact: true });
        if (await closeNav.isVisible()) await closeNav.click({ position: { x: 375, y: 420 } });
        const closeInsights = page.getByRole('button', { name: '关闭数据洞察', exact: true });
        if (await closeInsights.isVisible()) await closeInsights.click();
        await select('D2');
        await page.waitForFunction(() => {
          const card = document.querySelector('.sheet-input-prompt');
          if (!card) return false;
          const box = card.getBoundingClientRect();
          return card.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          );
        });
        const box = await prompt.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= 390 && box.height > 0);
        await page.screenshot({ path: path.join(output, 'narrow.png') });
        return { viewport: { width: 390, height: 844 }, box };
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

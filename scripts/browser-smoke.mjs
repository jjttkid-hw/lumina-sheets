import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { siteDigest } from './site-evidence.mjs';
import { verifySiteHttp } from './site-runtime.mjs';
import { finalizeBrowserReport } from './browser-report.mjs';

// Real browser smoke coverage only. Native IME, Safari, assistive technology and
// physical touch still require the separate acceptance matrix.
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
const output = path.resolve(`artifacts/browser-acceptance/${engine}`);
await mkdir(output, { recursive: true });
const site = await siteDigest('dist');
await verifySiteHttp('dist', origin.origin);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const archive = await readFile(`artifacts/lumina-report-sdk-${version}.tgz`);
const browser = await engines[engine].launch({
  headless: process.env.BROWSER_HEADED !== '1',
  ...(engine === 'chromium' ? { channel: process.env.BROWSER_CHANNEL ?? 'chrome' } : {}),
  // Only local candidate traffic skips system proxies; remote runs keep normal routing.
  ...(engine === 'firefox' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
    ? { firefoxUserPrefs: { 'network.proxy.type': 0 } } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
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
    'Isolated real-browser smoke. Not full browser/IME/accessibility/physical-touch acceptance.',
  checks: [],
  pageErrors: [],
  consoleErrors: [],
  runErrors: [],
};
page.on('pageerror', (error) => report.pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error')
    report.consoleErrors.push({ text: message.text(), location: message.location() });
});
const check = async (name, action) => {
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
    await page
      .screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true })
      .catch(() => {});
  }
};
async function valueEquals(locator, expected) {
  await page.waitForFunction(
    ({ label, expected }) => document.querySelector(`[aria-label="${label}"]`)?.value === expected,
    { label: await locator.getAttribute('aria-label'), expected },
    { timeout: 5000 },
  );
}
const address = page.getByRole('textbox', { name: '单元格地址', exact: true });
const formula = page.getByRole('textbox', { name: '公式编辑栏', exact: true });
async function selectCell(key) {
  await address.fill(key);
  await address.press('Enter');
  await page.waitForFunction(
    (key) => document.querySelector('[role=gridcell]')?.textContent?.startsWith(`${key} `),
    key,
    { timeout: 5000 },
  );
}
try {
  await check('workspace-render', async () => {
    await page.goto(origin.href);
    await page.getByRole('grid').waitFor();
    await page.getByText('已保存到本地', { exact: true }).waitFor();
    const canvas = await page
      .locator('canvas')
      .first()
      .evaluate((node) => ({ width: node.width, height: node.height }));
    assert(canvas.width > 0 && canvas.height > 0);
    await page.screenshot({ path: path.join(output, 'workspace.png'), fullPage: true });
    return canvas;
  });
  await check('create-edit-history', async () => {
    await page.getByRole('button', { name: '新建工作簿', exact: true }).click();
    await page.getByPlaceholder('例如：2026 季度销售计划').fill('浏览器验收副本');
    await page.getByRole('button', { name: '创建工作簿', exact: true }).click();
    await selectCell('A1');
    await formula.fill('42');
    await formula.press('Enter');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await valueEquals(formula, '');
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await valueEquals(formula, '42');
    await selectCell('B1');
    await formula.fill('=A1*2');
    await formula.press('Enter');
    await page.getByRole('gridcell').filter({ hasText: '84' }).waitFor();
    await page.getByRole('grid').focus();
    await page.keyboard.press('F2');
    const editor = page.getByRole('textbox', { name: '编辑单元格 B1', exact: true });
    await editor.fill('=A1*3');
    await editor.press('Enter');
    await selectCell('B1');
    await valueEquals(formula, '=A1*3');
    await page.getByRole('gridcell').filter({ hasText: '126' }).waitFor();
    await formula.fill('unsaved');
    await formula.press('Escape');
    await valueEquals(formula, '=A1*3');
  });
  await check('indexeddb-reload', async () => {
    await page.getByText('已保存到本地', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('grid').waitFor();
    await selectCell('A1');
    await valueEquals(formula, '42');
    await selectCell('B1');
    await valueEquals(formula, '=A1*3');
    await page.getByRole('gridcell').filter({ hasText: '126' }).waitFor();
  });
  await check('zoom-narrow-layout', async () => {
    await page.getByRole('button', { name: '放大', exact: true }).click();
    assert.equal(await page.getByLabel('缩放比例').inputValue(), '110');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('grid').waitFor();
    await page.screenshot({ path: path.join(output, 'workspace-narrow.png'), fullPage: true });
    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert(widths.scroll <= widths.client + 1, `Page overflows: ${JSON.stringify(widths)}`);
    return widths;
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await check('report-layouts', async () => {
    await page.goto(new URL('examples/report.html', origin).href);
    await page.getByRole('grid').waitFor();
    const layouts = await page
      .locator('[data-layout]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-layout')));
    const observations = [];
    for (const layout of layouts) {
      await page.locator(`[data-layout="${layout}"]`).click();
      await page.waitForFunction(
        () =>
          document.querySelector('#status')?.dataset.error !== 'true' &&
          !!document.querySelector('[role=grid]'),
      );
      await page.waitForTimeout(layout === 'snapshot' || layout === 'paged' ? 1200 : 450);
      assert.notEqual(
        await page.locator('#status').getAttribute('data-error'),
        'true',
        await page.locator('#status').innerText(),
      );
      observations.push({
        layout,
        status: await page.locator('#status').innerText(),
        metrics: await page.locator('#metrics').innerText(),
      });
    }
    return observations;
  });
  await check('report-downloads-roundtrip', async () => {
    await page.locator('[data-layout="list"]').click();
    const downloads = [];
    for (const format of ['json', 'csv', 'xlsx', 'pdf']) {
      await page.locator('#format').selectOption(format);
      const waiting = page.waitForEvent('download', { timeout: 30000 });
      await page.locator('#export').click();
      const download = await waiting;
      const filename = path.join(output, `report.${format}`);
      await download.saveAs(filename);
      assert.equal(await download.failure(), null);
      const bytes = await readFile(filename);
      assert(bytes.length > 0);
      if (format === 'json') JSON.parse(bytes.toString('utf8'));
      if (format === 'xlsx') assert.equal(bytes.subarray(0, 2).toString(), 'PK');
      if (format === 'pdf') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      downloads.push({
        format,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    await page.locator('#json-file').setInputFiles(path.join(output, 'report.xlsx'));
    await page.waitForFunction(
      () =>
        /报表已恢复/.test(document.querySelector('#status')?.textContent ?? '') &&
        document.querySelector('#status')?.dataset.error !== 'true',
    );
    await page.screenshot({ path: path.join(output, 'report-roundtrip.png'), fullPage: true });
    return { downloads, importStatus: await page.locator('#status').innerText() };
  });
  await check('report-idle', async () => {
    await page.locator('#check-idle').click();
    await page.waitForFunction(() =>
      /1 秒内额外绘制/.test(document.querySelector('#idle-result')?.textContent ?? ''),
    );
    const text = await page.locator('#idle-result').innerText();
    assert(text.includes('额外绘制 0 次'), text);
    return text;
  });
  await check('packed-sdk-example', async () => {
    await page.goto(new URL('sdk/example.html', origin).href);
    await page.getByRole('grid').waitFor();
    await page.getByLabel('显示比例', { exact: true }).selectOption('150');
    await page.waitForFunction(() => document.querySelector('#status')?.textContent === '显示比例已调整为 150%');
    await page.locator('[data-layout="sheets"]').click();
    await page.waitForFunction(() => document.querySelector('#sheet-select')?.options.length === 2);
    const options = await page
      .locator('#sheet-select option')
      .evaluateAll((nodes) => nodes.map((node) => ({ value: node.value, name: node.textContent })));
    for (const option of options) {
      await page.locator('#sheet-select').selectOption(option.value);
      await page.getByRole('grid', { name: new RegExp(option.name) }).waitFor();
    }
    assert.equal(await page.getByLabel('显示比例', { exact: true }).inputValue(), '150');
    await page.screenshot({ path: path.join(output, 'packed-sdk.png'), fullPage: true });
    return options;
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
    'workspace-render',
    'create-edit-history',
    'indexeddb-reload',
    'zoom-narrow-layout',
    'report-layouts',
    'report-downloads-roundtrip',
    'report-idle',
    'packed-sdk-example',
  ]);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  if (report.status !== 'passed') process.exitCode = 1;
}

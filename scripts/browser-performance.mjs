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
  ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname),
  'Use a local candidate server',
);
const output = path.resolve(`artifacts/browser-performance/${engine}`);
await mkdir(output, { recursive: true });
const site = await siteDigest('dist');
await verifySiteHttp('dist', origin.origin);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const archive = await readFile(`artifacts/lumina-report-sdk-${version}.tgz`);
const browser = await engines[engine].launch({
  headless: process.env.BROWSER_HEADED !== '1',
  ...(engine === 'chromium' ? { channel: process.env.BROWSER_CHANNEL ?? 'chrome' } : {}),
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
    'Measured real-browser performance on this machine, no pass/fail latency budget or competitor comparison. Functional assertions cover data counts, formula sentinels, sampling completion, edits, cancellation and report export.',
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
async function download(button, name) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const item = await pending;
  const filename = path.join(output, name);
  await item.saveAs(filename);
  assert.equal(await item.failure(), null);
  return JSON.parse(await readFile(filename, 'utf8'));
}
try {
  await page.goto(new URL('?view=performance', origin).href);
  await page.getByRole('region', { name: '性能实验室' }).waitFor();
  for (const size of [100000, 1000000]) {
    await check(`fixture-${size}`, async () => {
      await page.getByLabel('实际存储单元格').selectOption(String(size));
      await page.getByRole('button', { name: '加载数据', exact: true }).click();
      await page
        .getByText(`${size.toLocaleString('zh-CN')} 个单元格已驻留`, { exact: true })
        .waitFor({ timeout: 60000 });
      await page.getByRole('button', { name: '跨视区采样', exact: true }).click();
      await page
        .getByText('40 个目标视区均已实际绘制，采样包含填充区与空白边界，可导出报告', {
          exact: true,
        })
        .waitFor({ timeout: 60000 });
      await page.getByRole('button', { name: '测量后台公式', exact: true }).click();
      await page.getByRole('button', { name: '测量后台公式', exact: true }).waitFor();
      const first = await download('导出实测报告', `fixture-${size}-before-edit.json`);
      assert.equal(first.fixture.storedCells, size);
      assert.equal(first.fixture.formulaCount, size / 10);
      assert.equal(first.scrollSampling.completed, 40);
      assert.equal(first.scrollSampling.status, 'complete');
      assert.equal(first.workerCalculation.targets, size / 10);
      assert.equal(first.workerCalculation.firstValue, 5);
      assert.equal(first.workerCalculation.lastValue, size / 2);
      assert(first.canvas.samples.length >= 40);
      assert(first.fixture.firstDrawMs >= first.fixture.dataReadyMs);
      await page.getByLabel('跳至行').fill('1');
      await page.getByRole('button', { name: '定位', exact: true }).click();
      await page.getByRole('gridcell').filter({ hasText: 'A1 1' }).waitFor();
      for (const value of [10, 20, 30, 40, 50]) {
        await page.getByRole('grid').focus();
        await page.keyboard.press('F2');
        const input = page.getByRole('textbox', { name: '编辑单元格 A1', exact: true });
        await input.fill(String(value));
        await input.press('Enter');
        // Enter navigates to A2 and restores grid focus on the next animation
        // frame. Finish that browser interaction before operating the toolbar.
        await page
          .getByRole('gridcell')
          .filter({ hasText: /^A2 2$/ })
          .waitFor();
        await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'grid');
        await page.getByLabel('跳至行').fill('1');
        await page.getByRole('button', { name: '定位', exact: true }).click();
        await page
          .getByRole('gridcell')
          .filter({ hasText: `A1 ${value}` })
          .waitFor();
      }
      await page.getByRole('button', { name: '测量后台公式', exact: true }).click();
      await page.getByRole('button', { name: '测量后台公式', exact: true }).waitFor();
      const edited = await download('导出实测报告', `fixture-${size}-after-edit.json`);
      assert.equal(edited.workerCalculation.firstValue, 54);
      assert.equal(edited.workerCalculation.lastValue, size / 2);
      assert.equal(edited.editToCanvas.frames, 5);
      await page.screenshot({ path: path.join(output, `fixture-${size}.png`), fullPage: true });
      return {
        fixture: first.fixture,
        canvas: first.canvas.p95Ms,
        edit: edited.editToCanvas,
        worker: first.workerCalculation,
      };
    });
  }
  await check('scroll-cancel-clear', async () => {
    await page.getByRole('button', { name: '跨视区采样', exact: true }).click();
    await page.getByRole('button', { name: '停止采样', exact: true }).click();
    const cancelled = await download('导出实测报告', 'cancelled.json');
    assert.equal(cancelled.scrollSampling.status, 'cancelled');
    assert(cancelled.scrollSampling.completed < 40);
    await page.getByRole('button', { name: '清空样本', exact: true }).click();
    const reset = await download('导出实测报告', 'reset.json');
    assert.equal(reset.workerCalculation, null);
    assert.equal(reset.editToCanvas.frames, 0);
    assert.equal(reset.scrollSampling.status, 'not-started');
    return { cancelled: cancelled.scrollSampling, reset: reset.scrollSampling };
  });
  await page.getByText('范围公式更新基准', { exact: true }).click();
  await check('range-cancel', async () => {
    await page.getByRole('button', { name: '运行范围基准', exact: true }).click();
    await page.getByRole('button', { name: '取消范围基准', exact: true }).click();
    await page.getByText('采样已取消，未生成完成报告。', { exact: true }).waitFor();
    assert(await page.getByRole('button', { name: '导出范围报告', exact: true }).isDisabled());
  });
  for (const layout of ['disjoint', 'overlapping'])
    await check(`range-${layout}`, async () => {
      await page.getByLabel('公式分布').selectOption(layout);
      await page.getByRole('button', { name: '运行范围基准', exact: true }).click();
      await page
        .getByText('30 次计算结果均与全量重算一致，原始样本可导出。', { exact: true })
        .waitFor({ timeout: 60000 });
      const data = await download('导出范围报告', `range-${layout}.json`);
      assert.equal(data.layout, layout);
      assert.equal(data.formulaCount, 10000);
      assert.equal(data.iterations, 30);
      return data.summary;
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
    'fixture-100000',
    'fixture-1000000',
    'scroll-cancel-clear',
    'range-cancel',
    'range-disjoint',
    'range-overlapping',
  ]);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  if (report.status !== 'passed') process.exitCode = 1;
}

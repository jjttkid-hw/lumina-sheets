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
const output = path.resolve(`artifacts/browser-focus/${engine}`);
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
try {
  await page.goto(new URL('sdk/example.html', origin).href);
  await page.evaluate(async () => {
    const { createSpreadsheet } = await import('./lumina.js');
    const host = document.createElement('div');
    host.id = 'focus-grid';
    host.style.cssText = 'height:300px;width:700px';
    const input = document.createElement('input');
    input.id = 'host-input';
    input.setAttribute('aria-label', 'Host input');
    document.body.append(host, input);
    window.focusTest = createSpreadsheet(host);
    window.focusTest.setCell('A1', 1);
  });
  const grid = page.locator('#focus-grid [role=grid]');
  for (const key of ['Enter', 'Escape'])
    await check(`host-focus-${key.toLowerCase()}`, async () => {
      await page.evaluate(() => window.focusTest.select({ row: 0, col: 0 }));
      await grid.focus();
      await page.keyboard.press('F2');
      const editor = page.getByRole('textbox', { name: '编辑单元格 A1', exact: true });
      await editor.fill(key === 'Enter' ? '9' : 'discard');
      // Deterministically move host focus after the complete React key handler,
      // before its animation frame. A capture-listener microtask can run before
      // React's handler in Chromium/WebKit and would instead test blur-first.
      await editor.evaluate((input, key) => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        document.querySelector('#host-input').focus();
      }, key);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'host-input');
      assert.equal(await page.evaluate(() => window.focusTest.getValue('A1')), 9);
    });
  await check('ordinary-focus-return', async () => {
    await page.evaluate(() => window.focusTest.select({ row: 0, col: 0 }));
    await grid.focus();
    await page.keyboard.press('F2');
    await page.getByRole('textbox', { name: '编辑单元格 A1', exact: true }).press('Escape');
    await page.waitForFunction(
      () => document.activeElement?.closest('#focus-grid')?.id === 'focus-grid',
    );
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'grid');
  });
  await check('synchronous-host-focus', async () => {
    await page.evaluate(async () => {
      window.focusTest.destroy();
      const { createSpreadsheet } = await import('./lumina.js');
      window.focusTest = createSpreadsheet(document.querySelector('#focus-grid'), {
        onChange: () => document.querySelector('#host-input').focus(),
      });
    });
    await grid.focus();
    await page.keyboard.press('F2');
    const editor = page.getByRole('textbox', { name: '编辑单元格 A1', exact: true });
    await editor.fill('25');
    await editor.press('Enter');
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'host-input');
    assert.equal(await page.evaluate(() => window.focusTest.getValue('A1')), 25);
  });
  await page.evaluate(() => window.focusTest.destroy());
} catch (error) {
  report.runErrors.push({
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack,
  });
  throw error;
} finally {
  finalizeBrowserReport(report, [
    'host-focus-enter',
    'host-focus-escape',
    'ordinary-focus-return',
    'synchronous-host-focus',
  ]);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  if (report.status !== 'passed') process.exitCode = 1;
}

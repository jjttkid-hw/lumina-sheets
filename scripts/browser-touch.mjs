import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { siteDigest } from './site-evidence.mjs';
import { verifySiteHttp } from './site-runtime.mjs';
import { finalizeBrowserReport } from './browser-report.mjs';

const driver = process.env.PLAYWRIGHT_MODULE;
if (!driver) throw new Error('Set PLAYWRIGHT_MODULE to an installed Playwright index.mjs');
const { chromium, firefox, webkit } = await import(pathToFileURL(path.resolve(driver)).href);
const engine = process.env.BROWSER_ENGINE ?? 'chromium';
const engines = { chromium, firefox, webkit };
assert.equal(engine, 'chromium', 'This suite requires Chromium CDP native touch injection');
const origin = new URL(process.env.BROWSER_TEST_URL ?? 'http://127.0.0.1:4273/lumina-sheets/');
assert(
  ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
    origin.origin === 'https://jjttkid-hw.github.io',
  'Use a local candidate server or the official Pages deployment',
);
const output = path.resolve(`artifacts/browser-touch/${engine}`);
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
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
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
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  siteSha256: site.sha256,
  artifactSha256: createHash('sha256').update(archive).digest('hex'),
  scope:
    'Chromium browser-level CDP touch packets, native pan and explicitly host-disabled pan for resize. Not physical-device, mobile keyboard or cross-engine certification.',
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
const tick = () =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
async function makeFixture() {
  await page.evaluate(async () => {
    const { createSpreadsheet } = await import('./lumina.js');
    window.touchGrid?.destroy();
    document.querySelector('#touch-host')?.remove();
    const host = document.createElement('div');
    host.id = 'touch-host';
    host.style.cssText = 'width:360px;height:500px;margin:8px';
    document.body.prepend(host);
    const sheet = {
      id: 'touch-sheet',
      name: 'Touch',
      rowCount: 100,
      colCount: 8,
      cells: { A1: { value: 'one' }, B1: { value: 'two' }, A2: { value: 'three' } },
    };
    const workbook = {
      id: 'touch-book',
      name: 'Touch',
      description: '',
      activeSheetId: sheet.id,
      sheets: [sheet],
      createdAt: '2026-09-21T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
    };
    window.touchGrid = createSpreadsheet(host, { workbook });
  });
  await page.locator('#touch-host [role=grid]').waitFor();
  await tick();
}
const grid = page.locator('#touch-host [role=grid]');
async function pointForCell(row, col) {
  const box = await grid.boundingBox();
  assert(box);
  // Canvas origin is row header + column header; default cells are 100x36.
  return { x: box.x + 44 + col * 100 + 50, y: box.y + 34 + row * 36 + 18 };
}
async function touchTap(point) {
  await page.touchscreen.tap(point.x, point.y);
  await tick();
}
async function touchDrag(from, to, cancel = false) {
  if (engine === 'chromium') {
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y, radiusX: 1, radiusY: 1, id: 11 }],
      modifiers: 0,
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: to.x, y: to.y, radiusX: 1, radiusY: 1, id: 11 }],
      modifiers: 0,
    });
    await session.send('Input.dispatchTouchEvent', {
      type: cancel ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
      modifiers: 0,
    });
    await session.detach();
  }
  await tick();
}
try {
  await page.goto(new URL('sdk/example.html', origin).href);
  await check('touch-tap-selection', async () => {
    await makeFixture();
    const point = await pointForCell(1, 0);
    await touchTap(point);
    assert.deepEqual(await page.evaluate(() => window.touchGrid.selectedRange), { row: 1, col: 0 });
    return {
      pointerType: 'touch',
      selected: await page.evaluate(() => window.touchGrid.selectedRange),
    };
  });
  await check('touch-native-scroll', async () => {
    await makeFixture();
    const box = await grid.boundingBox();
    assert(box);
    await touchDrag({ x: box.x + 200, y: box.y + 350 }, { x: box.x + 200, y: box.y + 100 });
    await page.waitForFunction(
      () => document.querySelector('#touch-host [role=grid]').scrollTop > 0,
      null,
      { timeout: 5000 },
    );
    return {
      scrollTop: await grid.evaluate((node) => node.scrollTop),
      touchAction: await grid.evaluate((node) => getComputedStyle(node).touchAction),
    };
  });
  await check('touch-resize-cancel-retry', async () => {
    await makeFixture();
    // Explicit host gesture policy permits resize drags instead of native pan.
    await grid.evaluate((node) => (node.style.touchAction = 'none'));
    const box = await grid.boundingBox();
    assert(box);
    const from = { x: box.x + 140, y: box.y + 18 },
      to = { x: box.x + 200, y: box.y + 18 };
    await touchDrag(from, to, true);
    assert.equal(
      await page.evaluate(() => window.touchGrid.getSheetLayout().columnWidths?.[0]),
      undefined,
    );
    await touchDrag(from, to);
    assert.equal(
      await page.evaluate(() => window.touchGrid.getSheetLayout().columnWidths?.[0]),
      156,
    );
    return { cancelledWidth: 'default 96', retryWidth: 156, hostTouchAction: 'none' };
  });
  await page.screenshot({ path: path.join(output, 'touch-final.png'), fullPage: true });
} catch (error) {
  report.runErrors.push({
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack,
  });
  throw error;
} finally {
  finalizeBrowserReport(report, [
    'touch-tap-selection',
    'touch-native-scroll',
    'touch-resize-cancel-retry',
  ]);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  if (report.status !== 'passed') process.exitCode = 1;
}

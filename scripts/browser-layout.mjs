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
const output = path.resolve(`artifacts/browser-layout/${engine}`);
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
    'Real-browser Canvas layout, hit testing, navigation and edit validation. Sparse million-row layout is not million stored cells; no native IME, Safari, screen reader or physical touch certification.',
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
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
async function settled() {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function fixture(layout = {}) {
  await page.evaluate(async (layout) => {
    window.layoutTest?.destroy();
    const { createSpreadsheet } = await import('./lumina.js');
    let host = document.querySelector('#layout-host');
    if (!host) {
      // Keep the demo DOM intact: its own instance and callbacks remain live.
      host = document.createElement('div');
      host.id = 'layout-host';
      host.style.cssText = 'width:800px;height:400px;margin:20px';
      document.body.prepend(host);
      const clipboard = document.createElement('textarea');
      clipboard.id = 'clipboard-target';
      document.body.append(clipboard);
    }
    const cells = {
      A1: { value: 'Header' },
      A2: { value: 'alpha' },
      C2: { value: 'charlie' },
      A4: { value: 'delta' },
    };
    window.layoutDraws = [];
    const sheet = {
      id: 'layout-sheet',
      name: 'Layout',
      rowCount: 1000000,
      colCount: 20,
      cells,
      ...layout,
    };
    const workbook = {
      id: 'layout-book',
      name: 'Browser Layout',
      description: '',
      activeSheetId: sheet.id,
      sheets: [sheet],
      createdAt: '2026-09-21T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
    };
    window.layoutTest = createSpreadsheet(host, {
      workbook,
      onRender: (value) => window.layoutDraws.push(value),
    });
  }, layout);
  await page.locator('#layout-host [role=grid]').waitFor();
  await settled();
}
const grid = page.locator('#layout-host [role=grid]');
async function select(row, col) {
  await page.evaluate(({ row, col }) => window.layoutTest.select({ row, col }), { row, col });
  await settled();
  await grid.focus();
}
async function selected(row, col) {
  await page.waitForFunction(
    ({ row, col }) => {
      const s = window.layoutTest.selectedRange;
      return s.row === row && s.col === col;
    },
    { row, col },
    { timeout: 5000 },
  );
}
async function edit(address, value) {
  await grid.focus();
  await page.keyboard.press('F2');
  const input = page.getByRole('textbox', { name: `编辑单元格 ${address}`, exact: true });
  await input.fill(value);
  await input.press('Enter');
  await page.waitForFunction(
    ({ address, value }) => window.layoutTest.getValue(address) === value,
    { address, value },
  );
  await settled();
}
try {
  await page.goto(new URL('sdk/example.html', origin).href);
  await check('hidden-axis-keyboard', async () => {
    await fixture({ hiddenRows: [2], hiddenColumns: [1] });
    await select(1, 0);
    await page.keyboard.press('ArrowRight');
    await selected(1, 2);
    await page.keyboard.press('ArrowDown');
    await selected(3, 2);
    await page.keyboard.press('ArrowLeft');
    await selected(3, 0);
    await page.keyboard.press('ArrowUp');
    await selected(1, 0);
    await page.keyboard.press('Tab');
    await selected(1, 2);
    await page.keyboard.press('Shift+Tab');
    await selected(1, 0);
    await page.keyboard.press('Shift+ArrowRight');
    assert.deepEqual(await page.evaluate(() => window.layoutTest.selectedRange), {
      row: 1,
      col: 0,
      endRow: 1,
      endCol: 2,
    });
  });
  await check('merge-hit-edit-navigation', async () => {
    await fixture({
      cells: { A1: { value: 'header' }, A2: { value: 'merged' } },
      merges: [{ start: { row: 1, col: 0 }, end: { row: 2, col: 2 } }],
    });
    // Click the visible interior of C3; data and selection belong to master A2.
    await grid.click({ position: { x: 344, y: 124 } });
    await selected(1, 0);
    await edit('A2', 'merged edited');
    await select(1, 0);
    await page.keyboard.press('ArrowRight');
    await selected(1, 3);
    await page.keyboard.press('ArrowLeft');
    await selected(1, 0);
    await page.keyboard.press('ArrowDown');
    await selected(3, 0);
    await page.keyboard.press('ArrowUp');
    await selected(1, 0);
    assert.equal(await page.evaluate(() => window.layoutTest.getCell('C3')?.value ?? ''), '');
    await page.screenshot({ path: path.join(output, 'merged.png'), fullPage: true });
  });
  await check('frozen-row-scroll-hit', async () => {
    await fixture({ frozenRows: 1 });
    const box = await grid.boundingBox();
    assert(box);
    await page.mouse.move(box.x + 400, box.y + 200);
    await page.mouse.wheel(0, 900);
    await page.waitForFunction(
      () => document.querySelector('#layout-host [role=grid]').scrollTop > 0,
    );
    await settled();
    const scrollTop = await grid.evaluate((node) => node.scrollTop);
    await grid.click({ position: { x: 90, y: 50 } });
    await selected(0, 0);
    await edit('A1', 'frozen edited');
    assert.equal(await page.evaluate(() => window.layoutTest.getValue('A2')), 'alpha');
    await page.screenshot({ path: path.join(output, 'frozen.png'), fullPage: true });
    return { scrollTop };
  });
  await check('sparse-million-row-locate-edit', async () => {
    await fixture();
    await select(999999, 2);
    await page.locator('#layout-host [role=gridcell]').filter({ hasText: 'C1000000' }).waitFor();
    await edit('C1000000', 'last row');
    await select(999999, 2);
    const state = await page.evaluate(() => ({
      selection: window.layoutTest.selectedRange,
      value: window.layoutTest.getValue('C1000000'),
      draw: window.layoutDraws.at(-1),
      domCells: document.querySelectorAll('#layout-host [role=gridcell]').length,
    }));
    assert.equal(state.value, 'last row');
    assert(state.draw.paintedCells < 1000);
    assert.equal(state.domCells, 1);
    await page.keyboard.press('PageUp');
    assert((await page.evaluate(() => window.layoutTest.selectedRange.row)) < 999999);
    await page.keyboard.press(`${modifier}+Home`);
    await selected(0, 0);
    await page.screenshot({ path: path.join(output, 'sparse-navigation.png'), fullPage: true });
    return state;
  });
  await check('row-height-column-width-hit-undo', async () => {
    await fixture();
    await page.evaluate(() =>
      window.layoutTest.setSheetLayout({ rowHeights: { 0: 70 }, columnWidths: { 0: 200 } }),
    );
    await settled();
    await grid.click({ position: { x: 190, y: 85 } });
    await selected(0, 0);
    await grid.click({ position: { x: 260, y: 125 } });
    await selected(1, 1);
    await page.evaluate(() => window.layoutTest.undo());
    await settled();
    await grid.click({ position: { x: 190, y: 85 } });
    await selected(1, 1);
    await page.evaluate(() => window.layoutTest.redo());
    await settled();
    await grid.click({ position: { x: 190, y: 85 } });
    await selected(0, 0);
    return await page.evaluate(() => window.layoutTest.getSheetLayout());
  });
  await check('filtered-navigation-visible-clipboard', async () => {
    await fixture({
      rowCount: 10,
      colCount: 3,
      frozenRows: 1,
      cells: {
        A1: { value: 'Header' },
        A2: { value: 'keep one' },
        A3: { value: 'omit' },
        A4: { value: 'keep two' },
        A5: { value: 'omit' },
      },
    });
    await page.evaluate(() => window.layoutTest.setFilter('keep'));
    // Filtering is debounced; wait for its actual visible completion state.
    await page.locator('#layout-host .sheet-filter-status').waitFor({ state: 'hidden' });
    await settled();
    await select(1, 0);
    await page.keyboard.press('ArrowDown');
    await selected(3, 0);
    await page.keyboard.press('ArrowUp');
    await selected(1, 0);
    await page.keyboard.press('Shift+ArrowDown');
    assert.deepEqual(await page.evaluate(() => window.layoutTest.selectedRange), {
      row: 1,
      col: 0,
      endRow: 3,
      endCol: 0,
    });
    await page.keyboard.press(`${modifier}+C`);
    const target = page.locator('#clipboard-target');
    await target.fill('');
    await target.press(`${modifier}+V`);
    assert.equal((await target.inputValue()).replace(/\r\n/g, '\n'), 'keep one\nkeep two');
    await grid.focus();
    await page.keyboard.press('Delete');
    await settled();
    assert.deepEqual(
      await page.evaluate(() => ['A2', 'A3', 'A4'].map((key) => window.layoutTest.getValue(key))),
      ['', 'omit', ''],
    );
    await page.evaluate(() => window.layoutTest.undo());
    await settled();
    assert.deepEqual(
      await page.evaluate(() => ['A2', 'A3', 'A4'].map((key) => window.layoutTest.getValue(key))),
      ['keep one', 'omit', 'keep two'],
    );
    await page.screenshot({ path: path.join(output, 'filtered.png'), fullPage: true });
  });
  await page.evaluate(() => window.layoutTest?.destroy());
} catch (error) {
  report.runErrors.push({
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack,
  });
  throw error;
} finally {
  finalizeBrowserReport(report, [
    'hidden-axis-keyboard',
    'merge-hit-edit-navigation',
    'frozen-row-scroll-hit',
    'sparse-million-row-locate-edit',
    'row-height-column-width-hit-undo',
    'filtered-navigation-visible-clipboard',
  ]);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  if (report.status !== 'passed') process.exitCode = 1;
}

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { siteDigest } from './site-evidence.mjs';
import { finalizeBrowserReport } from './browser-report.mjs';

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
const output = path.resolve(`artifacts/browser-accessibility/${engine}`);
await mkdir(output, { recursive: true });
const site = await siteDigest('dist');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const archive = await readFile(`artifacts/lumina-report-sdk-${version}.tgz`);
const browser = await engines[engine].launch({
  headless: process.env.BROWSER_HEADED !== '1',
  ...(engine === 'chromium' ? { channel: process.env.BROWSER_CHANNEL ?? 'chrome' } : {}),
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const report = {
  schema: 1,
  version,
  engine,
  browserVersion: browser.version(),
  executedAt: new Date().toISOString(),
  environment: { platform: process.platform, arch: process.arch, node: process.version, headless: process.env.BROWSER_HEADED !== '1' },
  siteSha256: site.sha256,
  artifactSha256: createHash('sha256').update(archive).digest('hex'),
  scope: 'Browser DOM accessibility semantics for the Canvas grid. This is not a screen-reader announcement or assistive-technology certification.',
  checks: [], pageErrors: [], consoleErrors: [], runErrors: [],
};
page.on('pageerror', (error) => report.pageErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') report.consoleErrors.push({ text: message.text(), location: message.location() }); });
async function check(name, action) {
  const started = Date.now();
  try { const details = await action(); report.checks.push({ name, status: 'passed', elapsedMs: Date.now() - started, details }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, status: 'failed', elapsedMs: Date.now() - started, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}
const state = async () => page.locator('#a11y-grid [role=grid]').evaluate((grid) => {
  const id = grid.getAttribute('aria-activedescendant');
  const cell = id ? document.getElementById(id) : null;
  const row = cell?.parentElement;
  return {
    role: grid.getAttribute('role'), tabIndex: grid.tabIndex,
    rowCount: grid.getAttribute('aria-rowcount'), colCount: grid.getAttribute('aria-colcount'),
    readOnly: grid.getAttribute('aria-readonly'), multiselectable: grid.getAttribute('aria-multiselectable'),
    activeId: id, cellRole: cell?.getAttribute('role'), cellText: cell?.textContent,
    rowIndex: cell?.getAttribute('aria-rowindex'), colIndex: cell?.getAttribute('aria-colindex'), selected: cell?.getAttribute('aria-selected'),
    rowRole: row?.getAttribute('role'), live: row?.getAttribute('aria-live'), atomic: row?.getAttribute('aria-atomic'),
    cellTabIndex: cell?.getAttribute('tabindex'), canvasHidden: grid.querySelector('canvas')?.getAttribute('aria-hidden'),
    focused: document.activeElement === grid,
  };
});
try {
  await page.goto(new URL('sdk/example.html', origin).href, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  if (origin.origin === 'https://jjttkid-hw.github.io') {
    const identity = await page.evaluate(async () => {
      const response = await fetch('../build-info.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`build-info returned ${response.status}`);
      return response.json();
    });
    assert.equal(identity.siteSha256, site.sha256, 'Pages deployment belongs to another build');
    assert.equal(identity.version, version, 'Pages deployment belongs to another version');
  }
  await page.evaluate(async () => {
    const { createSpreadsheet } = await import('./lumina.js');
    const host = document.createElement('div'); host.id = 'a11y-grid'; host.style.cssText = 'height:320px;width:760px'; document.body.replaceChildren(host);
    window.a11yGrid = createSpreadsheet(host); window.a11yGrid.setCell('B2', '中文'); window.a11yGrid.setCell('C3', '=1+1'); window.a11yGrid.select({ row: 1, col: 1 });
  });
  const grid = page.locator('#a11y-grid [role=grid]');
  await grid.waitFor();
  await check('grid-contract', async () => { const x=await state(); assert.equal(x.role,'grid'); assert.equal(x.tabIndex,0); assert.equal(x.rowCount,'100'); assert.equal(x.colCount,'16'); assert.equal(x.multiselectable,'true'); assert.equal(x.canvasHidden,'true'); assert.equal(x.cellTabIndex,null); return x; });
  await check('active-cell-value', async () => { const x=await state(); assert(x.activeId && x.cellRole==='gridcell'); assert.equal(x.cellText,'B2 中文'); assert.equal(x.rowIndex,'2'); assert.equal(x.colIndex,'2'); assert.equal(x.selected,'true'); assert.equal(x.rowRole,'row'); assert.equal(x.live,'polite'); assert.equal(x.atomic,'true'); return x; });
  await check('selection-announcement', async () => { await page.evaluate(()=>window.a11yGrid.select({row:2,col:2,endRow:0,endCol:0})); await page.waitForFunction(()=>document.querySelector('#a11y-grid [role=gridcell]')?.textContent?.includes('已选择 A1:C3')); const x=await state(); assert.equal(x.cellText,'C3 2，已选择 A1:C3，3 行 3 列'); return x; });
  await check('keyboard-focus-update', async () => { await grid.focus(); await page.keyboard.press('ArrowLeft'); await page.waitForFunction(()=>document.querySelector('#a11y-grid [role=gridcell]')?.textContent?.startsWith('B3 ')); const x=await state(); assert.equal(x.focused,true); assert.equal(x.cellText,'B3 '); return x; });
  await check('read-only-contract', async () => { await page.evaluate(async()=>{window.a11yGrid.destroy(); const {createSpreadsheet}=await import('./lumina.js'); window.a11yGrid=createSpreadsheet(document.querySelector('#a11y-grid'),{readOnly:true});}); await page.locator('#a11y-grid [role=grid]').waitFor(); const x=await state(); assert.equal(x.readOnly,'true'); assert.equal(x.tabIndex,0); return x; });
  await page.evaluate(()=>window.a11yGrid.destroy());
} catch (error) { report.runErrors.push({ name: error?.name ?? 'Error', message: error?.message ?? String(error), stack: error?.stack }); throw error; }
finally { finalizeBrowserReport(report, ['grid-contract','active-cell-value','selection-announcement','keyboard-focus-update','read-only-contract']); await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n'); await browser.close(); if(report.status!=='passed')process.exitCode=1; }

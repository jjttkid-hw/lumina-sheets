import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { finalizeBrowserReport } from './browser-report.mjs';
import { siteDigest } from './site-evidence.mjs';

// These checks dispatch the browser's CompositionEvent/InputEvent/KeyboardEvent
// sequence against the production UI. They verify our event lifecycle, but they
// cannot display or certify an operating-system IME candidate window.
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
const output = path.resolve(`artifacts/browser-ime/${engine}`);
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
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    headless: process.env.BROWSER_HEADED !== '1',
  },
  siteSha256: site.sha256,
  artifactSha256: createHash('sha256').update(archive).digest('hex'),
  scope:
    'Browser composition/input/keyboard event lifecycle against the production SDK and report example. Synthetic CompositionEvent sequences are not native operating-system IME candidate-window certification.',
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
async function compose(locator, value, { blur = false, enterDuring = false, keyCode229 = false } = {}) {
  await locator.evaluate(
    (input, options) => {
      input.focus();
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      input.value = options.value;
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: options.value,
          inputType: 'insertCompositionText',
          isComposing: true,
        }),
      );
      if (options.enterDuring)
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: options.keyCode229 ? 229 : 13,
            bubbles: true,
            cancelable: true,
            isComposing: true,
          }),
        );
      if (options.blur) input.blur();
      input.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, data: options.value }),
      );
      // Native browsers commonly emit a final non-composing input event after
      // compositionend. React must retain the final DOM value either way.
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: options.value,
          inputType: 'insertText',
          isComposing: false,
        }),
      );
    },
    { value, blur, enterDuring, keyCode229 },
  );
}
async function mountSdk() {
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
    const host = document.createElement('div');
    host.id = 'ime-grid';
    host.style.cssText = 'height:320px;width:760px';
    // Keep the example host UI mounted because its SDK callbacks legitimately
    // retain references to those controls while this isolated grid is tested.
    document.body.append(host);
    window.imeChanges = [];
    window.imeGrid = createSpreadsheet(host, {
      onChange: (event) => window.imeChanges.push(event),
    });
    window.imeGrid.setCell('A1', '初始');
    window.imeChanges.length = 0;
  });
  await page.locator('#ime-grid [role=grid]').waitFor();
}
async function editor(address = 'A1') {
  const grid = page.locator('#ime-grid [role=grid]');
  await grid.focus();
  await page.keyboard.press('F2');
  const input = page.getByRole('textbox', { name: `编辑单元格 ${address}`, exact: true });
  await input.waitFor();
  return input;
}
try {
  await mountSdk();
  await check('canvas-blur-defers-final-composition', async () => {
    const input = await editor();
    await compose(input, '中文输入', { blur: true });
    await page.waitForFunction(() => window.imeGrid.getValue('A1') === '中文输入');
    const state = await page.evaluate(() => ({
      value: window.imeGrid.getValue('A1'),
      changes: window.imeChanges.map((event) => event.changes),
      editorCount: document.querySelectorAll('#ime-grid .sheet-cell-editor').length,
    }));
    assert.equal(state.value, '中文输入');
    assert.equal(state.changes.length, 1);
    assert.equal(state.changes[0][0].key, 'A1');
    assert.equal(state.changes[0][0].cell.value, '中文输入');
    assert.equal(state.editorCount, 0);
    return state;
  });
  await check('canvas-composing-enter-does-not-commit', async () => {
    await page.evaluate(() => {
      window.imeGrid.setCell('A1', '基线');
      window.imeChanges.length = 0;
    });
    const input = await editor();
    await compose(input, '候选文字', { enterDuring: true, keyCode229: true });
    const composing = await page.evaluate(() => ({
      value: window.imeGrid.getValue('A1'),
      changes: window.imeChanges.length,
      editorCount: document.querySelectorAll('#ime-grid .sheet-cell-editor').length,
    }));
    assert.deepEqual(composing, { value: '基线', changes: 0, editorCount: 1 });
    await input.press('Enter');
    await page.waitForFunction(() => window.imeGrid.getValue('A1') === '候选文字');
    const committed = await page.evaluate(() => ({
      value: window.imeGrid.getValue('A1'),
      changes: window.imeChanges.length,
      editorCount: document.querySelectorAll('#ime-grid .sheet-cell-editor').length,
    }));
    assert.deepEqual(committed, { value: '候选文字', changes: 1, editorCount: 0 });
    return { composing, committed };
  });
  await check('canvas-stale-composition-cannot-write-after-sheet-switch', async () => {
    await page.evaluate(async () => {
      window.imeGrid.destroy();
      const { createSpreadsheet } = await import('./lumina.js');
      const now = new Date().toISOString();
      window.imeChanges = [];
      window.imeGrid = createSpreadsheet(document.querySelector('#ime-grid'), {
        workbook: {
          id: 'ime-workbook',
          name: 'IME workbook',
          description: '',
          activeSheetId: 'ime-sheet-1',
          createdAt: now,
          updatedAt: now,
          category: 'acceptance',
          starred: false,
          sheets: [
            {
              id: 'ime-sheet-1',
              name: '输入',
              cells: { A1: { value: '保留值' } },
              rowCount: 100,
              colCount: 16,
            },
            {
              id: 'ime-sheet-2',
              name: '目标',
              cells: { A1: { value: '目标值' } },
              rowCount: 100,
              colCount: 16,
            },
          ],
        },
        onChange: (event) => window.imeChanges.push(event),
      });
    });
    await page.locator('#ime-grid [role=grid]').waitFor();
    const input = await editor();
    await input.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      element.value = '过期候选';
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: '过期候选',
          inputType: 'insertCompositionText',
          isComposing: true,
        }),
      );
      window.staleImeEditor = element;
      element.blur();
      window.imeGrid.setActiveSheet('ime-sheet-2');
    });
    await page.waitForFunction(
      () =>
        window.imeGrid.activeSheetInfo.id === 'ime-sheet-2' &&
        !window.staleImeEditor.isConnected,
    );
    const state = await page.evaluate(() => {
      window.staleImeEditor.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, data: '过期候选' }),
      );
      const target = window.imeGrid.getValue('A1');
      window.imeGrid.setActiveSheet('ime-sheet-1');
      return new Promise((resolve) =>
        requestAnimationFrame(() =>
          resolve({
            source: window.imeGrid.getValue('A1'),
            target,
            activeSheet: window.imeGrid.activeSheetInfo.id,
            changes: window.imeChanges.length,
            detached: !window.staleImeEditor.isConnected,
          }),
        ),
      );
    });
    assert.deepEqual(state, {
      source: '保留值',
      target: '目标值',
      activeSheet: 'ime-sheet-1',
      changes: 0,
      detached: true,
    });
    return state;
  });
  await page.goto(new URL('examples/report.html', origin).href, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.locator('#formula').waitFor();
  await check('report-formula-composing-enter-guard', async () => {
    await page.locator('#address').fill('A1');
    await page.locator('#jump').click();
    const formula = page.locator('#formula');
    const before = await page.locator('#value').textContent();
    await compose(formula, '报表中文', { enterDuring: true, keyCode229: true });
    const during = await page.locator('#value').textContent();
    assert.equal(during, before);
    await formula.press('Enter');
    await page.waitForFunction(
      () => document.querySelector('#value')?.textContent === '结果：报表中文',
    );
    const after = await page.locator('#value').textContent();
    assert.equal(after, '结果：报表中文');
    return { before, during, after };
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
    'canvas-blur-defers-final-composition',
    'canvas-composing-enter-does-not-commit',
    'canvas-stale-composition-cannot-write-after-sheet-switch',
    'report-formula-composing-enter-guard',
  ]);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  if (report.status !== 'passed') process.exitCode = 1;
}

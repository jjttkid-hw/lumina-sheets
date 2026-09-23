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
const output = path.resolve(`artifacts/browser-interactions/${engine}`);
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
    'Real browser interaction checks. Clipboard uses browser keyboard commands. SDK lifecycle uses published JS API in the page. Not native IME, Safari or physical-touch certification.',
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
async function jump(key) {
  await page.locator('#address').fill(key);
  await page.locator('#jump').click();
  await page.waitForFunction(
    (key) => document.querySelector('#selected')?.textContent === key,
    key,
  );
}
async function result(value) {
  await page.waitForFunction(
    (value) => document.querySelector('#value')?.textContent === `结果：${value}`,
    String(value),
  );
}
async function copyText(text) {
  await page.evaluate(() => {
    if (!document.querySelector('#acceptance-clipboard')) {
      const input = document.createElement('textarea');
      input.id = 'acceptance-clipboard';
      input.setAttribute('aria-label', 'Acceptance clipboard source');
      document.body.append(input);
    }
  });
  const source = page.locator('#acceptance-clipboard');
  await source.fill(text);
  await source.selectText();
  await source.press(`${modifier}+C`);
}
try {
  await page.goto(new URL('sdk/example.html', origin).href);
  await page.getByRole('grid').waitFor();
  await check('validation-editor-recovery', async () => {
    await page.locator('[data-layout="validation"]').click();
    await jump('B2');
    await result(2);
    await page.getByRole('grid').focus();
    await page.keyboard.press('F2');
    const input = page.getByRole('textbox', { name: '编辑单元格 B2', exact: true });
    await input.fill('-1');
    await input.press('Enter');
    await page.getByText('数量须为 1–1000 的整数', { exact: false }).last().waitFor();
    assert.equal(await input.inputValue(), '-1');
    await input.fill('7');
    await input.press('Enter');
    await jump('B2');
    await result(7);
    await page.locator('#undo').click();
    await result(2);
    await page.locator('#redo').click();
    await result(7);
  });
  await check('validation-list-keyboard', async () => {
    await jump('D2');
    await page.getByRole('grid').focus();
    await page.keyboard.press('Alt+ArrowDown');
    const search = page.getByRole('combobox', { name: '搜索 D2 的可选值' });
    await search.fill('取消');
    await search.press('Enter');
    await result('已取消');
    assert.equal(await page.getByRole('listbox').count(), 0);
    await page.getByRole('grid').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await search.fill('确认');
    await search.press('Escape');
    await result('已取消');
    assert.equal(await page.getByRole('listbox').count(), 0);
    await page.locator('#undo').click();
    await result('待审核');
  });
  await check('native-clipboard-atomic-validation', async () => {
    await page.locator('[data-layout="validation"]').click();
    await copyText('8\t-1');
    await jump('B2');
    await page.getByRole('grid').focus();
    await page.keyboard.press(`${modifier}+V`);
    await page.getByText('单价须为 0–1,000,000 的数字', { exact: false }).last().waitFor();
    await jump('B2');
    await result(2);
    await jump('C2');
    await result(500);
    await copyText('8\t600');
    await jump('B2');
    await page.getByRole('grid').focus();
    await page.keyboard.press(`${modifier}+V`);
    await jump('B2');
    await result(8);
    await jump('C2');
    await result(600);
    await page.locator('#undo').click();
    await jump('B2');
    await result(2);
    await jump('C2');
    await result(500);
    return {
      transport: 'native keyboard copy/paste',
      rejected: 'B2:C2 unchanged',
      accepted: 'both cells changed, one undo restores both',
    };
  });
  await check('native-copy-cut-paste', async () => {
    await jump('F2');
    await page.getByRole('grid').focus();
    await page.keyboard.press(`${modifier}+C`);
    await jump('F3');
    await page.getByRole('grid').focus();
    await page.keyboard.press(`${modifier}+V`);
    await result('编辑数量或选择状态');
    await page.getByRole('grid').focus();
    await page.keyboard.press(`${modifier}+X`);
    await result('');
    await jump('F4');
    await page.getByRole('grid').focus();
    await page.keyboard.press(`${modifier}+V`);
    await result('编辑数量或选择状态');
  });
  await check('sdk-mount-isolation-destroy', async () => {
    await page.evaluate(async () => {
      const { createSpreadsheet } = await import('./lumina.js');
      const hosts = [0, 1].map((index) => {
        const host = document.createElement('div');
        host.id = `test-sdk-${index}`;
        host.className = 'customer-host';
        host.style.cssText = 'height:280px;width:700px';
        document.body.append(host);
        return host;
      });
      window.acceptanceSDK = {
        hosts,
        createSpreadsheet,
        instances: hosts.map((host) => createSpreadsheet(host)),
      };
      window.acceptanceSDK.instances[0].setCell('A1', 11);
      window.acceptanceSDK.instances[1].setCell('A1', 22);
    });
    await page.locator('#test-sdk-0 [role=gridcell]').filter({ hasText: '11' }).waitFor();
    await page.locator('#test-sdk-1 [role=gridcell]').filter({ hasText: '22' }).waitFor();
    await page.locator('#test-sdk-0 [role=grid]').focus();
    await page.keyboard.press(`${modifier}+Z`);
    assert.deepEqual(
      await page.evaluate(() => window.acceptanceSDK.instances.map((g) => g.getValue('A1'))),
      ['', 22],
    );
    const state = await page.evaluate(async () => {
      const t = window.acceptanceSDK;
      let duplicate;
      try {
        t.createSpreadsheet(t.hosts[0]);
      } catch (e) {
        duplicate = e.code;
      }
      const old = t.instances[0];
      old.destroy();
      old.destroy();
      const empty = t.hosts[0].childElementCount;
      const restored = t.hosts[0].className;
      let destroyed;
      try {
        old.setCell('A1', 99);
      } catch (e) {
        destroyed = e.code;
      }
      t.instances[0] = t.createSpreadsheet(t.hosts[0]);
      old.destroy();
      t.instances[0].setCell('A1', 33);
      return { duplicate, empty, restored, destroyed, other: t.instances[1].getValue('A1') };
    });
    assert.deepEqual(state, {
      duplicate: 'INVALID_ARGUMENT',
      empty: 0,
      restored: 'customer-host',
      destroyed: 'DESTROYED',
      other: 22,
    });
    await page.locator('#test-sdk-0 [role=gridcell]').filter({ hasText: '33' }).waitFor();
    await page.evaluate(() => {
      window.acceptanceSDK.instances.forEach((g) => g.destroy());
      window.acceptanceSDK.hosts.forEach((h) => h.remove());
    });
    return state;
  });
  await check('sdk-pending-source-destroy', async () => {
    const state = await page.evaluate(async () => {
      const { createSpreadsheet } = await import('./lumina.js');
      const host = document.createElement('div');
      host.style.cssText = 'height:280px';
      document.body.append(host);
      let complete;
      let calls = 0;
      const grid = createSpreadsheet(host, { onDataStateChange: () => calls++ });
      const pending = grid
        .bindData({
          rowCount: 100,
          columnCount: 1,
          fetchPage: () =>
            new Promise((resolve) => {
              complete = resolve;
            }),
        })
        .then(
          () => 'resolved',
          (e) => e.name,
        );
      await new Promise((resolve) => setTimeout(resolve, 50));
      grid.destroy();
      const afterDestroy = calls;
      const outcome = await pending;
      const next = createSpreadsheet(host);
      next.setCell('A1', 'new session');
      complete?.({ rows: [['stale']], totalRows: 100 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = { outcome, lateCallbacks: calls - afterDestroy, value: next.getValue('A1') };
      next.destroy();
      host.remove();
      return result;
    });
    assert.deepEqual(state, { outcome: 'AbortError', lateCallbacks: 0, value: 'new session' });
    return state;
  });
  await page.screenshot({ path: path.join(output, 'validation.png'), fullPage: true });
} catch (error) {
  report.runErrors.push({
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack,
  });
  throw error;
} finally {
  finalizeBrowserReport(report, [
    'validation-editor-recovery',
    'validation-list-keyboard',
    'native-clipboard-atomic-validation',
    'native-copy-cut-paste',
    'sdk-mount-isolation-destroy',
    'sdk-pending-source-destroy',
  ]);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  if (report.status !== 'passed') process.exitCode = 1;
}

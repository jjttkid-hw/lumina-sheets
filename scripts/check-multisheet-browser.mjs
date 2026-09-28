import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { siteDigest } from './site-evidence.mjs';
import { verifySiteHttp } from './site-runtime.mjs';
import { finalizeBrowserReport } from './browser-report.mjs';

// Drive the shipped controls, downloads and file inputs. Never mutate the grid
// through page.evaluate; the only page reads below wait for visible UI state.
const runtime = path.resolve('scripts/fixtures/frameworks/node_modules');
const { preview } = await import(pathToFileURL(path.join(runtime, 'vite/dist/node/index.js')));
const engines = await import(pathToFileURL(path.join(runtime, 'playwright/index.mjs')));
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const site = await siteDigest('dist');
const artifactSha256 = hash(await readFile(`artifacts/lumina-report-sdk-${version}.tgz`));
const checks = ['cross-sheet-edit-history', 'active-sheet-csv', 'json-roundtrip', 'xlsx-roundtrip'];
let server;
try {
  server = await preview({
    configFile: false,
    base: '/lumina-sheets/',
    preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
  });
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  await verifySiteHttp('dist', origin);
  for (const engine of ['chromium', 'firefox', 'webkit']) {
    const browser = await engines[engine].launch({
      headless: true,
      ...(engine === 'chromium' && process.env.BROWSER_CHANNEL
        ? { channel: process.env.BROWSER_CHANNEL }
        : {}),
      ...(engine === 'firefox' ? { firefoxUserPrefs: { 'network.proxy.type': 0 } } : {}),
    });
    try {
      for (const [entry, relative] of [
        ['site', 'examples/report.html'],
        ['sdk', 'sdk/example.html'],
      ]) {
        const output = path.resolve(`artifacts/browser-multisheet/${engine}/${entry}`);
        await mkdir(output, { recursive: true });
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          acceptDownloads: true,
        });
        const page = await context.newPage();
        const report = {
          schema: 1,
          version,
          engine,
          entry,
          browserVersion: browser.version(),
          executedAt: new Date().toISOString(),
          environment: {
            platform: process.platform,
            arch: process.arch,
            node: process.version,
            headless: true,
          },
          siteSha256: site.sha256,
          artifactSha256,
          scope:
            'Shipped multi-sheet example controls, cross-sheet formula/history and downloaded CSV/JSON/XLSX reimport. Not desktop Excel, native IME, screen reader or physical touch certification.',
          checks: [],
          pageErrors: [],
          consoleErrors: [],
          runErrors: [],
        };
        page.on('pageerror', (error) => report.pageErrors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') report.consoleErrors.push(message.text());
        });
        const select = async (cell) => {
          await page.locator('#address').fill(cell);
          await page.locator('#address').press('Enter');
          await page.waitForFunction(
            (cell) => document.querySelector('#selected')?.textContent === cell,
            cell,
          );
        };
        const value = async (expected) => {
          await page.waitForFunction(
            (expected) => document.querySelector('#value')?.textContent === `结果：${expected}`,
            expected,
          );
        };
        const sheet = async (name) => {
          await page.locator('#sheet-select').selectOption({ label: name });
          await page.getByRole('grid', { name: new RegExp(name) }).waitFor();
        };
        const download = async (format, label) => {
          await page.locator('#format').selectOption(format);
          const pending = page.waitForEvent('download');
          await page.locator('#export').click();
          const result = await pending;
          const filename = `${label}.${format}`;
          await result.saveAs(path.join(output, filename));
          assert.equal(await result.failure(), null);
          const bytes = await readFile(path.join(output, filename));
          assert(bytes.length > 0);
          return { filename, bytes, sha256: hash(bytes) };
        };
        const summary = async () => {
          await sheet('经营汇总');
          await select('B2');
          await value(8299000);
        };
        const run = async (name, action) => {
          const start = Date.now();
          try {
            const details = await action();
            report.checks.push({ name, status: 'passed', elapsedMs: Date.now() - start, details });
            console.log(`PASS ${engine}/${entry}/${name}`);
          } catch (error) {
            report.checks.push({ name, status: 'failed', error: error.message });
            throw error;
          }
        };
        try {
          await page.goto(`${origin}/lumina-sheets/${relative}`, { waitUntil: 'domcontentloaded' });
          await page.getByRole('grid').waitFor();
          await page.locator('[data-layout="sheets"]').click();
          await page.waitForFunction(
            () => document.querySelector('#sheet-select')?.options.length === 2,
          );
          await run(checks[0], async () => {
            await sheet('经营汇总');
            await select('B2');
            await value(8199000);
            const formula = await page.locator('#formula').inputValue();
            assert.equal(formula, "=SUM('销售明细'!C2:C37)");
            await sheet('销售明细');
            await select('C2');
            await value(100000);
            await page.locator('#formula').fill('200000');
            await page.locator('#formula').press('Enter');
            await value(200000);
            await summary();
            await page.locator('#undo').click();
            await value(8199000);
            assert.equal(
              await page.locator('#sheet-select option:checked').innerText(),
              '经营汇总',
            );
            await page.locator('#redo').click();
            await value(8299000);
            assert.equal(await page.locator('#formula').inputValue(), formula);
            await sheet('销售明细');
            await select('C2');
            await value(200000);
            await summary();
            return { before: 8199000, edited: 8299000, undo: 8199000, redo: 8299000, formula };
          });
          await run(checks[1], async () => {
            const result = await download('csv', 'summary');
            const text = result.bytes.toString('utf8').replace(/^\uFEFF/, '');
            assert.match(text, /^指标,计算结果,操作说明/);
            assert.match(text, /营收合计,8299000,/);
            assert(!text.includes('月份,区域'), 'CSV exported the detail sheet');
            return { file: result.filename, bytes: result.bytes.length, sha256: result.sha256 };
          });
          for (const format of ['json', 'xlsx']) {
            await run(`${format}-roundtrip`, async () => {
              const result = await download(format, `workbook-${format}`);
              if (format === 'json') {
                const book = JSON.parse(result.bytes.toString('utf8'));
                assert.deepEqual(
                  book.sheets.map((item) => item.name),
                  ['销售明细', '经营汇总'],
                );
                assert.equal(book.sheets[0].cells.C2.value, 200000);
                assert.equal(book.sheets[1].cells.B2.value, "=SUM('销售明细'!C2:C37)");
              } else assert.equal(result.bytes.subarray(0, 2).toString(), 'PK');
              // Replace first so success cannot come from unchanged prior data.
              await page.locator('[data-layout="list"]').click();
              await page.waitForFunction(
                () => document.querySelector('#sheet-select')?.options.length === 1,
              );
              await page.locator('#json-file').setInputFiles(path.join(output, result.filename));
              await page.waitForFunction(
                () =>
                  document.querySelector('#sheet-select')?.options.length === 2 &&
                  /报表已恢复/.test(document.querySelector('#status')?.textContent ?? '') &&
                  document.querySelector('#status')?.dataset.error !== 'true',
              );
              await sheet('销售明细');
              await select('C2');
              await value(200000);
              await summary();
              assert.equal(await page.locator('#formula').inputValue(), "=SUM('销售明细'!C2:C37)");
              return {
                file: result.filename,
                bytes: result.bytes.length,
                sha256: result.sha256,
                sheets: 2,
                revenue: 8299000,
              };
            });
          }
          await page.screenshot({ path: path.join(output, 'result.png'), fullPage: true });
        } catch (error) {
          report.runErrors.push({ name: error.name, message: error.message, stack: error.stack });
          await page
            .screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
            .catch(() => {});
        } finally {
          finalizeBrowserReport(report, checks);
          await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
          await context.close();
          if (report.status !== 'passed') {
            process.exitCode = 1;
            console.error(JSON.stringify(report.runErrors));
          }
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  if (server)
    await new Promise((resolve, reject) => {
      server.httpServer.close((error) => (error ? reject(error) : resolve()));
      server.httpServer.closeAllConnections();
    });
}

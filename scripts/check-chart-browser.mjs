import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { preview } from './fixtures/frameworks/node_modules/vite/dist/node/index.js';
import { chromium, firefox, webkit } from './fixtures/frameworks/node_modules/playwright/index.mjs';
import { siteDigest } from './site-evidence.mjs';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const site = await siteDigest('dist');
const artifactSha256 = createHash('sha256').update(await readFile(`artifacts/lumina-report-sdk-${version}.tgz`)).digest('hex');
const server = await preview({ configFile: false, base: '/lumina-sheets/', preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}/lumina-sheets/`;
try {
  for (const [engine, driver] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await driver.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const output = `artifacts/browser-charts/${engine}`;
    await mkdir(output, { recursive: true });
    const report = { schema: 1, version, engine, browserVersion: browser.version(), executedAt: new Date().toISOString(), siteSha256: site.sha256, artifactSha256, scope: 'Shipped site and packaged SDK chart controls, SVG downloads and exact table. No native Excel object, screen-reader or physical device claim.', checks: [], errors: [] };
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    const check = async (name, action) => {
      try { await action(); report.checks.push({ name, status: 'passed' }); console.log(`PASS ${engine}/${name}`); }
      catch (error) { report.checks.push({ name, status: 'failed', error: error.message }); process.exitCode = 1; console.log(`FAIL ${engine}/${name}: ${error.message}`); }
    };
    for (const entry of ['examples/charts.html', 'sdk/charts.html']) {
      await check(`${entry}/types-update-export`, async () => {
        await page.goto(origin + entry);
        await page.locator('#plot svg').waitFor();
        assert.equal(await page.locator('#rows tr').count(), 4);
        assert.equal(await page.locator('#rows tr').first().locator('td').first().textContent(), '120');
        await page.locator('#type').selectOption('line');
        assert(await page.locator('#plot polyline').count() > 0);
        await page.locator('#amount').fill('240'); await page.locator('#apply').click();
        assert.equal(await page.locator('#rows tr').first().locator('td').first().textContent(), '240');
        await page.locator('#source').selectOption('pivot');
        assert.equal(await page.locator('#rows tr').first().locator('td').first().textContent(), '240');
        await page.locator('#type').selectOption('pie');
        assert.equal(await page.locator('#rows tr').first().locator('td').count(), 1);
        const downloadWait = page.waitForEvent('download'); await page.locator('#export').click();
        const download = await downloadWait;
        const filename = path.join(output, entry.replaceAll('/', '-') + '.svg');
        await download.saveAs(filename);
        const svg = await readFile(filename, 'utf8');
        assert(svg.includes('<svg') && svg.includes('240') && svg.includes('华东'));
        assert(!/<script|foreignObject|onload=/.test(svg));
        // Negative pie update must leave the last chart/table intact.
        await page.locator('#amount').fill('-1'); await page.locator('#apply').click();
        assert.equal(await page.locator('#status').getAttribute('data-error'), 'true');
        assert.equal(await page.locator('#rows tr').first().locator('td').first().textContent(), '240');
        await page.locator('#type').selectOption('bar');
        assert.equal(await page.locator('#status').getAttribute('data-error'), 'false');
        await page.locator('#amount').fill('-20'); await page.locator('#apply').click();
        assert.equal(await page.locator('#rows tr').first().locator('td').first().textContent(), '-20');
        await page.locator('#source').selectOption('records');
        assert.equal(await page.locator('#rows tr').last().locator('td').last().textContent(), '缺失');
      });
      await check(`${entry}/narrow-keyboard`, async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, svg: document.querySelector('svg').getBoundingClientRect().width }));
        assert(sizes.scroll <= sizes.width && sizes.svg > 0 && sizes.svg < sizes.width);
        await page.locator('#amount').fill('300'); await page.locator('#apply').focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#rows tr').first().locator('td').first().textContent(), '300');
        assert.equal(await page.locator('#plot svg').getAttribute('role'), 'img');
        await page.screenshot({ path: path.join(output, entry.replaceAll('/', '-') + '-390.png'), fullPage: true });
      });
    }
    await check('sdk-runtime-boundaries', async () => {
      await page.evaluate(async base => {
        const sdk = await import(base + 'sdk/lumina.js');
        const m = sdk.createChartModel({ type: 'bar', category: 'r', series: [{ field: 'v' }] }, [{ r: 1, v: 2 }, { r: '1', v: 3 }]);
        if (m.categories.length !== 2) throw new Error('Typed dimensions merged');
        m.series[0].values[0] = Infinity;
        let rejected = false; try { sdk.chartToSvg(m); } catch { rejected = true; }
        if (!rejected) throw new Error('Invalid values rendered');
      }, origin);
    });
    report.status = report.checks.every(c => c.status === 'passed') && !report.errors.length ? 'passed' : 'failed';
    if (report.status !== 'passed') process.exitCode = 1;
    await writeFile(`${output}/result.json`, JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
} finally {
  await new Promise(resolve => { server.httpServer.close(resolve); server.httpServer.closeAllConnections(); });
}

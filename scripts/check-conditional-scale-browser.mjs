import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { preview } from './fixtures/frameworks/node_modules/vite/dist/node/index.js';
import { chromium, firefox, webkit } from './fixtures/frameworks/node_modules/playwright/index.mjs';
import ExcelJS from 'exceljs';
import { siteDigest } from './site-evidence.mjs';

// The installed production SDK, real Canvas pixels and generated XLSX blob
// bytes are checked together. This is not desktop Excel or native IME evidence.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const site = await siteDigest('dist');
const artifactSha256 = createHash('sha256').update(await readFile(`artifacts/lumina-report-sdk-${version}.tgz`)).digest('hex');
const server = await preview({ configFile: false, base: '/lumina-sheets/', preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}/lumina-sheets/`;
try {
  for (const [engine, driver] of Object.entries({ chromium, firefox, webkit })) {
    if (process.env.BROWSER_ENGINE && engine !== process.env.BROWSER_ENGINE) continue;
    const browser = await driver.launch({ headless: process.env.BROWSER_HEADED !== '1' });
    try {
      const context = await browser.newContext({ acceptDownloads: true });
      const page = await context.newPage();
      const output = `artifacts/browser-conditional-scales/${engine}`;
      await mkdir(output, { recursive: true });
      const report = { schema: 1, version, engine, browserVersion: browser.version(), executedAt: new Date().toISOString(), siteSha256: site.sha256, artifactSha256, scope: 'Production Canvas pixels, formula edit/history, structural rule tracking and generated static XLSX blob bytes. The independent core suites cover native download events. Fixed two-color bounds only; no native Excel dynamic rule compatibility.', checks: [], errors: [] };
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
      const check = async (name, action) => {
        try { await action(); report.checks.push({ name, status: 'passed' }); console.log(`PASS ${engine}/${name}`); }
        catch (error) { report.checks.push({ name, status: 'failed', error: error.message }); process.exitCode = 1; console.log(`FAIL ${engine}/${name}: ${error.message}`); }
      };
      await page.goto(origin + 'sdk/charts.html');
      await page.evaluate(async base => {
        const sdk = await import(base + 'sdk/lumina.js');
        document.body.innerHTML = '<h1>双色阶条件格式验收</h1><div id="test-grid" style="height:320px;width:640px"></div><button id="download">导出 XLSX</button>';
        const workbook = {
          id: 'scale-book', name: '双色阶验收', description: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), activeSheetId: 'scale',
          sheets: [{ id: 'scale', name: 'Scale', rowCount: 8, colCount: 4, cells: { A1: { value: 0 }, A2: { value: 50 }, A3: { value: '=B1' }, A4: { value: 'text' }, B1: { value: 100 } } }],
        };
        window.scaleGrid = sdk.createSpreadsheet(document.querySelector('#test-grid'), { workbook, conditionalScaleRules: [{ range: { start: { row: 0, col: 0 }, end: { row: 3, col: 0 } }, minColor: '#ffffff', maxColor: '#000000' }] });
        window.scaleGrid.select({ row: 4, col: 3 });
        document.querySelector('#download').onclick = () => window.scaleGrid.export('xlsx').catch(error => { throw error; });
      }, origin);
      const waitPixel = async (row, rgb) => page.waitForFunction(({ row, rgb }) => {
        const canvas = document.querySelector('#test-grid canvas');
        if (!canvas || !canvas.width || !canvas.height) return false;
        const ratio = canvas.width / canvas.getBoundingClientRect().width;
        const pixel = canvas.getContext('2d').getImageData(Math.floor(54 * ratio), Math.floor((44 + 36 * row) * ratio), 1, 1).data;
        return rgb.every((channel, i) => pixel[i] === channel) && pixel[3] === 255;
      }, { row, rgb });
      await check('canvas-endpoints-midpoint-and-text', async () => {
        await waitPixel(0, [255, 255, 255]);
        await waitPixel(1, [128, 128, 128]);
        await waitPixel(2, [0, 0, 0]);
        await waitPixel(3, [255, 255, 255]);
      });
      await check('formula-edit-undo-redo-pixels', async () => {
        await page.evaluate(() => window.scaleGrid.setCell('B1', 50));
        await waitPixel(2, [128, 128, 128]);
        await page.evaluate(() => window.scaleGrid.undo());
        await waitPixel(2, [0, 0, 0]);
        await page.evaluate(() => window.scaleGrid.redo());
        await waitPixel(2, [128, 128, 128]);
        await page.evaluate(() => window.scaleGrid.undo());
        await waitPixel(2, [0, 0, 0]);
      });
      await check('structural-range-and-history', async () => {
        await page.evaluate(() => window.scaleGrid.insertRows(0));
        await waitPixel(2, [128, 128, 128]);
        await waitPixel(3, [0, 0, 0]);
        assert.equal(await page.evaluate(() => window.scaleGrid.getConditionalScaleRules()[0].range.start.row), 1);
        await page.evaluate(() => window.scaleGrid.undo());
        await waitPixel(1, [128, 128, 128]);
        assert.equal(await page.evaluate(() => window.scaleGrid.getConditionalScaleRules()[0].range.start.row), 0);
      });
      await check('xlsx-blob-static-colors-and-formula', async () => {
        const encoded = await page.evaluate(async () => {
          const original = URL.createObjectURL;
          URL.createObjectURL = blob => { window.__scaleExportBlob = blob; return original.call(URL, blob); };
          try {
            await window.scaleGrid.export('xlsx');
            const bytes = new Uint8Array(await window.__scaleExportBlob.arrayBuffer());
            let binary = '';
            for (const byte of bytes) binary += String.fromCharCode(byte);
            return btoa(binary);
          } finally { URL.createObjectURL = original; }
        });
        await writeFile(`${output}/scale.xlsx`, Buffer.from(encoded, 'base64'));
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(await readFile(`${output}/scale.xlsx`));
        const sheet = book.getWorksheet('Scale');
        assert.equal(sheet.getCell('A2').fill.fgColor.argb, 'FF808080');
        assert.equal(sheet.getCell('A3').fill.fgColor.argb, 'FF000000');
        assert.equal(sheet.getCell('A3').value.formula, 'B1');
        assert.equal(sheet.getCell('A3').value.result, 100);
        assert.equal(await page.evaluate(() => window.scaleGrid.getCell('A2').style?.background ?? null), null);
        await page.screenshot({ path: `${output}/canvas.png`, fullPage: true });
      });
      await page.evaluate(() => window.scaleGrid.destroy());
      report.status = report.checks.every(c => c.status === 'passed') && !report.errors.length ? 'passed' : 'failed';
      if (report.status !== 'passed') process.exitCode = 1;
      await writeFile(`${output}/result.json`, JSON.stringify(report, null, 2) + '\n');
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => { server.httpServer.close(resolve); server.httpServer.closeAllConnections(); });
}

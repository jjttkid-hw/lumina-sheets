import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, copyFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { finalizeBrowserReport } from './browser-report.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixture = path.resolve('scripts/fixtures/frameworks');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const archive = path.resolve(`artifacts/lumina-report-sdk-${version}.tgz`);
const artifactSha256 = hash(await readFile(archive));
const consumer = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lumina-frameworks-')));
const files = ['index.html', 'main.js', 'package.json', 'package-lock.json'];
const fixtureHashes = {};
const expected = [
  'mount-and-strict-effects',
  'canvas-edit-and-callback-update',
  'document-switch-and-duplicate-guard',
  'cancel-import-after-switch',
  'cancel-source-after-unmount',
  'repeated-mount-cleanup',
];
let server;
try {
  for (const name of files) {
    await copyFile(path.join(fixture, name), path.join(consumer, name));
    fixtureHashes[name] = hash(await readFile(path.join(fixture, name)));
  }
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: consumer,
    stdio: 'inherit',
  });
  execFileSync(
    'npm',
    [
      'install',
      '--no-save',
      '--package-lock=false',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      archive,
    ],
    { cwd: consumer, stdio: 'inherit' },
  );
  // Ensure the dependency really is the packed SDK, not a workspace alias.
  for (const name of ['lumina.js', 'lumina.css']) {
    execFileSync('tar', ['-xzf', archive, '-C', consumer, `package/${name}`]);
    assert.equal(
      hash(await readFile(path.join(consumer, 'node_modules/lumina-report-sdk', name))),
      hash(await readFile(path.join(consumer, 'package', name))),
    );
  }
  const dependencies = {};
  for (const name of ['react', 'react-dom', 'vue', 'vite', 'playwright', 'lumina-report-sdk']) {
    dependencies[name] = JSON.parse(
      await readFile(path.join(consumer, 'node_modules', name, 'package.json'), 'utf8'),
    ).version;
  }
  const vite = await import(
    pathToFileURL(path.join(consumer, 'node_modules/vite/dist/node/index.js'))
  );
  const driver =
    process.env.PLAYWRIGHT_MODULE ?? path.join(consumer, 'node_modules/playwright/index.mjs');
  const engines = await import(pathToFileURL(path.resolve(driver)));
  const runnerSha256 = hash(await readFile('scripts/browser-frameworks.mjs'));
  for (const mode of ['development', 'production']) {
    process.env.NODE_ENV = mode;
    const config = {
      root: consumer,
      configFile: false,
      logLevel: 'warn',
      server: { host: '127.0.0.1', port: 0 },
      preview: { host: '127.0.0.1', port: 0 },
    };
    if (mode === 'development') {
      server = await vite.createServer(config);
      await server.listen();
    } else {
      await vite.build(config);
      server = await vite.preview(config);
    }
    const address = server.httpServer.address();
    const base = `http://127.0.0.1:${address.port}/`;
    for (const engine of (process.env.BROWSER_ENGINE ?? 'chromium,firefox,webkit').split(',')) {
      assert(['chromium', 'firefox', 'webkit'].includes(engine));
      const browser = await engines[engine].launch({
        headless: true,
        ...(engine === 'chromium' && process.env.BROWSER_CHANNEL
          ? { channel: process.env.BROWSER_CHANNEL }
          : {}),
        ...(engine === 'firefox' ? { firefoxUserPrefs: { 'network.proxy.type': 0 } } : {}),
      });
      try {
        for (const framework of ['react', 'vue']) {
          const output = path.resolve(
            `artifacts/browser-frameworks/${mode}/${engine}/${framework}`,
          );
          await mkdir(output, { recursive: true });
          const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
          const page = await context.newPage();
          page.setDefaultTimeout(15000);
          const report = {
            schema: 1,
            version,
            framework,
            mode,
            engine,
            browserVersion: browser.version(),
            executedAt: new Date().toISOString(),
            artifactSha256,
            fixtureHashes,
            runnerSha256,
            dependencies,
            environment: {
              node: process.version,
              platform: process.platform,
              arch: process.arch,
              headless: true,
            },
            scope:
              'Installed tgz in real React/Vue development and production hosts. Canvas edit, callback updates, remount and late I/O cancellation; DOM cleanup is not a heap-leak or SSR certification.',
            checks: [],
            pageErrors: [],
            consoleErrors: [],
            runErrors: [],
          };
          page.on('pageerror', (error) => report.pageErrors.push(error.message));
          page.on('console', (message) => {
            if (message.type() === 'error') report.consoleErrors.push(message.text());
          });
          const settle = () =>
            page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
            );
          const ready = async (id) => {
            await page.waitForFunction((id) => window.acceptance.active?.getValue('A1') === id, id);
            await page.locator('#sheet-host canvas').waitFor();
            await settle();
          };
          const check = async (name, action) => {
            const started = Date.now();
            try {
              const details = await action();
              report.checks.push({
                name,
                status: 'passed',
                elapsedMs: Date.now() - started,
                details,
              });
            } catch (error) {
              report.checks.push({ name, status: 'failed', error: error.message });
              await page
                .screenshot({ path: path.join(output, `${name}-failure.png`) })
                .catch(() => {});
            }
            console.log(
              `${report.checks.at(-1).status.toUpperCase()} ${mode}/${engine}/${framework}/${name}`,
            );
          };
          try {
            await page.goto(`${base}?framework=${framework}`);
            await check(expected[0], async () => {
              await ready('document-a');
              const result = await page.evaluate(() => ({
                created: acceptance.created,
                destroyed: acceptance.destroyed,
                development: acceptance.development,
              }));
              assert.equal(result.development, mode === 'development');
              const mounts = framework === 'react' && mode === 'development' ? 2 : 1;
              assert.equal(result.created, mounts);
              assert.equal(result.destroyed, mounts - 1);
              assert.equal(await page.locator('#sheet-host canvas').count(), 1);
              const drawn = await page.locator('canvas').evaluate((canvas) => {
                const pixels = canvas
                  .getContext('2d')
                  .getImageData(0, 0, canvas.width, canvas.height).data;
                return {
                  width: canvas.width,
                  height: canvas.height,
                  painted: pixels.some((byte) => byte !== 0),
                };
              });
              assert(drawn.width > 0 && drawn.height > 0 && drawn.painted);
              return { ...result, ...drawn };
            });
            await check(expected[1], async () => {
              const grid = page.locator('#sheet-host [role=grid]');
              await grid.click({ position: { x: 92, y: 88 } });
              await grid.press('F2');
              const editor = page.getByRole('textbox', { name: '编辑单元格 A2', exact: true });
              await editor.fill('用户编辑');
              await editor.press('Enter');
              assert.equal(await page.evaluate(() => acceptance.active.getValue('A2')), '用户编辑');
              const before = await page.evaluate(() => acceptance.created);
              await page.evaluate(() => acceptance.render('document-a', 9));
              await settle();
              assert.equal(await page.evaluate(() => acceptance.created), before);
              assert.equal(await page.evaluate(() => acceptance.active.getValue('A2')), '用户编辑');
              await page.evaluate(() => acceptance.active.setCell('B2', 42));
              assert.equal(await page.evaluate(() => acceptance.changes.at(-1)), 9);
              await page.evaluate(() => acceptance.active.undo());
              assert.equal(await page.evaluate(() => acceptance.active.getValue('B2')), '');
              await page.screenshot({ path: path.join(output, 'canvas.png') });
              return { userEditPreserved: true, callbackRevision: 9, historyRetained: true };
            });
            await check(expected[2], async () => {
              assert.equal(await page.evaluate(() => acceptance.duplicate()), 'INVALID_ARGUMENT');
              await page.evaluate(() => acceptance.render('document-b'));
              await ready('document-b');
              assert.equal(await page.evaluate(() => acceptance.active.getValue('A2')), 'initial');
              assert.equal(await page.locator('#sheet-host canvas').count(), 1);
              assert.equal(await page.evaluate(() => acceptance.created - acceptance.destroyed), 1);
            });
            await check(expected[3], async () => {
              await page.evaluate(() => acceptance.beginPending('import'));
              await page.waitForFunction(() => acceptance.pendingStarted);
              await page.evaluate(() => acceptance.render('document-c'));
              await ready('document-c');
              await page.waitForFunction(() => acceptance.pendingResult !== null);
              assert.equal(await page.evaluate(() => acceptance.pendingResult), 'IMPORT_CANCELLED');
              await page.evaluate(() => acceptance.releasePending());
              await settle();
              assert.equal(
                await page.evaluate(() => acceptance.active.getValue('A1')),
                'document-c',
              );
              assert.equal(await page.evaluate(() => acceptance.staleNotifications), 0);
            });
            await check(expected[4], async () => {
              await page.evaluate(() => acceptance.beginPending('source'));
              await page.waitForFunction(() => acceptance.pendingStarted);
              await page.evaluate(() => acceptance.render(null));
              await page.waitForFunction(
                () => acceptance.active === null && acceptance.pendingResult !== null,
              );
              assert.equal(await page.evaluate(() => acceptance.pendingResult), 'AbortError');
              assert.equal(await page.evaluate(() => acceptance.sourceSignal.aborted), true);
              assert.equal(await page.locator('canvas').count(), 0);
              await page.evaluate(() => {
                acceptance.render('document-d');
                acceptance.releasePending();
              });
              await ready('document-d');
              assert.equal(await page.evaluate(() => acceptance.staleNotifications), 0);
            });
            await check(expected[5], async () => {
              for (let i = 0; i < 10; i++) {
                await page.evaluate(() => acceptance.render(null));
                await page.waitForFunction(() => acceptance.active === null);
                await settle();
                assert.equal(await page.locator('canvas, [role=grid], .lumina-sdk').count(), 0);
                assert.equal(
                  await page.evaluate(() => acceptance.created - acceptance.destroyed),
                  0,
                );
                await page.evaluate((id) => acceptance.render(id), `cycle-${i}`);
                await ready(`cycle-${i}`);
              }
              await page.evaluate(() => acceptance.dispose());
              await settle();
              const stats = await page.evaluate(() => ({
                created: acceptance.created,
                destroyed: acceptance.destroyed,
                errors: acceptance.errors,
                staleNotifications: acceptance.staleNotifications,
              }));
              assert.equal(stats.created, stats.destroyed);
              assert.deepEqual(stats.errors, []);
              assert.equal(stats.staleNotifications, 0);
              assert.equal(await page.locator('canvas, [role=grid], .lumina-sdk').count(), 0);
              return stats;
            });
          } catch (error) {
            report.runErrors.push(error.message);
          } finally {
            // Browser errors from asynchronous teardown are part of the result.
            await settle().catch(() => {});
            finalizeBrowserReport(report, expected);
            await writeFile(
              path.join(output, 'result.json'),
              JSON.stringify(report, null, 2) + '\n',
            );
            if (report.status !== 'passed') process.exitCode = 1;
            await context.close();
          }
        }
      } finally {
        await browser.close();
      }
    }
    if (mode === 'development') await server.close();
    else await new Promise((resolve) => server.httpServer.close(resolve));
    server = undefined;
  }
} finally {
  if (server?.close) await server.close();
  else if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  await rm(consumer, { recursive: true, force: true });
}

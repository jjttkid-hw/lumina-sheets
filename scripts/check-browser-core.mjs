import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { siteDigest } from './site-evidence.mjs';

// Exercise the downloaded CI artifact; never rebuild it in the browser job.
// Keep the locked browser toolchain separate from the product dependencies.
const runtime = path.resolve('scripts/fixtures/frameworks/node_modules');
const { preview } = await import(pathToFileURL(path.join(runtime, 'vite/dist/node/index.js')));
const supported = ['chromium', 'firefox', 'webkit'];
const engines = process.env.BROWSER_ENGINE ? [process.env.BROWSER_ENGINE] : supported;
assert(engines.every(engine => supported.includes(engine)), 'Unsupported BROWSER_ENGINE');
const suites = [
  ['smoke', 'browser-acceptance'],
  ['accessibility', 'browser-accessibility'],
  ['focus', 'browser-focus'],
  ['interactions', 'browser-interactions'],
  ['layout', 'browser-layout'],
  ['performance', 'browser-performance'],
  ['persistence', 'browser-persistence'],
  ['ime', 'browser-ime'],
];
const site = await siteDigest('dist');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const artifactSha256 = createHash('sha256')
  .update(await readFile(`artifacts/lumina-report-sdk-${version}.tgz`)).digest('hex');
const output = path.resolve('artifacts/browser-core');
await mkdir(output, { recursive: true });
let server;
try {
  server = await preview({
    configFile: false,
    base: '/lumina-sheets/',
    preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
  });
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string', 'Preview has no TCP address');
  for (const engine of engines) {
    const summary = {
      schema: 1, version, engine, executedAt: new Date().toISOString(),
      siteSha256: site.sha256, artifactSha256,
      scope: 'Automated core browser regression; not native IME, Safari, screen reader or physical touch acceptance.',
      status: 'running', suites: [],
    };
    const plan = engine === 'chromium' ? [...suites, ['touch', 'browser-touch']] : suites;
    for (const [suite, directory] of plan) {
      const filename = path.resolve(`artifacts/${directory}/${engine}/result.json`);
      // A failed startup must not pass by reading a preceding run's report.
      await rm(filename, { force: true });
      const result = { suite, status: 'failed', exitCode: null };
      try {
        result.exitCode = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [`scripts/browser-${suite}.mjs`], {
            stdio: 'inherit', timeout: 180_000, killSignal: 'SIGKILL',
            env: {
              ...process.env,
              PLAYWRIGHT_MODULE: path.join(runtime, 'playwright/index.mjs'),
              BROWSER_CHANNEL: process.env.BROWSER_CHANNEL ?? 'bundled',
              BROWSER_ENGINE: engine,
              BROWSER_TEST_URL: `http://127.0.0.1:${address.port}/lumina-sheets/`,
            },
          });
          child.on('error', reject);
          child.on('exit', (code) => resolve(code ?? 1));
        });
        assert.equal(result.exitCode, 0, `${suite} exited unsuccessfully`);
        const report = JSON.parse(await readFile(filename, 'utf8'));
        assert.equal(report.status, 'passed', `${suite} reported a failure`);
        assert.equal(report.engine, engine);
        assert.equal(report.version, version);
        assert.equal(report.siteSha256, site.sha256);
        assert.equal(report.artifactSha256, artifactSha256);
        assert(report.checks.length > 0 && report.checks.every(check => check.status === 'passed'));
        assert.deepEqual(report.validation?.actualChecks, report.validation?.expectedChecks);
        assert.equal(report.validation?.pageErrorCount, 0);
        assert.equal(report.validation?.consoleErrorCount, 0);
        assert.equal(report.validation?.runErrorCount, 0);
        result.status = 'passed';
        result.checks = report.checks.length;
      } catch (error) {
        result.error = error.message;
        process.exitCode = 1;
        console.error(`FAIL ${engine}/${suite}: ${error.message}`);
      }
      summary.suites.push(result);
    }
    summary.status = summary.suites.every(suite => suite.status === 'passed') ? 'passed' : 'failed';
    await writeFile(path.join(output, `${engine}.json`), JSON.stringify(summary, null, 2) + '\n');
  }
} finally {
  if (server) {
    await new Promise((resolve, reject) => {
      server.httpServer.close(error => error ? reject(error) : resolve());
      server.httpServer.closeAllConnections();
    });
  }
}

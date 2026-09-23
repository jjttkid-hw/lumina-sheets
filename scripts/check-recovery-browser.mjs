import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Use the locked acceptance toolchain, independently of the product runtime.
const runtime = path.resolve('scripts/fixtures/frameworks/node_modules');
const { preview } = await import(pathToFileURL(path.join(runtime, 'vite/dist/node/index.js')));
let server;
try {
  server = await preview({
    configFile: false,
    base: '/lumina-sheets/',
    preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
  });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Preview has no TCP address');
  for (const engine of ['chromium', 'firefox', 'webkit']) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/browser-recovery.mjs'], {
        stdio: 'inherit',
        env: {
          ...process.env,
          PLAYWRIGHT_MODULE: path.join(runtime, 'playwright/index.mjs'),
          BROWSER_CHANNEL: 'bundled',
          BROWSER_ENGINE: engine,
          BROWSER_TEST_URL: `http://127.0.0.1:${address.port}/lumina-sheets/`,
        },
      });
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? 1));
    });
    if (code !== 0) process.exitCode = 1;
  }
} finally {
  if (server)
    await new Promise((resolve, reject) => {
      server.httpServer.close((error) => (error ? reject(error) : resolve()));
      server.httpServer.closeAllConnections();
    });
}

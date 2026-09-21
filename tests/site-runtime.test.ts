import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error Node-only deployment tooling
import { verifySiteHttp } from '../scripts/site-runtime.mjs';

const folders: string[] = [];
afterEach(() => folders.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'lumina-http-'));
  folders.push(root);
  for (const dir of ['assets', 'sdk', 'examples']) mkdirSync(path.join(root, dir));
  const write = (name: string, text: string) => writeFileSync(path.join(root, name), text);
  write('index.html', '<script src="/lumina-sheets/assets/main.js"></script>');
  write('examples/report.html', '<script src="../assets/main.js"></script>');
  write(
    'sdk/example.html',
    '<link href="./lumina.css"><script type="module">import { grid } from "./lumina.js";</script>',
  );
  write('assets/main.js', 'export const app = 1;');
  write('assets/lazy.js', 'export const lazy = 2;');
  write('assets/worker.js', 'postMessage(3);');
  write('sdk/lumina.js', 'export const grid = 1;');
  write('sdk/lumina.css', '.grid {}');
  const requested: string[] = [];
  const fetcher = async (input: string) => {
    const url = new URL(input);
    requested.push(url.pathname + url.search);
    const name = url.pathname.slice('/lumina-sheets/'.length) || 'index.html';
    const type = name.endsWith('.js')
      ? 'text/javascript'
      : name.endsWith('.css')
        ? 'text/css'
        : 'text/html';
    return new Response(readFileSync(path.join(root, name)), { headers: { 'content-type': type } });
  };
  return { root, write, requested, fetcher };
}

describe('HTTP deployment verification (synthetic transport)', () => {
  it('checks all lazy/worker/SDK resources and performance query against built bytes', async () => {
    const f = fixture();
    const result = await verifySiteHttp(f.root, 'http://localhost:1234', f.fetcher);
    expect(result).toMatchObject({ status: 'passed', files: 8, requests: 10 });
    expect(f.requested).toContain('/lumina-sheets/assets/lazy.js');
    expect(f.requested).toContain('/lumina-sheets/assets/worker.js');
    expect(f.requested).toContain('/lumina-sheets/?view=performance');
  });
  it.each(['status', 'mime', 'bytes', 'fallback'])(
    'rejects %s response failures',
    async (failure) => {
      const f = fixture();
      await expect(
        verifySiteHttp(f.root, 'http://localhost:1234', async (url: string) => {
          if (!url.endsWith('/assets/lazy.js')) return f.fetcher(url);
          if (failure === 'status') return new Response('', { status: 404 });
          if (failure === 'mime')
            return new Response('export const lazy = 2;', {
              headers: { 'content-type': 'text/html' },
            });
          return new Response(
            failure === 'fallback' ? '<html>Home</html>' : 'export const lazy = 9;',
            { headers: { 'content-type': 'text/javascript' } },
          );
        }),
      ).rejects.toThrow();
    },
  );
  it.each(['/assets/main.js', './missing.js', 'https://example.org/app.js'])(
    'rejects broken or external entry reference %s',
    async (ref) => {
      const f = fixture();
      f.write('index.html', `<script src="${ref}"></script>`);
      await expect(verifySiteHttp(f.root, 'http://localhost:1234', f.fetcher)).rejects.toThrow();
      expect(f.requested).toHaveLength(0);
    },
  );
  it('rejects a missing SDK inline module before HTTP checks', async () => {
    const f = fixture();
    f.write(
      'sdk/example.html',
      '<script type="module">import { grid } from "./missing.js";</script>',
    );
    await expect(verifySiteHttp(f.root, 'http://localhost:1234', f.fetcher)).rejects.toThrow(
      'Missing entry resource',
    );
  });
});

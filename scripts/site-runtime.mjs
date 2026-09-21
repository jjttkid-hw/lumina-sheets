import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { siteDigest } from './site-evidence.mjs';

const prefix = '/lumina-sheets/';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// HTTP transport evidence only: no JavaScript execution or browser certification.
export async function verifySiteHttp(root, origin, fetcher = fetch) {
  const base = new URL(origin);
  assert(
    ['http:', 'https:'].includes(base.protocol) &&
      base.pathname === '/' &&
      !base.search &&
      !base.hash &&
      !base.username &&
      !base.password,
    'SITE_RUNTIME_URL must be an HTTP(S) origin without credentials, path or query',
  );
  const site = await siteDigest(root);
  const files = new Map(site.files.map((file) => [file.path, file]));
  for (const required of [
    'index.html',
    'examples/report.html',
    'sdk/example.html',
    'sdk/lumina.js',
    'sdk/lumina.css',
  ])
    assert(files.has(required), `Missing required build output: ${required}`);

  // Check HTML entry resources against the manifest, including the plain SDK
  // example's inline ESM import. External navigation links are not asset inputs.
  for (const name of ['index.html', 'examples/report.html', 'sdk/example.html']) {
    const html = await readFile(path.join(root, name), 'utf8');
    const refs = [
      ...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi),
    ].map((m) => m[1]);
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
      for (const ref of script[1].matchAll(
        /\b(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g,
      ))
        refs.push(ref[1]);
    assert(refs.length, `No entry resources found: ${name}`);
    for (const ref of refs) {
      const url = new URL(ref, `${base.origin}${prefix}${name}`);
      assert.equal(url.origin, base.origin, `External entry resource: ${name}: ${ref}`);
      assert(url.pathname.startsWith(prefix), `Entry resource escapes Pages base: ${name}: ${ref}`);
      assert(
        files.has(decodeURIComponent(url.pathname.slice(prefix.length))),
        `Missing entry resource: ${name}: ${ref}`,
      );
    }
  }

  let requests = 0;
  async function check(urlPath, file) {
    const response = await fetcher(`${base.origin}${urlPath}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200, `${urlPath} returned HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    const expected = file.path.endsWith('.html')
      ? /text\/html/i
      : file.path.endsWith('.js')
        ? /(?:text|application)\/javascript/i
        : file.path.endsWith('.css')
          ? /text\/css/i
          : null;
    if (expected) assert.match(type, expected, `Wrong content type: ${urlPath}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes.byteLength, file.bytes, `Response size mismatch: ${urlPath}`);
    assert.equal(hash(bytes), file.sha256, `Response content mismatch: ${urlPath}`);
    requests++;
  }
  // Fetch every generated file, including lazy XLSX chunks and Worker scripts.
  for (const file of site.files)
    await check(prefix + file.path.split('/').map(encodeURIComponent).join('/'), file);
  await check(prefix, files.get('index.html'));
  await check(`${prefix}?view=performance`, files.get('index.html'));
  return {
    status: 'passed',
    siteSha256: site.sha256,
    files: files.size,
    requests,
    scope: 'HTTP bytes, MIME types and HTML entry resources; no browser execution.',
  };
}

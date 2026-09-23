import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

it('ships self-contained CSS without remote font or asset imports', async () => {
  const css = await readFile('src/styles/global.css', 'utf8');
  expect(css).not.toMatch(/@import\s+url\s*\(/i);
  expect(css).not.toMatch(/https?:\/\//i);
  expect(css).not.toMatch(/url\s*\(/i);
});

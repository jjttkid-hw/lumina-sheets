import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function workflow(name: string): Promise<string> {
  return readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
}

describe('release workflow artifact alignment', () => {
  it('builds and smoke-tests the Pages-base site before npm publication', async () => {
    const source = await workflow('npm.yml');
    expect(source).toMatch(/npm run build:site/);
    expect(source).toMatch(/npm run check:site-runtime/);
    expect(source).toMatch(/npm run check:reproducibility/);
    expect(source).toMatch(/npm run check:licenses/);
    expect(source).toMatch(/npm run check:stable/);
    expect(source).not.toMatch(/- run: npm run build:all/);
    expect(source.indexOf('npm run check:licenses')).toBeLessThan(source.indexOf('npm publish'));
    expect(source.indexOf('npm run check:stable')).toBeLessThan(source.indexOf('npm publish'));
  });

  it('keeps CI and Pages deployment on the same tested site artifact', async () => {
    const ci = await workflow('ci.yml');
    const cd = await workflow('cd.yml');
    expect(ci).toMatch(/npm run build:site/);
    expect(ci).toMatch(/npm run check:site-runtime/);
    expect(ci).toMatch(/npm run check:licenses/);
    expect(ci).toMatch(/actions\/upload-artifact@v7/);
    expect(cd).toMatch(/actions\/download-artifact@v8/);
    expect(cd).toMatch(/check-deploy-site\.mjs/);
    expect(cd).toMatch(/actions\/deploy-pages@v5/);
    expect(ci.indexOf('npm run check:licenses')).toBeLessThan(
      ci.indexOf('actions/upload-artifact@v7'),
    );
  });
});

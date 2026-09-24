import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function workflow(name: string): Promise<string> {
  return readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
}

describe('release workflow artifact alignment', () => {
  it('keeps verification retries read-only while requiring the exact registry artifact', async () => {
    const source = await workflow('npm.yml');
    expect(source).toMatch(/verify_only:\n(?:.*\n)*?        default: false\n        type: boolean/);
    const steps = source.split(/\n      - /);
    const guarded = steps.filter((step) => /npm publish|gh release upload/.test(step));
    expect(guarded).toHaveLength(2);
    for (const step of guarded) expect(step).toContain('if: ${{ !inputs.verify_only }}');
    const verification = steps.find((step) =>
      step.includes('node scripts/check-npm-registry.mjs'),
    )!;
    expect(verification).toBeDefined();
    expect(verification).not.toMatch(/\n        if:/);
    expect(verification).toContain('NPM_EXPECTED_ARCHIVE: ${{ steps.release.outputs.artifact }}');
    expect(verification).toContain('NPM_VERSION: ${{ steps.release.outputs.version }}');
    expect(verification).toContain('NPM_DIST_TAG: ${{ steps.release.outputs.dist-tag }}');
  });

  it('builds and smoke-tests the Pages-base site before npm publication', async () => {
    const source = await workflow('npm.yml');
    expect(source).toMatch(/npm run build:site/);
    expect(source).toMatch(/npm run check:site-runtime/);
    expect(source).toMatch(/npm run check:reproducibility/);
    expect(source).toMatch(/npm run check:licenses -- --strict/);
    expect(source).toMatch(/npm run check:stable/);
    expect(source).not.toMatch(/- run: npm run build:all/);
    expect(source.indexOf('npm run check:licenses')).toBeLessThan(source.indexOf('npm publish'));
    expect(source.indexOf('npm run check:stable')).toBeLessThan(source.indexOf('npm publish'));
    for (const check of ['check:xlsx-corpus', 'check:wps-corpus']) {
      const position = source.indexOf(`npm run ${check}`);
      expect(position).toBeGreaterThan(source.indexOf('npm run check:reproducibility'));
      expect(position).toBeLessThan(source.indexOf('gh release upload'));
      expect(position).toBeLessThan(source.indexOf('npm publish'));
    }
    expect(source).toMatch(/NPM_TOKEN_PRESENT: \$\{\{ secrets\.NPM_TOKEN !==? '' \}\}/);
    expect(source).toMatch(/unset NODE_AUTH_TOKEN/);
    expect(source).toMatch(/Trusted Publishing \(OIDC\)/);
  });

  it('keeps CI and Pages deployment on the same tested site artifact', async () => {
    const ci = await workflow('ci.yml');
    const cd = await workflow('cd.yml');
    expect(ci).toMatch(/npm run build:site/);
    expect(ci).toMatch(/npm run check:site-runtime/);
    expect(ci).toMatch(/node scripts\/package-notices\.mjs/);
    expect(ci).toMatch(/npm run check:licenses -- --strict/);
    expect(ci).toMatch(/npm run check:xlsx-corpus/);
    expect(ci).toMatch(/npm run check:wps-corpus/);
    expect(ci).toMatch(/npm run check:xlsx-corpus-evidence/);
    expect(ci).toMatch(/Block dependency integrity errors/);
    expect(ci).toMatch(/actions\/upload-artifact@v7/);
    expect(cd).toMatch(/actions\/download-artifact@v8/);
    expect(cd).toMatch(/check-deploy-site\.mjs/);
    expect(cd).toMatch(/actions\/deploy-pages@v5/);
    expect(ci.indexOf('node scripts/package-notices.mjs')).toBeLessThan(
      ci.indexOf('actions/upload-artifact@v7'),
    );
  });
});

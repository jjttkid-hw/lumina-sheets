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

  it('requires a fresh three-engine core browser run on the validated artifacts before deployment', async () => {
    const ci = await workflow('ci.yml');
    const cd = await workflow('cd.yml');
    const job = ci.split('\n  browser-core:')[1]?.split('\n  frameworks:')[0];
    expect(job).toBeDefined();
    expect(job).toContain('needs: validate');
    expect(job).toContain('fail-fast: false');
    expect(job).toContain('engine: [chromium, firefox, webkit]');
    expect(job).toContain('name: npm-package');
    expect(job).toContain('name: lumina-site');
    expect(job).toContain('BROWSER_CHANNEL: bundled');
    expect(job).toContain('node scripts/check-browser-core.mjs');
    expect(job).toContain('xvfb-run --auto-servernum');
    expect(job).toContain("BROWSER_HEADED: ${{ matrix.engine == 'webkit' && '1' || '0' }}");
    expect(job).not.toMatch(/continue-on-error|npm run build/);
    expect(job).toContain('if: always()');
    expect(job).toContain('name: core-browser-reports-${{ matrix.engine }}');
    expect(cd).toContain("github.event.workflow_run.conclusion == 'success'");
  });
});

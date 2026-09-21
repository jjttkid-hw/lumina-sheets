import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
// @ts-expect-error Node release tooling has no SDK declarations
import * as policy from '../scripts/stable-release-policy.mjs';
// @ts-expect-error Node release tooling has no SDK declarations
import { siteDigest } from '../scripts/site-evidence.mjs';
const {
  browserTargets,
  browserChecks,
  evidenceGates,
  requiresStableAcceptance,
  validateStableAcceptance,
} = policy;

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const licenseText = readFileSync('node_modules/react/LICENSE', 'utf8');
const notices = `--- node_modules/fixture/LICENSE ---\n${licenseText}`;
const inventory = {
  schemaVersion: 1,
  summary: {
    errors: 0,
    reviewItems: 0,
    unresolvedVendorComponents: 0,
    packageInstallations: 1,
    uniqueNameVersions: 1,
    noticeFiles: 1,
  },
  packages: [
    {
      name: 'fixture',
      version: '1.0.0',
      location: 'node_modules/fixture',
      license: 'MIT',
      licenseFiles: [
        {
          path: 'LICENSE',
          bytes: Buffer.byteLength(licenseText),
          sha256: digest(licenseText),
          hasLicenseText: true,
        },
      ],
      licenseCoverage: { status: 'text-evidenced', recognized: ['MIT'], expressionSupported: true },
    },
  ],
  vendorBundles: [],
  issues: [],
};
const hash = 'a'.repeat(64);
function reproducibility(artifactSha256 = hash, siteSha256 = 'b'.repeat(64)) {
  return {
    schema: 1,
    status: 'passed',
    version: '1.0.0',
    dirty: false,
    commit: 'c'.repeat(40),
    inputSha256: 'd'.repeat(64),
    sourceDateEpoch: '0',
    sourceTimestamp: '1970-01-01T00:00:00.000Z',
    environment: { node: 'v24', npm: '11', platform: 'test', arch: 'test' },
    runs: Array.from({ length: 2 }, () => ({
      artifactSha256,
      siteSha256,
      artifactBytes: 100,
      siteFiles: 1,
    })),
  };
}
function evidence() {
  const record = () => ({
    status: 'passed',
    reviewer: 'test fixture',
    environment: 'synthetic test',
    executedAt: '2026-09-20T00:00:00Z',
    report: 'docs/acceptance/report.txt',
    reportSha256: digest('synthetic evidence'),
  });
  return {
    schema: 1,
    version: '1.0.0',
    artifactSha256: hash,
    browsers: Object.fromEntries(
      browserTargets.map((target: string) => [
        target,
        {
          ...record(),
          browserVersion: 'test 1',
          checks: Object.fromEntries(browserChecks.map((check: string) => [check, 'passed'])),
        },
      ]),
    ),
    gates: Object.fromEntries(evidenceGates.map((gate: string) => [gate, record()])),
  };
}
const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true })),
);

describe('stable release evidence', () => {
  it('validates reproducibility contents independently of the acceptance passed flag', () => {
    const accepted = { version: '1.0.0', artifactSha256: hash, siteSha256: 'b'.repeat(64) };
    expect(() => policy.validateStableReproducibility(reproducibility(), accepted)).not.toThrow();
    for (const change of [
      { dirty: true },
      { status: 'running' },
      { version: '0.29.0' },
      { commit: null },
      { inputSha256: '' },
      { runs: [] },
      { sourceDateEpoch: 'NaN' },
      { sourceTimestamp: 'wrong' },
      { environment: {} },
    ])
      expect(() =>
        policy.validateStableReproducibility({ ...reproducibility(), ...change }, accepted),
      ).toThrow();
    for (const field of ['artifactSha256', 'siteSha256', 'artifactBytes', 'siteFiles']) {
      const report = reproducibility();
      Object.assign(report.runs[0], { [field]: 0 });
      expect(() => policy.validateStableReproducibility(report, accepted)).toThrow('differ');
      Object.assign(report.runs[1], { [field]: 0 });
      expect(() => policy.validateStableReproducibility(report, accepted)).toThrow();
    }
  });
  it.each(['0.26.0', '1.0.0-rc.1', '2.0.0-beta'])(
    'does not claim stable acceptance for %s',
    (version) => {
      expect(requiresStableAcceptance(version)).toBe(false);
    },
  );
  it.each(['1.0.0', '1.2.3', '2.0.0', '1.0.0+build'])('requires acceptance for %s', (version) => {
    expect(requiresStableAcceptance(version)).toBe(true);
  });
  it('accepts complete synthetic records only for their exact artifact', () => {
    expect(validateStableAcceptance(evidence(), '1.0.0', hash, inventory, notices)).toHaveLength(9);
    expect(() => validateStableAcceptance(evidence(), '1.0.1', hash, inventory, notices)).toThrow(
      'version',
    );
    expect(() =>
      validateStableAcceptance(evidence(), '1.0.0', 'b'.repeat(64), inventory, notices),
    ).toThrow('artifact');
  });
  it.each(['errors', 'reviewItems', 'unresolvedVendorComponents'])(
    'rejects unresolved inventory %s',
    (field) => {
      expect(() =>
        validateStableAcceptance(evidence(), '1.0.0', hash, {
          ...inventory,
          summary: { ...inventory.summary, [field]: 1 },
        }),
      ).toThrow('unresolved');
    },
  );
  it.each([
    'missing-packages',
    'empty-packages',
    'coverage',
    'count',
    'vendor',
    'missing-text',
    'changed-text',
    'wrong-license',
  ])('rejects zero-summary inventory with %s', (fault) => {
    const value = JSON.parse(JSON.stringify(inventory));
    let text = notices;
    if (fault === 'missing-packages') delete value.packages;
    if (fault === 'empty-packages') value.packages = [];
    if (fault === 'coverage') value.packages[0].licenseCoverage.status = 'review';
    if (fault === 'count') value.summary.noticeFiles = 2;
    if (fault === 'vendor')
      value.vendorBundles = [{ components: [{ status: 'unresolved-vendor-bundle-review' }] }];
    if (fault === 'missing-text') text = '';
    if (fault === 'changed-text') text = notices.replace('Permission', 'PermissioN');
    if (fault === 'wrong-license') value.packages[0].license = 'Apache-2.0';
    expect(() => validateStableAcceptance(evidence(), '1.0.0', hash, value, text)).toThrow();
  });

  it('uses UTF-8 byte lengths for multiple packed dependency notices', () => {
    const value = JSON.parse(JSON.stringify(inventory));
    const text = `Copyright 中文作者\n${licenseText}`;
    value.packages.push({
      ...value.packages[0],
      name: 'second',
      location: 'node_modules/second',
      licenseFiles: [
        {
          path: 'LICENSE',
          bytes: Buffer.byteLength(text),
          sha256: digest(text),
          hasLicenseText: true,
        },
      ],
    });
    value.summary.packageInstallations = 2;
    value.summary.uniqueNameVersions = 2;
    value.summary.noticeFiles = 2;
    const shipped = `${notices}\n--- node_modules/second/LICENSE ---\n${text}\n`;
    expect(validateStableAcceptance(evidence(), '1.0.0', hash, value, shipped)).toHaveLength(9);
    value.packages[1].licenseFiles[0].bytes = text.length;
    expect(() => validateStableAcceptance(evidence(), '1.0.0', hash, value, shipped)).toThrow();
  });

  it('rejects missing and partial browser results and independent gates', () => {
    expect(() => validateStableAcceptance(null, '1.0.0', hash, inventory, notices)).toThrow(
      'Missing',
    );
    for (const target of browserTargets) {
      const value = evidence();
      delete value.browsers[target];
      expect(() => validateStableAcceptance(value, '1.0.0', hash, inventory, notices)).toThrow(
        target,
      );
    }
    for (const check of browserChecks) {
      const value = evidence();
      value.browsers.chromium.checks[check] = 'not-run';
      expect(() => validateStableAcceptance(value, '1.0.0', hash, inventory, notices)).toThrow(
        check,
      );
    }
    for (const gate of evidenceGates) {
      const value = evidence();
      value.gates[gate].status = 'pending';
      expect(() => validateStableAcceptance(value, '1.0.0', hash, inventory, notices)).toThrow(
        gate,
      );
    }
  });
  it.each(['../outside', 'docs/acceptance/../outside', '/tmp/report'])(
    'rejects report path %s',
    (report) => {
      const value = evidence();
      value.gates.api.report = report;
      expect(() => validateStableAcceptance(value, '1.0.0', hash, inventory, notices)).toThrow(
        'report path',
      );
    },
  );

  it('checks actual tarball inventory, site files, report bytes and symlink confinement', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'lumina-stable-'));
    temporary.push(cwd);
    const write = (name: string, value: string) => writeFileSync(path.join(cwd, name), value);
    for (const name of ['package', 'artifacts', 'docs/acceptance', 'dist'])
      mkdirSync(path.join(cwd, name), { recursive: true });
    const script = path.resolve('scripts/check-stable-release.mjs');
    const run = (site = false) =>
      spawnSync(process.execPath, [script, ...(site ? ['--site'] : [])], { cwd, encoding: 'utf8' });
    const pack = (inv = inventory) => {
      write('package/dependency-inventory.json', JSON.stringify(inv));
      write('package/THIRD_PARTY_NOTICES.txt', notices);
      execFileSync('tar', ['-czf', 'artifacts/lumina-report-sdk-1.0.0.tgz', 'package'], { cwd });
      const sha = digest(readFileSync(path.join(cwd, 'artifacts/lumina-report-sdk-1.0.0.tgz')));
      const value = evidence();
      value.artifactSha256 = sha;
      Object.assign(value, { siteSha256: 'b'.repeat(64) });
      const result = JSON.stringify(reproducibility(sha));
      write('docs/acceptance/reproducibility.json', result);
      value.gates.reproducibility.report = 'docs/acceptance/reproducibility.json';
      value.gates.reproducibility.reportSha256 = digest(result);
      write('docs/acceptance/stable-release.json', JSON.stringify(value));
    };
    write('package.json', JSON.stringify({ version: '1.0.0' }));
    write('package/package.json', JSON.stringify({ name: 'lumina-report-sdk', version: '1.0.0' }));
    write('docs/acceptance/report.txt', 'synthetic evidence');
    pack();
    expect(run().status).toBe(0);
    write('dist/index.html', 'accepted site');
    expect(run(true).stderr).toContain('different site build');
    const accepted = JSON.parse(
      readFileSync(path.join(cwd, 'docs/acceptance/stable-release.json'), 'utf8'),
    );
    accepted.siteSha256 = (await siteDigest(path.join(cwd, 'dist'))).sha256;
    const result = JSON.stringify(reproducibility(accepted.artifactSha256, accepted.siteSha256));
    write('docs/acceptance/reproducibility.json', result);
    accepted.gates.reproducibility.reportSha256 = digest(result);
    write('docs/acceptance/stable-release.json', JSON.stringify(accepted));
    expect(run(true).status).toBe(0);
    write('dist/index.html', 'untested site');
    expect(run(true).stderr).toContain('different site build');
    // Package-only publishing does not claim that a site was deployed.
    expect(run().status).toBe(0);
    const dirtyResult = JSON.stringify({ ...JSON.parse(result), dirty: true });
    write('docs/acceptance/reproducibility.json', dirtyResult);
    accepted.gates.reproducibility.reportSha256 = digest(dirtyResult);
    write('docs/acceptance/stable-release.json', JSON.stringify(accepted));
    expect(run().stderr).toContain('clean checkout');
    write('docs/acceptance/reproducibility.json', result);
    accepted.gates.reproducibility.reportSha256 = digest(result);
    write('docs/acceptance/stable-release.json', JSON.stringify(accepted));
    write('docs/acceptance/report.txt', 'changed');
    expect(run().stderr).toContain('changed evidence');
    write('docs/acceptance/report.txt', 'synthetic evidence');
    pack({ ...inventory, summary: { ...inventory.summary, reviewItems: 5 } });
    expect(run().stderr).toContain('unresolved reviewItems');
    pack();
    write('package/THIRD_PARTY_NOTICES.txt', notices.replace('Permission', 'PermissioN'));
    execFileSync('tar', ['-czf', 'artifacts/lumina-report-sdk-1.0.0.tgz', 'package'], { cwd });
    const changed = evidence();
    changed.artifactSha256 = digest(
      readFileSync(path.join(cwd, 'artifacts/lumina-report-sdk-1.0.0.tgz')),
    );
    write('docs/acceptance/stable-release.json', JSON.stringify(changed));
    expect(run().stderr).toContain('notice digest');
    pack();
    rmSync(path.join(cwd, 'docs/acceptance/report.txt'));
    write('outside.txt', 'synthetic evidence');
    symlinkSync(path.join(cwd, 'outside.txt'), path.join(cwd, 'docs/acceptance/report.txt'));
    expect(run().stderr).toContain('escapes');
    write('package.json', JSON.stringify({ version: '0.26.0' }));
    expect(run().status).toBe(0);
  });
});

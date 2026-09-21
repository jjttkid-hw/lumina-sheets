import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceTimestamp } from './build-time.mjs';
import { siteDigest } from './site-evidence.mjs';

// Two local builds with one dependency installation. This produces technical
// evidence, never a stable-release acceptance record or a publishing action.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
assert(process.argv.length === 2, 'Usage: node scripts/check-reproducibility.mjs');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const epoch = process.env.SOURCE_DATE_EPOCH ?? git('log', '-1', '--format=%ct');
const timestamp = sourceTimestamp(epoch);
const env = { ...process.env, SOURCE_DATE_EPOCH: epoch };
const output = path.join(root, 'artifacts/reproducibility');
await mkdir(output, { recursive: true });

async function inputs() {
  const names = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  // Runtime/build inputs only; docs included because SDK README/notices consume them.
  const selected = [...new Set(names)].filter((name) =>
    /^(?:src\/|scripts\/|examples\/|public\/|docs\/|package(?:-lock)?\.json$|tsconfig[^/]*\.json$|vite[^/]*\.ts$|index\.html$|LICENSE$|NOTICE$|README\.md$)/.test(
      name,
    ),
  );
  const files = [];
  for (const name of selected.sort()) {
    const filename = path.join(root, name);
    let stat;
    try {
      stat = await lstat(filename);
    } catch (error) {
      if (error.code === 'ENOENT') continue; // tracked deletion is represented by absence
      throw error;
    }
    assert(stat.isFile() && !stat.isSymbolicLink(), `Build input must be a regular file: ${name}`);
    const bytes = await readFile(filename);
    files.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
  }
  return { sha256: hash(JSON.stringify(files)), files };
}
const before = await inputs();
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const report = {
  schema: 1,
  status: 'running',
  version: manifest.version,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    npm: execFileSync(npm, ['--version'], { cwd: root, encoding: 'utf8' }).trim(),
  },
  commit: git('rev-parse', 'HEAD'),
  dirty: !!git('status', '--porcelain'),
  sourceDateEpoch: epoch,
  sourceTimestamp: timestamp,
  inputSha256: before.sha256,
  scope:
    'Two builds in one local checkout with the same installed dependencies. Not clean-install, cross-machine, browser or commercial acceptance.',
  runs: [],
};
await writeFile(path.join(output, 'inputs.json'), JSON.stringify(before, null, 2) + '\n');
try {
  for (let index = 1; index <= 2; index++) {
    console.log(`Reproducibility: building site and package ${index}/2`);
    let log = '';
    try {
      for (const script of ['build:site', 'check:api', 'check:sdk'])
        log += execFileSync(npm, ['run', script], {
          cwd: root,
          env,
          encoding: 'utf8',
          timeout: 180000,
          maxBuffer: 16 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (error) {
      log += [error.stdout, error.stderr].filter(Boolean).join('\n');
      throw error;
    } finally {
      await writeFile(path.join(output, `run-${index}.log`), log);
    }
    const site = await siteDigest(path.join(root, 'dist'));
    const archive = await readFile(
      path.join(root, `artifacts/lumina-report-sdk-${manifest.version}.tgz`),
    );
    await writeFile(path.join(output, `site-${index}.json`), JSON.stringify(site, null, 2) + '\n');
    report.runs.push({
      siteSha256: site.sha256,
      siteFiles: site.files.length,
      artifactSha256: hash(archive),
      artifactBytes: archive.length,
    });
    assert.equal(
      (await inputs()).sha256,
      before.sha256,
      'Source inputs changed during verification',
    );
  }
  assert.deepEqual(
    report.runs[1],
    report.runs[0],
    'Repeated site or package differs; inspect the two site manifests and logs',
  );
  report.status = 'passed';
  console.log(JSON.stringify(report));
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  throw error;
} finally {
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
}

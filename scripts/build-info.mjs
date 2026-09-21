import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { siteDigest } from './site-evidence.mjs';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).trim();
assert(/^[a-f0-9]{40}$/.test(commit), 'Build identity requires a checked-out Git commit');
const site = await siteDigest('dist');
await writeFile(
  'dist/build-info.json',
  JSON.stringify({ version, commit, siteSha256: site.sha256 }, null, 2) + '\n',
);

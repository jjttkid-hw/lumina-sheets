import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { siteDigest } from './site-evidence.mjs';

const [root, expectedCommit] = process.argv.slice(2);
assert(process.argv.length === 4 && root, 'Usage: node scripts/check-deploy-site.mjs <site-directory> <tested-commit>');
assert(typeof expectedCommit === 'string' && /^[a-f0-9]{40}$/.test(expectedCommit), 'Invalid tested commit');
const info = JSON.parse(await readFile(path.join(root, 'build-info.json'), 'utf8'));
assert(info.commit === expectedCommit, 'Downloaded site belongs to a different commit');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
assert(info.version === version, 'Downloaded site version does not match tested source');
const site = await siteDigest(root);
assert(info.siteSha256 === site.sha256, 'Downloaded site files differ from the tested build');
console.log(JSON.stringify({status: 'verified', commit: expectedCommit, version, siteSha256: site.sha256}));

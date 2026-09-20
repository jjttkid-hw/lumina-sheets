import { readFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const expected = `v${version}`;
if (process.env.RELEASE_TAG !== expected) {
  throw new Error(`Release tag must be ${expected}, received ${process.env.RELEASE_TAG}`);
}
console.log(`Release tag matches package version: ${expected}`);

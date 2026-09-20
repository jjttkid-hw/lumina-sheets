import { readFile, writeFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(
  'dist/build-info.json',
  JSON.stringify({ version, commit: process.env.GITHUB_SHA ?? null }, null, 2) + '\n',
);

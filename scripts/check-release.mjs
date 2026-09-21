import { appendFile, readFile } from 'node:fs/promises';
import { releasePolicy } from './release-policy.mjs';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
let prerelease;
if (process.env.GITHUB_EVENT_NAME === 'release') {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  prerelease = event.release?.prerelease;
  if (typeof prerelease !== 'boolean') throw new Error('Missing release prerelease flag');
}
const plan = releasePolicy(version, process.env.RELEASE_TAG, prerelease);
if (process.env.GITHUB_OUTPUT)
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `dist-tag=${plan.distTag}\nartifact=${plan.artifact}\n`,
  );
console.log(JSON.stringify(plan));

import { siteDigest } from './site-evidence.mjs';
// Read-only: printing evidence does not certify browser acceptance.
console.log(JSON.stringify(await siteDigest('dist'), null, 2));

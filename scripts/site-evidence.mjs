import { lstat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

/** Hash every deployed file, including SDK/demo/worker assets. Build trace metadata
 * is excluded because an evidence-only commit changes its commit ID. */
export async function siteDigest(root) {
  assert((await lstat(root)).isDirectory(), 'Site root must be a directory, not a symlink');
  const files = [];
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  async function visit(relative = '') {
    const entries = await readdir(path.join(root, relative));
    entries.sort();
    for (const name of entries) {
      const key = relative ? `${relative}/${name}` : name;
      const target = path.join(root, key);
      const stat = await lstat(target);
      assert(!stat.isSymbolicLink(), `Site symlinks are not allowed: ${key}`);
      if (stat.isDirectory()) await visit(key);
      else {
        assert(stat.isFile(), `Unsupported site entry: ${key}`);
        if (key === 'build-info.json') continue;
        const bytes = await readFile(target);
        files.push({ path: key, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  await visit();
  assert(files.some(file => file.path === 'index.html'), 'Site is missing index.html');
  // Sorting by the entire relative path also makes directory traversal irrelevant.
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { schema: 1, sha256: hash(JSON.stringify(files)), files };
}

import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildTimestamp } from './build-time.mjs';

/** Source identity for diagnostics. Separate from final site/tgz acceptance digests. */
export async function productBuildIdentity(root, command = 'build') {
  const files = [];
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const visit = async (relative) => {
    const filename = path.join(root, relative);
    const info = await lstat(filename);
    if (info.isSymbolicLink()) throw new Error(`Build identity forbids symlinks: ${relative}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(filename)).sort()) await visit(`${relative}/${name}`);
    } else if (info.isFile()) {
      const bytes = await readFile(filename);
      files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
    } else throw new Error(`Unsupported build input: ${relative}`);
  };
  for (const relative of [
    'src',
    'public',
    'examples',
    'scripts/build-time.mjs',
    'scripts/product-build.mjs',
    'scripts/bundle-evidence.mjs',
    'package.json',
    'package-lock.json',
    'index.html',
    'vite.config.ts',
    'vite.sdk.config.ts',
    'tsconfig.json',
    'tsconfig.sdk.json',
  ]) {
    // Public assets are optional; all declared build inputs must otherwise exist.
    if (relative === 'public') {
      try {
        await lstat(path.join(root, relative));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
    }
    await visit(relative);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const time = buildTimestamp(root);
  return {
    schema: 1,
    version: manifest.version,
    mode: command === 'build' ? 'production' : 'development',
    sourceSha256: hash(JSON.stringify(files)),
    sourceFiles: files.length,
    sourceTimestamp: time.timestamp,
    timestampSource: time.source,
    scope:
      'Source/build configuration fingerprint; excludes installed dependency bytes and final artifacts. Development identity is captured at server startup and may precede HMR changes. Acceptance still requires site and SDK archive digests.',
  };
}

export function productBuildPlugin() {
  return {
    name: 'lumina-product-build',
    async config(config, environment) {
      return {
        define: {
          __LUMINA_BUILD__: JSON.stringify(
            await productBuildIdentity(path.resolve(config.root ?? '.'), environment.command),
          ),
        },
      };
    },
  };
}

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
/** Records actual Rollup inputs, without inventing identities inside vendor bundles. */
export async function collectBundleEvidence(root, bundle) {
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const sources = new Map(), chunks = [];
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk') continue;
    const inputs = [];
    for (const [id, rendered] of Object.entries(chunk.modules)) {
      // Virtual CommonJS wrappers are generated code; only record real input files.
      if (id.startsWith('\0')) continue;
      const filename = id.split('?')[0];
      if (!path.isAbsolute(filename)) throw new Error(`Unresolved bundle input: ${id}`);
      const relative = path.relative(root, filename).split(path.sep).join('/');
      if (relative.startsWith('../') || relative === '..') throw new Error('Bundle input escapes project root');
      if (!sources.has(relative)) {
        const bytes = await readFile(filename);
        const packagePath = Object.keys(lock.packages ?? {}).filter(location => location && relative.startsWith(location + '/')).sort((a, b) => b.length - a.length)[0];
        let dependency = null;
        if (packagePath) {
          const manifest = JSON.parse(await readFile(path.join(root, packagePath, 'package.json'), 'utf8'));
          const entry = lock.packages[packagePath];
          if (entry.version !== manifest.version) throw new Error(`Bundle dependency version mismatch: ${packagePath}`);
          dependency = { name: manifest.name, version: manifest.version, location: packagePath, integrity: entry.integrity ?? null };
        } else if (relative.includes('node_modules/')) throw new Error(`Untracked bundled dependency: ${relative}`);
        sources.set(relative, { path: relative, sha256: hash(bytes), bytes: bytes.length, dependency });
      }
      inputs.push({ path: relative, renderedLength: rendered.renderedLength });
    }
    chunks.push({ file: chunk.fileName, sha256: hash(chunk.code), bytes: Buffer.byteLength(chunk.code), inputs: inputs.sort((a, b) => a.path.localeCompare(b.path)) });
  }
  if (!chunks.length) throw new Error('No SDK chunks to inventory');
  return {
    schema: 1,
    scope: 'Actual Rollup chunk inputs and output hashes. renderedLength is pre-minification module output, not final per-dependency byte attribution. Virtual wrappers are excluded. Prebundled internal components remain unresolved.',
    lockfileSha256: hash(await readFile(path.join(root, 'package-lock.json'))),
    sources: [...sources.values()].sort((a, b) => a.path.localeCompare(b.path)),
    chunks: chunks.sort((a, b) => a.file.localeCompare(b.file)),
  };
}
export function bundleEvidencePlugin() {
  let root;
  return {
    name: 'lumina-bundle-evidence', enforce: 'post',
    configResolved(config) { root = config.root; },
    async generateBundle(_options, bundle) {
      this.emitFile({ type: 'asset', fileName: 'bundle-inputs.json', source: JSON.stringify(await collectBundleEvidence(root, bundle), null, 2) + '\n' });
    },
  };
}

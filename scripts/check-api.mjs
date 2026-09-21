import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 1 && args[0] === '--write'),
  'Usage: node scripts/check-api.mjs [--write]',
);
const root = path.resolve('dist/sdk/types');
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const declarations = {};
for (const relative of (await readdir(root, { recursive: true })).sort()) {
  if (!relative.endsWith('.d.ts')) continue;
  const source = ts.createSourceFile(
    relative,
    await readFile(path.join(root, relative), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const transformed = ts.transform(source, [
    (context) => {
      const visit = (node) => {
        if (
          ts.canHaveModifiers(node) &&
          ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)
        )
          return undefined;
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => ts.visitNode(node, visit);
    },
  ]);
  declarations[relative.replaceAll(path.sep, '/')] = printer.printFile(transformed.transformed[0]);
  transformed.dispose();
}
assert(Object.keys(declarations).length > 0, 'Build the SDK before checking its API');
const manifest = JSON.parse(await readFile('dist/sdk/package.json', 'utf8'));
const contract = { schema: 1, exports: manifest.exports, declarations };
const baseline = 'docs/api-contract.json';
if (args[0] === '--write') {
  await writeFile(baseline, JSON.stringify(contract, null, 2) + '\n');
  console.log('API baseline updated; review the diff and document compatibility changes.');
} else {
  assert.deepEqual(
    contract,
    JSON.parse(await readFile(baseline, 'utf8')),
    'Public declaration contract changed. Review compatibility before deliberately updating the baseline.',
  );
  console.log(
    `SDK public declaration contract passed (${Object.keys(declarations).length} files).`,
  );
}

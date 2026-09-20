import { copyFile, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import './package-notices.mjs';
const project = JSON.parse(await readFile('package.json', 'utf8'));
await copyFile('LICENSE', 'dist/sdk/LICENSE');
await copyFile('NOTICE', 'dist/sdk/NOTICE');
await copyFile('docs/NPM-README.md', 'dist/sdk/README.md');

// Keep the published declaration graph self-contained. Implementation-only
// declarations otherwise expose React, ExcelJS and source-only CSS paths.
const typesRoot = path.resolve('dist/sdk/types');
const declarations = new Map();
async function prepareDeclaration(filename) {
  if (declarations.has(filename)) return;
  const content = await readFile(filename, 'utf8');
  declarations.set(filename, true);
  const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true);
  const edits = [];
  const dependencies = new Set();
  function visit(node) {
    // surface is the internal React rendering bridge, not a host API.
    if (
      filename === path.join(typesRoot, 'sdk/index.d.ts') &&
      ts.isMethodDeclaration(node) &&
      node.name.getText(source) === 'surface' &&
      ts.isClassDeclaration(node.parent) &&
      node.parent.name?.text === 'LuminaSpreadsheet'
    ) {
      edits.push({ start: node.getStart(source), end: node.end, text: 'private surface;' });
      return;
    }
    const specifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
        ? node.moduleSpecifier
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
          ? node.argument.literal
          : undefined;
    if (specifier && ts.isStringLiteral(specifier)) {
      const name = specifier.text;
      if (name.endsWith('.css') && ts.isImportDeclaration(node) && !node.importClause) {
        edits.push({ start: node.getStart(source), end: node.end, text: '' });
        return;
      }
      if (!name.startsWith('.'))
        throw new Error(`Public SDK declaration requires an unbundled type: ${name} (${filename})`);
      const target = path.resolve(
        path.dirname(filename),
        name.endsWith('.js') ? name.slice(0, -3) + '.d.ts' : name + '.d.ts',
      );
      if (!target.startsWith(typesRoot + path.sep))
        throw new Error(`SDK declaration escapes its package: ${name} (${filename})`);
      dependencies.add(target);
      if (!name.endsWith('.js'))
        edits.push({
          start: specifier.getStart(source),
          end: specifier.end,
          text: JSON.stringify(`${name}.js`),
        });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  let output = content;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  await writeFile(filename, output);
  for (const dependency of dependencies) await prepareDeclaration(dependency);
}
await prepareDeclaration(path.join(typesRoot, 'sdk/index.d.ts'));
for (const relative of await readdir(typesRoot, { recursive: true })) {
  const filename = path.join(typesRoot, relative);
  if (relative.endsWith('.d.ts') && !declarations.has(filename)) await rm(filename);
}
// Resolves the documented CSS subpath even with noUncheckedSideEffectImports.
await writeFile(path.join(typesRoot, 'style.d.ts'), 'export {};\n');
const example = (await readFile('examples/report.html', 'utf8'))
  .replace("'../src/sdk/index.tsx'", "'./lumina.js'")
  .replaceAll('%BASE_URL%', 'https://jjttkid-hw.github.io/lumina-sheets/')
  .replace('</head>', '<link rel="stylesheet" href="./lumina.css"></head>');
await writeFile('dist/sdk/example.html', example);
await writeFile(
  'dist/sdk/package.json',
  JSON.stringify(
    {
      name: 'lumina-report-sdk',
      version: project.version,
      description: project.description,
      license: project.license,
      repository: project.repository,
      homepage: project.homepage,
      bugs: project.bugs,
      keywords: ['spreadsheet', 'canvas', 'reporting', 'javascript', 'typescript', 'xlsx', 'csv'],
      type: 'module',
      main: './lumina.js',
      module: './lumina.js',
      types: './types/sdk/index.d.ts',
      exports: {
        '.': {
          types: './types/sdk/index.d.ts',
          import: './lumina.js',
          default: './lumina.js',
        },
        './style.css': { types: './types/style.d.ts', default: './lumina.css' },
      },
      files: [
        '*.js',
        '*.css',
        'types',
        'README.md',
        'LICENSE',
        'NOTICE',
        'THIRD_PARTY_NOTICES.txt',
        'dependency-inventory.json',
        'example.html',
      ],
      sideEffects: ['*.css'],
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
    },
    null,
    2,
  ),
);

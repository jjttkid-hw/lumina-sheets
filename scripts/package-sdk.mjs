import { copyFile, readFile, writeFile } from 'node:fs/promises';
import './package-notices.mjs';
const project = JSON.parse(await readFile('package.json', 'utf8'));
await copyFile('LICENSE', 'dist/sdk/LICENSE');
await copyFile('NOTICE', 'dist/sdk/NOTICE');
const example = (await readFile('examples/report.html', 'utf8'))
  .replace("'/src/sdk/index.tsx'", "'./lumina.js'")
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
      type: 'module',
      main: './lumina.js',
      module: './lumina.js',
      types: './types/sdk/index.d.ts',
      exports: {
        '.': { types: './types/sdk/index.d.ts', import: './lumina.js' },
        './style.css': './lumina.css',
      },
      sideEffects: ['*.css'],
    },
    null,
    2,
  ),
);

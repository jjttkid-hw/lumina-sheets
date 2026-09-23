import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.');
const dist = path.join(root, 'dist');

async function assetBytes(relative) {
  return (await stat(path.join(dist, relative))).size;
}

function assetsFromHtml(html) {
  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)="\.?(?:\/)?(?:[^"/]+\/)*assets\/([^"]+\.js)"/g))
    assets.add(`assets/${match[1]}`);
  return [...assets];
}

async function checkEntry(relative, budget) {
  const html = await readFile(path.join(dist, relative), 'utf8');
  const assets = assetsFromHtml(html);
  if (!assets.length) throw new Error(`${relative} 没有可验证的 JavaScript 入口。`);
  if (assets.some((asset) => asset.includes('exceljs')))
    throw new Error(`${relative} 首屏静态加载了 ExcelJS；XLSX 依赖必须保持按需加载。`);
  const bytes = (await Promise.all(assets.map(assetBytes))).reduce((sum, value) => sum + value, 0);
  if (bytes > budget)
    throw new Error(`${relative} 首屏 JavaScript 为 ${bytes} 字节，超过 ${budget} 字节预算。`);
  console.log(`${relative}: ${bytes} bytes across ${assets.length} entry/preload assets`);
}

await checkEntry('index.html', 700_000);
await checkEntry('examples/report.html', 700_000);

const sdk = await readFile(path.join(dist, 'sdk', 'lumina.js'), 'utf8');
if (/from\s*['"][^'"]*exceljs/i.test(sdk))
  throw new Error('SDK 主入口静态依赖 ExcelJS；XLSX 依赖必须保持按需加载。');
console.log('dist/sdk/lumina.js: ExcelJS remains dynamically loaded');

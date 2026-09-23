# Lumina Report SDK

Canvas-based JavaScript spreadsheet and reporting SDK for browser applications. Mount it in an HTML element, edit cells, evaluate supported formulas, generate reports, and import or export supported workbook formats. JavaScript and TypeScript hosts do not need to install React: the renderer and its runtime are bundled.

This package is an ES module browser SDK. Mounting requires a DOM and Canvas; server rendering and CommonJS `require()` are not supported. It is under active development and does not claim complete Excel or SpreadJS compatibility. Pin a version and validate it against your own workbook corpus before deploying.

## Install and mount

```sh
npm install lumina-report-sdk
```

Use a browser bundler with ES module and CSS support, such as Vite. Provide a container with an explicit height:

```html
<div id="sheet" style="height: 560px; width: 100%"></div>
```

```js
import { createSpreadsheet } from 'lumina-report-sdk';
import 'lumina-report-sdk/style.css';

const host = document.getElementById('sheet');
if (!host) throw new Error('Spreadsheet container is missing');

const grid = createSpreadsheet(host, {
  onChange: ({ sheetId, changes }) => console.log(sheetId, changes),
  onError: (error) => console.error(error),
});

grid.setCells([
  { key: 'A1', cell: { value: 10 } },
  { key: 'B1', cell: { value: '=A1*2' } },
]);
console.log(grid.getValue('B1')); // 20

// Call when your view is removed, before removing its container:
// grid.destroy();
```

Create the instance only after the container has mounted. For applications with server rendering, load and mount it in the browser lifecycle. Call `destroy()` when disposing the view; this cancels pending data requests and exports and unmounts the renderer.

Type declarations are included. Use TypeScript 5+ with DOM libraries and either `moduleResolution: "Bundler"` or `"NodeNext"` for an ES module project; no `@types/react` package is required. The CSS import also has a declaration for strict side-effect import checking.

```ts
import { createSpreadsheet, type CellChange } from 'lumina-report-sdk';
import 'lumina-report-sdk/style.css';

const host = document.querySelector<HTMLElement>('#sheet');
if (!host) throw new Error('Spreadsheet container is missing');
const grid = createSpreadsheet(host);
const changes: CellChange[] = [{ key: 'A1', cell: { value: 42 } }];
grid.setCells(changes);
```

## Without a bundler

Copy the **complete package directory** to a static HTTP(S) server. Keep all JavaScript chunks together; XLSX support loads additional chunks on demand. Use the included `example.html`, or:

```html
<link rel="stylesheet" href="./vendor/lumina/lumina.css" />
<div id="sheet" style="height: 560px"></div>
<script type="module">
  import { createSpreadsheet } from './vendor/lumina/lumina.js';
  const grid = createSpreadsheet(document.getElementById('sheet'));
  grid.setCell('A1', 'Hello, Lumina');
</script>
```

Serve these files over HTTP(S), not `file://`. Clipboard integration depends on browser permission and secure-context support. Modern browsers need ES modules, Canvas 2D, `structuredClone`, `ResizeObserver`, `AbortController`, and Web Streams for streaming exports. A full browser certification matrix is not yet available.

## Core API

| API                                                   | Behavior                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `setCell(address, value, style?)`                     | Edit one cell; strings beginning with `=` are formulas.             |
| `setCells(changes)`                                   | Apply a validated atomic batch; `cell: null` deletes a cell.        |
| `getCell(address)` / `getValue(address)`              | Read an isolated raw cell or its current calculated value.          |
| `setZoom(value)` / `zoom`                             | Change view scale without changing workbook data or undo history.   |
| `select({ row, col, endRow?, endCol? })`              | Select using zero-based coordinates.                                |
| `undo()` / `redo()`                                   | Undo or redo editing transactions.                                  |
| `toJSON()` / `load(workbook)`                         | Capture or restore a workbook snapshot; snapshots copy stored data. |
| `import(file, options?)` / `export(format, options?)` | Browser file import and XLSX, CSV, PDF, or JSON download.           |
| `prefetch(range, options?)`                          | Warm a paged viewport without changing selection or view state.    |
| `report(definition, records)`                         | Generate list, grouped, or cross-tab reports.                       |
| `bindData(source, options?)`                          | Bind a read-only paged source with bounded viewport caching.        |
| `destroy()`                                           | Release the instance; safe to call repeatedly.                      |

Use `grid.setZoom(125)` for 125%. The getter returns the supplied value; values above 3 are percentages, smaller positive values are scale factors, and Canvas clamps the effective scale to 50–200%. Read-only and paged views support zoom. Loading a workbook retains it.

Imports accept an AbortSignal. A newer import, successful workbook edit/replacement, data binding, or destruction cancels the pending import with `IMPORT_CANCELLED`; late parsing cannot overwrite current content. Parsing may continue after cancellation, but its result is discarded.

Additional APIs cover layout, static row sorting, row/column insertion and deletion, input validation, conditional styles, print settings, data retries, and streaming CSV exports. [API documentation](https://github.com/jjttkid-hw/lumina-sheets/blob/main/docs/SDK.md) describes contracts and examples. Errors from direct API calls should be handled by the caller; `onError` reports asynchronous data, interaction, and callback failures.

For a production paged view, expose the data state and keep retry explicit. A failed page stays out of the cache, while pages that already loaded remain usable:

```js
const grid = createSpreadsheet(host, {
  onDataStateChange: (state) => {
    status.textContent = state.status === 'error'
      ? `加载失败：${state.error?.message ?? '请重试'}`
      : `${state.cachedPages} 页已缓存`;
    retryButton.disabled = state.status !== 'error';
  },
});

retryButton.addEventListener('click', () => grid.retryData());
refreshButton.addEventListener('click', () => grid.clearDataCache());
```

`retryData()` only retries the last requested viewport and does not loop automatically. `clearDataCache()` cancels active page requests, drops retained pages, and reloads that viewport. Treat `AbortError` as an intentional cancellation during navigation or teardown; surface other errors to the user and keep the current cached pages visible.

## Build identity

For support diagnostics and release verification, the package exposes the identity embedded in the build:

```ts
import { productBuildIdentity } from 'lumina-report-sdk';

const build = productBuildIdentity();
if (build) console.info(`Lumina ${build.version}`, build.sourceSha256);
```

The value contains the package version, a SHA-256 fingerprint of the tracked source/build inputs, the source timestamp and whether the bundle was produced in production or development mode. It is a diagnostic fingerprint, not a signature and not a substitute for the final SDK archive or site digest. A host must tolerate `null` when running an unbundled development build.

## Persistence and data ownership

The SDK does not automatically save workbooks to a server or provide accounts, permissions, collaboration, or cloud storage. Use `toJSON()` and `load()` for explicit snapshots, and integrate the change callbacks with your own persistence. Structural changes have a separate `onStructureChange` callback. Worksheet renames use `onSheetRename`; include both callbacks when saving snapshots. `readOnly` controls editor behavior; enforce access permissions in your service.

For large remote datasets, implement the `ReportDataSource` interface or use `restDataSource`. Paging is read-only and cached cells are not a complete workbook. Provide a stable source snapshot when exporting. See [data-source and export documentation](https://github.com/jjttkid-hw/lumina-sheets/blob/main/docs/SDK.md).

For a paged source, `await grid.prefetch({ firstRow: 10_000, lastRow: 10_127 })` loads the required cache pages ahead of a planned navigation. It does not move the selection, change the active sheet, or make the instance writable. Pass an `AbortSignal` when navigation is superseded; cancellation rejects with `AbortError` and never changes the workbook.

REST sources default to one request per page. For networks where transient failures are expected, opt into a bounded policy such as `retry: { retries: 2, baseDelayMs: 200, maxDelayMs: 2000 }`. Only network failures and the configured temporary HTTP statuses are retried; malformed payloads and capacity errors fail immediately. An abort during backoff stops the retry before another request starts.

## Current limits

- Formula support is a documented subset, calculated synchronously on demand with dependency invalidation. There is no claim of complete Excel formula compatibility or universal performance superiority. See [supported formulas](https://github.com/jjttkid-hw/lumina-sheets/blob/main/docs/FORMULAS.md) and [measured performance](https://github.com/jjttkid-hw/lumina-sheets/blob/main/docs/PERFORMANCE.md).
- Paged sources support complete CSV export; XLSX, PDF, and JSON export from paged sources are rejected. Blob exports hold the output in memory; use streaming CSV APIs for larger exports.
- XLSX import/export preserves a supported subset of workbook, layout, validation, and print features, with file and cell quotas. Unsupported validation and print configurations may be rejected. Validate round trips against your files.
- PDF export rasterizes Canvas pages. It does not provide selectable text, complete Excel print fidelity, charts, or a pivot-table designer.
- Conditional formatting is exported as evaluated styles on stored cells, not as dynamic Excel rules. JSON preserves SDK input rules and print settings.
- Structural edits scan stored workbook cells and formulas and retain affected-sheet snapshots for undo. Large structural edits are not guaranteed to complete within an animation frame.
- Input validation checks directly edited cells against the complete candidate batch. It is not a continuous constraint system for every dependent formula or a server-side validation boundary.

## 发布后注册表核对

GitHub Actions 使用 npm Trusted Publishing（OIDC）发布后，会立即读取 npm 注册表中的同一版本，核对名称、版本、tarball integrity，并在临时目录中用下载的 tarball 独立安装。发布工作流失败时不会把“发布命令返回成功”当作首发完成。

手动核对已发布版本：

```sh
NPM_VERSION=1.0.0 node scripts/check-npm-registry.mjs
```

该命令只读取公开注册表并下载指定版本，不需要本地 npm 登录；包尚未发布时应明确失败。Trusted Publisher 必须指向 GitHub 用户 `jjttkid-hw`、仓库 `lumina-sheets`、工作流文件 `npm.yml`、环境 `npm`。首次发布前仍需在 npm 包设置中完成该绑定。

## License and support

Project code is licensed under Apache-2.0. This package includes `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.txt`, and `dependency-inventory.json`. Third-party components retain their own licenses. The inventory identifies unresolved upstream notice/version review items; it is not a completed commercial redistribution audit. See [dependency review](https://github.com/jjttkid-hw/lumina-sheets/blob/main/docs/DEPENDENCIES.md).

Report reproducible issues with synthetic or redacted data at [GitHub Issues](https://github.com/jjttkid-hw/lumina-sheets/issues). No paid support service or enterprise SLA is currently provided by this package.

## Rename worksheets

Call `grid.renameSheet('Sales', sheetId)` or omit `sheetId` to rename the current static sheet. Explicit formula sheet qualifiers and single-cell internal hyperlink targets update atomically, with one undo/redo transaction. Sheet IDs, the active sheet and selection stay unchanged. Duplicate/invalid names and unsupported reference syntax reject the operation without modifying history. Equal names are a no-op. Successful renames cancel pending imports; readonly or paged targets cannot be renamed.

`onSheetRename({ sheetId, previousName, name, affectedSheetIds, phase })` runs after the complete commit. `phase` is `apply`, `undo` or `redo`, and names describe that operation's before/after state. Renames do not emit synthetic cell or structure events. Renames and row/column structural edits share a limit of ten snapshot transactions within the overall 100-transaction history; dropping an old snapshot drops its preceding history prefix.

## Rich text cells

`Cell.richText` is an optional `RichTextRun[]`. Its concatenated text must exactly equal the cell's ordinary string `value`; formulas and numeric values cannot carry runs. Run styles support bold, italic, single underline, strike, six-digit RGB color, fontSize (6–96), and fontFamily. Use `setCells` to replace complete runs. Changing text via `setCell` clears previous runs; unchanged text preserves them, and undo restores them.

Supported runs survive JSON/XLSX round trips and render through Canvas and raster PDF output. CSV and external plain-text clipboard operations carry text only. The Canvas text editor remains plain text. The workspace offers a separate selected-text formatting dialog; SDK hosts can supply runs through setCells. XLSX theme/index colors, double/accounting underlines, font scheme metadata and phonetic annotations are not supported and reject rich-text import instead of silently flattening it. Available system fonts determine appearance; fonts are not embedded. This is not complete Excel rich-text compatibility or browser certification.

Rich runs also accept `verticalAlign: 'baseline' | 'superscript' | 'subscript'`, `fontFamilyClass` (0–5), and `charset` (0–255). These attributes round trip through XLSX; text remains Unicode. Canvas and PDF render scripts at 65% size with a 30% upward/downward offset and reserve line height. Font classification and charset are preserved metadata, not browser font selectors. Exact Excel typography and theme relationships remain unverified/unsupported.

XLSX text export preserves CR/CRLF, XML control characters and literal escape-shaped strings such as `_x0041_` using OOXML string encoding. This applies to ordinary strings, hyperlink labels and rich runs. Rich text import decodes these escapes once; invalid Unicode units can be retained as data but may render as replacement glyphs. Actual Excel application compatibility remains pending.

Formula string caches also use OOXML encoding; numeric, boolean and error caches keep their types. Export requests full recalculation on load in Excel. Lumina imports formulas and recomputes them with its supported engine subset. ExcelJS 4.4 does not itself decode ST_Xstring formula caches, so direct cache reads may expose escape strings; this is not Excel application certification.

多工作表宿主可使用 `grid.sheetInfos` 创建目录，通过 `grid.setActiveSheet(id)` 切换，并监听 `onActiveSheetChange` 保存活动表偏好。切表保留工作簿撤销/重做与计算缓存，重置选区/筛选；只读也可切换。分页绑定期间整个实例保持只读；CSV 按当前表选择数据源，含分页表的完整工作簿导出需先生成静态报表。详见 SDK.md。浏览器切换交互仍待实际验收。

安装包的 `example.html` 新增“多工作表”示例：销售明细与经营汇总通过跨表公式关联，可切表编辑、撤销及导出当前表 CSV。打开多工作表 Excel/JSON 后通过“当前工作表”选择器浏览其他表；导入期间若继续编辑，旧导入会取消以保留新编辑。需以 HTTP 服务打开示例。示例事件回归已执行，实际浏览器视觉/键盘/下载仍待验收。

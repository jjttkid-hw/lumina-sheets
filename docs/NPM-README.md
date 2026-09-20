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

| API                                         | Behavior                                                            |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `setCell(address, value, style?)`           | Edit one cell; strings beginning with `=` are formulas.             |
| `setCells(changes)`                         | Apply a validated atomic batch; `cell: null` deletes a cell.        |
| `getCell(address)` / `getValue(address)`    | Read an isolated raw cell or its current calculated value.          |
| `select({ row, col, endRow?, endCol? })`    | Select using zero-based coordinates.                                |
| `undo()` / `redo()`                         | Undo or redo editing transactions.                                  |
| `toJSON()` / `load(workbook)`               | Capture or restore a workbook snapshot; snapshots copy stored data. |
| `import(file)` / `export(format, options?)` | Browser file import and XLSX, CSV, PDF, or JSON download.           |
| `report(definition, records)`               | Generate list, grouped, or cross-tab reports.                       |
| `bindData(source, options?)`                | Bind a read-only paged source with bounded viewport caching.        |
| `destroy()`                                 | Release the instance; safe to call repeatedly.                      |

Additional APIs cover layout, static row sorting, row/column insertion and deletion, input validation, conditional styles, print settings, data retries, and streaming CSV exports. [API documentation](https://github.com/jjttkid-hw/lumina-sheets/blob/main/docs/SDK.md) describes contracts and examples. Errors from direct API calls should be handled by the caller; `onError` reports asynchronous data, interaction, and callback failures.

## Persistence and data ownership

The SDK does not automatically save workbooks to a server or provide accounts, permissions, collaboration, or cloud storage. Use `toJSON()` and `load()` for explicit snapshots, and integrate the change callbacks with your own persistence. Structural changes have a separate `onStructureChange` callback. `readOnly` controls editor behavior; enforce access permissions in your service.

For large remote datasets, implement the `ReportDataSource` interface or use `restDataSource`. Paging is read-only and cached cells are not a complete workbook. Provide a stable source snapshot when exporting. See [data-source and export documentation](https://github.com/jjttkid-hw/lumina-sheets/blob/main/docs/SDK.md).

## Current limits

- Formula support is a documented subset, calculated synchronously on demand with dependency invalidation. There is no claim of complete Excel formula compatibility or universal performance superiority. See [supported formulas](https://github.com/jjttkid-hw/lumina-sheets/blob/main/docs/FORMULAS.md) and [measured performance](https://github.com/jjttkid-hw/lumina-sheets/blob/main/docs/PERFORMANCE.md).
- Paged sources support complete CSV export; XLSX, PDF, and JSON export from paged sources are rejected. Blob exports hold the output in memory; use streaming CSV APIs for larger exports.
- XLSX import/export preserves a supported subset of workbook, layout, validation, and print features, with file and cell quotas. Unsupported validation and print configurations may be rejected. Validate round trips against your files.
- PDF export rasterizes Canvas pages. It does not provide selectable text, complete Excel print fidelity, charts, or a pivot-table designer.
- Conditional formatting is exported as evaluated styles on stored cells, not as dynamic Excel rules. JSON preserves SDK input rules and print settings.
- Structural edits scan stored workbook cells and formulas and retain affected-sheet snapshots for undo. Large structural edits are not guaranteed to complete within an animation frame.
- Input validation checks directly edited cells against the complete candidate batch. It is not a continuous constraint system for every dependent formula or a server-side validation boundary.

## License and support

Project code is licensed under Apache-2.0. This package includes `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.txt`, and `dependency-inventory.json`. Third-party components retain their own licenses. The inventory identifies unresolved upstream notice/version review items; it is not a completed commercial redistribution audit. See [dependency review](https://github.com/jjttkid-hw/lumina-sheets/blob/main/docs/DEPENDENCIES.md).

Report reproducible issues with synthetic or redacted data at [GitHub Issues](https://github.com/jjttkid-hw/lumina-sheets/issues). No paid support service or enterprise SLA is currently provided by this package.

# Multi-sheet browser acceptance — 2026-09-28

24 checks passed across headless Chrome 153.0.8010.54, Firefox 144.0.2 and WebKit 26.0 on macOS arm64, using the shipped site example and SDK package example. Browser versions, timestamps, environment and exact results are recorded in each `result.json`. Chromium used the installed Chrome channel (`BROWSER_CHANNEL=chrome`); CI uses its pinned bundled Chromium.

## Verified behavior

Each of the six engine/entry combinations verifies:

1. Edit detail C2 from 100000 to 200000; summary B2 recalculates from 8199000 to 8299000. Undo from the summary restores 8199000 without switching sheets; redo restores 8299000 and the cross-sheet formula.
2. Download CSV and inspect the actual bytes for the active summary sheet and edited total.
3. Download JSON, inspect both sheets, edited data and raw formula; replace the workbook with a single-sheet example, then import the downloaded file and verify both sheets and recalculation.
4. Download XLSX; replace the workbook, import the actual downloaded file and verify both sheets, edited data and raw formula/recalculation.

All actions use page controls, keyboard input, downloads and file inputs. No SDK state is injected. Each directory includes the report, final screenshot and original CSV/JSON/XLSX downloads. Reports record download lengths and SHA-256; `SHA256SUMS` covers the archived files.

## Artifact identity and reproduction

- Version: `0.29.0`, candidate r20, source epoch `1790122493`.
- Site SHA-256: `af75fb282b72a6a8498510b97ffae36f672577754e8a1e4048e914015977831c`.
- SDK SHA-256: `e2af24d67fda8af3ed26e27a24a7f4b2e17249aa741ff0212357fa652ac2fa64`.
- Runner: `scripts/check-multisheet-browser.mjs`; requires built `dist`, the checked SDK archive in `artifacts`, and installed browser tools in `scripts/fixtures/frameworks`.
- Local command: `BROWSER_CHANNEL=chrome node scripts/check-multisheet-browser.mjs`.
- CI runs `node scripts/check-multisheet-browser.mjs` after the React/Vue suite and uploads its fresh evidence.

This supplements [candidate r20](../browser-candidate-2026-09-24-r20/README.md). It verifies the supplied two-sheet example, not every workbook or full Excel/SpreadJS compatibility. It does not replace desktop Excel/WPS testing, native IME, real screen readers, physical mobile touch or target-hardware performance measurements.

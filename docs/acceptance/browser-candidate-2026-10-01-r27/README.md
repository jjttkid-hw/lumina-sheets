# Lumina Sheets 0.29.0 candidate r27

Executed 2026-10-01 locally on macOS arm64 / Node 24.14.0 with source epoch 1790122493 before commit. This is candidate evidence, not stable approval.

- Site SHA-256: `939ce1eb3268e6a623ed126367fe4ac17040319a5a1385fd1dca989d62dcd110`.
- SDK SHA-256: `7586704641638f54423083490cb588ba9ae8b2684c295ba9e2f12f09ea68be74`, 724638 bytes.

The report and package examples save latest active-sheet and selection metadata after navigation. Draft typing and view changes reuse the serialized workbook snapshot; data and structure edits refresh it. A report over the 5,000,000-character recovery limit retains in-memory edits and displays an export warning instead of writing an unrecoverable local copy. Storage rejection remains explicit. This is same-origin demo recovery, not SDK/server persistence.

All 2362 tests pass. Chromium runs 51 checks, Firefox and WebKit 48 each (147 total), including actual edit → sheet switch → B2 selection → full reload → summary value 8344000 recovery. The 25 reports also cover ARIA, focus, interactions, layout, performance, IndexedDB persistence, synthetic composition events and Chromium touch simulation. XLSX 5 and retained WPS fixture 4 checks pass against the same package.

These records do not certify native Safari reload cancellation, actual system IME, real screen readers, physical mobile touch, target customer hardware, complete Excel/SpreadJS compatibility, public npm publication or commercial legal review. Subsequent GitHub CI must independently run its artifact and three-engine browser gates before deployment.

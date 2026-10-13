# Lumina Sheets 0.29.0 candidate r44

Executed 2026-10-13 for the first v3.0 development milestone. This candidate adds bounded programmable pivot analysis: multiple row groups, an optional column category, sum/count/average/min/max measures, typed dimensions, deterministic ordering, weighted grand averages and ordinary editable workbook snapshots. The report example exposes a pivot layout with source regeneration and XLSX export.

The site SHA-256 and SDK archive SHA-256 are bound to the reports in this directory. Core browser checks passed in Chromium, Firefox and WebKit, including pivot generation, source regeneration, editable snapshot undo and XLSX round trip. Framework hosts, XLSX/WPS/business corpora, accessibility, IME, persistence and touch suites are retained alongside the core reports.

`createPivot` is a bounded in-memory analysis model. `grid.pivot()` installs ordinary cells and does not create or preserve an Excel native pivot cache; regenerate after changing source records. Limits and numeric/type semantics are documented in [NPM-README.md](../../../NPM-README.md#pivot-analysis).

This is development evidence, not stable v3.0 approval. Native IME, physical touch, real screen readers, target-device performance, complete Excel/SpreadJS compatibility and independent commercial/legal review remain open. npm publication is separate from product acceptance.

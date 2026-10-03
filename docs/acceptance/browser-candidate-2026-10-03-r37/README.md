# Lumina Sheets 0.29.0 candidate r37

Executed 2026-10-03 on macOS arm64 / Node 24.14.0, source epoch 1790122493.
Based on edceac7 with recorded pending changes; regression evidence, not stable approval.

- Site SHA-256: `065a4d88796f1575c3c44ead8c466b7009df15dfa200767eb48c732a251196e6`.
- SDK SHA-256: `3fb97d4fe24e7e557831650d0780ae10288a2dbf96994daca227ff3e27c6c01e`, 728317 bytes.

Previously XLSX export omitted the active workbook view and import always selected
the first sheet. Export now records activeTab and selects only the matching tab,
preserving frozen rows. Import restores the first workbook view's active sheet
using the original sheet directory; absent activeTab defaults to the first sheet.
Malformed and out-of-range indexes are rejected instead of silently selecting a
different sheet. Other window views, worksheet grouping, scroll and cell selection
are not retained. Eight failing regressions passed after the fix. ExcelJS handles
tabSelected in serialization but omits it from its types; a local type extension
bridges that omission without changing public SDK declarations.

All 2403 tests in 172 files pass. Core browser regression passes 162 checks in
25 reports; multi-sheet site/SDK checks pass 42, prompt checks 18 and workspace
validation checks 18. Multi-sheet actual JSON/XLSX downloads now assert the
restored active sheet is 经营汇总 before any test navigation. XLSX raw XML confirms
activeTab=1 and only sheet2 is selected. All downloads are retained per engine.

Native WPS 12.1.26055/build 26055 opens the exact SDK download on 经营汇总 without
a repair dialog or grouped-sheet title. Its save produces a different archive;
built SDK reimports the same active sheet. All 199 computed cell values agree,
including revenue 8299000. WPS removes optional sheet-name quotes in B2/B3; those
exact source-text differences are recorded, not called byte-preservation. Source,
WPS-saved file, result and cropped screenshot are retained under native-wps-active-sheet.

Two builds agree byte for byte; API contract, installed SDK checks, bundle budgets,
HTTP and XLSX 5 / WPS 4 / business 7 corpus checks pass. Three-engine 100k/1m
performance raw evidence passes the explicit local developer-desktop profile.
No customer SLA or competitor performance claim is made.

Native IME, real screen readers, physical touch, remaining Safari mouse-cancel
acceptance, customer hardware, broader Excel/WPS cases, public npm first publication
and human commercial review remain open. Version stays 0.29.0 without a stable
acceptance record or 1.0.0 tag.

# Lumina Sheets 0.29.0 candidate r38

Executed 2026-10-03 on macOS arm64 / Node 24.14.0, source epoch 1790122493.
Runtime source: ffaaa7f. Regression evidence, not stable approval.

- Site SHA-256: `ae0091fa180c7e99804103637d489c81bb123e78b0b9ab1e7306ec4ccf044305`.
- SDK SHA-256: `166bead41426361ad7dcd264f29add2230d80c9700bf38f88ef40e25edfe84ab`, 728359 bytes.

HLOOKUP adds first-row exact, approximate and wildcard lookup to the scalar formula subset. Row indices below 1 return #VALUE!; indices beyond the table return #REF!. Approximate inputs must be sorted ascending; duplicate exact candidates currently select the first. The dependency recursion guard was reduced from 256 to 200 after the new evaluator produced host stack exhaustion in the existing long-chain regression. That regression now returns #NUM! and a valid tail remains calculable. This does not establish a universal browser stack limit.

The core runner actually reran Chromium, Firefox and WebKit against these bytes: 162 checks in 25 reports. Reports are copied byte-for-byte from this run, including accessibility semantics and synthetic composition-event checks. All 2412 tests in 173 files pass, including six added HLOOKUP cases for wildcard escapes, lazy errors, mutation invalidation and XLSX roundtrip. Installed SDK XLSX / retained WPS / business corpora reran with 5 / 4 / 11 checks. Two local builds agree; the original reproducibility record retains its actual base commit and dirty status.

Correction: the initial r38 archive in 98a745d copied r37 attachments and replaced their hash fields, which did not constitute re-execution. Those inherited reports and native files are withdrawn from r38. The corrected archive includes only actual current runs; r37 remains the historical native WPS, multi-sheet and prompt record. No new native WPS session, framework or multi-sheet run is claimed here. CI runs those browser integrations separately.

Native Safari physical mouse confirmation, system IME candidates, real screen readers, physical touch, customer hardware, broader Excel/WPS compatibility, public npm publication and human commercial review remain open. Version stays 0.29.0.

Local performance runs did not configure a budget profile; raw samples are retained, but no local budget pass is claimed. Linux CI uses its explicit regression budget.

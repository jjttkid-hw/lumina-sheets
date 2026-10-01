# Lumina Sheets 0.29.0 candidate r23

Executed 2026-10-01 on macOS arm64 / Node 24.14.0 with source epoch 1790122493.
Local evidence was collected before commit; it is not stable release approval.

- Site SHA-256: `a78d4012e8d98b5988ec9e9159d48510079611a2f0592c6b4740b20f330854`.
- SDK SHA-256: `99c365d3eb312617776e8ee558633aeabffb0856c81c3bf32e738c59f2a3f2fe`, 723347 bytes.

Report example replacement now asks for confirmation after edits or drafts before
switching examples, regenerating repeated headers or reading a selected import.
Cancellation keeps the workbook, formula draft and undo/redo history. Cancelling
repeated-header regeneration restores the prior selector. A cancelled file selection
is cleared so the same file can be selected again. Confirming replacement starts the
existing generation/import operation; successful replacement resets session risk.
The example remains in memory and requires exports for retention.

The report's beforeunload handler now provides a non-empty legacy return value in
addition to preventDefault. Native Safari reload protection still requires successful
reverification; [the r22 observation](../r22-deployment-followup-2026-10-01/README.md)
records a reload that lost a draft without an observed cancellable prompt.

All 167 files / 2356 unit tests pass. The refreshed run binds the browser, framework, recovery, multi-sheet, XLSX and WPS reports to the rebuilt site and SDK hashes above. Three browser engines run seven multi-sheet
checks for each site/SDK entry (42 total), including actual confirm dismissal for
replacement/import/layout and retained undo history. React/Vue development and
production hosts provide 72 checks; recovery provides 12 checks and real downloads.
Core browser evidence covers smoke, interaction, focus, layout, performance,
DOM/ARIA, synthetic composition events and native persistence (24 reports), plus
Chrome touch simulation. XLSX corpus has five checks and retained WPS corpus four.

These checks do not certify native Safari reloads, system IME candidate windows,
real screen readers, physical touch, cross-device performance, full desktop Excel/
WPS/SpreadJS compatibility, npm publication or commercial license review.

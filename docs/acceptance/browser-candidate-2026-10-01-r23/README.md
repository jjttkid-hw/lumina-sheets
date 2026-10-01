# Lumina Sheets 0.29.0 candidate r23

Executed 2026-10-01 on macOS arm64 / Node 24.14.0 with source epoch 1790122493.
Local evidence was collected before commit; it is not stable release approval.

- Site SHA-256: `aed5cedc658526f8dd63b9f36f74aa58debae83d379d0d78236552bff1580dd0`.
- SDK SHA-256: `56b7e447a2058115d1ff43977ee91ff1f408a7f9430f0638aecfc6caf806ccac`, 723078 bytes.

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

All 167 files / 2356 unit tests pass. Three browser engines run seven multi-sheet
checks for each site/SDK entry (42 total), including actual confirm dismissal for
replacement/import/layout and retained undo history. React/Vue development and
production hosts provide 72 checks; recovery provides 12 checks and real downloads.
Core browser evidence covers smoke, interaction, focus, layout, performance,
DOM/ARIA, synthetic composition events and native persistence (24 reports), plus
Chrome touch simulation. XLSX corpus has five checks and retained WPS corpus four.

The initial local core run failed HTTP asset validation because the preview server
was started without the deployment base. After correcting server configuration,
interaction automation encountered the new replacement prompt while resetting its
fixture. The script now explicitly accepts that prompt and was rerun. These failures
were not product clipboard regressions; logs remain in the task history/temp files.

These checks do not certify native Safari reloads, system IME candidate windows,
real screen readers, physical touch, cross-device performance, full desktop Excel/
WPS/SpreadJS compatibility, npm publication or commercial license review.

# Lumina Sheets 0.29.0 candidate r28

Executed 2026-10-02 locally on macOS arm64 / Node 24.14.0 with source epoch 1790122493 before commit. This is candidate evidence, not stable approval.

- Site SHA-256: `eae8ebfbe326c2f699a859e3ad22bd3b7cb31ef0ce19447968bd85709ca5e53c`.
- SDK SHA-256: `96369145572f2ca10cbbf6da971600a81f081c7990802995032433373290fd96`, 725311 bytes.

The report example adds an 80 ms pointer-release fallback for Apply when a click is missing. A normal click cancels it. A late pointer click for the same draft is deduplicated; keyboard activation remains synchronous. The fallback ignores secondary mouse buttons and disabled controls, and refuses to apply after the report generation, active sheet, cell or input changes. Teardown cancels pending work. Unit regressions exercise normal/missing/late click sequences and cell-navigation guards with substituted elements; these are not native Safari event evidence.

All 167 test files / 2364 tests pass. The earlier parallel run timed out during an unusually long host pause; its failures were not accepted as passing evidence. The final full run uses one worker without increasing timeout limits. Two builds produced identical site and SDK digests. API, isolated SDK install/type checks, strict dependency inventory, site HTTP checks, entry-asset budgets, XLSX 5 and retained WPS fixture 4 checks pass. Chromium runs 51 checks, Firefox and WebKit 48 each (147 total) across 25 retained reports. The reports remain scoped to automated browser regression, synthetic composition events and simulated touch.

A native Safari development-page attempt was interrupted by external app changes during both leave-page confirmation responses. The restored-session notice was observed, so this attempt does not establish that navigation was cancelled. No successful first-Apply-after-Stay result is claimed. The r27 first-click observation remains open, and the fallback must still be validated against an uninterrupted native event sequence on the production candidate.

npm whoami returned E401 on 2026-10-02. No npm publication was performed. Native Safari interaction, system IME candidate windows, real screen readers, physical touch, target customer hardware, broader Excel/WPS business corpus, commercial legal review and public registry installation remain stable-release gates. No 1.0.0 tag or stable acceptance record is created.

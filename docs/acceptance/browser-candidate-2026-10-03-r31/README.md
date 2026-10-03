# Lumina Sheets 0.29.0 candidate r31

Executed 2026-10-03 on macOS arm64 / Node 24.14.0 with source epoch 1790122493. Source checkout was based on 9cffb3591547a1b07819a7a24a6d1938cfd5fe1c with the recorded pending runtime changes. This is regression evidence, not stable approval.

- Site SHA-256: `f454ab2f96a424e195777ecca765117a301c9fb5363a52373cfb0d84d9283594`.
- SDK SHA-256: `7a959bbd2ba01ade6b49d9f8fce49a13d0fa6f9252f091d6e332ee79989e73d6`, 725902 bytes.

The report formula bar tracks composition state. Apply, Enter and the delayed pointer fallback cannot commit a partial composition. Starting another composition cancels queued pointer activation; after composition ends, an explicit Apply commits final text and one undo restores the original value. Three real browser engines execute synthetic composition, mouse and keyboard events against the built example; this does not certify a native operating-system IME candidate window.

Cancelled-unload recovery is invalidated by newer input, successful Apply and report replacement. Recovery records are scoped to report generation. Unit regressions demonstrate that stale drafts cannot overwrite a newer input or reappear in a replaced report. Existing cancelled-unload restoration remains covered. The recovery record no longer retains an unused serialized workbook copy.

All 167 test files / 2369 tests pass. API, isolated SDK install/type checks, strict dependency inventory, site HTTP checks, entry-asset budgets, XLSX 5 and retained WPS fixture 4 checks pass. Chromium runs 52 checks, Firefox and WebKit 49 each (150 total) across 25 reports. Two deterministic builds produce identical site and SDK digests.

Native Safari refresh → Stay → first Apply remains unverified on this candidate. System IME candidate windows, real screen readers, physical touch, target hardware, broader Excel/WPS corpus, public npm publication and commercial legal review remain open. Version remains 0.29.0; no stable-release record or 1.0.0 tag is created.

# Lumina Sheets 0.29.0 candidate r30

Executed 2026-10-03 on macOS arm64 / Node 24.14.0 with source epoch 1790122493, runtime source commit 332ff2dc95d128bd476b8c75dc54cdb930fbc007. This is candidate regression evidence, not stable approval.

- Site SHA-256: `74fa5f999486a48fee36b443ec8baec28b895e47f7a39b71e4aa7998ce2a87e6`.
- SDK SHA-256: `76a96daef90ad0e09f88fbc5b5155e4c3836865dd18130730b9e0f1fd9294e48`, 725616 bytes.

The report formula input explicitly disables browser autofill, capitalization, correction and spell checking to avoid browser text assistance changing formulas. This is a browser input hint, not proof that every Safari autofill UI is suppressed. The r29 cancelled-navigation recovery and guarded pointer-release fallback remain in place.

All 167 test files / 2365 tests pass. API, isolated SDK install/type checks, strict dependency inventory, site HTTP checks, entry-asset budgets, XLSX 5 and retained WPS fixture 4 checks pass. Chromium runs 51 checks, Firefox and WebKit 48 each (147 total) across 25 retained reports. Two deterministic builds produce identical site and SDK digests.

A separate manual diagnostic attempt initially used a preview server without the Pages base path, causing asset 404s and a Chromium composition timeout. Those failed diagnostic reports are not retained as passing evidence. The final matrix used check-browser-core.mjs with the correct /lumina-sheets/ base path and all checks passed.

Native Safari attempts on r29 were interrupted by incorrect automation shortcut syntax opening autofill/Reader UI. No uninterrupted refresh → Stay → first Apply sequence was completed in this turn. This does not add native Safari acceptance or certify the input hints. Native Safari first-Apply, system IME candidate windows, real screen readers, physical touch, target hardware, broader Excel/WPS corpus, public npm publication and commercial legal review remain open. Version remains 0.29.0.

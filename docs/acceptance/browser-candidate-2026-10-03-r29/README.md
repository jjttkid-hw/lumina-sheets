# Lumina Sheets 0.29.0 candidate r29

Executed 2026-10-03 locally on macOS arm64 / Node 24.14.0 with source epoch 1790122493. This is candidate evidence, not stable approval.

- Site SHA-256: `2750e1ea50f27475ecae73fdf79e37a67e34b3d7b3c73d3a8388937591328639`.
- SDK SHA-256: `f6a67d9ffe9b3af03b4f82f16474056d5fad86791ab7ef4c5764fbf7facdc90f`, 725584 bytes.

The report example preserves the active sheet, selection and formula draft when Safari cancels a native beforeunload prompt and returns focus. The guarded 80 ms pointer-release fallback remains scoped to the original generation, sheet, cell and displayed draft; secondary buttons, disabled controls, pointer cancellation and pointer-leave are ignored. Delayed clicks are deduplicated and keyboard activation remains synchronous.

All 167 test files / 2365 tests pass. API, isolated SDK install/type checks, strict dependency inventory, site HTTP checks, entry-asset budgets, XLSX 5 and retained WPS fixture 4 checks pass. Chromium runs 51 checks, Firefox and WebKit 48 each (147 total) across 25 retained reports. Two deterministic builds produce identical site and SDK digests. Browser reports remain scoped to automated regression, synthetic composition events and simulated touch.

Native Safari 27 shows the real leave-page warning and draft retention after Stay; the current native session still needs an uninterrupted first-Apply verification against this r29 deployment. npm whoami remains E401, so no public npm publication or 1.0.0 tag is claimed. System IME candidate windows, real screen readers, physical touch, target hardware, broader Excel/WPS corpus and commercial legal review remain open gates.

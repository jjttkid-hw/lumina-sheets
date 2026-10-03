# Lumina Sheets 0.29.0 candidate r32

Executed 2026-10-03 on macOS arm64 / Node 24.14.0 with source epoch 1790122493.
Source checkout was based on 052d50a7fdba094bd84ffe46f5429437e7046bde with the
recorded pending runtime changes. This is regression evidence, not stable approval.

- Site SHA-256: `7e1c53a7791bc0eef950a510f81cc17056ec9ff1c8a356ea4b2c465055a97962`.
- SDK SHA-256: `b0ae6a1ef23aa47524b5677ebcb3023bbf56e4b7249e1f57e403cb6167403593`, 726106 bytes.

The formula-bar pointer activation is owned by the report generation, sheet,
cell and exact draft present at press time. Previously a press followed by a
selection/draft change before release could write the newer draft to the new
cell. A new unit regression reproduced the erroneous B1 setCell call before the
fix. Release fallback and detail-bearing click now refuse that stale activation.
Mouse compatibility events retain pointerdown ownership. A cancelled activation
cannot be revived by a late click after sheet switch, report replacement or
pointercancel. Explicit keyboard activation and a fresh pointer activation remain
available. Existing delayed-click deduplication and IME guards remain covered.

All 167 test files / 2372 tests pass. API, isolated SDK install/type checks,
strict dependency inventory, HTTP, entry-asset budgets, XLSX 5 and retained WPS
fixture 4 checks pass. Chromium executes 53 checks, Firefox and WebKit 50 each
(153 total), across 25 reports. The added real-browser check verifies changed
selection/draft and cancelled activation do not write, then actual mouse click
and keyboard Enter commit with a single undo restoring the original value.
Composition/pointercancel edge events are synthetic; they do not certify native
system IME or physical touch. Two builds produce identical site and SDK hashes.

The first exploratory browser run used the preceding intermediate build while
the final cancellation guard was being added; Firefox/WebKit correctly failed
the new pointercancel assertion. Those reports were discarded and every engine
was rerun against the final hashes above; only the final reports are retained here.

Native Safari mouse-cancel → first Apply remains an open gate; the independent
control investigation is recorded under safari-session-2026-10-03-r31. This fix
does not claim to repair that native input anomaly. System IME, real screen
readers, physical touch, target hardware, broader Excel/WPS corpus, public npm
publication and human commercial review remain open. Version remains 0.29.0;
no stable acceptance record or 1.0.0 tag is created.

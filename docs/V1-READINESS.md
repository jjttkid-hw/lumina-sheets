# Lumina Sheets v1.0 readiness

This page records the candidate evidence observed through 2026-09-28; deployment commit IDs
are dated observations, not a promise that they remain the newest main commit. Live
deployment identity is available in `build-info.json`. Historical candidate notes remain in
[V1-PLAN.md](V1-PLAN.md); they do not override the status below.

## Latest candidate verification

2026-10-01: [Candidate r23](acceptance/browser-candidate-2026-10-01-r23/README.md)
adds explicit confirmation before edited report replacement, repeated-header
regeneration and selected-file import. The Safari lifecycle fix uses `unload` teardown
and an empty legacy `beforeunload` return value. Cancellation preserves workbook, drafts and
history. All 2,356 unit tests and the full three-engine browser matrix pass locally.
The refreshed candidate is bound to site hash `a78d4012e8d98b5988ec9e9159d48510079611a2f0592c6b4740b20f330854` and
SDK hash `99c365d3eb312617776e8ee558633aeabffb0856c81c3bf32e738c59f2a3f2fe` (723347 bytes).
[The r22 follow-up](acceptance/r22-deployment-followup-2026-10-01/README.md)
retains successful CI/CD evidence and a native Safari reload attempt where no
cancellable prompt was observed and the draft was lost. Native Safari reload
protection remains open; headless close tests do not close it.
[Native Safari r23 follow-up](acceptance/safari-session-2026-10-01-r23/README.md)
verified cancellation of an edited-example switch retaining the formula draft.
A native reload warning was also observed, but external app changes prevented
verification of cancellation/retention. The reload gate remains open.

The candidate was pushed as commit [`27c6607`](https://github.com/jjttkid-hw/lumina-sheets/commit/27c66078fbee87ca9c4b527d37a4ec8b94f07110). GitHub [CI run 36817535027](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/36817535027) and [CD run 36817952787](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/36817952787) passed. Pages `build-info.json` reports version `0.29.0`, the same commit, and the site hash above.

2026-09-28: [Candidate r22](acceptance/browser-candidate-2026-09-28-r22/README.md)
adds the report example's persistent session notice and beforeunload protection for
edits, drafts and structure changes. It remains an in-memory demo. The rebuilt
site hash is `7eb51ec5a0190fbd66ad47bc7897722597362ae03070ba6bc784a5c7b096ec91`,
SDK hash `c1c854b73bf519fb9346332c5f76734e70ba542f838f4d85561cd26f633cc231`.
All 2,353 tests pass. Current evidence is archived with this candidate; r21 and
native Safari observations below remain valid only for their recorded artifacts.

2026-09-28 recovery addition: [r21 recovery reports](acceptance/recovery-2026-09-28-r21/README.md)
now include actual IndexedDB transaction abort, subsequent queued edit, explicit retry
and full page reload. All four recovery checks pass in Chrome, Firefox and WebKit
(12 checks total). This fault injection does not certify physical crash consistency.

The [unsaved-edit rescue follow-up](acceptance/unsaved-rescue-2026-09-28-r21/README.md)
also verifies actual JSON export while saving fails, import into an independent
browser context, and cancellation of a real beforeunload close dialog in all three
engines. Exported bytes contain both unsaved edits. Firefox automated reload did not
show a dialog; the passing check explicitly exercises close with beforeunload enabled.

2026-09-28: [Candidate r21](acceptance/browser-candidate-2026-09-28-r21/README.md) fixes duplicate XLSX rows overwriting earlier data. All 2,351 tests, 25 browser reports and 30 multi-sheet checks pass locally. Site SHA-256: `340a6a3426458159583bb7faa34edd82e796aa0fffceb13c27c63db32716d1a3`; SDK SHA-256: `8e150872f59d69b336ce5728d0f2835956e5ebdf43778a1fae3691f91fbc1885`. This supersedes r20 for the current source; the deployment observations below remain historical.

## Previous deployment observation

2026-09-28 update: commit `86d4510` passed [CI 36371934070](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/36371934070)
and [CD 36372262019](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/36372262019).
The retained [native Safari/WPS evidence](acceptance/safari-2026-09-28-r21/FOLLOWUP.md)
covers desktop editing and a two-sheet workbook roundtrip. The expanded WPS corpus
now has four passing checks. [Registry consumer verification](acceptance/registry-consumer-2026-09-28/README.md)
also exercises formulas and XLSX from the installed r21 archive through a local
HTTP registry fixture; public npm publication remains open (HTTP 404, local E401).
These observations do not close the native IME, screen-reader or other gates below.

2026-09-28 Safari evidence correction: the earlier r2/r15 notes that treated the
report example's refresh as persistence are withdrawn. After waiting for a complete
Safari navigation, the example returned to its default in-memory report, as its
implementation specifies. The new [native validation record](acceptance/safari-validation-2026-09-28/README.md)
confirms input-rule rejection, list validation, atomic invalid paste, valid batch
paste and undo/redo. The main workspace's local persistence remains a separate
verified path; SDK hosts and the report example must explicitly save `toJSON()` if
they need refresh recovery.

| Item | Evidence | Status |
| --- | --- | --- |
| Source and Pages deployment | Commit [`3ce9299`](https://github.com/jjttkid-hw/lumina-sheets/commit/3ce9299), [CI run 36373191960](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/36373191960), [CD run 36373536392](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/36373536392) | Passed |
| Site identity | `https://jjttkid-hw.github.io/lumina-sheets/build-info.json` → version `0.29.0`, commit `3ce9299`, site SHA-256 `340a6a3426458159583bb7faa34edd82e796aa0fffceb13c27c63db32716d1a3` | Passed |
| SDK artifact | Candidate r21, SDK SHA-256 `8e150872f59d69b336ce5728d0f2835956e5ebdf43778a1fae3691f91fbc1885` | Passed |
| Automated regression | 167 test files, 2,351 tests; API, package isolation, strict license and reproducibility gates | Passed |
| Real-browser automation | [Candidate r21](acceptance/browser-candidate-2026-09-28-r21/README.md): Chromium, Firefox and WebKit smoke, interaction, focus, layout, performance, ARIA, composition-event and persistence suites; Chromium touch simulation | Passed for the documented scope |
| File corpus | Candidate r21 XLSX and WPS reports, plus native Safari/WPS retained files | Passed for the documented subset |
| npm package | Public registry lookup for `lumina-report-sdk` currently returns 404; local `npm whoami` currently returns E401 | **Open** |

Supplemental evidence dated 2026-09-28: [multi-sheet acceptance](acceptance/multisheet-2026-09-28/README.md) adds 24 passing browser checks for cross-sheet editing/history and actual CSV/JSON/XLSX downloads and reimports, across both the site and SDK example. These reports bind the same r20 hashes above; CI now repeats the suite.

## v1.0 gates that are still open

These are release gates, not claims that the implementation is broken:

- npm first publication and an isolated install from the public registry;
- native system IME candidate-window testing, real screen-reader sessions (VoiceOver,
  NVDA or JAWS), and physical mobile touch testing;
- cross-device performance measurements using the target customer hardware matrix;
- a materially broader Excel/WPS business corpus and application-level comparison;
- human commercial redistribution and third-party license review.

The product therefore remains on the `0.29.0` development line. Creating a `1.0.0`
tag before every gate has evidence would make the version misleading and is blocked by
the release workflow's stable-acceptance check.

## What the current stable scope means

The verified scope is a browser ESM Canvas spreadsheet/reporting SDK with sparse
workbooks, bounded viewport paging, supported-subset formulas, validation, history,
JSON/CSV/XLSX/PDF paths, and the documented React/Vue/vanilla integration lifecycle.
The [support matrix](SUPPORT-MATRIX.md) is normative. It does not promise complete
Excel or SpreadJS compatibility, a server, collaboration, CommonJS, SSR Canvas
rendering, or a commercial SLA.

## Publication and stable release sequence

1. Bootstrap the still-unpublished package with an authenticated maintainer account:
   publish a verified 0.x archive explicitly to `next`, then verify the public
   tarball and isolated install. GitHub login alone cannot authorize npm.
2. Once the package exists, configure its npm Settings → Trusted Publishers with
   `jjttkid-hw / lumina-sheets / npm.yml / npm`. Subsequent versions may use OIDC.
   This repository contains the workflow; it does not prove the npm-side binding.
3. After the remaining platform and review gates close, prepare the intended 1.0.0
   version in a clean committed checkout, before creating its release tag. Build
   with a fixed `SOURCE_DATE_EPOCH` and run acceptance against the exact site and
   SDK archive. A 0.29.0 report cannot certify a new 1.0.0 artifact.
4. Record reviewed evidence in `docs/acceptance/stable-release.json`, commit it,
   rebuild with the same source epoch, and require the identical artifact hashes
   and `npm run check:stable` to pass. Then create the matching `v1.0.0` tag and
   Release; the publishing workflow must repeat its gates before publication.
5. Verify the published 1.0.0 tarball, `latest` tag and isolated install before
   announcing delivery. Do not move existing tags to pick up workflow fixes:
   the workflow checks out the release tag, not the current main source.

Trusted Publisher fields are recorded in
[NPM-TRUSTED-PUBLISHER.md](NPM-TRUSTED-PUBLISHER.md); no password, OTP or long-lived
token belongs in this repository.

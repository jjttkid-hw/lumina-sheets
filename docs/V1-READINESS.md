# Lumina Sheets v1.0 readiness

This page records the candidate evidence observed through 2026-10-04; deployment commit IDs
are dated observations, not a promise that they remain the newest main commit. Live
deployment identity is available in `build-info.json`. Historical candidate notes remain in
[V1-PLAN.md](V1-PLAN.md); they do not override the status below.

## Latest candidate verification

2026-10-04: [Candidate r41](acceptance/browser-candidate-2026-10-04-r41/README.md)
fixes direct scalar coercion for SUM/AVERAGE/MIN/MAX. All 2419 tests and 162
three-engine checks pass; site and SDK hashes are
`4e53d3de973b331e3ba63df1b3c840ac2e79fe88eb17f37bb44ce952b1839078` and
`409cb3657939fab6eef47c22163330d9d87958bc824272e756f5dc2fa049db23`.
External v1.0 gates remain open.

2026-10-03: [Candidate r39](acceptance/browser-candidate-2026-10-03-r39/README.md)
fixes approximate VLOOKUP/HLOOKUP duplicate thresholds, proven by 16 native WPS
results and a reopened SDK export. All 2417 tests and 162 three-engine core checks
pass; the installed business corpus has 12 checks. Site and SDK hashes are
`00987b73918c19b025b16edfa849d5512017266b9329a5aa3ba9779a856a6e99` and
`56ede0c174d3eb5293417db5c8a8c33cb655552abab0811e6041ae8433ef9fe3`.
The external stable gates below remain open; npm whoami still returns E401.

2026-10-03: [Candidate r38](acceptance/browser-candidate-2026-10-03-r38/README.md)
adds HLOOKUP to the safe formula subset with exact, approximate and wildcard
semantics, and lowers the recursive dependency guard so long chains return
`#NUM!` before a browser call-stack overflow. All 2412 tests pass; the current
candidate site and SDK hashes are `ae0091fa180c7e99804103637d489c81bb123e78b0b9ab1e7306ec4ccf044305`
and `166bead41426361ad7dcd264f29add2230d80c9700bf38f88ef40e25edfe84ab`.
The core browser and file suites actually reran against r38; native Safari
mouse, system IME, screen readers, physical touch, npm publication and human
commercial review remain open.

2026-10-03: [Native WPS quotation lookup corpus](acceptance/wps-lookup-2026-10-03-r37/README.md)
adds a second synthetic business workflow: three sheets, 70 cells and 28 formulas
with exact/approximate lookup, INDEX/MATCH, missing SKU, #N/A, discounts and wildcard
aggregation. Desktop edits and installed-SDK roundtrips agree; the shared CI/npm
corpus now runs 12 checks, including duplicate lookup thresholds. Runtime hashes are unchanged and external gates remain open.

2026-10-03: The stable gate now requires an independent human commercial-review
report bound to the candidate archive and its original packed inventory/notices.
A clean automated license inventory cannot substitute for that review. A [regression run](acceptance/commercial-gate-2026-10-03/README.md)
first reproduced the missing gate; all 2405 tests pass and no actual commercial approval is claimed.
Native Safari r37 mouse Stay → first Apply still leaves the committed value unchanged
under CUA; physical mouse confirmation remains pending, consistent with the r31
independent-control investigation. See [r37 native follow-up](acceptance/safari-session-2026-10-03-r37/README.md).


2026-10-03: [r37 native-file regression](acceptance/business-corpus-2026-10-03-r37/README.md)
extends the installed SDK business corpus to 9 cases. CI and npm release gates
now also reimport/roundtrip the retained WPS prompt and active-sheet files, compare
all 199 cells / 41 formulas in the active-sheet fixture against desktop caches,
and inspect the exported active-tab XML. Runtime and package hashes are unchanged.


2026-10-03: [Candidate r37](acceptance/browser-candidate-2026-10-03-r37/README.md)
preserves the active worksheet on XLSX export/import and selects only that tab.
The 42 multi-sheet browser checks now assert the restored active sheet in both
site and packaged SDK examples. Native WPS opens on 经营汇总, saves it and SDK
reimports that selection; all 199 cell results agree. WPS removes optional quotes
in two cross-sheet formulas, recorded explicitly. Native/external stable gates remain open.


2026-10-03: [Candidate r36](acceptance/browser-candidate-2026-10-03-r36/README.md)
adds optional selection input messages through the rule editor, Canvas, JSON and
XLSX. Disabled messages retain their content. Three browser engines exercise
selection, edit rejection, undo/redo, reload, real downloads/reimport, overlapping
rules and unobscured 390px rendering. Native WPS now also displays the prompt and saves a workbook that SDK reimports
with exact metadata and all original cell values/formulas. Retained files and a
regression cover this single synthetic case; native Excel and broader WPS cases
remain open.


2026-10-03: [Cloud workspace validation evidence](acceptance/workspace-validation-ci-2026-10-03-r35/README.md)
confirms all 18 workspace checks in Linux CI after correcting the runner's isolated
dependency resolution. CI 37108097392 and CD 37108507318 passed for commit 887ae73;
live build-info matches unchanged r35 hashes. Actual cloud downloads are retained
and independently checked for digests and exact JSON/OOXML content. A verifier
regression rejects missing/tampered evidence even when the wrong title is rehashed.
All 2390 tests pass. Runtime/API/package contents and external stable gates are unchanged.

2026-10-03: [Workspace rule-dialog acceptance](acceptance/workspace-validation-2026-10-03-r35/README.md)
adds 18 shipped-control browser checks on unchanged r35 artifacts. WPS import,
rule/title editing, undo/redo, durable reload, empty-title export/reimport, narrow
keyboard operation and exact metadata whitespace roundtrips pass in three engines.
CI now runs this workflow and retains actual XLSX/JSON downloads. Commit e376f5d
passed CI 37106530604 and CD 37106839749; the live build-info response agrees.
This does not close native, customer, npm or commercial stable gates.

2026-10-03: [Candidate r35](acceptance/browser-candidate-2026-10-03-r35/README.md)
adds optional WPS/XLSX Stop validation error titles and fixes error-title/message
whitespace and OOXML string-escape roundtrips. All 2389 tests and 162 three-engine
browser checks pass; actual title-bearing downloads are retained. Native WPS
rejects an invalid value with the original title/message, then saves a valid
change that SDK reimports with updated SUMIF totals. Local 100k/1m performance
budgets and two byte-identical builds pass. Site hash
`65e7f121db9a733a771a23428540ced85b3c30fdbd1a76f26324698e08e5d74d` and SDK hash
`e8c8042fab4032cc95a81d5a12551847792190ff6b63251fec47cf6e3aa517dc` (727127 bytes).
Native/customer/publication and commercial stable gates remain open; earlier
candidates below are historical.

2026-10-03: [Native WPS business corpus](acceptance/wps-business-2026-10-03-r34/README.md)
adds a three-sheet receivables/inventory/project-expense workflow on unchanged r34
artifacts. WPS recalculated and saved 22 formulas; the installed SDK agrees with
its caches, roundtrips them, exports edited values, and reimports a further native
WPS edit with correct cross-sheet totals. Seven installed-package checks now run
in CI and before npm publication, including two documented validation rejections.
This extends actual application evidence but does not close the broader Excel/WPS
customer corpus or other stable gates.

2026-10-03: [Explicit performance budgets](acceptance/performance-budgets-2026-10-03-r34/README.md)
supplement r34 without changing product artifacts. Both 100,000 and 1,000,000
stored-cell workloads pass the committed developer-desktop profile in Chromium,
Firefox and WebKit, using 40 target viewports and 30 separate edits per fixture.
Raw downloads and budget bytes are retained and independently revalidated.
All 2385 tests and the 159-check core rerun pass. CI now enforces its separate,
generous runner regression ceilings; customer hardware/SLA and competitor
comparison gates remain open. See [methodology](PERFORMANCE-BUDGETS.md).

2026-10-03: [Candidate r34](acceptance/browser-candidate-2026-10-03-r34/README.md)
refuses conflicting workspace journal retry identities instead of silently
selecting the last-read edit. Identical reordered retries still deduplicate.
All 2379 tests and 159 three-engine checks pass; actual IndexedDB conflicts retain
the base and both raw rows, and real recovery downloads contain the exact stores.
Site hash `eee2b027616215ce2e1f76ab13d97956d8529d597acffa890b75ee0491a02820`
and SDK hash `5afed7f6e3ae70291f1f000836395453af082ecd3fff61bfab14085e2d4b366c`
(726258 bytes) agree across two builds. This is workspace-local recovery, not SDK
persistence or automatic conflict reconciliation. External stable gates remain
open; the following candidates are historical.

2026-10-03: [Candidate r33](acceptance/browser-candidate-2026-10-03-r33/README.md)
coalesces formula-draft localStorage writes over 150 ms while preserving synchronous
committed-change, beforeunload and teardown flushes. A roughly 1 MB unit fixture
reproduces the previous 40 writes per 40-input burst. All 2374 tests and 156
three-engine checks pass; immediate actual reload recovers the latest uncommitted
draft. Site hash `0c9a21e19854fb946053a0851ce92ba3ac73e1dfbe5f9a86b3121e499ef36864`
and SDK hash `263e31fd130b1239b160b3fa8ac30b5099eba5ac326652815b78e39155102b82`
(726253 bytes) agree across two builds. Forced process termination during the
150 ms draft window is not guaranteed to recover the last input. External stable
gates remain open; the following candidates are historical.

2026-10-03: [Candidate r32](acceptance/browser-candidate-2026-10-03-r32/README.md)
fixes formula-bar activation ownership across selection/draft changes and cancels
late clicks across pointercancel, sheet switch and report replacement. A failing
regression reproduced the wrong-cell write before the fix. All 2372 tests and 153
three-engine checks pass; two builds agree on site `7e1c53a7791bc0eef950a510f81cc17056ec9ff1c8a356ea4b2c465055a97962`
and SDK `b0ae6a1ef23aa47524b5677ebcb3023bbf56e4b7249e1f57e403cb6167403593`
(726106 bytes). Native input/platform and publication gates remain open. The
following records are historical and do not certify r32 native behavior.

2026-10-03: [Native r31 event investigation](acceptance/safari-session-2026-10-03-r31/README.md)
reproduces mouse-cancel → first Apply failing on both the deployed example and an
independent page containing no Lumina code. The diagnostic page observes release
before down with no final release/click. Escape cancellation → first Apply passes
on the unmodified live product and the independent control. This narrows the
cause but does not distinguish Safari from native input delivery; a physical
mouse/trackpad run is still required. The mouse gate stays open. Runtime artifacts
remain r31; an additional regression protects against committing an incomplete
activation. npm authentication still returns E401.

2026-10-03: [Candidate r31](acceptance/browser-candidate-2026-10-03-r31/README.md) prevents partial composition commits and invalidates stale cancelled-unload recovery after new input, Apply or report replacement. All 2369 tests, 150 three-engine checks and two identical builds pass. Site hash is `f454ab2f96a424e195777ecca765117a301c9fb5363a52373cfb0d84d9283594`; SDK hash is `7a959bbd2ba01ade6b49d9f8fce49a13d0fa6f9252f091d6e332ee79989e73d6` (725902 bytes). Native Safari first Apply and external stable gates remain open. The following candidates are historical.

2026-10-03: [Candidate r30](acceptance/browser-candidate-2026-10-03-r30/README.md) adds explicit formula-input browser text-assistance hints. All 2365 tests, 147 three-engine checks and two identical builds pass. Site hash is `74fa5f999486a48fee36b443ec8baec28b895e47f7a39b71e4aa7998ce2a87e6`; SDK hash is `76a96daef90ad0e09f88fbc5b5155e4c3836865dd18130730b9e0f1fd9294e48` (725616 bytes). Native Safari first Apply remains unverified; input hints do not close that gate. The following candidate records are historical.

2026-10-02: [Candidate r29](acceptance/browser-candidate-2026-10-03-r29/README.md)
adds cancellation recovery for Safari beforeunload prompts and retains the guarded pointer-release fallback. All 2365 tests, 147 three-engine browser checks and two identical builds pass locally. Site hash is `2750e1ea50f27475ecae73fdf79e37a67e34b3d7b3c73d3a8388937591328639`; SDK hash is `f6a67d9ffe9b3af03b4f82f16474056d5fad86791ab7ef4c5764fbf7facdc90f` (725584 bytes). npm authentication still returns E401. Version remains 0.29.0. The following r27 details are historical context.

2026-10-01: [Candidate r27](acceptance/browser-candidate-2026-10-01-r27/README.md)
adds latest-sheet/selection recovery and cached workbook serialization during
draft typing and view navigation. Storage rejection and the local recovery size
limit produce explicit export warnings. The candidate is bound to site hash
`939ce1eb3268e6a623ed126367fe4ac17040319a5a1385fd1dca989d62dcd110` and SDK hash
`7586704641638f54423083490cb588ba9ae8b2684c295ba9e2f12f09ea68be74`
(724638 bytes). All 2,362 tests and the documented three-engine matrix pass locally.
This browser-local copy is not SDK persistence, server backup or cross-device sync.
The preceding r23/r24 notes remain historical records.
[The r22 follow-up](acceptance/r22-deployment-followup-2026-10-01/README.md)
retains successful CI/CD evidence and a native Safari reload attempt where no
cancellable prompt was observed and the draft was lost. Native Safari reload
protection remains open; headless close tests do not close it.
[Native Safari r23 follow-up](acceptance/safari-session-2026-10-01-r23/README.md)
verified cancellation of an edited-example switch retaining the formula draft.
A native reload warning was also observed, but external app changes prevented
verification of cancellation/retention. The r23 reload gate remained open at that time.
[Native Safari r27 session follow-up](acceptance/safari-session-2026-10-01-r27/README.md)
now confirms actual native warnings, Stay retaining drafts, accepted full reload
restoring committed cells, and separate recovery of uncommitted formula drafts.
However, the first Apply click after Stay was consumed in three runs (two AX clicks
and a screenshot-grounded coordinate click); a second click or Return committed the
retained draft. This unresolved interaction keeps the broader Safari gate open.

The r23 candidate was originally pushed as commit [`ee6d7f2`](https://github.com/jjttkid-hw/lumina-sheets/commit/ee6d7f2159b5f4b6bad4561034cacda2d24bcdae), with GitHub [CI run 36830251153](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/36830251153) and [CD run 36830831858](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/36830831858) passing. The accepted r23 Pages deployment is recorded in the table below; documentation-only commits may advance the live `build-info.json` without changing the tested site bytes. The historical candidate remains useful evidence but does not by itself identify the current deployment.

The [r24 Pages manual record](acceptance/manual-pages-2026-10-01-r24/README.md)
also exercises the deployed multi-sheet example: editing `销售明细!C2` changes
`经营汇总!B2` from `8,199,000` to `8,299,000`, and undo restores the original
value. This is a narrow manual path and does not close the native-platform gates.

2026-09-28: [Candidate r22](acceptance/browser-candidate-2026-09-28-r22/README.md)
adds the report example's persistent session notice and beforeunload protection for
edits, drafts and structure changes. The example now restores its edited snapshot
and formula draft from same-origin browser storage after reload; this remains a
demo-level local copy rather than SDK or server persistence. The rebuilt
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
| Source and Pages deployment | Commit [`92670db`](https://github.com/jjttkid-hw/lumina-sheets/commit/92670db334ff499ea4900dfaaeccae8073dbcd68), [CI run 36858240934](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/36858240934), [CD run 36858835989](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/36858835989) | Passed |
| Site identity | `https://jjttkid-hw.github.io/lumina-sheets/build-info.json` → version `0.29.0`, commit `92670db`, site SHA-256 `939ce1eb3268e6a623ed126367fe4ac17040319a5a1385fd1dca989d62dcd110` | Passed |
| SDK artifact | Candidate r27, SDK SHA-256 `7586704641638f54423083490cb588ba9ae8b2684c295ba9e2f12f09ea68be74` (724638 bytes) | Passed |
| Automated regression | 167 test files, 2,362 tests; API, package isolation, strict license and reproducibility gates | Passed |
| Real-browser automation | [Candidate r27](acceptance/browser-candidate-2026-10-01-r27/README.md): Chromium, Firefox and WebKit smoke, interaction, focus, layout, performance, ARIA, composition-event and persistence suites; Chromium touch simulation | Passed for the documented scope |
| File corpus | Candidate r27 XLSX and WPS reports, plus native Safari/WPS retained files | Passed for the documented subset |
| npm package | Public registry lookup for `lumina-report-sdk` currently returns 404; local `npm whoami` currently returns E401 | **Open** |

Supplemental evidence: [multi-sheet acceptance](acceptance/multisheet-2026-09-28/README.md) adds 24 passing browser checks for cross-sheet editing/history and actual CSV/JSON/XLSX downloads and reimports, across both the site and SDK example. The [r24 Pages manual record](acceptance/manual-pages-2026-10-01-r24/README.md) independently verifies the deployed cross-sheet edit, recalculation and undo path on the current Pages commit.

## v1.0 gates that are still open

These are release gates, not claims that the implementation is broken:

- npm first publication and an isolated install from the public registry;
- native system IME candidate-window testing, real screen-reader sessions (VoiceOver,
  NVDA or JAWS), and physical mobile touch testing;
- cross-device performance measurements using the target customer hardware matrix;
- a materially broader Excel/WPS business corpus and application-level comparison;
- human commercial redistribution and third-party license review. The automated
  dependency evidence gate currently passes with 0 errors, 0 review items and 0
  unresolved bundled components; this does not replace the human legal review.

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

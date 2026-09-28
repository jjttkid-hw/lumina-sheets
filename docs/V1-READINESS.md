# Lumina Sheets v1.0 readiness

This page records the candidate evidence observed on 2026-09-24; deployment commit IDs
are dated observations, not a promise that they remain the newest main commit. Live
deployment identity is available in `build-info.json`. Historical candidate notes remain in
[V1-PLAN.md](V1-PLAN.md); they do not override the status below.

## Current candidate

| Item | Evidence | Status |
| --- | --- | --- |
| Source and Pages deployment | Commit [`8ecfc7c`](https://github.com/jjttkid-hw/lumina-sheets/commit/8ecfc7c), [CI run 35950642882](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35950642882), [CD run 35951022424](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35951022424) | Passed |
| Site identity | `https://jjttkid-hw.github.io/lumina-sheets/build-info.json` → version `0.29.0`, commit `8ecfc7c`, site SHA-256 `af75fb282b72a6a8498510b97ffae36f672577754e8a1e4048e914015977831c` | Passed |
| SDK artifact | Candidate r20, SDK SHA-256 `e2af24d67fda8af3ed26e27a24a7f4b2e17249aa741ff0212357fa652ac2fa64` | Passed |
| Automated regression | 167 test files, 2,347 tests; API, package isolation, strict license and reproducibility gates | Passed |
| Real-browser automation | [Candidate r20](acceptance/browser-candidate-2026-09-24-r20/README.md): Chromium, Firefox and WebKit smoke, interaction, focus, layout, performance, ARIA, composition-event and persistence suites; Chromium touch simulation | Passed |
| File corpus | Candidate r20 XLSX and WPS reports | Passed for the documented subset |
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

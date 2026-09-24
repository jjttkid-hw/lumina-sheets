# Lumina Sheets v1.0 readiness

This page is the short, current release ledger. Historical candidate notes remain in
[V1-PLAN.md](V1-PLAN.md); they do not override the status below.

## Current candidate

| Item | Evidence | Status |
| --- | --- | --- |
| Source and Pages deployment | Commit [`38f48d3`](https://github.com/jjttkid-hw/lumina-sheets/commit/38f48d3), [CI run 35948294862](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35948294862), [CD run 35948777963](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35948777963) | Passed |
| Site identity | `https://jjttkid-hw.github.io/lumina-sheets/build-info.json` → version `0.29.0`, commit `38f48d3`, site SHA-256 `af75fb282b72a6a8498510b97ffae36f672577754e8a1e4048e914015977831c` | Passed |
| SDK artifact | Candidate r20, SDK SHA-256 `e2af24d67fda8af3ed26e27a24a7f4b2e17249aa741ff0212357fa652ac2fa64` | Passed |
| Automated regression | 167 test files, 2,347 tests; API, package isolation, strict license and reproducibility gates | Passed |
| Real-browser automation | [Candidate r20](acceptance/browser-candidate-2026-09-24-r20/README.md): Chromium, Firefox and WebKit smoke, interaction, focus, layout, performance, ARIA, composition-event and persistence suites; Chromium touch simulation | Passed |
| File corpus | Candidate r20 XLSX and WPS reports | Passed for the documented subset |
| npm package | Public registry lookup for `lumina-report-sdk` currently returns 404; local `npm whoami` currently returns E401 | **Open** |

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

## Release sequence after the open gates close

1. Rebuild from a clean tag with the configured `SOURCE_DATE_EPOCH`.
2. Re-run the candidate browser and file evidence against that exact site and SDK
   digest.
3. Publish the first package version through the configured npm Trusted Publisher,
   then verify the public tarball and isolated install.
4. Prepare `docs/acceptance/stable-release.json` from the reviewed evidence and run
   `npm run check:stable` before creating the matching `v1.0.0` tag.

Trusted Publisher fields are recorded in
[NPM-TRUSTED-PUBLISHER.md](NPM-TRUSTED-PUBLISHER.md); no password, OTP or long-lived
token belongs in this repository.

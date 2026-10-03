# Browser performance budgets

The performance laboratory exports raw local measurements. The browser acceptance
runner can additionally judge them against an explicit profile. This does not
change the UI report's unqualified measurement status or establish a customer SLA.

```sh
BROWSER_PERFORMANCE_BUDGET_FILE=scripts/fixtures/performance-local-budget.json \
  BROWSER_CHANNEL=bundled node scripts/check-browser-core.mjs
```

Two profiles are committed before running acceptance:

| Profile | Stored cells | First data draw | Canvas paint P95 | Commit-to-Canvas P95 | Worker round trip |
| --- | --- | --- | --- | --- | --- |
| Local desktop reference | 100,000 | 1,500 ms | 16.7 ms | 50 ms | 1,000 ms |
| Local desktop reference | 1,000,000 | 5,000 ms | 16.7 ms | 50 ms | 5,000 ms |
| CI regression guard | 100,000 | 5,000 ms | 50 ms | 150 ms | 5,000 ms |
| CI regression guard | 1,000,000 | 15,000 ms | 50 ms | 150 ms | 15,000 ms |

Local targets apply only to the recorded developer machine. CI uses generous
ceilings for shared GitHub Linux runners to detect large regressions; it is not a
60 FPS target. Customer devices must have their own reviewed profile and runs.
Budgets are ceilings, not measurements, and are not calibrated against SpreadJS.

Each fixture contains ten populated columns and one formula per populated row,
inside a logical million-row sheet. The runner waits for 40 painted target
viewports and commits 30 separate edits to A1. Its final formula sentinels must
match 54 and the fixture's last value. It recomputes P95 from the raw retained
samples and rejects missing, dropped, inconsistent or nonfinite samples. Passing
functional assertions alone cannot pass a configured latency budget. Exceeding
any ceiling fails the performance suite and CI.

`artifacts/browser-performance/<engine>/result.json` records the full profile,
its SHA-256, measured values and any exceeded limits. It links each actual
downloaded `fixture-*-after-edit.json` by SHA-256. Without a profile the status is
`not-configured`; an incomplete configured run is `failed`, never passed.
The raw `budget.json` is retained alongside the downloads. CI runs
`node scripts/check-browser-performance-evidence.mjs <engine-report-directory>`
to independently verify file hashes and recompute the judgement from the raw
samples. The summary's passed flag alone is insufficient evidence.

Canvas paint timing excludes other browser work, so 16.7 ms does not prove 60 FPS.
Edit latency starts at committed edit, not physical keypress. Initial draw and
Worker calculation are single samples, not P95; the Worker round trip uses data
already resident in that worker. Browser memory counters omit Worker heaps.
The range benchmark is an isolated formula workload and remains a separately
measured result; this profile does not budget it. Native devices, application-level
Excel/WPS comparisons and competitor baselines remain open v1.0 work.

# Explicit browser performance budgets on candidate r34

Executed 2026-10-03 on Apple M5 Pro, 15 logical CPUs, 24 GiB memory,
macOS arm64, Node 24.14.0, bundled headless browser engines. This supplements
[r34](../browser-candidate-2026-10-03-r34/README.md); product artifacts are unchanged.

- Site SHA-256: `eee2b027616215ce2e1f76ab13d97956d8529d597acffa890b75ee0491a02820`.
- SDK SHA-256: `5afed7f6e3ae70291f1f000836395453af082ecd3fff61bfab14085e2d4b366c` (726258 bytes).
- 168 test files / 2385 tests pass. The three-engine core rerun passes 159 checks.
- Each fixture samples 40 target viewports and 30 separately committed edits.
  Both 100,000 and 1,000,000 stored-cell workloads pass the explicit local desktop
  profile. Original downloaded reports and exact budget bytes are retained here.

| Engine | Million-cell first draw | Canvas paint P95 | Commit-to-Canvas P95 | Worker round trip |
| --- | --- | --- | --- | --- |
| Chromium 143.0.7499.4 | 1583.1 ms | 2.2 ms | 7.4 ms | 487.8 ms |
| Firefox 144.0.2 | 1534 ms | 4 ms | 7 ms | 1925 ms |
| WebKit 26.0 | 1618 ms | 4 ms | 12 ms | 483 ms |

Browser versions in each result are authoritative. First draw and Worker are
single samples, not distributions. Canvas paint P95 is not full-frame timing or
FPS. Editing starts at commit, not physical keypress. Both density and logical
sheet boundaries are recorded; this is not a fully dense million-row workbook.
These developer-machine results do not close the customer hardware performance,
native Safari, system IME, screen reader, physical touch or competitor gates.

The independent evidence checker passes for all three engine directories:

```sh
node scripts/check-browser-performance-evidence.mjs docs/acceptance/performance-budgets-2026-10-03-r34/chromium
node scripts/check-browser-performance-evidence.mjs docs/acceptance/performance-budgets-2026-10-03-r34/firefox
node scripts/check-browser-performance-evidence.mjs docs/acceptance/performance-budgets-2026-10-03-r34/webkit
```

It verifies profile/raw download hashes and recomputes the judgement from raw
samples. Synthetic tests reject rehashed over-budget measurements, cancelled or
insufficient samples and falsified P95 summaries. CI uses the separately committed
CI regression profile; its remote result must be observed after pushing.
See [budget methodology](../../PERFORMANCE-BUDGETS.md) for scope and ceilings.
The initial build caught a multiline TypeScript suppression placement error in
the added test; after correction all tests and two deterministic builds passed.

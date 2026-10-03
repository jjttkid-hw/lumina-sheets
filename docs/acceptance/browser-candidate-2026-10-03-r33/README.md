# Lumina Sheets 0.29.0 candidate r33

Executed 2026-10-03 on macOS arm64 / Node 24.14.0 with source epoch 1790122493.
Source checkout was based on 079e851e892625397a8843318a203944439885a3 with the
recorded pending runtime changes. This is regression evidence, not stable approval.

- Site SHA-256: `0c9a21e19854fb946053a0851ce92ba3ac73e1dfbe5f9a86b3121e499ef36864`.
- SDK SHA-256: `263e31fd130b1239b160b3fa8ac30b5099eba5ac326652815b78e39155102b82`, 726253 bytes.

Formula draft input previously synchronously wrote the entire cached workbook
string to localStorage on every key. The retained before-fix regression observes
40 extra writes for a burst of 40 input events on an approximately 1 MB workbook.
The report example now coalesces those draft events over 150 ms. A draft immediately
sets leave protection and remains in memory; the latest draft flushes synchronously
on committed edits, selection/sheet navigation, beforeunload and teardown. Report
replacement clears its pending timer. Cached workbook serialization still avoids
recloning the workbook for each draft input. This is example-local recovery, not
SDK persistence or crash-consistency certification: a forced process/OS kill in
the delay window can lose the latest uncommitted input.

Unit regression verifies zero immediate writes, one write after the burst, no
workbook clone during typing, immediate beforeunload flush without a duplicate
queued save, teardown flush and replacement cancellation. All 167 test files /
2374 tests pass. Three real browsers instrument only the example's storage writes:
40 synchronous input events produce one saved draft, then an immediate actual
reload restores a newer uncommitted draft while the committed value stays intact.
Existing storage rejection, composition and pointer ownership checks still pass.
This does not measure a physical typing latency budget or claim competitor parity.

Chromium executes 54 checks, Firefox and WebKit 51 each (156 total) across 25
reports. API, isolated SDK install/type checks, strict dependency inventory,
HTTP, entry-asset budgets, XLSX 5 and retained WPS fixture 4 checks pass. Two builds
produce identical site and SDK hashes. An exploratory browser run was stopped
when a license check run without the fixed epoch rewrote inventory timestamps;
hash gates detected that mutation. The fixed-epoch builds were rerun and every
engine was rerun against the unchanged final artifacts above. Only final reports
are retained in this candidate.

Native Safari mouse-cancel first Apply, native system IME, real screen readers,
physical touch, target hardware, broader Excel/WPS business corpus, public npm
publication and human commercial review remain open. Version remains 0.29.0;
no stable acceptance record or 1.0.0 tag is created.

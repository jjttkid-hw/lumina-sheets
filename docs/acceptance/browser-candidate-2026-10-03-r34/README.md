# Lumina Sheets 0.29.0 candidate r34

Executed 2026-10-03 on macOS arm64 / Node 24.14.0 with source epoch 1790122493.
Source checkout was based on d6e11e37d362328ea32652fb568f686614f055de with the
recorded pending runtime changes. This is regression evidence, not stable approval.

- Site SHA-256: `eee2b027616215ce2e1f76ab13d97956d8529d597acffa890b75ee0491a02820`.
- SDK SHA-256: `5afed7f6e3ae70291f1f000836395453af082ecd3fff61bfab14085e2d4b366c`, 726258 bytes.

Workspace journal replay previously deduplicated records by keeping the last
record read for each edit identity. A regression first reproduced two differing
payloads with the same modern operation ID or legacy sequence silently resolving
to the second edit. Replay now compares duplicate identities and refuses a
conflicting patch, sequence or timestamp rather than choosing one arbitrarily.
Identical retries remain deduplicated; property insertion order and storage
transport fields do not change edit identity. Comparison is iterative and only
runs for repeated identities; existing 5000-patch replay/untouched-sheet bounds
remain covered. Read failure preserves the base snapshot and raw journal for
recovery. This is the main workspace persistence layer, not automatic SDK storage.

All 167 test files / 2379 tests pass. Chromium runs 55 checks, Firefox and WebKit
52 each (159 total), across 25 reports. The added browser check seeds two distinct
IndexedDB rows with one operation ID and differing edits, observes the actual
startup recovery UI with no grid opened, verifies the unchanged base and both
raw records, downloads a real backup, compares its raw stores to IndexedDB and
verifies the download has not modified the database. Original synthetic test
backup downloads are retained beside each persistence report with recorded
SHA-256 values. This fault injection does not certify physical crash consistency
or promise automatic reconciliation of conflicting data.

API, isolated SDK install/type checks, strict dependency inventory, HTTP,
entry-asset budgets, XLSX 5 and retained WPS fixture 4 checks pass. Two builds
produce identical site and SDK hashes. An initial reproducibility attempt correctly
failed because its browser test source was still being edited; after source was
frozen, both builds and every browser engine were rerun successfully. Only the
final reproducibility and browser reports are retained here.

Native Safari mouse-cancel first Apply, native system IME, real screen readers,
physical touch, target hardware, broader Excel/WPS business corpus, public npm
publication and human commercial review remain open. Version remains 0.29.0;
no stable acceptance record or 1.0.0 tag is created.

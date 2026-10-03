# Lumina Sheets 0.29.0 candidate r39

Executed 2026-10-03 on macOS arm64 / Node 24.14.0, SOURCE_DATE_EPOCH=1790122493.
This is regression evidence, not stable approval.

- Site SHA-256: 00987b73918c19b025b16edfa849d5512017266b9329a5aa3ba9779a856a6e99.
- SDK SHA-256: 56ede0c174d3eb5293417db5c8a8c33cb655552abab0811e6041ae8433ef9fe3, 728365 bytes.

VLOOKUP/HLOOKUP approximate lookup now selects the last candidate less than or
equal to the query, including equal duplicates. Exact lookup still selects the
first match. The [native WPS fixture](../wps-lookup-duplicates-2026-10-03-r39/README.md)
retains 16 independently computed results and a WPS-resaved SDK export.

All 2417 tests in 174 files pass. The current extracted SDK passes TypeScript
NodeNext/Bundler, ESM and package checks. XLSX, WPS and business corpora reran with
5, 4 and 12 checks. Chromium, Firefox and WebKit actually reran 162 checks in 25
reports against these site/package bytes, including semantic accessibility and
synthetic composition events. Reports are copied byte-for-byte from the final run.
Local raw performance samples are retained; no budget profile was configured.

An initial browser run overlapped a rebuild and the packed SDK example timed out
while files were replaced. It was stopped and rerun after the builds settled;
only that complete passing run is archived. An initial repeat-build check also
rejected changing documentation inputs while reports were being copied. The
retained repeat-build run occurred after those copies and passed with identical
site/package bytes. Its actual base commit, input inventory and dirty state are
preserved without rewriting provenance.

No new native Safari, framework, system IME, screen-reader or physical touch
acceptance is claimed. Customer hardware, broader Excel/WPS comparison, public
npm publication and independent human commercial review remain open. Version
remains 0.29.0. Cloud CI runs the framework and other integrations separately.

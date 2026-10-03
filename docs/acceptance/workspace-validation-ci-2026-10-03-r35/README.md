# Cloud workspace validation evidence on unchanged r35 artifacts

Observed 2026-10-03. Commit 887ae73e4f7d5dc998c3861696f932860e668d10 passed
[CI 37108097392](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/37108097392)
and [CD 37108507318](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/37108507318).
The retained live build-info response agrees on version 0.29.0, that commit and
site SHA-256 65e7f121db9a733a771a23428540ced85b3c30fdbd1a76f26324698e08e5d74d.
SDK archive SHA-256 remains e8c8042fab4032cc95a81d5a12551847792190ff6b63251fec47cf6e3aa517dc.
These are dated observations, not stable acceptance or a newest-commit promise.

The framework-browser-reports artifact was downloaded from that exact CI run.
All 18 workspace rule checks passed on Ubuntu Chromium/Firefox/WebKit; the actual
XLSX/JSON downloads, source variant and 390px screenshots are retained under
reports. The artifact-bound independent verifier also passed for every engine.
It checks exact check lists, error channels, version/site/package/source identity,
seven downloads per engine, download digests, JSON rule title/message/blank flag/
range/list and preserved D2, original XLSX metadata independent of SDK decoding,
the source variant and PNG dimensions. Full-browser behavior is established by
the originating run; the verifier cannot establish human perception or physical input.

The prior run 37107662083 failed before browser launch because the isolated
framework job lacked root ExcelJS/JSZip. Commit 887ae73 corrected tool dependency
resolution and inspected original OOXML instead, without weakening title/message
assertions. The subsequent run completed all jobs successfully.

Verifier fault injection uses real retained evidence. Missing checks, missing
files, changed bytes, a wrong title with a newly computed report hash, and a
wrong-width PNG all reject. All 170 files / 2390 tests pass after adding this
regression. The verifier now runs in CI immediately after the browser workflow.
Runtime/API/package contents remain unchanged; original r35 remains the candidate.
Native IME, real assistive technology, physical mobile touch, customer hardware,
broader native Excel/WPS business cases, npm first publication and human commercial
review remain open.

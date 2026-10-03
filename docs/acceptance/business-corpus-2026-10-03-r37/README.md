# r37 installed-package native workbook regression

Executed 2026-10-03 against `lumina-report-sdk@0.29.0`, SHA-256
`3fb97d4fe24e7e557831650d0780ae10288a2dbf96994daca227ff3e27c6c01e`.
The runtime candidate remains r37. This is a supplemental regression record.

`scripts/check-business-corpus.mjs` now checks 9 cases (previously 7), using the
SDK extracted from the distributable tarball outside the source checkout.
Both existing CI and npm release workflows already run this script.

The retained native WPS prompt workbook from r36 is checked for its exact title,
body, display flag, error title, cell value and calculated approved total before
and after a new SDK XLSX roundtrip. The downloaded active-sheet workbook from r37
is checked against WPS's saved values: all 199 stored cells and 41 formulas,
including shared followers, match desktop caches after import and roundtrip.
The active sheet remains 经营汇总; the exported original OOXML independently
records activeTab=1 and selects only sheet2. Revenue is 8299000 and profit 4312000.
Input fixture digests are pinned in the runner; source fixtures stay in the
original candidate directories. Exported files and report hashes are retained here.

The comparison reads WPS-produced caches with ExcelJS; it does not regenerate
expected values using Lumina. It does not launch WPS in CI or certify native Excel,
other desktop versions, arbitrary customer workbooks, or v1.0. Native observations
are documented separately in the r36 and r37 candidate directories.

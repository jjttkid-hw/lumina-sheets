# Native WPS quotation and lookup acceptance

Executed 2026-10-03 on macOS with WPS Office 12.1.26055 and the actual
Lumina 0.29.0 npm archive extracted to an isolated directory. SDK SHA-256:
`3fb97d4fe24e7e557831650d0780ae10288a2dbf96994daca227ff3e27c6c01e`.
Runtime/site remain candidate r37; this is supplemental desktop-file evidence.

The synthetic quotation has three sheets, 70 nonempty cells and 28 formulas:
cross-sheet exact VLOOKUP, approximate quantity-discount VLOOKUP, INDEX/MATCH,
IFERROR, a real #N/A cache, ROUND, SUM, COUNTIFS and wildcard SUMIF. It has no
customer data. The generator writes formulas without cached answers. source.xlsx
was regenerated with that same generator after retaining the desktop outputs;
its ZIP identity is not claimed to equal the originally opened source archive.

1. Opened the generated input through Finder in native WPS. WPS calculated the
   initial total 1297.38, valid bulk quotes 3 and A-series units 161. Saved using
   Command-S and retained wps-saved.xlsx and the cropped wps-opened.png.
2. Imported with the extracted SDK; every formula agreed with WPS caches and
   independent expected values, including zero, text and #N/A. Export/reimport
   preserved formulas, all nonempty cell addresses and literal values, frozen
   first rows and the active quotation sheet.
3. SDK changed B3 from 10 to 50; the discount became 10% and total 1590.25.
   Opened its export in native WPS without an observed repair dialog. The WPS
   formula field confirmed B3=50. Changed B3 to 100 using native input, saved
   and retained wps-reedited.xlsx; screenshot wps-reedited.png shows 15%,
   line amount 701.25, total 1920.25 and A-series units 251.
4. Reimported that native edit with the installed SDK and exported/reimported
   again. All 28 formulas agree with independent WPS caches and expected answers.
   ExcelJS independently reads every formula result from both SDK exports,
   including the typed error result. Installed-corpus.json retains this run.

The existing CI and npm workflows call scripts/check-business-corpus.mjs, now
11 checks. Both native inputs have pinned SHA-256 values; complete nonempty cell
key sets are compared to avoid missing data loss through one-sided iteration.
The generator alone is not desktop evidence; CI consumes the retained files
and does not run WPS. Cropped screenshots omit other document tabs.

This verifies a second synthetic business workflow, not all lookup semantics,
customer corpus coverage, native Excel or complete WPS/SpreadJS compatibility.
Fonts and exact number formats normalize within the documented SDK categories.
No runtime change was needed. Native IME/screen reader/physical touch, customer
hardware, npm publication and actual commercial review remain open.

# Native WPS business workbook acceptance on r34

Executed 2026-10-03 with WPS Office 12.1.26055 (build 26055), macOS,
and Lumina 0.29.0 installed SDK from the r34 archive.

- Site SHA-256: `eee2b027616215ce2e1f76ab13d97956d8529d597acffa890b75ee0491a02820`.
- SDK SHA-256: `5afed7f6e3ae70291f1f000836395453af082ecd3fff61bfab14085e2d4b366c`.
- No product runtime changes were needed; this expands actual application evidence.

The synthetic three-sheet fixture covers receivables, inventory and project
expenses: leading-zero IDs, multiline Chinese/emoji text, leap-year dates,
fractional dates, positive/zero/negative balances, ROUND, SUM, SUMIF, SUMIFS,
COUNTIF, SUMPRODUCT, IF text results, cross-sheet references, frozen header rows,
landscape print settings and a Stop list-validation rule. It contains 22 formulas.
It contains no customer records.

1. Generated fresh formulas without cached results using the committed
   `scripts/fixtures/create-business-corpus.mjs` script. Opened the file through
   Finder into native WPS; WPS calculated it. Saved with Command-S and retained
   `wps-business-saved.xlsx`. Screenshots show initial totals: receivables
   1600.25, inventory 448.5, project net 1625.31. The initial screenshots came
   from the otherwise identical nonblocking-validation variant.
2. Extracted the actual npm archive to an isolated temporary directory. Its SDK
   imported the retained file; all 22 formulas agreed with the independent WPS
   caches, including a zero cache verified directly in worksheet XML.
3. Imported/exported/reimported without edits; values, formulas, text, dates,
   frozen rows, print orientation and list rule remained within supported scope.
4. Edited receivables D2 from 200.5 to 300.5 and inventory E2 from 12 to 20 in
   the SDK, then exported. Results changed to receivables 1500.25, inventory
   348.5, net 1425.31. Opened the export in native WPS without a repair dialog.
5. In WPS, actually changed receivables D2 to 400.5. The desktop recalculated
   receivables to 1400.25 and project net to 1325.31. Saved, retained
   `wps-reedited-export.xlsx`, imported it with the SDK and roundtripped again;
   all 22 formulas agreed. Cropped screenshots retain only the synthetic workbook.

Two real WPS-saved rejected files are also retained: the nonblocking validation
variant rejects with the documented Stop-policy limitation; the Stop rule with
custom title rejects with the documented unsupported-title limitation. These
are negative corpus checks, not claims that either feature is implemented. They
must not be silently converted to a different rule. The final supported fixture
uses Stop with a message and no custom title. The corpus runner checks fixed
SHA-256 values before using each retained input.

`node scripts/check-business-corpus.mjs` runs seven checks against the final
installed archive in CI and before npm publication. `installed-corpus.json`
records this observed run; future executions write under artifacts. CI does not
operate WPS; it consumes the archived desktop outputs.

This is one additional synthetic business workflow, not complete Excel/WPS
compatibility or a materially complete customer corpus. Font family and exact
number-format/typography are not claimed preserved: source WPS used Songti,
Lumina's exported default was Aptos, and numeric formatting normalized to the
supported categories. There was no runtime fix or feature expansion in this
turn. Native Safari/IME, real screen reader, physical touch, customer hardware,
public npm and commercial review gates remain open.

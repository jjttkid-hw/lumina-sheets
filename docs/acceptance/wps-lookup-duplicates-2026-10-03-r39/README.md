# Native WPS duplicate lookup thresholds

Executed 2026-10-03 on macOS using WPS Office 12.1.26055. The synthetic
single-sheet fixture has 51 nonempty cells and 16 formulas. It has no customer data.

The input has ascending numeric thresholds 0, 10, 10, 20, 20 in both orientations,
with distinct old/new labels. `source.xlsx` is the original ExcelJS-generated
input without formula caches (SHA-256 fb3db58ec614dd0d3226f5685d6cf25a95ef21f8efddcc167e358910aaf18b55).
It was copied before native save and restored byte-for-byte afterward.

1. Opened the dedicated input through Finder in native WPS, saved using Command-S,
   and retained `wps-saved.xlsx` (SHA-256 61f05edcc0c1d8aadfb36b7058f8a085951e6f19afb6df8b9e7e0a6af01da15e).
   `wps-results.png` shows the result area and formula field; unrelated document
   tabs are cropped out.
2. Native VLOOKUP and HLOOKUP exact matches at 10/20 return the first duplicate;
   approximate matches and the omitted fourth argument return the last duplicate.
   Query 15 returns the second 10 label, 99 returns the second 20 label, and -1
   produces a typed #N/A cache. The previous SDK returned the first duplicate for
   exact-equal approximate queries. Both formula handlers now continue searching
   approximate candidates and retain the last candidate less than or equal to the query.
3. The installed current SDK import, export and reimport agree with all 16 native
   caches and independently expected values, formula text and complete nonempty
   cell key sets. ExcelJS independently checks exported formula caches and error types.
4. Opened the SDK export in native WPS without an observed repair dialog, saved,
   and retained `wps-resaved-sdk.xlsx` (SHA-256 2992dacdee3af47ee2e67cd94e189abf98483b181f3725d0ae74e5319008e763).
   The independently decoded native caches still agree. `wps-roundtrip.png`
   retains the reopened result area.

The shared installed-package business corpus now has 12 checks, including this
retained pair of native files with pinned digests. Five added test cases also
cover selected-result errors, cycles and managed/unmanaged dependency invalidation.
Search errors still propagate if read; only exact lookup stops on its first match.

This establishes these sorted numeric duplicate scenarios, not full Excel/WPS
certification, unsorted inputs, mixed-type compatibility or a customer workbook corpus.
Native IME/screen reader/physical touch, customer hardware, npm publication and
human commercial review remain open. The SDK remains a 0.29.0 development candidate.

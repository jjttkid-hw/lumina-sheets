# Lumina Sheets 0.29.0 candidate r36

Executed 2026-10-03 on macOS arm64 / Node 24.14.0, source epoch 1790122493.
Based on 6720feb with the recorded pending runtime changes. Regression evidence,
not stable approval or full SpreadJS compatibility.

- Site SHA-256: `1d1de63660dd8b913d2f4a65cbf0ea2564ae5b06f957c64fe360a999297dd8a4`.
- SDK SHA-256: `0a61ce477b392a7d7ebab099283b9b389f3d13bc782cbf48bc737eae702bc151`, 728046 bytes.

Rules now accept optional promptTitle (32 UTF-16 units), prompt (255 units) and
showInputMessage. Only explicit true displays nonempty content for a selected
single cell. Multiple matching rules display in order; multi-cell selection and
nonmatching sheet bindings do not display prompts. React renders text literally.
Disabled and omitted display flags retain original text; XLSX/JSON roundtrips
preserve empty strings, CR/LF, tabs and literal OOXML escape-shaped text. Existing
Stop error titles and invalid-edit rejection continue to work. Lookup scans at
most the bounded rule collection, never expands logical cells.

All 2394 tests in 171 files pass. Core browser regression passes 162 checks in
25 reports (56 Chromium, 53 Firefox, 53 WebKit). Input-prompt controls add 18
checks and the existing workspace rule suite adds another 18. Actual downloaded
JSON/XLSX files, browser versions, hashes and screenshots are retained per engine.
Prompt checks cover configuration, selection, undo/redo, rejection, durable reload,
disabled export/reimport/re-enable, overlapping rules, sheet binding, range
selection and 390px visibility. Narrow checks close navigation and insights panels
then verify hit-testing reaches the visible prompt, not just its bounding box.
Screenshots were inspected. Browser automation does not certify physical input.

Two builds agree byte for byte; public API changes are only three optional rule
fields and two limits in lib/data-validation.d.ts. Installed SDK checks, HTTP,
bundle budgets, XLSX 5 / WPS 4 / business 7 corpus checks pass. All three engines
pass the explicit local developer-desktop 100k/1m performance profile; retained
raw evidence is revalidated. This is not a customer SLA or competitor benchmark.

WPS 12.1.26055 also opened the prompt workbook without repair and visibly showed the title/body in `项目费用!D2`; the observation is retained in `native-wps-input-prompt/result.json`. It did not save/reimport this prompt-specific copy, and does not certify Excel or other WPS versions. The r35 native WPS
error-title evidence remains historical and is not relabeled as prompt evidence.
Native Safari mouse-cancel first Apply, native IME, screen readers, physical touch,
customer hardware, broader desktop corpus, npm publication and commercial review
remain open. Version stays 0.29.0, without a stable record or 1.0.0 tag.

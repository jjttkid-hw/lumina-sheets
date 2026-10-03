# Lumina Sheets 0.29.0 candidate r35

Executed 2026-10-03 on macOS arm64 / Node 24.14.0 with source epoch 1790122493.
Source checkout was based on 36bea07747cb67bb4c8bb21200af613646dd3d18 with the
recorded pending runtime changes. This is regression evidence, not stable approval.

- Site SHA-256: `65e7f121db9a733a771a23428540ced85b3c30fdbd1a76f26324698e08e5d74d`.
- SDK SHA-256: `e8c8042fab4032cc95a81d5a12551847792190ff6b63251fec47cf6e3aa517dc`, 727127 bytes.

Previously, the retained WPS Stop validation file with a custom error title was
rejected. Optional errorTitle now survives JSON, XLSX, rule-editor changes and
SDK/workspace edit errors. Title length is limited to 32 UTF-16 units. Failure
objects retain a separate title and message; missing titles keep the old formatted
prompt. A failing regression also reproduced CR/LF loss through ExcelJS's XML
attribute serialization. Export now writes original metadata with OOXML string
escapes and XML attribute references; import decodes once. Regression covers
Unicode, literal escape-shaped text, CR/LF, tab, control units and title bounds.
Input prompts and non-Stop modes remain unsupported and explicitly rejected.

All 169 files / 2389 tests pass. Chromium runs 56 checks, Firefox and WebKit
53 each (162 total), across 25 reports. Each engine imports the exact retained
WPS file, edits D2 through the visible editor, sees its original title and message
on rejection, corrects the value, downloads actual XLSX and reimports it.
Downloads are retained with SHA-256 values in the reports. Seven installed-package
business checks pass, including the new successful custom-title roundtrip,
independent ExcelJS title reading, and the remaining non-Stop rejection.
The older r34 business evidence retains its then-current rejection result.

Native WPS 12.1.26055/build 26055 opens the SDK-generated synthetic workbook
without a repair dialog and rejects invalid D2 with the visible title 审批状态
and message 请选择通过、待审或拒绝. Escape restores 通过. A valid paste/edit to 待审
was saved in WPS and reimported by SDK, retaining title/message/value and updated
SUMIF C6=299.99. Both before/after workbooks and cropped screenshots are retained
under native-wps-title. Initial direct text input did not change D2; the documented
successful edit used F2/select-all/paste and confirmed the saved value. This is
one synthetic desktop case, not native Excel or arbitrary Unicode UI certification.

Two builds agree byte for byte. API diff contains only the title bound, two
optional title fields and one formatter in lib/data-validation.d.ts. Isolated SDK
install/type checks, dependency inventory, HTTP, bundle budgets, XLSX 5 and WPS 4
corpus checks pass. The 100k/1m stored-cell performance fixtures pass the explicit
local developer-desktop profile in all three engines; raw samples/budget bytes
are retained and independently revalidated. This is not a customer SLA or
physical-input/competitor benchmark.

Native Safari mouse-cancel first Apply, native IME, real screen readers, physical
touch, target customer hardware, broader Excel/WPS corpus, public npm publication
and human commercial review remain open. Version remains 0.29.0; no stable
acceptance record or 1.0.0 tag is created.

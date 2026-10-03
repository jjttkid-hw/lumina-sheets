# Workspace validation acceptance on candidate r35

Executed 2026-10-03 on macOS arm64 / Node 24.14.0, using the unchanged r35
site `65e7f121db9a733a771a23428540ced85b3c30fdbd1a76f26324698e08e5d74d`
and SDK tgz `e8c8042fab4032cc95a81d5a12551847792190ff6b63251fec47cf6e3aa517dc`.
This supplements candidate r35; no runtime or package files changed.

18 checks pass: six each in Chromium, Firefox and WebKit. The runner operates
shipped workspace file inputs, rule configuration, formula bar, history buttons,
export menu and native download events. It does not install workbooks by injecting
SDK calls or modifying application state. Page evaluation only reads visible state.

- Import the retained WPS custom-title file; check range/list/title/message;
  change allowBlank, save and reject invalid input with original heading.
- Edit heading, save, reject invalid input, undo and redo the rule change.
- Wait for durable save, actually reload, reopen the rule; export XLSX/JSON and
  independently inspect the ExcelJS title/message and JSON rule.
- Clear heading, verify default error format, download XLSX/JSON, import the actual
  downloaded workbook and confirm the title stays empty and message stays intact.
- At 390px, use the real navigation backdrop and close the data-insight panel
  before reopening the dialog. Type past 32 units to exercise the browser limit,
  Tab to message, save with keyboard, reopen and close with Escape. Screenshots
  show the narrow dialog; no page horizontal overflow was observed.
- Generate a title/message variant of the retained WPS file with CR/LF, tab,
  emoji and protected literal OOXML escape-shaped text. Import it, change only
  allowBlank, save and compare exact JSON text; download XLSX, import that download
  and compare exact JSON again. Original and all downloaded files are retained.

Initial runs had incorrect exact label locators, and a reimport wait raced the
old rule dialog. Final run uses accessible role names and waits for the new visible
workbook heading. Narrow tests initially hit the sidebar/insight overlays; the
final path uses visible controls to close them, without forced clicks or hidden
state mutation. Final reports retain no page/console/run errors.

Candidate r35 commit e376f5d8f836c9178cf8bca774358479caf9eb06 passed
[CI 37106530604](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/37106530604)
and [CD 37106839749](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/37106839749).
The retained live build-info response matches that commit, version 0.29.0 and site
hash. This is a dated deployment observation; later evidence commits may redeploy.

This is browser automation on synthetic files, not native system IME, real screen
reader, physical touch, customer hardware or full Excel/WPS compatibility acceptance.
npm first publication and the other v1 stable gates remain open.

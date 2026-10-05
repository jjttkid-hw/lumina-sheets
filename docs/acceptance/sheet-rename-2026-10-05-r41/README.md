# Workspace sheet rename on candidate r41

Executed 2026-10-05 on macOS arm64 / Node 24.14.0 with the unchanged r41
site SHA-256 `4e53d3de973b331e3ba63df1b3c840ac2e79fe88eb17f37bb44ce952b1839078`
and SDK SHA-256 `409cb3657939fab6eef47c22163330d9d87958bc824272e756f5dc2fa049db23`.
This supplements r41 and does not change product/runtime/package files.

The runner `scripts/check-sheet-rename-browser.mjs` operates the shipped file
input, rename dialog, address field, sheet tabs, history buttons and export menu.
It uses real downloads and a fresh browser context per engine; page evaluation
only observes DOM state and layout. Six checks per engine pass in bundled
Chromium, Firefox and WebKit, with no page, console or run errors:

- Cancel, duplicate name and invalid character rejection leave every cell and
  worksheet name unchanged in the actual JSON download.
- Rename Data to O'Brien 数据, verify quoted cross-sheet formulas and qualified
  internal links, preserve formula string literals, local links and external URLs;
  the visible Summary A1 result remains 7.
- Undo restores original cell contents; redo restores the renamed references.
- Wait for local durable save, reload and compare an actual JSON download.
- Export XLSX, reimport the download through the file picker, compare the visible
  result and all relevant formula/link metadata in the next JSON download.
- At 390 x 844, enter the dialog by normal controls, verify contained focus, Tab
  to the name, submit with Enter, reopen and close with Escape. The dialog fits
  horizontally; screenshots are captured after its entry animation finishes.

Each engine directory retains result.json, six JSON downloads, one XLSX and
the narrow screenshot. The report binds the executed runner, synthetic fixture,
site, SDK, and downloaded bytes. sha256-manifest.json inventories the retained
evidence. CI runs the same script on its already-built artifacts and retains
artifacts/browser-sheet-rename/ in framework-browser-reports.

Initial runs used an incorrect autofocus assumption and did not close the
responsive navigation overlay before reopening the dialog. These were corrected
using the actual focus order and visible navigation control, without forced
clicks or injected application state. Early screenshots caught the entry animation;
the final run waits for animation completion before capture.

This is automated synthetic-workbook evidence. It does not certify desktop
Excel/WPS, native IME candidate windows, screen readers or physical touch. npm
publication and the remaining stable gates are still open.

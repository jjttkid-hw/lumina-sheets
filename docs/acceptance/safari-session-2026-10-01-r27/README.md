# Native Safari report session — r27

Executed 2026-10-01 on Safari 27.0 / macOS 26.7 (25G227), using native
application controls against the deployed Pages report. No page scripts or
synthetic composition events were injected. The new test tabs were closed after
the observations were saved; unrelated pre-existing tabs were left open.

- URL: `https://jjttkid-hw.github.io/lumina-sheets/examples/report.html?r27-native`
- Source: `92670db334ff499ea4900dfaaeccae8073dbcd68`, version 0.29.0.
- Site SHA-256: `939ce1eb3268e6a623ed126367fe4ac17040319a5a1385fd1dca989d62dcd110`.
- SDK SHA-256: `7586704641638f54423083490cb588ba9ae8b2684c295ba9e2f12f09ea68be74`.
- CI 36858240934 and CD 36858835989 passed; retained API responses and
  deployed identity are beside this record.

## Verified paths

1. Native typing replaces the A1 formula-bar draft with `Safari-r27-draft`.
   Cmd+R displays Safari's actual leave-page warning with Stay/Leave buttons.
   Stay retains the draft and the committed value `月份`. Return subsequently
   commits the draft; the grid cell and result both become `Safari-r27-draft`.
2. Cmd+R and Leave complete a real reload: the restored-session notice appears,
   and A1/result remain `Safari-r27-draft`. This observation waits for the new
   document and recovery notice, rather than treating an unchanged page as reload.
3. A new uncommitted formula draft `Safari-r27-uncommitted` is typed. Cmd+R and
   Leave restore that draft while the committed result stays `Safari-r27-draft`.
   Clicking Apply after this reload successfully commits the recovered draft.
4. Another native draft `Safari-r27-cancel-click` triggers the actual warning.
   Stay again retains the draft, with committed value `Safari-r27-uncommitted`.

## Open first-click observation

Immediately after either Stay action, the first native accessibility click on
Apply did not change the cell. Keyboard Return worked after the first cancellation;
after the second cancellation a second Apply click committed the exact retained
draft. The page continued rendering and reporting metrics throughout. Apply after
an accepted reload worked on its first observed click.

A third run on a newly opened `?r27-pointer` tab used screenshot-grounded native
coordinate clicks rather than AX element clicks. Stay retained `Safari-r27-pointer`;
the first pointer click again left the old result `Safari-r27-cancel-click`, and
the second committed `Safari-r27-pointer`. This reproduces the symptom using both
control methods; it does not identify whether Safari or page event handling caused
the first click to be consumed. It is not recorded as a passing first-click
interaction and still needs event-level investigation.
Cancellation and draft retention are now evidenced for this narrow path, while
the broader Safari interaction gate remains open.

## Evidence and limits

`ax-observations.json` contains actual tool-returned accessibility states/diffs,
including the native warnings, drafts, committed values and new-document recovery
notices. Browser chrome and unrelated tab inventory are omitted from the retained
text. Screenshots are actual captures cropped below the browser tab strip to
avoid including unrelated tabs. Their surrounding page still shows the formula
bar, result and Canvas cell.

These observations do not close system IME candidate-window, VoiceOver, physical
mobile touch, target hardware, full Excel/WPS, npm or commercial-review gates.
Undo history across a full reload was not tested or promised.

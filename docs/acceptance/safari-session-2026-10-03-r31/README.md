# Native Safari cancellation event investigation — r31

Executed 2026-10-03 on Safari 27.0 / macOS 26.7 using native application
controls. This record separates the unmodified deployed product from local
diagnostic and control pages. It does not approve a stable release.

- Live URL: `https://jjttkid-hw.github.io/lumina-sheets/examples/report.html?r31-native`.
- Live source: `b57df4aad397a654ebe5292a4fe5260f9442a5c4`, version 0.29.0.
- Site SHA-256: `f454ab2f96a424e195777ecca765117a301c9fb5363a52373cfb0d84d9283594`.
- SDK SHA-256: `7a959bbd2ba01ade6b49d9f8fce49a13d0fa6f9252f091d6e332ee79989e73d6`, 725902 bytes.
- CI 37098883745 and CD 37099188615 succeeded before this native investigation.

## Unmodified live product

Native typing replaced the B2 draft with `Safari-r31-first-apply`. The actual
Cmd+R leave-page warning appeared. Clicking Stay retained the draft and old
committed result `云端协作`. The first accessibility click on Apply left that
result unchanged; a second screenshot-grounded coordinate click committed the
exact draft. First Apply after mouse cancellation is **not passed**.

A separate live run typed `Safari-r31-escape-first`, opened the actual refresh
warning and cancelled with **Escape**. The retained draft was then committed on
the first native Apply click; both B2 and the result changed to that exact text.
This is a passing narrow keyboard-cancellation path, not a passing mouse path.
Native shortcuts used `super+a` and `super+r`; prior incorrectly named shortcut
attempts are not counted as refresh or text replacement.

## Event diagnostic on a local copy

The local page at `127.0.0.1:4381/lumina-sheets/examples/report.html` copied r31
`dist` and appended only `diagnostic-overlay.html` before `</body>`. Its original
application assets were unchanged. The overlay records capture-phase events in
a readonly textarea; it does not call Apply, change focus or prevent events.
The local modified page is diagnostic evidence, not production acceptance.

After mouse-clicking Stay, both a first AX Apply and a separate first coordinate
Apply produced this suffix (columns: type, target, button, detail, active element):

```text
pointerup:apply:0:0:formula
mouseup:apply:0:0:formula
pointerdown:apply:0:1:formula
mousedown:apply:0:1:formula
blur:formula::0:BODY
```

There was no final release or click in the returned state, and the committed
result stayed unchanged. A second click completed release/click and committed
once. Cancelling with Escape instead produced the normal down → up → click order
and first Apply committed `native-escape-first`.

## Independent control experiment

`minimal-beforeunload.html` contains a text input, plain click handler, event log
and standard beforeunload protection. It imports **no Lumina code** and has no
session restoration, composition tracking or pointer fallback.

On this control page, mouse Stay followed by first native Apply produced the
same release-before-down suffix and left `Committed: initial` unchanged. A second
Apply committed `control-mouse-cancel; count: 1`. A subsequent Escape-cancel run
committed `control-escape-cancel; count: 2` on its first Apply with normal event
order. Thus the observed anomaly is not specific to Lumina's event handlers.
This does not distinguish a Safari defect from native automation delivery or
prove how a physical mouse behaves. A human mouse/trackpad run remains necessary.

The regression in `tests/report-example.test.ts` protects against interpreting
an early release followed only by a down as a completed activation. It retains
the draft, commits once on the next complete click and undoes once to the prior
value. Product behavior was not changed to submit on mousedown.

## Retained evidence and limits

`ax-observations.json` contains actual tool-returned states/diffs; browser chrome
and unrelated tab inventory are omitted. Five screenshots are actual captures
cropped below the browser tab strip. Local overlay/control source is retained
for reproduction and is not included in the distributed SDK or demo.

The mouse-cancel first-click gate stays open. This record does not close native
system IME, screen readers, physical touch, target hardware, broader Excel/WPS
or commercial-review gates. npm `whoami` still returned E401 on 2026-10-03; no
package was published and no 1.0 tag or stable acceptance record was created.

## Verification of this evidence/test-only follow-up

The targeted report suite passes 40 tests and formatting passes. Rebuilding with
`SOURCE_DATE_EPOCH=1790122493` preserves the exact r31 site hash, and the existing
25 browser reports pass the build-bound evidence check. These checks do not
reclassify the mouse-cancellation failure as a passing product interaction.

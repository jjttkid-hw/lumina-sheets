# Native Safari report session observation — r23

Executed 2026-10-01 using native Safari app controls on macOS. Page:
`http://127.0.0.1:4273/lumina-sheets/examples/report.html?r23`.
It was served from the fixed, already-tested production dist, not the development
source server. No files were rebuilt during this native check.

- Source: `0b32af5155beb603447b0645c6541e741f0727c8`, version 0.29.0.
- Site SHA-256: `a1079cf0390664f68b413e4923c3daa0d33585eaac828bd25bf08d130d825d0c`.
- SDK SHA-256: `6be2438b27dd8ce790f8be0126fbff5c58440494a2ac6440e0e38572bd7470c4`.

## Verified replacement cancellation

The initial formula bar A1 was 月份. Direct native typing changed its uncommitted
draft to `Safari-r23-draft`; the committed value and selected cell remained 月份,
and the edited-session notice appeared. Clicking 多工作表 displayed the actual
Safari modal with the text explaining that continuing discards edits/drafts.
Clicking 取消 returned to 行式明细: one sheet, committed value 月份, and formula bar
`Safari-r23-draft`. This passes the observed native draft/switch-cancellation path.
It does not cover all import, repeat-header or undo cases in Safari.

## Partial reload observation

Cmd+R displayed a native Safari warning: 来自“127.0.0.1”：确定要离开此页面吗？,
with 留在页面 and 离开页面 buttons. The attempted click on 留在页面 returned an
external-app-change error. Subsequent reads showed unrelated tabs and a changing
tab inventory, preventing a reliable follow-up read of the tested report.
The native warning was observed; cancellation and retention after reload are
**unverified**, so the full native Safari reload acceptance gate remains open.
The non-empty legacy return-value change may have helped, but this evidence does
not isolate causality or prove a fix for the earlier r22 reload loss.

Original AX states remain in task tool history. No raw AX files or screenshots
were fabricated. No exports or account actions were performed in this check.

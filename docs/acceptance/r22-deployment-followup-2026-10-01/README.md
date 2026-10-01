# r22 deployment follow-up and Safari observation

r22 source: `9ee852f6a14136f6182bcc3696fb9b6911797d7e`, version `0.29.0`.
[CI 36375452147](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/36375452147)
and [CD 36375780595](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/36375780595)
completed successfully on 2026-09-28. Deployment identity was read again on 2026-10-01.

- Site SHA-256: `7eb51ec5a0190fbd66ad47bc7897722597362ae03070ba6bc784a5c7b096ec91`.
- SDK SHA-256: `c1c854b73bf519fb9346332c5f76734e70ba542f838f4d85561cd26f633cc231`, 722409 bytes.
- CI Linux x64 / Node 24.21.0 built twice in a clean checkout; both site and archive
  hashes match the macOS candidate. Retained result states its exact scope.
- Downloaded CI reports retain 72 React/Vue development/production checks,
  36 multi-sheet checks and 12 recovery checks. Recovery evidence and real downloaded
  files were checked again after download. CI uses headless Chromium/Firefox/WebKit.

## Native Safari observation on 2026-10-01

Loaded the online report in a new Safari tab using the native app controls.
The persistent in-memory notice appeared. In the two-sheet example, selected
销售明细 C2 (100000), then pasted a formula-bar draft 200000. The edited-session
notice appeared, draft was 200000, and committed value remained 100000.

After Cmd+R, the UI tool returned a capture-size error. The next completed AX read
showed the default one-sheet report and no draft. No cancellable native confirmation
was observed. This attempt therefore does **not** pass native Safari reload protection.
It does not prove whether Safari suppressed a dialog, the input automation lacked
browser activation, or another UI event intervened. The automated close tests remain
separate evidence and do not certify this reload path.

A subsequent paste returned unrelated clipboard content; no file was exported or
uploaded from that attempt. Direct typing later visibly produced the intended
`Safari-session-check` draft, but submitting it returned an external-app-change
error. That submission is unverified. Original AX observations remain in task tool
history; this record does not manufacture screenshots or raw AX files.

This follow-up does not close native IME candidate-window, real screen-reader,
physical touch, target-hardware performance, broad desktop Excel/WPS, npm first
publication or commercial license-review gates.

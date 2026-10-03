# Native Safari r37 mouse-cancel follow-up

Executed 2026-10-03 on native Safari 27.0 / macOS 26.7 through CUA, on the deployed
report example with query `r37-native`. Live build-info is retained: commit
0ea6842819d21b234e9f0d73d6c6e90ba4f2889e, site SHA-256
065a4d88796f1575c3c44ead8c466b7009df15dfa200767eb48c732a251196e6.
SDK candidate: 3fb97d4fe24e7e557831650d0780ae10288a2dbf96994daca227ff3e27c6c01e.

The new Safari tab restored the prior synthetic local report. B2 held
Safari-r31-escape-first. Native focus/select-all/paste entered the new draft
Safari-r37-mouse-first. Cmd+R displayed the real native leave-page dialog.
Clicking 留在页面 kept the draft and old committed result. The first AX click on
应用 still left the committed result Safari-r31-escape-first; the page retained
the draft. This path is **not passed**. No second click was used to disguise the
first-click failure. The user was asked to perform a physical mouse/trackpad run;
no response has yet been recorded.

The r31 independent plain-JS control reproduced the same release-before-down
anomaly, so this observation alone cannot distinguish Safari from CUA event
delivery or establish physical mouse behavior. No product event workaround was
added. Native IME, screen readers, physical touch and other stable gates remain
open. AX product observations and a screenshot cropped below browser chrome are
retained; unrelated tab titles are omitted. This is a failed narrow observation,
not a new accepted runtime candidate.

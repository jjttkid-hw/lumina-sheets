# Firefox save-burst CI failure investigation

CI 37114278377, commit 0ea3a518adf711ccc11d8ff5f6b69676fa2fee77:
Linux Firefox 144.0.2 failed only report-draft-save-coalescing-reload with a
5-second waitForFunction timeout. The raw report does not identify which wait
failed. Screenshot shows burst draft 39 and the old committed value; the session
notice still says restored. The core report retains the failure; all seven other
Firefox suites passed. CD did not deploy this failed run.

On the same unchanged r37 runtime hashes, local macOS Firefox smoke passed all
12 checks in five consecutive runs. A fault-injection run then forced the save
assertion to fail: the report captured the phase and storage state, restored the
Storage interceptor in a `finally` block, and all later checks still passed. This
does not explain or erase the Linux failure. No timeout or product assertion was
relaxed and no runtime change was made. Cloud follow-up CI 37114765396 (commit 2406947) passed on the same
runtime hashes; its report is retained as ci-followup-smoke.json. Later CI
37115540429 (4140fcb) and CI 37116436946 (73ba6c0) also passed. The original cause
remains unproven.

The five repeated runs, fault-injection report and final smoke are now retained
alongside the original failure. The injected-failure report must remain failed;
it proves diagnostic/cleanup behavior, not product acceptance. On 2026-10-03 an
audit found that a prior README edit had not updated this directory manifest.
Only that stale README entry changed; the original CI failure report/screenshot
bytes remained intact. The manifest now includes the supplemental raw reports.

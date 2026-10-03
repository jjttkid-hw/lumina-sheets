# Firefox save-burst CI failure investigation

CI 37114278377, commit 0ea3a518adf711ccc11d8ff5f6b69676fa2fee77:
Linux Firefox 144.0.2 failed only report-draft-save-coalescing-reload with a
5-second waitForFunction timeout. The raw report does not identify which wait
failed. Screenshot shows burst draft 39 and the old committed value; the session
notice still says restored. The core report retains the failure; all seven other
Firefox suites passed. CD did not deploy this failed run.

On the same unchanged r37 runtime hashes, local macOS Firefox smoke passed all
12 checks. This does not explain or erase the Linux failure. No timeout or
assertion was relaxed and no runtime change was made. The smoke runner now
captures readyState, draft, committed result, notice, write lengths and persisted
draft/selection whenever this check fails. These fields contain only the isolated
synthetic browser fixture. The next cloud run must provide fresh evidence; the
cause remains unproven at the time of this record.

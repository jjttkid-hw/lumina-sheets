# Stable commercial review gate regression

2026-10-03, local macOS checkout, Node/npm test runner. This is automated
release-policy verification, **not a human commercial approval**.

A regression reproduced acceptance of a synthetic stable ledger without the
previously documented commercial review. Stable release now requires its own
human review report, bound to the archive and original packed inventory/notices.
Tests reject missing, automated, incomplete, stale and pending reports, including
an actual CLI invocation with a pending decision and recomputed ledger digest.
Synthetic passed reports exist only in tests and temporary test archives.

- All 2405 tests in 172 files passed, including 28 stable-release tests.
- Source/test formatting passed.
- r37 browser evidence verified: 25 reports, 178 manifest files; installed package
  and site hashes unchanged. No new native/browser pass is claimed.
- No stable-release ledger or actual commercial approval was created.

Retained logs below document this run. CI also runs these tests on pushed commits.

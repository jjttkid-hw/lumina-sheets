# Core browser CI integration

Executed 2026-10-01 locally on macOS arm64 using the locked Playwright 1.57.0 toolchain against the unchanged r26 site and SDK. All 25 suites / 144 checks passed. The report source files and engine summaries are retained here.

The new CI matrix downloads the validated site and npm archive, starts an ephemeral local Pages-base preview, and runs these suites independently for Chromium, Firefox and WebKit. It deletes stale reports before launching each suite, requires successful exit and matching artifact hashes, and uploads results even after failures. CD requires the entire CI run to pass.

This integration does not certify native Safari, system IME candidate windows, real assistive technology, physical mobile devices, target customer hardware, public npm publication or commercial review. Performance reports contain measurements and functional checks without a cross-machine latency pass/fail threshold. Remote CI results must be checked separately after pushing.

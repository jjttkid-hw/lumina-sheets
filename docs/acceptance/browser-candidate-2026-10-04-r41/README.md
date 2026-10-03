# Lumina Sheets 0.29.0 candidate r41

Executed 2026-10-04 after the direct aggregate argument coercion fix. Site SHA-256: `4e53d3de973b331e3ba63df1b3c840ac2e79fe88eb17f37bb44ce952b1839078`. SDK SHA-256: `409cb3657939fab6eef47c22163330d9d87958bc824272e756f5dc2fa049db23` (728421 bytes).

The formula engine now converts direct scalar text/boolean arguments for SUM, AVERAGE, MIN and MAX while preserving strict range/reference behavior. Full tests: 2419 tests in 174 files passed.

Chromium, Firefox and WebKit core reports were rerun serially against this build after a complete site and SDK build; 162 checks passed. React/Vue integration, API, license, XLSX, WPS and 12-check business corpus validations passed. Reproducibility passed with dirty=false and identical site/package bytes. Firefox’s 1,000,000-cell sample is retained from the serial run; an overlapping local run timed out and was not archived.

This is regression evidence, not stable approval. Native IME, screen readers, physical touch, public npm publication and independent human commercial review remain open.

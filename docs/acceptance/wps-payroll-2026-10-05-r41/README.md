# Native WPS payroll workbook acceptance on candidate r41

Executed 2026-10-05 on macOS arm64 with WPS Office and the installed Lumina
0.29.0 SDK from the r41 archive. This is a synthetic payroll and cash-control
workflow; it contains no employee records.

The four-sheet workbook covers parameters, payroll detail, department summaries
and cash reconciliation. It contains 51 formulas and 119 non-empty cells:
`ROUND`, `SUM`, `COUNTIF`, `SUMIF`, `SUMIFS`, `SUMPRODUCT`, `AVERAGE`, `MAX`,
`MIN`, `COUNTIFS`, cross-sheet references, percentage inputs, frozen headers and
landscape print settings.

- WPS calculated the fresh workbook and saved `wps-saved.xlsx`. The baseline
  cash cost is 32,478.55 and closing cash is 17,521.45.
- A real WPS edit changed `工资明细!D3` from 50% to 75%. WPS recalculated the
  dependent sheets: cash cost became 34,718.55 and closing cash 15,281.45.
- The SDK imported and exported both files, compared every formula cache and
  every non-empty cell, then reopened the exported edited file in WPS and saved
  `wps-resaved-sdk.xlsx`. All three paths matched the independent WPS results.

Retained files include the two native inputs, the WPS-resaved SDK export, and
screenshots of the baseline and edited cash-control views. The runner
`scripts/payroll-corpus.mjs` verifies fixed input SHA-256 values and is invoked
by `scripts/check-business-corpus.mjs`; CI and the npm release workflow therefore
run the same 51-formula comparison before shipping.

This evidence expands the supported-subset business corpus. It does not certify
complete Excel/WPS compatibility, payroll legislation, customer data, fonts or
commercial/legal review. Native IME, screen readers, physical touch, public npm
publication and the other stable-release gates remain open.

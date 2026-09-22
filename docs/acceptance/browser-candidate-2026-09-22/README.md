# 2026-09-22 最终候选构建浏览器复验

本目录保存对当前 `0.29.0` 可重复构建候选执行的真实 Playwright 浏览器证据。报告绑定：

- 站点 SHA-256：`6bc3e152d2de6f1520075c6f90a014a7abbc17efcbea341d3da857eb655465c0`
- SDK tgz SHA-256：`10c083fff0c2727242fd0ed9b1794b73731d3169f87c18c5c8ecca2a5629cd54`
- 构建：Node `v24.14.0`、npm `11.9.0`、macOS `darwin/arm64`，固定 `SOURCE_DATE_EPOCH=1790070581`（`2026-09-22T09:49:41.000Z`）
- 浏览器：Chromium `153.0.8010.53`、Firefox `144.0.2`、WebKit `26.0`

三引擎分别通过 smoke 8 项、交互 6 项、布局 6 项、焦点 4 项和性能 6 项，共 90 项；Chromium 另通过 3 项触控模拟。所有报告的 `pageErrors`、`consoleErrors` 和 `runErrors` 均为 0。性能目录保留两档实际单元格、取消和范围公式报告。

复跑方式：先以 `SOURCE_DATE_EPOCH=1790070581 npm run check:reproducibility` 生成并核对候选，将 `dist/` 挂载到 `/lumina-sheets/`，再设置 `PLAYWRIGHT_MODULE`、`BROWSER_ENGINE` 和 `BROWSER_TEST_URL` 运行 `scripts/browser-*.mjs`。`summary.json` 汇总状态，`sha256-manifest.json` 绑定本目录文件字节。

边界：WebKit 运行器不等于正式 Safari；Chromium 触控使用 CDP 模拟，不等于实体设备、系统软键盘或真实多指；未覆盖原生 IME、屏幕阅读器、跨设备同步、生产负载和商业许可法律审计。因此这轮证据不单独宣布 `1.0.0`，也不证明完整 SpreadJS/Excel 兼容。

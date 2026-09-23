# 2026-09-23 当前候选浏览器复验（构建哈希强绑定）

本目录保存 0.29.0 当前候选，在 macOS arm64、Node.js v24.14.0、Playwright 1.57.0 下运行。构建使用 SOURCE_DATE_EPOCH=1790122493。

- 站点 SHA-256：1663d6db7c774b422d16fed0ef57d42cecbcae6a4c05aa5158594da653312d97
- SDK tgz SHA-256：36a2ef19026396fd25027085b343a2a050753bfe2fcee5cc36064b6b57aba3d4
- Chromium：153.0.8010.54
- Firefox：144.0.2
- WebKit：26.0

三引擎分别通过 smoke 8、interactions 6、focus 4、layout 6、performance 6 项；Chromium 另通过 3 项触控模拟。所有最终报告均为 passed，页面、控制台和运行错误均为 0。Firefox 首轮启动曾发生本地预览传输错误，失败报告未归档；确认服务后完整重跑通过。

本候选由 check-browser-evidence --verify-build 同时核对报告、站点 dist 和 SDK tgz 的实际摘要。它不替代正式 macOS Safari、原生中文 IME、实体移动设备、屏幕阅读器、跨设备性能、完整 Excel/WPS 语料或商业许可证法律复核。

# 2026-09-23 当前候选浏览器复验（提交 23dde02）

本目录保存提交 23dde0236374ef8ce47262447d3d276ed0aa9ebf 的 0.29.0 构建候选，在 macOS arm64、Node.js v24.14.0 上使用 Playwright 1.57.0 运行。构建使用 SOURCE_DATE_EPOCH=1790122493。

- 站点 SHA-256：05c8cb117e6560ab4be12e2d98de075afe8c9966fb0877bca3f06834fd4e9282
- SDK tgz SHA-256：36a2ef19026396fd25027085b343a2a050753bfe2fcee5cc36064b6b57aba3d4
- Chromium：153.0.8010.54
- Firefox：144.0.2
- WebKit：26.0

三引擎分别通过 smoke 8、interactions 6、focus 4、layout 6、performance 6 项；Chromium 另通过 3 项触控模拟。所有报告均为 passed，页面、控制台和运行错误均为 0。

报告、清单与限制说明见各 JSON 及 sha256-manifest.json。该证据覆盖当前自动化浏览器闭环，不替代正式 macOS Safari、原生中文 IME、实体移动设备、屏幕阅读器、跨设备性能、完整 Excel/WPS 语料或商业许可证法律复核。

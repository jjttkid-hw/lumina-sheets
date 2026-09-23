# 2026-09-23 当前候选浏览器复验（提交 4941f45）

本目录保存提交 4941f4518effab4a9bbdeb6de33a0b2a5d244ee2 的 0.29.0 构建候选，在 macOS arm64、Node.js v24.14.0 上使用 Playwright 1.57.0 运行。构建使用 SOURCE_DATE_EPOCH=1790122493。

- 站点 SHA-256：4c55a3b43f6418ce3a6242b3c46f20b7bcdce28ef907013186907d36f5ec21b0
- SDK tgz SHA-256：d51f9a8664aa77623a684049dbf026b8fa73cfa56b045e0d6f47f1a9f650ed17
- Chromium：153.0.8010.54
- Firefox：144.0.2
- WebKit：26.0

三引擎分别通过 smoke 8、interactions 6、focus 4、layout 6、performance 6 项；Chromium 另通过 3 项触控模拟。所有报告均为 passed，页面、控制台和运行错误均为 0。

报告、清单与限制说明见各 JSON 及 sha256-manifest.json。该证据覆盖当前自动化浏览器闭环，不替代正式 macOS Safari、原生中文 IME、实体移动设备、屏幕阅读器、跨设备性能、完整 Excel/WPS 语料或商业许可证法律复核。

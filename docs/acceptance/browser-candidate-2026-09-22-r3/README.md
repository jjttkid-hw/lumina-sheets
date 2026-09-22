# 2026-09-22 依赖修复候选浏览器复验

本目录保存 `unzipper@0.12.5` 依赖替换后、尚未发布为稳定版的 `0.29.0` 候选在本机执行的 Playwright 证据。报告、站点和 SDK 包均绑定同一组字节摘要，提交号 `86ef259` 已写入 `summary.json`。

- 三引擎 smoke、交互、布局、焦点和性能报告均为通过；Chromium 另执行三项 CDP 触控模拟。
- 当前运行器版本：Chromium `153.0.8010.53`、Firefox `151.0`、WebKit `26.5`。
- 站点 SHA-256：站点 SHA-256：`aa4a1663a3d70d2da7bac9e41ad6ba7e574f65120dd3d32894647691f1261025`；SDK tgz SHA-256：`395baf25a395a64bf8bce7f9bb8efcbcff595769f69899274139e9625b19bc3a`。
- 原始 JSON 报告按检查组保存，`sha256-manifest.json` 绑定本目录文件。

这组证据覆盖本项目自动化浏览器闭环，不等同于正式 Safari、实体触控、原生 IME、屏幕阅读器、跨设备同步、生产负载或商业许可法律审计，也不宣称完整 SpreadJS/Excel 兼容。稳定版仍需满足项目稳定发布门禁。

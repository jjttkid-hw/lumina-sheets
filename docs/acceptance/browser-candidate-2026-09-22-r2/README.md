# 2026-09-22 当前主线候选浏览器复验（r2）

本目录保存对提交 `048568e6871ff40bbd5cf048a7a67c1c9fef1813` 当前构建候选执行的真实 Playwright 浏览器证据。报告绑定：

- 站点 SHA-256：`4920cf45ef12ebc0e0bbc766805a9cce5ac6754c98c36a6811e1c1a4d38d63b3`
- SDK tgz SHA-256：`2162954eb6990ace6509868822bbb779b3ebae170fd1552e58dfac70e360e1c5`
- 版本：`0.29.0`
- 构建来源时间：`SOURCE_DATE_EPOCH=1790079444`（`2026-09-22T12:17:24.000Z`）
- 浏览器：Chromium `153.0.8010.53`、Firefox `144.0.2`、WebKit `26.0`

Chromium、Firefox、WebKit 各通过 smoke 8、交互 6、布局 6、焦点 4、性能 6 项；Chromium 另通过 3 项 CDP 触控检查。所有报告的 `pageErrors`、`consoleErrors` 和 `runErrors` 均为 0。每个 JSON 报告都保存了浏览器版本、检查数量、候选摘要和执行时间；`summary.json` 汇总矩阵，`sha256-manifest.json` 绑定本目录文件字节。

本轮使用本地静态 HTTP 服务器将 `dist/` 挂载到 `/lumina-sheets/`，并执行真实浏览器导航、Canvas 绘制、编辑、键盘、剪贴板、下载、SDK 销毁、布局、性能、取消和触控脚本。WebKit 运行器不等于正式 Safari；Chromium 触控使用 CDP 模拟，不等于实体设备、系统软键盘或真实多指。未覆盖原生 IME、屏幕阅读器、跨设备同步、生产负载和商业许可证法律审计，因此这份证据仍不能单独宣布 `1.0.0` 或完整 SpreadJS/Excel 兼容。

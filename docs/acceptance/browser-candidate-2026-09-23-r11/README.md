# WPS 文字往返修复候选 r11

0.29.0，macOS 26.7 arm64 / Node v24.14.0 / Playwright 1.57.0，来源时间 1790122493。

站点 SHA-256：209e8f6485f146cc41ed15b352f7760a5a3a47b35ac9dcd273980d66ac79bb45

SDK SHA-256：4cdae46eeb77d8d13f985f5ff33126829376882095dde088276048aae8770e0e

Chromium 153.0.8010.54、Firefox 144.0.2、WebKit 26.0 各通过 smoke 8、interactions 6、focus 4、layout 7、performance 6、accessibility 5、IME 4、persistence 4 项；Chromium touch 模拟另通过 3 项。25 份报告均通过，错误通道为零。当前包另通过 XLSX 5 项语料及 WPS 保存夹具的导入/二次往返两项检查。

WPS 实际桌面操作与问题来源见 ../wps-2026-09-23/README.md，包回读结果见 wps-corpus.json。本目录浏览器报告与本次新安装包同时绑定，不复用旧 r10 的通过状态。重复构建及 HTTP 验证另行执行。

本记录不证明原生 IME 候选窗口、实体触控、真实屏幕阅读器、Safari 完整矩阵、跨设备性能、完整 Excel/WPS 兼容、法律复核或 npm 发布。当前开发候选工作区含修复，仍非正式 v1.0。

# Lumina Sheets v0.29.0 候选 r16（无外部字体依赖）

- 来源时间：1790122493
- 站点 SHA-256：`6cfad7b747f837df98b68702cf6c9b1cd04785a80c7c26baea23fff8506ea18c`
- SDK SHA-256：`8833fde167d56b59446110f34f54fbe1d186af18a4580a24819cefba2af68a3e`

本候选移除了生产 CSS 对 Google Fonts 的运行时依赖，使用系统中英文字体回退，适用于离线、内网和严格 CSP 环境。三引擎实际重跑 smoke、交互、焦点、布局、性能、DOM/ARIA 无障碍语义、合成输入事件和原生持久化；Chromium 另完成触控模拟。全部 25 份核心报告绑定本候选站点/SDK 摘要，并通过首屏分包预算门禁，页面、控制台和运行错误均为零。恢复验收补充见 [recovery-2026-09-24](../recovery-2026-09-24/README.md)，该轮三引擎功能通过且截图证据完整。

XLSX 受支持子集 5 项、WPS 夹具 2 项重新使用同一 SDK 制品通过。

这是 0.x 候选，不扩大为原生操作系统 IME 候选窗口、真实读屏器、实体移动设备、完整 Excel/SpreadJS 兼容、商业法务审计或 npm registry 已发布。

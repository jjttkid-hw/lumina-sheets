# 启动救援页面修复候选 r12

当前 0.29.0；来源时间 1790122493；macOS arm64 / Node 24.14.0。

站点 SHA-256：`590d1b339fbfd652efbb81f4908e37f852c480894866a06676c07492245cfab8`

SDK tgz SHA-256：`0ddab00cacdc71ebbb6ae50c73c855f23eaa88d4cd037bdaf2749d7b2b9045a1`

启动失败页面改为独立纵向卡片，读取错误和操作区分开；窄屏按钮堆叠，按钮高度至少 44px。仅对救援页解除全局 375px 最小宽度，320px 下无横向溢出。备份结果保留 live status，错误保留 alert 语义，加载状态仍用原加载条。

本候选重新运行全部 25 份核心浏览器报告（Chromium/Firefox/WebKit 各 8 套，Chromium 另有触控模拟），全部通过；同时运行三引擎救援流程 9 项，以及 React/Vue 开发和生产矩阵 72 项。所有页面/控制台/运行错误通道为零。安装包 XLSX 5 项、WPS 保存夹具 2 项通过，2,328 项单元测试通过。

救援报告新增 1280/390/320px 的实际布局、水平溢出、按钮几何和键盘重试验证；截图与合成下载文件保存在 recovery 各引擎目录。macOS WebKit 默认键盘导航需 Option+Tab 才遍历按钮，报告记录 Alt+Tab；其他引擎用 Tab。未把系统默认焦点策略差异误报为应用故障。

关键证据：[Chromium 320px](recovery/chromium/startup-320.png)、[WebKit 320px](recovery/webkit/startup-320.png)、[Firefox 报告](recovery/firefox/result.json)。原始旧候选及失败日志仍保留；此目录是对新制品的真实重跑，没有替换旧报告摘要冒充验收。

此记录不证明原生 Safari 全矩阵、原生 IME 候选窗口、实体触控、真实屏幕阅读器、跨设备性能、完整 Excel/WPS 兼容、法律复核或 npm 首发。尚未交付 v1.0。

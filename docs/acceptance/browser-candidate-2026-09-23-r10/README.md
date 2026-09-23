# 2026-09-23 SDK 运行时缩放候选（r10）

版本 0.29.0，macOS arm64、Node v24.14.0、Playwright 1.57.0；SOURCE_DATE_EPOCH=1790122493。工作区包含本次实现，报告不冒充干净 tag 或 v1.0 验收。

- 站点 SHA-256：8e13b289517a70e1c27c8f347c9010f03bad2fab1ed53d655ffe025c8fcd6af4
- SDK tgz SHA-256：57f26f4d1da11a787072ddc988a416495d3921120820c836aa30b98b4509029e
- Chromium 153.0.8010.54 / Firefox 144.0.2 / WebKit 26.0

三引擎各通过 smoke 8、interactions 6、focus 4、layout 7、performance 6、accessibility 5、IME 4、persistence 4 项；Chromium 另通过 touch 3 项。25 份最终报告均为 passed，页面、控制台与运行错误均为 0。包内示例实际操作显示比例菜单并切换工作表；新增布局检查验证 50%、125%、200%、1.5 倍缩放后的点击定位、编辑框几何变化、焦点/草稿保留及撤销重做。三引擎截图随报告保留。

Firefox 首次本地导航被系统代理配置干扰；同一最小 HTTP 服务在默认配置失败、禁用测试配置中的代理后成功。脚本仅为 loopback 候选设置 Firefox profile 的 network.proxy.type=0，未改变操作系统设置；正式远端 URL 保留默认路由。失败报告未改写成通过。

5 项 XLSX 检查从当前 tgz 安装入口执行，覆盖业务语料、受支持子集往返、ExcelJS 独立读取和图片对象拒绝边界；并非桌面 Excel/WPS 或完整 OOXML 验收。

自动化 IME 仅为事件链，accessibility 仅为浏览器语义，touch 为模拟；本记录不替代原生输入法候选窗口、VoiceOver/NVDA/JAWS 实际朗读、实体触控、正式 Safari 完整矩阵、跨设备性能、法律复核或 npm 发布。npm 注册表仍未确认首发。

复验：固定来源时间运行 build:site、check:sdk、build-info.mjs，启动 /lumina-sheets/ 候选预览，再用 PLAYWRIGHT_MODULE 和 BROWSER_ENGINE 运行 scripts/browser-*.mjs。CI 使用 check-browser-evidence --verify-build 核对实际 dist 与 tgz，保留历史 r9 供追溯。

# 2026-09-23 当前候选浏览器复验（构建哈希强绑定）

本目录保存 0.29.0 当前候选，在 macOS arm64、Node.js v24.14.0、Playwright 1.57.0 下运行。构建使用 SOURCE_DATE_EPOCH=1790122493。

- 站点 SHA-256：791a5888cb5672e3a597062cfc4441a689db8597e26d6dfd32ecf3f1f6a07268
- SDK tgz SHA-256：619a3196bd784e082833bdc8e14383896410fb0e698dde781b2161adb55a26fb
- Chromium：153.0.8010.54
- Firefox：144.0.2
- WebKit：26.0

三引擎分别通过 smoke 8、interactions 6、focus 4、layout 6、performance 6 项；Chromium 另通过 3 项触控模拟。所有最终报告均为 passed，页面、控制台和运行错误均为 0。Firefox 首轮启动曾发生本地预览传输错误，失败报告未归档；确认服务后完整重跑通过。

三引擎另各通过 5 项 Canvas 网格无障碍语义检查：grid 行列契约、活动格地址和值、反向范围选择播报、键盘焦点更新和只读状态。该检查验证浏览器 DOM/ARIA 状态，不代表 VoiceOver、NVDA、JAWS 或移动辅助技术的实际朗读已验收。

三引擎另各通过 4 项中文输入事件链检查：合成期间失焦延迟提交、合成中的 Enter/229 不提前提交、切换工作表后迟到的 compositionend 不写回，以及报表示例公式栏在合成期间不提交。脚本向生产 UI 派发浏览器 CompositionEvent/InputEvent/KeyboardEvent；它验证应用的事件处理链，不等同于 macOS、Windows 或移动系统的原生输入法候选窗口验收。

三引擎另各通过 4 项浏览器原生持久化检查：旧版 localStorage 正文/恢复点/批注迁移后编辑和刷新、两个页面同时迁移只提交一份记录、损坏工作簿行与有效内容隔离、损坏编辑日志闭锁且保留恢复材料。检查直接使用各浏览器的 IndexedDB；它验证同源单设备恢复边界，不代表跨设备同步或突然断电一致性认证。

当前安装包另通过 5 项 XLSX 受支持子集语料检查：两份脱敏业务报表往返、包含公式/样式/富文本/超链接/合并/校验/打印设置/隐藏轴/跨表引用的合成工作簿往返、ExcelJS 独立读取契约，以及含图片对象时明确拒绝而不静默丢失。报告从当前 `lumina-report-sdk` tgz 加载入口执行，并绑定 SDK 摘要；它不代表完整 Excel/OOXML 或桌面 Excel/WPS 兼容。

本候选由 check-browser-evidence --verify-build 同时核对报告、站点 dist 和 SDK tgz 的实际摘要。它不替代正式 macOS Safari、原生中文 IME、实体移动设备、屏幕阅读器、跨设备性能、完整 Excel/WPS 语料或商业许可证法律复核。

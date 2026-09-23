# 当前候选 r13（发布后核对与启动救援修复）

版本 `0.29.0`，来源时间 `1790122493`。

- 站点 SHA-256：`e432797f8db69cb4afc38ad69f7b6f8ad973fb99efcf3cf6ca9ab48cc655d7b0`
- SDK SHA-256：`066fefcbbf82ae7e49c44592b9769d282b567eb292e5af5197b9ab7c8c13eb25`
- 提交：`f7f78f5`（发布后注册表核对门禁）之后重新生成的当前工作区候选；后续脚本改善测试导航等待，并修正无障碍夹具不应删除示例 metrics 节点的问题；因此本目录报告来自修正后的真实重跑。

核心浏览器报告为 Chromium、Firefox、WebKit 各 smoke、interactions、focus、layout、performance、accessibility、IME、persistence 共 25 份，另有 Chromium touch；全部报告状态通过且错误通道为零。React/Vue 开发和生产框架报告 72 项；原生恢复下载/导入/刷新报告三引擎各 3 项。

XLSX 5 项、WPS 保存夹具 2 项以同一 SDK 摘要通过。Firefox 本地候选导航使用 `domcontentloaded`，不等待远程字体的 `load` 事件；救援报告同样使用 DOM 就绪和功能断言，避免把外部字体请求误判为产品失败。

这仍是 0.x 候选，不等同于 npm 注册表已发布、完整 Safari/VoiceOver/实体触控/原生 IME、完整 Excel/WPS、法务复核或商业 SLA。

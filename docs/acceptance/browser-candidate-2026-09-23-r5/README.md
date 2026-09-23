# 2026-09-23 当前候选浏览器复验（固定来源时间）

本目录保存提交 `f2a25a9bc677ff5226534ffae26dea5b4af73e4c` 的 `0.29.0` 构建候选，在 macOS arm64、Node.js `v24.14.0` 上使用 Playwright `1.57.0` 运行的真实浏览器证据。构建使用仓库变量 `RELEASE_SOURCE_DATE_EPOCH=1790122493`，因此与线上部署内容保持同一站点摘要。

- 站点 SHA-256：`8f506d211485b4df08bcce679b0d933c2a3a0c2fff19292f1c6fe271d8544534`
- SDK tgz SHA-256：`d51f9a8664aa77623a684049dbf026b8fa73cfa56b045e0d6f47f1a9f650ed17`
- Chromium：`153.0.8010.54`
- Firefox：`144.0.2`
- WebKit：`26.0`

三引擎分别通过以下自动化组：

- smoke 8 项：Canvas 初始化、编辑/撤销/重做、IndexedDB 刷新、窄屏缩放、报表布局、JSON/CSV/XLSX/PDF 下载回读、空闲绘制、打包 SDK 示例。
- interactions 6 项：数据校验恢复、列表键盘、原生剪贴板原子校验、复制/剪切/粘贴、SDK 多实例隔离与销毁、分页数据源销毁竞态。
- focus 4 项：宿主焦点转移、Enter/Escape、普通焦点恢复、同步宿主焦点回调。
- layout 6 项：隐藏行列导航、合并区域命中、冻结行滚动、百万逻辑行稀疏定位、行高列宽撤销、筛选后的可见剪贴板。
- performance 6 项：100,000 与 1,000,000 个实际存储单元格、跨视区采样、后台公式、编辑传播、取消与范围公式基准。

Chromium 另外通过 3 项触控模拟：点按选区、原生滚动、调整尺寸后的取消/重试。

所有原始报告的 `status` 均为 `passed`，`pageErrors`、`consoleErrors`、`runErrors` 均为零；报告和文件摘要见各引擎目录及 [sha256-manifest.json](sha256-manifest.json)。这覆盖项目当前自动化浏览器闭环，但不等同于正式 macOS Safari、原生中文 IME、实体移动设备、屏幕阅读器、跨设备性能、完整 Excel/WPS 语料或商业许可证法律复核，也不宣称完整 SpreadJS 兼容。

执行入口为构建后的 `/lumina-sheets/` 静态预览；运行器为 `scripts/browser-{smoke,interactions,focus,layout,performance}.mjs` 及 Chromium 的 `scripts/browser-touch.mjs`。本轮报告使用与线上相同的固定来源时间生成，避免仅更新文档时改变可执行站点摘要。

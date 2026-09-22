# 2026-09-23 当前候选浏览器复验

本目录保存当前 `main`（提交 `28d8d096946d9cceba349895dfd022f415638ab2`）重新构建的 `0.29.0` 候选在本机执行的真实 Playwright 证据。所有报告都核对了同一份本地静态站点和同一份 SDK 归档：

- 站点 SHA-256：`00c64e949326bb3fee9660baf4fcda6691e947483e9f7bc81e109f3dd0650c8f`
- SDK tgz SHA-256：`9967b1a3f033d9a824d5acb0bb7d1e8186a9c87fd1923e50aa37e0cb1202d03b`
- 站点文件数：64
- Chromium：`153.0.8010.53`（触控运行器为 `153.0.8010.54`）
- Firefox：`144.0.2`
- WebKit：`26.0`

三引擎均通过以下自动化组：

- smoke 8 项：Canvas 初始化、编辑/撤销/重做、IndexedDB 刷新、窄屏缩放、报表布局、JSON/CSV/XLSX/PDF 下载回读、空闲绘制、打包 SDK 示例。
- interactions 6 项：数据校验恢复、列表键盘、原生剪贴板原子校验、复制/剪切/粘贴、SDK 多实例隔离与销毁、分页数据源销毁竞态。
- focus 4 项：宿主焦点转移、Enter/Escape、普通焦点恢复、同步宿主焦点回调。
- layout 6 项：隐藏行列导航、合并区域命中、冻结行滚动、百万逻辑行稀疏定位、行高列宽撤销、筛选后的可见剪贴板。
- performance 6 项：100,000 与 1,000,000 个实际存储单元格、跨视区采样、后台公式、编辑传播、取消与范围公式基准。

Chromium 另外通过 3 项 CDP 触控模拟：点按选区、原生滚动、调整尺寸后的取消/重试。

报告中的 `pageErrors`、`consoleErrors`、`runErrors` 均为零，原始 JSON 按引擎和检查组保存在本目录。该证据覆盖本项目自动化浏览器闭环；它不等同于正式 macOS Safari、原生中文 IME、实体移动设备、屏幕阅读器、跨设备性能、完整 Excel/WPS 语料或商业许可证法律复核，也不宣称完整 SpreadJS 兼容。

执行入口为构建后的 `/lumina-sheets/` 静态预览，依次运行 `scripts/browser-{smoke,interactions,focus,layout,performance}.mjs`，以及 Chromium 的 `scripts/browser-touch.mjs`。报告生成后再由本目录文件摘要绑定，未把失败截图或旧运行器输出混入本次证据。


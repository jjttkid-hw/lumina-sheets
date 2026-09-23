历史 r14、r16、r17 候选记录保留在下方；当前候选以 r18 账本为准。

2026-09-24 r18 重绑定：富文本 Canvas 颜色继承修复后，重新生成固定来源时间站点与 SDK；全量测试 167 个文件、2,343 项通过，Chromium、Firefox、WebKit 的 25 份浏览器报告、Chromium 触控、XLSX 5 项和 WPS 2 项均以新制品重新验证。r18 绑定站点 `2840ae6b66bd64a67f9ce69b76f5364be567c3b08201f67832cd5d0366146e87`、SDK `e21eef8fbb3b9803d312ce619553828921a6f2b0a536acc1bb6a31bb0847fc29`，证据见 [r18](acceptance/browser-candidate-2026-09-24-r18/README.md)。npm registry 首发、原生 IME、真实屏幕阅读器、实体移动设备、跨设备性能、完整 Excel/WPS 业务语料和商业法务复核仍未完成。

2026-09-24 r17 生命周期补强及远端同步：提交 `1e23218` 为分页 `prefetch` 增加主动取消、重新绑定、替换工作簿、清空缓存、销毁和共享页请求消费者取消回归；上一提交 `077162d` 的 Chromium、Firefox、WebKit 真实浏览器预取验收继续绑定 r17 固定制品。最新 GitHub CI [35924791431](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35924791431) 与 CD [35925452441](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35925452441) 均成功；线上 `build-info.json` 已核对为提交 `1e2321802eb162f3563287b77b2723f1bfcb7a93`、版本 `0.29.0` 和站点摘要 `1c772954b1139a5ab377a00b40b72d3170060218128557904f7586cabee5ad8a`。npm registry 仍未出现 `lumina-report-sdk`，因此不创建 `1.0.0`；自动化预取和取消结果仍不替代原生 IME、真实屏幕阅读器、实体移动设备、跨设备性能、完整 Excel/WPS 业务语料、npm 首发或商业法务复核。

2026-09-24 r17 证据重绑定：文档化分页数据恢复流程后，SDK 包内容发生变化；重新运行本机 Chromium、Firefox、WebKit 的 25 份浏览器报告、Chromium 触控、XLSX 5 项和 WPS 2 项，并将 r17 证据重新绑定站点 `cbfe14c925e37087b276f2167127b109643c4b43c68c62868812db2637eb21e3` 与 SDK `d728ffb8fc1346e7751946118f1787352f09cccee38ab1e05673848ad15905a8`。本次重绑定只修正证据与当前候选制品的一致性，仍不扩大浏览器、文件或商业验收范围。

2026-09-24 r17 SDK 预取候选：新增 `prefetch({ firstRow, lastRow }, { signal? })`，绑定并重新执行本机 Chromium、Firefox、WebKit 的 smoke、交互、焦点、布局、性能、DOM/ARIA、合成输入、持久化和 Chromium 触控模拟，共 25 份报告；固定来源时间构建的站点摘要为 `1c772954b1139a5ab377a00b40b72d3170060218128557904f7586cabee5ad8a`，SDK 摘要为 `c6a73bc48aa68cb479970c2260378764e0cec5820aba7adfbed3cc12be47c6af`。提交 `9be95db` 的 GitHub CI `35922791383` 与 CD `35923421887` 均成功，线上 `build-info.json` 已核对为同一提交和站点摘要。证据见 [r17](acceptance/browser-candidate-2026-09-24-r17/README.md)，当前 CI 已切换至该目录。自动化结果仍不替代原生 IME、真实屏幕阅读器、实体移动设备、跨设备性能、完整 Excel/WPS 业务语料、npm registry 首发或商业法务复核。

2026-09-24 r16 远端同步：提交 `da55279` 的 GitHub CI [35917269616](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35917269616) 与 CD [35917893853](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35917893853) 均成功。线上 `build-info.json` 已核对为版本 `0.29.0`、同一提交 `da552797197ce369bc8be35c53261aeb686a8f10` 和站点摘要 `6cfad7b747f837df98b68702cf6c9b1cd04785a80c7c26baea23fff8506ea18c`；当前 SDK tgz 摘要为 `8833fde167d56b59446110f34f54fbe1d186af18a4580a24819cefba2af68a3e`。r16 的 25 份浏览器报告、首屏性能预算、API、许可证、可重复构建、XLSX/WPS 语料和 HTTP 运行时门禁均已绑定该候选。npm registry 首发、原生 IME、真实屏幕阅读器、实体移动设备、跨设备性能、完整 Excel/WPS 业务语料和商业法务复核仍是 v1.0 门槛。

2026-09-24 r15 及远端同步：Safari 27.0 / macOS 26.7 实机新增筛选、清除筛选、100%→125% 缩放、XLSX 下载触发和刷新恢复记录，见 [browser-safari-2026-09-24-r15](acceptance/browser-safari-2026-09-24-r15/README.md)。提交 `9820eae` 的 CI `35910288568` 与 CD `35910896102` 均成功；线上 `build-info.json` 已绑定提交 `9820eaed4eddb3e8974b8245429fd880dfbebb92` 和站点摘要 `6cfad7b747f837df98b68702cf6c9b1cd04785a80c7c26baea23fff8506ea18c`。r15 仍不替代原生 IME、真实屏幕阅读器、实体移动设备、跨设备性能、完整 Excel/WPS 语料、npm registry 或商业法务复核。

2026-09-23 r13 验证器修复：Firefox/本地候选浏览器脚本统一等待 `domcontentloaded`；无障碍夹具改为追加测试宿主，避免删除示例页面的 metrics 节点造成 page error。r13 的 25 份核心报告完整性检查已通过，摘要绑定 `e432797...` / `066fefc...`。

2026-09-23 r13 候选重绑定：发布 README 变更后重新构建 SDK（`066fefc...`）和站点（`e432797...`），重新生成 25 份核心浏览器、触控、框架、恢复及 XLSX/WPS 证据；Firefox 本地导航等待 DOM 就绪，避免字体加载超时。CI 将使用 r13，不沿用旧摘要。npm 注册表仍为 404，尚未发布。

2026-09-23 发布后核对加固：npm 工作流新增公开注册表 tarball integrity、包名/版本和临时目录独立安装检查；新增 `scripts/check-npm-registry.mjs`，注册表未出现版本时明确失败，不把 npm publish 返回成功当作首发证据。Trusted Publisher 仍需 `jjttkid-hw / lumina-sheets / npm.yml / npm` 配置，npm 首发门槛继续开放。

2026-09-23 Safari r5 实机补验：Safari 27.0 / macOS 26.7 完成百万行分页定位（A1000000）、缓存刷新、CSV 导出取消、200 行快照 XLSX 实际下载及再次导入回读（C200=2990）。证据见 [Safari r5](acceptance/browser-safari-2026-09-23-r5/README.md)，绑定 r12 站点和 SDK 摘要。Safari 全平台矩阵、VoiceOver、实体移动触控、原生 IME、完整 Excel/WPS 与法律/npm 门槛仍开放。

2026-09-23 启动救援页面修复：失败提示从横向加载条改为独立纵向卡片，窄屏按钮堆叠、44px 点击高度、320px 无横向滚动；保留错误和下载结果播报，三引擎完成布局与键盘重试。新制品重新执行核心浏览器 25 份报告、框架 72 项、救援 9 项与文件语料检查，见 [r12 候选](acceptance/browser-candidate-2026-09-23-r12/README.md)。版本仍为 0.29.0。

2026-09-23 原生存储救援闭环：Chromium、Firefox、WebKit 实际下载恢复 JSON、导入、显式选择并恢复新副本，刷新后内容保留，共 9 项检查通过。覆盖损坏日志原件救援、部分备份无效条目拒绝、搜索 Enter/取消无写入、历史版本及规则工作表标识重映射。见 [救援证据](acceptance/recovery-2026-09-23/README.md)。已加入 CI，仍不等同于物理断电恢复、跨设备同步或平台级验收完成。

2026-09-23 框架接入验收：从当前 SDK tgz 安装到独立 React 19.3.0 / Vue 3.5.43 项目，开发及生产模式在 Chromium、Firefox、WebKit 全部通过，共 12 份报告、72 项检查；覆盖真实画布编辑、StrictMode 双挂载、回调更新、切换/卸载取消及十轮 DOM 清理。CI 新增独立框架浏览器任务，其失败将阻止 CD。见 [框架证据](acceptance/frameworks-2026-09-23/README.md)。版本仍为 0.29.0，其余稳定版门槛保持开放。

2026-09-23 WPS 实际验收发现并修复小写 OOXML 转义文本损坏及普通 inlineStr 未解码；新增桌面保存夹具与当前安装包 CI 回归。见 [桌面记录](acceptance/wps-2026-09-23/README.md) 和 [r11 浏览器候选](acceptance/browser-candidate-2026-09-23-r11/README.md)。完整 Excel/WPS 语料门槛仍开放。

2026-09-23 缩放候选：SDK 新增运行时 `setZoom` / `zoom`，报表示例增加 50%–200% 显示比例菜单。新增三引擎画布点击定位、缩放期间草稿/焦点和撤销验证，完整报告见 [r10](acceptance/browser-candidate-2026-09-23-r10/README.md)。版本仍为 0.29.0，npm 首发及平台级验收门槛保持开放。

2026-09-23 Safari r3 多工作表复验：线上报表在 macOS Safari 干净刷新后完成多工作表入口、工作表选择器、销售明细 C2 编辑、经营汇总切回、B2 跨表公式从 8,199,000 重算为 8,299,000，以及撤销恢复为 8,199,000；AX 树持续显示 table/row/cell 语义与无错误状态。记录见 [browser-safari-2026-09-23-r3](acceptance/browser-safari-2026-09-23-r3/README.md)，绑定站点摘要 `791a5888cb5672e3a597062cfc4441a689db8597e26d6dfd32ecf3f1f6a07268`。

2026-09-23 当前候选确定性重建：主线提交 `efc6e79006651f37c602411396c34a71ed433e69` 使用 `SOURCE_DATE_EPOCH=1790122493` 连续两次构建通过，站点摘要为 `791a5888cb5672e3a597062cfc4441a689db8597e26d6dfd32ecf3f1f6a07268`，SDK 摘要为 `619a3196bd784e082833bdc8e14383896410fb0e698dde781b2161adb55a26fb`（718,444 字节）；摘要与线上部署和 r9 浏览器记录一致。npm 注册表仍未出现 `lumina-report-sdk`，所以版本继续保持 `0.29.0`。

2026-09-23 Safari r4 交互复验：Safari 27.0 / macOS 26.7 线上页面完成结构删除后撤销、XLSX 导出进度与下载提示、文本筛选应用/清除，以及公式栏和 B2 结果保持；记录见 [browser-safari-2026-09-23-r4](acceptance/browser-safari-2026-09-23-r4/README.md)。该记录绑定站点摘要 `791a5888cb5672e3a597062cfc4441a689db8597e26d6dfd32ecf3f1f6a07268` 和提交 `12a2205`，不改变实体触控、原生 IME、VoiceOver、完整 Excel/WPS 语料及 npm 首发门槛。

2026-09-23 Safari r2 复验：在 macOS Safari 线上构建实际完成报表初始化、公式示例切换、`=SUM(1,2,3)` 结果 6、撤销恢复，以及 `=SUM(4,5,6)` 结果 15 的刷新恢复；AX 树出现 table/row/cell 语义。记录见 [browser-safari-2026-09-23-r2](acceptance/browser-safari-2026-09-23-r2/README.md)，绑定当前站点摘要 `791a5888cb5672e3a597062cfc4441a689db8597e26d6dfd32ecf3f1f6a07268`。该记录不替代原生 IME、VoiceOver、实体触控、跨设备性能或完整文件语料验收。

2026-09-23 当前远端状态更新：提交 `39484f4` 的 GitHub CI `35820942633` 与 CD `35821172170` 均成功。线上 `build-info.json` 已核对为版本 `0.29.0`、同一提交和站点 SHA-256 `791a5888cb5672e3a597062cfc4441a689db8597e26d6dfd32ecf3f1f6a07268`；当前候选 SDK tgz SHA-256 为 `619a3196bd784e082833bdc8e14383896410fb0e698dde781b2161adb55a26fb`。全量测试为 163 个文件、2,309 项通过；XLSX 语料 5 项、r9 浏览器证据 25 份及构建绑定门禁均通过。npm 注册表仍未发布，正式 Safari、原生中文 IME、实体设备、真实屏幕阅读器、跨设备性能、完整 Excel/WPS 语料和商业许可法律复核仍是 v1.0 门槛。

2026-09-23 当前候选浏览器复验（r9）：确定性 SDK 归档修复后，macOS 与 Linux 生成相同 SDK tgz；同源 Chromium、Firefox、WebKit 各通过 smoke 8、交互 6、焦点 4、布局 6、性能 6、无障碍语义 5、中文输入事件链 4 和浏览器原生持久化 4 项，Chromium 另通过 3 项触控模拟。持久化套件直接覆盖 IndexedDB/localStorage 迁移、两个页面并发迁移、损坏工作簿隔离与损坏日志闭锁。强绑定摘要为站点 `791a5888cb5672e3a597062cfc4441a689db8597e26d6dfd32ecf3f1f6a07268`、SDK `619a3196bd784e082833bdc8e14383896410fb0e698dde781b2161adb55a26fb`，见 [browser-candidate-2026-09-23-r9](acceptance/browser-candidate-2026-09-23-r9/README.md)。自动化事件链不等同于原生系统输入法候选窗口；正式 Safari、原生中文 IME、实体触控、屏幕阅读器、完整文件语料和 npm 首发仍是 v1.0 门槛。
2026-09-23 文件兼容增量：当前安装包入口通过 5 项 XLSX 受支持子集语料检查，绑定同一 SDK tgz 摘要；覆盖两份脱敏业务报表、公式/样式/富文本/超链接/合并/校验/打印设置/隐藏轴/跨表引用合成语料、ExcelJS 独立读取和图片对象拒绝边界。该报告不扩大为完整 Excel/OOXML 兼容，桌面 Excel/WPS 对照仍需单独验收。

2026-09-23 当前候选浏览器复验（r8）：构建强绑定门禁定稿后，固定来源时间构建在 Chromium、Firefox、WebKit 各通过 smoke 8、交互 6、焦点 4、布局 6、性能 6 项，Chromium 另通过 3 项触控模拟。报告与实际 `dist`/SDK tgz 同时核对，绑定站点 `1663d6db7c774b422d16fed0ef57d42cecbcae6a4c05aa5158594da653312d97`、SDK `36a2ef19026396fd25027085b343a2a050753bfe2fcee5cc36064b6b57aba3d4`，见 [browser-candidate-2026-09-23-r8](acceptance/browser-candidate-2026-09-23-r8/README.md)。正式 Safari、原生中文 IME、实体触控、屏幕阅读器、跨设备性能、完整文件语料和 npm 首发仍是 v1.0 门槛。

2026-09-23 当前候选浏览器复验（r7）：提交 `23dde02` 的线上同源构建重新运行 Chromium、Firefox、WebKit 的 smoke、交互、焦点、布局和性能套件，三引擎各通过 8、6、4、6、6 项；Chromium 另通过 3 项触控模拟。报告统一绑定站点 `05c8cb117e6560ab4be12e2d98de075afe8c9966fb0877bca3f06834fd4e9282`、SDK `36a2ef19026396fd25027085b343a2a050753bfe2fcee5cc36064b6b57aba3d4`，见 [browser-candidate-2026-09-23-r7](acceptance/browser-candidate-2026-09-23-r7/README.md)。正式 Safari、原生中文 IME、实体触控、屏幕阅读器、跨设备性能、完整文件语料和 npm 首发仍是 v1.0 门槛。

2026-09-23 当前候选浏览器复验（r6）：提交 `4941f45` 使用 `SOURCE_DATE_EPOCH=1790122493` 重新构建并运行 Chromium、Firefox、WebKit 的 smoke、交互、焦点、布局和性能套件，三引擎各通过 8、6、4、6、6 项；Chromium 另通过 3 项触控模拟。报告统一绑定站点 `4c55a3b43f6418ce3a6242b3c46f20b7bcdce28ef907013186907d36f5ec21b0`、SDK `d51f9a8664aa77623a684049dbf026b8fa73cfa56b045e0d6f47f1a9f650ed17`，见 [browser-candidate-2026-09-23-r6](acceptance/browser-candidate-2026-09-23-r6/README.md)。证据完整性检查通过；正式 Safari、原生中文 IME、实体触控、屏幕阅读器、跨设备性能、完整文件语料和 npm 首发仍是 v1.0 门槛。

# v1.0 交付计划与验收账本

2026-09-23 当前远端状态：提交 `49a426a` 的 GitHub CI `35804841159` 与 CD `35805069184` 均成功。线上版本为 `0.29.0`，提交为 `49a426a77f7b1fa65ac1dd388aa71a375164bea1`；当前仓库已配置 `RELEASE_SOURCE_DATE_EPOCH=1790122493`，用于让验收文档提交保持候选站点摘要稳定。固定来源时间重建得到站点 SHA-256 `8f506d211485b4df08bcce679b0d933c2a3a0c2fff19292f1c6fe271d8544534`，npm 注册表仍未发布，不能据此宣布 v1.0.0。

2026-09-23 当前候选浏览器复验：提交 `f2a25a9` 的固定来源时间构建重新运行 Chromium、Firefox、WebKit 的 smoke、交互、焦点、布局和性能套件，三引擎各通过 8、6、4、6、6 项；Chromium 另通过 3 项触控模拟。所有报告均绑定站点 `8f506d211485b4df08bcce679b0d933c2a3a0c2fff19292f1c6fe271d8544534`、SDK `d51f9a8664aa77623a684049dbf026b8fa73cfa56b045e0d6f47f1a9f650ed17`，见 [browser-candidate-2026-09-23-r5](acceptance/browser-candidate-2026-09-23-r5/README.md)。这更新了自动化候选证据，但仍不能替代正式 Safari、原生中文 IME、实体触控、屏幕阅读器、跨设备性能、完整文件语料或商业许可证法律复核。

2026-09-23 财务公式增量：公式引擎新增 `IRR` 与 `RATE`，支持一维现金流范围/直接现金流、可选初始猜测、受保护的牛顿迭代与二分回退；补充 `#NUM!` 域错误、公式错误传播、范围往返和公式栏签名回归。定向财务与公式帮助测试 27 项通过；该增量扩大支持子集，不代表完整 Excel/SpreadJS 财务函数兼容。

2026-09-23 npm 发布尝试：手动运行 `v0.29.0` 的 npm 工作流 `35785677207`，所有发布前门禁和 GitHub Release 制品上传通过，发布步骤以 `ENEEDAUTH` 失败；该 Release 最初错误地标为正式版，随后已改为 prerelease，使重试时按规则使用 `next` 而不是 `latest`。需要在 npm 包 `lumina-report-sdk` 的 **Settings → Trusted Publishers** 配置 `jjttkid-hw / lumina-sheets / npm.yml / npm`，之后再重试同一 0.x Release；这不改变稳定版验收门槛。

2026-09-23 当前浏览器候选复验：提交 `28d8d09` 的构建已在 Chromium、Firefox、WebKit 完成 smoke、交互、焦点、布局、性能套件，并在 Chromium 完成 CDP 触控模拟；报告绑定站点 `00c64e949326bb3fee9660baf4fcda6691e947483e9f7bc81e109f3dd0650c8f` 与 SDK `9967b1a3f033d9a824d5acb0bb7d1e8186a9c87fd1923e50aa37e0cb1202d03b`，见 [browser-candidate-2026-09-23-r4](acceptance/browser-candidate-2026-09-23-r4/README.md)。这推进了桌面自动化证据，但仍不能替代正式 Safari、原生中文 IME、实体触控、屏幕阅读器、跨设备性能和完整文件语料。

2026-09-22 当前候选更新：提交 `41a9e51` 的 `unzipper@0.12.5` 依赖替换已消除严格许可证清单中的未解决项；三引擎真实浏览器自动化候选复验已重新绑定站点 SHA-256 `aa4a1663a3d70d2da7bac9e41ad6ba7e574f65120dd3d32894647691f1261025` 与 SDK SHA-256 `395baf25a395a64bf8bce7f9bb8efcbcff595769f69899274139e9625b19bc3a`，见 [browser-candidate-2026-09-22-r3](acceptance/browser-candidate-2026-09-22-r3/README.md)。该候选已通过 CI `35736775847` 和 CD `35737082042`；后续发布策略修正已在 `7c2f9f4`、`30587da` 通过 CI/CD。`check:licenses --strict` 当前通过，但仍需正式 Safari、实体移动触控、屏幕阅读器、跨设备性能和稳定版证据账本，不能据此宣布 `1.0.0`。

目标是继续建设高性能 JavaScript / Canvas 表格与报表产品，形成可安装、可验证、契约稳定的 v1.0。当前阶段 0.29.0；不能通过单独修改版本号宣布完成，也不能把 v1.0 等同于完整 SpreadJS API、Excel 兼容或商业 SLA。

## 交付门槛

2026-09-23 CI 门禁维护：移除旧 r7 浏览器候选的重复检查，持续集成统一使用当前强绑定的 r9 证据目录；历史候选仍保留用于追溯，不再参与当前提交的通过判断。

| 工作项             | 状态                                                                                                             | 验收要求                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 数据与异步生命周期 | 进行中                                                                                                           | 编辑、导入、数据源切换、销毁不会让迟到操作覆盖当前内容；原子失败与可恢复错误有回归证据                        |
| 公共 API 冻结      | 候选基线已建立                                                                                                   | 导出符号、类型、错误码、事件、只读/销毁行为明确；真实安装包契约检查；1.x 兼容政策                             |
| 工作空间核心闭环   | 进行中                                                                                                           | Canvas 编辑、规则、排序、撤销、保存重试、刷新恢复及导入导出验收；明确 SDK 与工作空间能力差异                  |
| 框架接入           | React 19.3 / Vue 3.5 开发与生产宿主已通过三引擎 72 项检查，其他版本/SSR 未认证                                   | 普通 JS 与 React/Vue 生命周期示例或包装；更新、卸载、重复挂载契约及类型检查                                   |
| 浏览器验收         | 候选构建已在 Chromium/Firefox/WebKit 完成 smoke、交互、布局、焦点、性能套件；Chromium 触控通过，平台级矩阵仍待验 | 实际浏览器 Canvas 绘制、编辑/键盘/剪贴板、列表规则、缩放/窄屏、保存刷新、SDK 销毁和导出；记录浏览器与版本     |
| 性能回归           | 候选构建三引擎实测及原始 JSON 已归档，跨设备预算与业务语料仍待验                                                 | 已有操作次数及基准；需要版本绑定的代表性数据、实际环境和原始结果，不能用逻辑行数替代实存格负载                |
| Excel / 文件兼容   | 部分完成                                                                                                         | 受支持子集的往返语料、拒绝边界和错误说明；不静默承诺未支持对象                                                |
| 第三方再分发材料   | 自动门禁已通过，法律复核仍待完成                                                                                 | 当前严格清单为 0 errors / 0 reviewItems / 0 unresolvedVendorComponents；技术证据不替代法律判断                |
| CI / CD / npm      | CI/CD 完成，npm 首发待账号验证                                                                                   | 单测、类型、包安装和发布门禁；0.x 不污染 latest；发布制品必须与验收对象一致；npm 首发尚未在注册表确认         |
| 稳定版文档         | 已覆盖主要入口，待稳定版最终审阅                                                                                 | 快速接入、迁移、兼容矩阵、限制、变更日志、支持/问题反馈、发布与回退策略；发布前需按最终候选复核版本与证据链接 |

## 推进顺序

1. 修复数据丢失和生命周期问题，完善 API 与发布门禁。
2. 完成接入示例、文件兼容语料与依赖证据，补齐工作空间核心闭环。
3. 实际浏览器和性能验收；明确支持矩阵及剩余限制。
4. 生成候选版本并执行所有门槛，依据结果修复；门槛通过后才定版 1.0.0。

2026-09-22 当前主线候选复验已完成：提交 `048568e` 的可重复构建摘要绑定同一 `0.29.0` 制品，在 Chromium、Firefox、WebKit 运行 smoke、交互、布局、焦点和性能套件均通过，Chromium 另通过 CDP 触控检查；全部报告无 page/console/run error。结果见 [当前候选复验记录](acceptance/browser-candidate-2026-09-22-r2/README.md)。这不代表正式 Safari、原生 IME、实体触控、屏幕阅读器、跨机器复现或商业许可证门槛已通过。此前 npm 首次发布仍未完成；本地安装包验证不等于注册表发布成功。

每个阶段在 [VERIFICATION.md](VERIFICATION.md) 记录真实命令结果、制品和限制。未通过的门槛保持可见；持续推进可独立完成的工作，不能隐去缺口后宣布完成。

0.23 阶段进展：SDK 导入取消/过期保护及回归已实现；API 声明基线与 CI 门禁已建立；npm 预发布 next 路由和精确制品选择已实现。尚未进行浏览器验收，也未定版 1.0。

0.24 阶段：恢复备份改读当前存储，加入部分失败提示；构建时间来自显式来源时间或 Git 提交时间，开始核验同源制品一致性。

0.24 最终验证：1,039 项测试、构建/包/API 门禁通过；恢复与挂载保护已补齐，最终 tgz 两次重建字节一致。框架例子见 [FRAMEWORKS.md](FRAMEWORKS.md)，实际浏览器验收步骤见 [BROWSER-ACCEPTANCE.md](BROWSER-ACCEPTANCE.md)，均不冒充浏览器通过证据。

0.25 阶段：XLSX 空白样式单元格保留，并预检实际存储格坐标、重复与总量；稀疏模板极限坐标往返已覆盖，浏览器门槛仍未完成。

0.26 阶段：将合并区域累计面积、坐标、重叠检查提前到 ExcelJS 解码前；可见列范围与空白行坐标也执行导入限额检查。

0.26 发布加固：npm 正式 1.x+ 发布新增 check:stable，检查制品哈希绑定的实际验收记录及包内依赖清单；当前没有通过记录，不允许靠升版本绕过。报告约定见 [acceptance/README.md](acceptance/README.md)。

0.27 阶段：工作空间工具栏接入行列插入/删除，候选工作簿整体校验后一次保存、撤销；界面浏览器验收仍未完成。

0.28 阶段：工作空间导入恢复备份时可挑选单本恢复为独立副本；修复复制工作表 ID 后验证规则未重映射的问题。批注/版本/旧设置完整恢复仍未实现。

0.29 阶段：Canvas 编辑会话增加工作簿/工作表/数据与修订所有权，忽略迟到回调；即时失焦读取最新草稿，输入法 229 确认键不提交。归档候选已完成三引擎自动化浏览器复验，但当前重新生成的制品尚未重新绑定浏览器报告。

0.29 依赖证据进展：SDK 实际构建输入与分包哈希随包输出并安装校验；通过 `unzipper@0.12.5` 覆盖移除不可核验解压依赖后，严格清单当前为 0 errors / 0 reviewItems / 0 unresolvedVendorComponents。该技术门禁不替代商业许可证法律复核。

0.29 导入完整性：拒绝同一单元格的多个地址别名与重复工作表 ID，避免静默覆盖数据或改变验证规则归属。全量 2,305 项测试、构建/API/安装包检查通过，当前候选的真实浏览器制品绑定和许可门槛继续未完成。

0.29 SDK 多工作表：新增活动表切换和目录/事件接口，保留历史与缓存，防止旧视图写入、分页迟到响应及非当前表撤销改变当前选区。1,439 项测试和真实安装包检查通过；浏览器切表/下载与商业许可门槛仍未完成，版本不升级为 1.0。

0.29 无障碍增量：Canvas 网格补充标准 grid/gridcell 语义和活动坐标，生命周期与安装门禁继续通过本地回归；真实屏幕阅读器和四类浏览器仍是 v1 门槛。

支持矩阵与迁移入口已补齐：见 [SUPPORT-MATRIX.md](SUPPORT-MATRIX.md) 与 [MIGRATION.md](MIGRATION.md)。新增 `check:site-runtime` 对 Pages 基路径、工作空间、报表示例、SDK 示例及其 JS/CSS 资源执行 HTTP 冒烟；该检查不替代真实浏览器矩阵。

发布工作流基路径修复：npm 候选使用 `build:site`，与 `/lumina-sheets/` HTTP 检查和 Pages 制品保持一致；根路径 `build:all` 仅用于本地开发构建。
2026-09-23 最终当前状态：提交 `b268e959affa28f232328f2041a20a11dde6eb43` 的 CI [35851359749](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35851359749) 与 CD [35851676228](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35851676228) 均成功。线上 `build-info.json` 已核对为同一提交、版本 `0.29.0` 和站点 SHA-256 `791a5888cb5672e3a597062cfc4441a689db8597e26d6dfd32ecf3f1f6a07268`；SDK tgz SHA-256 为 `619a3196bd784e082833bdc8e14383896410fb0e698dde781b2161adb55a26fb`。r9 25 份浏览器报告、5 项 XLSX 语料和构建绑定门禁均通过。npm 注册表仍返回 404，正式 Safari 全矩阵、原生 IME、实体触控、屏幕阅读器、跨设备性能、完整 Excel/WPS 对照和商业法律复核仍未完成，版本继续保持 `0.29.0`。
2026-09-23 当前远端状态：提交 `08189e6` 的 GitHub CI [35855427601](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35855427601) 与 CD [35855756341](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35855756341) 均成功。线上 `build-info.json` 已核对为同一提交、版本 `0.29.0` 和站点 SHA-256 `791a5888cb5672e3a597062cfc4441a689db8597e26d6dfd32ecf3f1f6a07268`；当前 SDK tgz SHA-256 为 `619a3196bd784e082833bdc8e14383896410fb0e698dde781b2161adb55a26fb`。本轮仅收紧 CI 到当前 r9 浏览器候选证据目录，未改变运行时代码或 npm 包内容；npm 注册表仍未出现 `lumina-report-sdk`。
2026-09-24 当前主线状态：提交 `627e39ee4c088515eee3b24dca8724ba9bc31ad0` 已通过 GitHub CI `35900682003` 与 CD `35901257082`。本地固定来源时间 `1790122493` 构建的站点 SHA-256 为 `6cfad7b747f837df98b68702cf6c9b1cd04785a80c7c26baea23fff8506ea18c`，SDK SHA-256 为 `8833fde167d56b59446110f34f54fbe1d186af18a4580a24819cefba2af68a3e`。新增 SDK 验证时钟门禁：依赖清单时间来源与归档时间必须一致，避免本地/CI 使用不同时间生成不同 tgz。线上 Pages `build-info.json` 已核对为同一提交和站点摘要。当前仍未满足 v1.0：npm registry 首发、原生系统 IME、真实屏幕阅读器、实体移动设备、跨设备性能、完整 Excel/WPS 业务语料和商业法务复核。

- 2026-09-24 Safari r14 公式与历史实机复验：Safari 27.0 / macOS 26.7 在线页面进入公式示例，定位 D5 并确认初值 40；编辑为 50 后确认“相关公式随之重算”，随后实际撤销恢复 40、重做恢复 50。AX 树持续提供 table/row/cell 语义，错误通道均为 0。记录见 [browser-safari-2026-09-24-r14](acceptance/browser-safari-2026-09-24-r14/README.md)，绑定当前站点和 SDK 摘要。npm registry、原生系统 IME、真实屏幕阅读器、实体移动触控、跨设备性能和商业法律复核仍开放。
2026-09-24 npm 发布链路加固：提交 `85964e5` 将 npm 工作流明确分为 Trusted Publisher OIDC（未配置 `NPM_TOKEN` 时清除 `NODE_AUTH_TOKEN`）与显式 token 回退，并增加工作流契约测试；提交 `fdc0b0a` 清理个人 npm 账号信息。GitHub CI `35905452013` 成功，随后文档提交的 CI `35906425854` 也成功；当前线上发布链路仍未获得 npm registry 包存在证据，不能将 OIDC 配置视为已发布。
2026-09-24 r16 本地候选：新增首屏分包预算门禁 `scripts/check-bundle-performance.mjs`，确认首页入口 592,753 字节、报表示例入口 466,426 字节（均未压缩），ExcelJS 仍只在 XLSX 操作时动态加载。167 个测试文件、2,333 项测试通过；格式、API、SDK 隔离安装、严格许可证、可重复构建、HTTP 运行时和 XLSX/WPS 语料均通过。Chromium、Firefox、WebKit 各重跑 smoke/交互/焦点/布局/性能/DOM-ARIA/合成输入/持久化，Chromium 另通过触控模拟，25 份报告绑定站点 `6cfad7b747f837df98b68702cf6c9b1cd04785a80c7c26baea23fff8506ea18c` 与 SDK `8833fde167d56b59446110f34f54fbe1d186af18a4580a24819cefba2af68a3e`，见 [r16](acceptance/browser-candidate-2026-09-24-r16/README.md)。这仍不替代原生系统 IME、真实读屏器、实体移动设备、跨设备性能、完整 Excel/WPS 语料、npm registry 首发或商业法务复核，不创建 v1.0.0。

2026-09-24 REST 重试契约同步：提交 `8289a27` 为 `restDataSource` 的可取消有限重试策略更新公共声明基线；本地 API 门禁与 REST 定向测试通过。GitHub CI [35929525138](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35929525138) 与 CD [35930032182](https://github.com/jjttkid-hw/lumina-sheets/actions/runs/35930032182) 均成功。线上 `build-info.json` 已核对为提交 `8289a273486763899903bd6eb457cc0efc92b884`、版本 `0.29.0`、站点 SHA-256 `a6f6b49f799a4d20cb8a473c1193a4f76c360a87b80f2ab4926800361e0c5c13`。npm registry 仍未出现 `lumina-report-sdk`（404），故不宣称 npm 已发布或 v1.0.0；原生系统 IME、真实屏幕阅读器、实体移动设备、跨设备性能、完整 Excel/WPS 业务语料和商业法务复核继续开放。

# API 稳定性与变更审查

当前仍为 0.x 开发阶段。`docs/api-contract.json` 记录从真实 SDK 声明产物抽取的公共契约候选，包含包 exports 与可达声明文件，排除类 private 成员和注释。它是差异审查基线，不表示 v1.0 已定版或全部浏览器已认证。

本轮新增 `productBuildIdentity()` 与 `ProductBuildIdentity` 类型。它只提供构建诊断指纹，不承诺签名验证；宿主应允许开发环境返回 `null`，并继续以发布包与部署站点的摘要作为交付核验依据。

构建后运行 `npm run check:api`，声明或导出路径变化时失败。CI 与 npm 发布工作流都执行该检查。确认新增/变更契约、测试和迁移说明后，维护者可执行 `node scripts/check-api.mjs --write` 更新基线，并审查提交中的实际差异。脚本不会因测试失败自动更新基线。该检查保守地包含可达声明文件中的辅助声明，因此可能拦截不影响公开调用的改变；它不取代运行时行为测试。

## 1.x 预定兼容政策

0.29 工作空间最初新增工作表重命名时，可达 `lib/formula-structure.d.ts` 仅增加 `renameFormulaSheet` 辅助声明；已逐字核对删除该行后与旧基线一致。该阶段尚未提供 SDK 重命名方法，基线更新只记录内部辅助声明，不表示内部模块成为受支持入口；后续 SDK 重命名增量见下一段。

随后 SDK 增加 `renameSheet(name, sheetId?): void`、`SheetRenameEvent` 和可选 `SpreadsheetOptions.onSheetRename`。本次基线差异只涉及 `sdk/index.d.ts` 的上述三个增量，其余 13 个声明文件、包 exports 均未改变。重命名不发送单元格/行列结构事件；宿主持久化需监听新增事件。重命名与结构事务共用十个快照历史上限，详见 SDK.md 与 CHANGELOG.md。NodeNext/Bundler 的安装包消费示例包含方法调用与事件类型检查。

富文本阶段新增 `RichTextStyle`、`RichTextRun` 和可选 `Cell.richText`。逐文件对比只改变 `lib/types.d.ts`，其余声明及包 exports 不变；安装包消费检查覆盖新增类型。普通 setCell 修改文字会清除旧片段，等值文字保留，完整单元格 setCells 要求片段和值一致。XLSX 已支持片段从原来的静默扁平化改为保留，未支持属性现在明确拒绝；这是导入行为变化，迁移限制见 RICH-TEXT.md。

上下标阶段仅在 RichTextStyle 增加可选 verticalAlign、fontFamilyClass、charset；逐文件核对其余 13 个声明及 exports 不变。有效值及显示规则见 RICH-TEXT.md，安装包消费示例检查三个字段。

- 修复遵守既有文档的错误、内部性能改进不应改变已支持输入的正常结果。
- 新增可选参数、独立方法或功能需要类型与行为回归；错误码和事件变化须在变更日志中列明，避免悄悄破坏穷尽处理。
- 删除/重命名公开成员、改变既有参数含义、取消受支持格式或改变同步/异步返回契约，需要主版本升级或明确的兼容过渡。
- `src/` 内部模块、`dist/sdk` 私有分包文件名、React 渲染桥与 `.surface()` 不属于宿主 API。只依赖包根和文档 CSS 子路径。
- 浏览器 API 能力、文件配额、公式子集与性能适用条件始终以兼容文档为准；不声称所有 Excel/SpreadJS 行为属于承诺契约。

## 0.23 导入行为迁移

新增 `ImportOptions.signal` 和 `IMPORT_CANCELLED` 错误码。以前迟到导入会覆盖当前内容，现在成功编辑/替换、后续导入或销毁会拒绝旧导入。调用者必须处理 Promise；需要强制导入时，应在编辑操作完成后重新发起，不应忽略取消后假定数据已替换。取消不会保证底层文件解析立即停止。

发布流程按 SemVer 路由：0.x 开发线和带预发布后缀的版本使用 npm `next`，首个 1.x 及以后无预发布后缀的正式版本使用 `latest`；GitHub Release prerelease 标志必须一致。此配置不证明 npm 权限已打通，实际发布另行验收。


SDK 多工作表增量：新增 `ActiveSheetChangeEvent`、可选 `onActiveSheetChange`、`sheetInfos` 和 `setActiveSheet(sheetId)`。本次逐行比较构建声明：仅 `sdk/index.d.ts` 增加上述接口，其余 13 个声明文件与包 exports 不变；安装包 NodeNext/Bundler 消费示例检查事件类型与方法调用。行为修复包括分页快照只读及拒绝不完整导出、静态活动表 CSV 不误用另一张表的分页源。切表允许只读，保留编辑历史和正在进行的导入；详见 SDK.md。基线更新不代表浏览器验证或完整商业兼容通过。


分页计算增量：EvaluatorOptions 新增可选 readPagedCell 回调。逐行基线比较仅 lib/engine.d.ts 增加一行，其余 13 文件与包 exports 不变；安装包消费示例使用此选项。分页表在缺少读取器/数据时计算返回 #N/A，替代此前错误地按空白计算的行为；SDK 自动接入有界缓存。回调同步且不得取数，undefined 与 null 的语义见 INCREMENTAL-CALC.md。


CSV 冻结结果修复增加内部 WorkbookExportOptions.frozenCsvValues（ReadonlyMap<string, CellValue>）。此选项用于 SDK 与 IO 之间传递结果，不是根入口 LuminaSpreadsheet.export 的公开参数。契约检查仍覆盖随包声明，基线逐行差异仅 lib/io.d.ts 增加该可选字段，其余 13 个文件及包 exports 不变。之前检查按预期拒绝此差异，复核后更新基线；根入口导出用法保持不变。

0.29 静态 CSV 流行为修正：chunkRows 现在要求正安全整数，原先对 0/负数/小数的隐式修正不再保留，NaN/Infinity 拒绝；引号/换行分隔符与非 LF/CRLF 行尾拒绝。流从首次读取开始工作，取消不再被空表或最终进度吞掉；分块行数是上限，另有文本长度触发行末输出。函数签名和 exports 不变，调用方不得依赖精确分块数量或把取消后的部分字节当完整文件。

0.29 视区分页完整性：已知总行数时不再接受缺行的成功页面，返回 DATA_SOURCE 错误并允许重试。接口提供方应遵守 offset/limit 和 totalRows；用空数组表示实际空行，不能删除中间行。未知总数的缓存行为不变，未改变函数签名。

0.29 hydrateSheetPage 短行修正：返回行按数据源列数完整覆盖，尾部省略列现在等同空字符串，清除该范围旧单元格。未返回行与范围外列仍保留，已知总数缺行拒绝；函数不修改输入、不提交历史，签名未改变。


0.29 视区总数变更：已知总数变化时，旧页和错误失效，其他在途页以 AbortError 取消；调用方应处理取消并重新请求所需视区。旧尾页的短 limit 响应不再作为增长后的完整页缓存。首次发现总数会移除不完整/越界缓存，总数不变时不刷新。该行为收紧避免混用旧尺寸数据，公开声明未改变；不承诺内容版本一致性或自动轮询。


0.29 底层导出保护：workbookToXlsx 在静态规范化前拒绝含分页表的输入；静态 CSV 三个公开入口拒绝活动分页表，不再把部分缓存序列化为成功文件。公开声明不变，行为与 SDK 实例的既有完整性要求对齐。分页数据调用独立的全源 CSV API；显式 toJSON 快照接口不改变。


0.29 JSON 分页元数据：validateWorkbook 不再丢弃已有 dataSource，保留经验证的 kind/totalRows/pageSize，未知扩展字段不复制。错误 kind、负数、非整数、超上限元数据明确拒绝。SDK load 和文件 import 同样拒绝错误元数据。此前将分页输入静默变为静态表的行为不再支持；公共声明无变化。


0.29 完整分页源静态化增量：新增 workbookFromReportData(source, options?) 和 ReportSnapshotOptions。构建后旧基线按预期拒绝；逐文件核对仅 lib/report-data.d.ts 增加 Workbook 类型导入、新选项接口和函数声明，其余 13 个声明文件及包 exports 不变。保留现有分页绑定和全源 CSV API；新函数要求完整且有界的数据源，不隐式截取已有缓存。取消以 AbortError 拒绝，其余数据/容量错误使用 Error/TypeError/RangeError，不属于 SDK 实例 LuminaError 码。具体容量、原始公式文字和源版本限制见 SDK.md。


0.29 手工输入转换增量：新增根导出 parseCellInput(value: string): CellValue。旧基线按预期拒绝；逐字比较仅新增 lib/cell-input.d.ts 和 sdk/index.d.ts 一条 re-export，其余 13 个既有声明及 exports 映射不变，声明总数 15。安装包 NodeNext/Bundler 类型消费及运行检查包含该函数；行为细节见 SDK.md。Canvas/公式栏不再吞掉下溢或小数舍入，不改变调用 setCell 时显式传入的数字或字符串类型。


0.29 计算结果类型增量：Evaluator 增加 result(sheet, key): EvaluationResult，新增 value/error 判别联合并从 SDK 根导出其类型。旧基线按预期拒绝；仅 lib/engine.d.ts 的新类型/方法与 sdk/index.d.ts 一条类型 re-export 改变，其余 13 声明及 exports 映射不变。原求值调用签名、错误码显示、缓存失效方法保持；手工实现 Evaluator 的接入方需补 result 方法。安装包类型和运行消费检查覆盖增量。


0.29 分页容量增量：ChunkCacheOptions 新增可选 maxPageCells/maxPageTextUnits；ReportChunkCache 提供同名只读有效上限，bindData 复用该选项类型。实际 pageSize 可能按列数缩小，行为变化已记入 MIGRATION。已审查声明差异，仅 report-data 与 SDK 引用两处发生上述变化，其余声明保持。


0.29 分页 CSV 容量增量：ReportDataCsvOptions 新增可选 maxPageTextUnits；ExportOptions 新增可选 pagedCsv（pageSize/maxPageTextUnits/maxRows）。审查声明差异仅 report-data-export 及 SDK 的类型引用/选项字段变化，其余 13 个声明和 exports 映射不变。默认超限行为收紧与降低页长重试方法记入 MIGRATION；实际安装包检查新增参数类型及容量拒绝。


0.29 REST 响应上限：RestDataSourceOptions 仅新增可选 maxResponseBytes；逐文件审查只改变 report-data 声明中的该字段，其余 14 声明及 exports 不变。默认 16 MiB 和标准 Response/body 要求的行为变化见迁移文档，安装包类型及运行时回归覆盖超限拒绝。

2026-09-23 增量：新增 `LuminaSpreadsheet.zoom` 只读 getter 与 `setZoom(value: number): void`，现有签名不变。运行时输入沿用构造选项的正有限数及倍率/百分比规则；此项为兼容性新增，已明确更新声明基线与安装包消费者检查。

2026-09-24 REST 重试退避增强：`restDataSource` 在可重试 HTTP 响应包含有效 `Retry-After` 时遵守服务端等待提示，同时受 `maxDelayMs` 上限约束；无效或过期值回退本地指数退避。公共类型和错误码不变，新增回归覆盖 429 响应、上限裁剪与成功重试。

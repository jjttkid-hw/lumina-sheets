# 稳定版发布证据

此目录目前没有已完成的稳定版验收记录。`stable-release.json` 只在真实验收结束后填写；不要把测试夹具或未执行的步骤复制成“通过”。

`npm run check:stable` 对正式的 1.0.0 及更高主版本生效。0.x 与带预发布后缀的版本只输出未声明稳定验收，不证明可商用或通过稳定版门槛。npm 工作流在上传、发布前执行检查。本地正式发布也必须先执行它。

记录包含：

- `schema: 1`、完整 `version`、实际待发布 tgz 的 `artifactSha256`。
- 验收记录必须有 `siteSha256`（安装包单独发布也用于绑定重复构建报告），对应 `build:site` 后整个 `dist/` 的内容摘要。运行 `node scripts/check-site.mjs` 获取摘要及逐文件清单；该命令只读取内容，不创建“已通过”记录。
- `browsers` 下 `chromium`、`firefox`、`safari`、`mobile-touch` 四项。每项填写实际 `browserVersion`、设备和操作系统 `environment`、执行时间 `executedAt`、复核人 `reviewer`、`status: "passed"`、报告路径 `report` 及原始文件 SHA-256 `reportSha256`。
- 每个浏览器的 `checks` 必须逐项为 `passed`：`render-zoom`、`editing-ime`、`layout-navigation`、`clipboard-validation`、`history-persistence`、`file-roundtrip`、`sdk-lifecycle`、`accessibility`。步骤参见 [浏览器验收矩阵](../BROWSER-ACCEPTANCE.md)。移动设备需记录实际浏览器与触控行为。
- `gates` 下 `performance`、`xlsx-corpus`、`frameworks`、`api`、`reproducibility` 五项，使用相同的执行时间、环境、复核人、状态和报告字段。性能报告应含原始测量及数据规模；文件语料报告明确来源与受支持子集；框架报告覆盖实际生命周期；API 报告记录契约结果；重复构建报告注明来源时间与两份制品哈希。

报告必须是仓库 `docs/acceptance/` 内的实际非空文件，路径不允许越界（包括符号链接）；文件内容的哈希必须与记录一致。门禁从实际 tgz 读取包名、版本及依赖清单，要求 errors、reviewItems、unresolvedVendorComponents 均为零且 issues 为空，不能用旁边更新后的 dist 清单替代旧包里的清单。

许可证检查还直接读取同一 tgz 中的 `THIRD_PARTY_NOTICES.txt`：逐个依赖核对所列正文的 UTF-8 字节数、SHA-256、许可正文标记及 `licenseCoverage`，重新计算声明许可的正文覆盖，并核对安装记录、名称版本和正文数量。缺失、重复或不一致的记录均拒绝；仅清空 summary/issues 不能放行。当前 schema 1 尚无预打包组件的已复核证据格式，因此存在 embedded components 时仍拒绝正式发布，不能靠修改组件 status 宣称已解决。未来完成上游取证后需明确审查记录格式及其验证方式。

这是一项可自动执行的证据完整性约束，不能自动判断截图、测量或人工结论是否真实，也不能代替许可复核。验收报告应提供可复现操作、实际结果及原始附件引用，并由维护者审核。

## 浏览器脚本报告完整性

仓库中的 `scripts/browser-*.mjs` 是真实浏览器运行器，不是报告生成器的离线替身。每个运行器在启动时声明本轮应执行的检查清单，并由 `scripts/browser-report.mjs` 在写出 `result.json` 前核对：

- 清单中的每个检查都实际产生一条结果；缺少检查、意外检查或重复检查都会使运行失败。
- 检查失败、页面异常、控制台错误、运行级异常都会使运行失败；只有所有声明检查通过且错误通道为空时才写入 `status: "passed"`。
- 导航、夹具初始化或检查流程在第一项检查前失败时，也会保留运行级错误和缺失检查，而不会因空数组的 `every()` 语义误写成通过；浏览器无法启动时不会产生通过记录。

这些字段只说明自动化运行是否完整，不证明 Safari、原生 IME、物理触控或屏幕阅读器已经完成验收；这些平台仍须按 [浏览器验收矩阵](../BROWSER-ACCEPTANCE.md) 单独记录真实环境、报告和哈希。

## 候选制品与记录提交

先生成与目标正式版同版本的候选包，记录该次构建使用的 `SOURCE_DATE_EPOCH`，完成真实验收并保留 tgz。填好验收记录后提交报告；仅新增证据的提交也会改变默认 Git 构建时间，因此正式发布必须显式沿用候选构建的来源时间。发布工作流读取仓库变量 `RELEASE_SOURCE_DATE_EPOCH`（若有），以便重建相同制品；未设置时沿用 Git 时间。若重建哈希不匹配，应排查输入差异并重新验收，而不是修改证据哈希来强行放行。

当前技术依赖门禁已通过（`0 errors / 0 reviewItems / 0 unresolvedVendorComponents`），并已有绑定同一站点与 SDK 摘要的 r18 Chromium、Firefox、WebKit 自动化候选及 macOS Safari 定向记录。它们仍不等于稳定版签署：原生中文 IME、真实 VoiceOver/NVDA/JAWS、实体移动触控、跨设备性能、完整 Excel/WPS 业务语料、npm registry 首发和商业法务复核仍未完成。本目录不提供虚假的已通过清单。

## 站点与安装包分别绑定

CI 在上传制品之前执行 `node scripts/check-stable-release.mjs --site`，正式 1.x 及以后必须同时匹配 tgz 和站点摘要。站点以 `build:site` 的 Pages 基路径为准；用 `build:all` 生成的根路径网页不能替代。摘要包括入口 HTML、JS/CSS、Worker、示例及 dist/sdk 中所有文件，新增/删除/更名或字节变化都会改变摘要。目录与文件不允许符号链接。

唯一排除的是根目录 `build-info.json`，它仅展示版本/提交追踪，提交验收报告后 commit ID 会改变；不可将运行时代码或配置放入这个文件。文件时间戳不参与摘要。摘要生成方法为按相对路径排序的 `{path,bytes,sha256}` 数组的 JSON 字节 SHA-256。

候选验收必须保留上述清单并实际使用对应站点完成工作空间、SDK 示例和性能验收。CI 与 npm 工作流都读取同一个 `RELEASE_SOURCE_DATE_EPOCH`，减少仅新增报告导致的打包时间差异。npm 包单独发布仍执行原来的包门槛，不表示站点已经部署。门槛验证证据绑定，不判断报告内容真实性；浏览器实测仍必须完成。


### 可重复性报告

正式候选应使用干净检出及明确的 RELEASE_SOURCE_DATE_EPOCH 运行 `npm run check:reproducibility`，并把 `artifacts/reproducibility/result.json`、inputs.json、两次站点清单和日志复制为仓库内报告，记录候选 tgz 与站点哈希。当前仓库的本地结果只证明同一工作区重复构建，不能填入 1.x 的 `reproducibility` 通过门禁；门禁还要求实际验收报告和清单哈希互相绑定。


重复构建门禁读取 `gates.reproducibility.report` 指向的原始 result.json，而不只接受 passed 标签或文件哈希。报告必须为 schema 1/passed、同版本、dirty=false，含有效 commit、输入摘要、来源 epoch 与一致的 ISO 时间及 Node/npm/平台/架构。必须恰好两次运行，记录一致，且站点和 tgz 摘要匹配验收账本，文件数/字节数为正整数。仅重新计算报告哈希无法让 dirty=true 或不一致产物通过。该项检查不证明报告真实执行，也不自动验证干净安装/跨机器复现；inputs.json、站点清单、构建日志仍需随报告保存并由维护者核查。不得把当前 dirty=true 本地结果改写成干净候选。

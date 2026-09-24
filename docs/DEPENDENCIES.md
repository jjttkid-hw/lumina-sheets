# 第三方依赖许可清单

## 当前权威状态（2026-09-24）

以当前工作树和已安装锁定依赖运行 `npm run check:licenses -- --strict` 的结果为：**92 个安装记录、82 个唯一名称/版本、127 份通知材料、0 个错误、0 个待审、0 个未解决预打包组件**。该结果是当前发布门禁的权威快照；下方按日期排列的段落保留为审计历史，较早记录中的失败计数不代表当前状态。每次修改生产依赖、ExcelJS 分包证据或许可材料后，都必须重新运行该命令并以新输出为准。

这项技术门禁只证明仓库内已收集的文本、哈希和安装树彼此一致，不构成权利人授权、专利风险或商业许可证义务已经完成的法律意见。npm 首次发布、注册表安装、Trusted Publisher provenance 和跨平台商业验收仍需单独留存证据。

2026-09-22 依赖替换：`exceljs@4.4.0` 的 Node 流式 XLSX 读取路径原本经 `unzipper@0.10.14` 引入 `binary@0.3.0`、`buffers` 和 `chainsaw`。这些历史包的 npm 元数据没有随包提供可验证的完整授权正文。项目现在通过根 `package.json` 的 npm `overrides` 固定 `unzipper@0.12.5`；该版本使用 `fs-extra`、`node-int64` 和 `bluebird`，不再安装这三个未能完成授权核验的包。ExcelJS 的内存 XLSX 读取、流式读取、取消和真实文件往返回归均继续通过；安装树和严格许可证清单均已重新生成。该替换只改变 Node 解压实现的依赖闭包，不改变 Lumina 对外 API 或浏览器 SDK 的接口。升级 ExcelJS 或 unzipper 时必须重新运行完整测试、安装包检查和许可证审计。

2026-09-22 `core-js` 证据增量：ExcelJS source map 内部的 `shared.js` 明确记录版本 `3.33.0`，全部 160 个 `core-js` 源文件均已与官方 `core-js@3.33.0` npm 归档逐字节匹配。清单绑定 npm integrity、归档 SHA-256、每个源文件摘要及归档内完整 MIT 正文。当前生成结果为 **140 份材料、0 个错误、2 项待审、6 个未解决预打包组件**；剩余项是 `@fast-csv/format`、`@fast-csv/parse`、`diffie-hellman`、`fast-csv`、`saxes`、`xmlchars`，strict 门禁仍失败。

2026-09-22 追加复核：`inherits` 的两个 ExcelJS source-map 路径已分别绑定官方 `inherits@2.0.4` 与 `inherits@2.0.1` 归档，并按多版本记录保存完整 ISC 正文。当前生成结果为 **140 份材料、0 个错误、2 项待审、7 个未解决预打包组件**；strict 门禁仍失败。

上述历史记录在 `core-js` 增量前保留作对照；以当前清单为准时，source map 共发现 68 个预打包组件名称，61 条 exact-source 版本记录已有可复核字节证据，6 个组件仍未解决。

2026-09-22 当前复核：在 ExcelJS browser source map 中，`browserify-sign@4.2.0`、`crypto-browserify@3.12.0`、`parse-asn1@5.1.6` 的源文件已逐字匹配官方 npm 归档；其中 JSON 文件按 `module.exports` 包装与原始 JSON 结构比较，并绑定归档完整性、源文件摘要和完整许可正文。当前生成结果为 **140 份材料、0 个错误、2 项待审、7 个未解决预打包组件**。未解决项是 `@fast-csv/format`、`@fast-csv/parse`、`core-js`、`diffie-hellman`、`fast-csv`、`saxes`、`xmlchars`；其中部分版本的 source map 字节与当前 npm 归档不一致，未被强行标记为 exact-source。`diffie-hellman` 归档缺少 LICENSE，`fast-csv` 系列和 `saxes`/`xmlchars` 仍需独立完整证据。严格门禁仍失败，版本保持 0.29.0，未发布 npm。

2026-09-22 最新：saxes 5.0.1 官方固定提交的 LICENSE 已接入清单与安装包；ExcelJS source map 新增 dayjs 三个源文件与官方 npm 归档的逐字校验。当前实际检查为 **138 份材料、0 个错误、4 项待审、46 个未解决预打包组件**，严格门禁仍失败。原文和来源记录见 [third-party/saxes-5.0.1](third-party/saxes-5.0.1/provenance.json) 与 `third-party/embedded/exact-sources/manifest.json`，官方 npm 包完整性与锁文件一致。dayjs 的 1.11.10、1.11.11、1.11.12 归档含相同的三份源字节，因此记录明确不把匹配结果当作历史构建版本的唯一证明；完整 MIT 正文仍逐字绑定到 1.11.10 归档。ExcelJS 浏览器 source map 中已有 22 个组件绑定完整性校验通过的官方 npm 归档和许可正文。

补充材料不伪装成 node_modules 自带文件：清单使用 kind=upstream-license-text、逻辑路径 @upstream/LICENSE，附完整 provenance；正文逐字收入 THIRD_PARTY_NOTICES.txt。构建和真实包安装检查固定核对名称、版本、包 integrity、来源 commit/URL、许可证 SHA-256 和字节数，缺失或篡改直接失败；更新依赖版本不会自动沿用旧版文本。材料来自官方版本但 tag 未签名，未证明源码到 npm 包的可重复构建，也不代表法律授权审查全部完成。该项仅关闭 saxes 缺失许可正文；binary、buffers、chainsaw 和 ExcelJS 内嵌组件继续待核实。

项目自有源码采用 [Apache-2.0](../LICENSE)，署名和项目声明见 [NOTICE](../NOTICE)。第三方依赖继续遵循各自许可证，不因本项目开源而改变。公开源码不包含 `node_modules` 或 `dist`；构建 SDK 时会复制本项目 LICENSE/NOTICE 并生成下列依赖材料。

运行 `node scripts/package-notices.mjs` 会读取当前项目的 `package.json`、`package-lock.json` 和已安装的 `node_modules`，生成：

- `dist/sdk/THIRD_PARTY_NOTICES.txt`：声明的许可、仓库信息和实际找到的上游许可/通知文本。
- `dist/sdk/dependency-inventory.json`：锁定版本、安装位置、依赖边、文本 SHA-256、问题列表和预打包组件证据。

不需要网络，不安装依赖。构建流程可在 SDK 输出目录生成后直接调用上述脚本，也可以从 ES module 包装脚本中使用 `await import('./package-notices.mjs')`。普通运行会在输出 JSON 摘要后结束；必需依赖缺失、锁定版本与安装版本不一致、显式 `UNLICENSED` 等错误使退出码为 1。许可材料不足标记为 `review`，普通构建仍生成产物。`node scripts/package-notices.mjs --strict` 会在任何 error 或 review 存在时返回 1，可作为后续商业发布审核门禁。产物即使存在未解决问题也会写出，便于人工复核。

## 清单范围

这是根 `dependencies` 的保守生产依赖闭包，递归包含依赖、必需 peer 和已锁定的 optional dependency；根 `devDependencies` 不会单独成为遍历起点。依赖解析遵循安装位置逐级向上的 `node_modules` 查找，并与锁文件的安装路径核对。同一名称不同版本或不同安装路径分别记录。由生产路径需要的包即使同时被开发工具使用，仍属于闭包。

它**不是 tree shaking 后最终浏览器包的精确 SBOM**。闭包会包含只用于 Node 功能的包，也可能不包含上游预构建文件已嵌入但未列入生产依赖的历史构建组件。因此，闭包数量不能用作浏览器最终依赖数量或已完成许可审计的证据。

脚本递归收集各依赖自身目录内名为 LICENSE、LICENCE、COPYING、NOTICE 及常见扩展名的文本，跳过嵌套 node_modules 和符号链接。各层 README 的明确 License 小节也会保留；无小节标题但包含可识别授权正文的 README 保留完整原文。完整许可文本与仅声明名称分开标记。没有许可元数据时不猜测 SPDX 标识；有元数据但缺少许可文本仍要求人工复核。清单不为 Lumina 自有产品设定或授予授权。

## ExcelJS 预打包边界

SDK 构建另生成并随包交付 `bundle-inputs.json`：来自 Rollup 实际分包的本地输入路径、文件 SHA-256、锁定包版本/完整性，以及每个输出 JS 的 SHA-256。虚拟 CommonJS 包装器不冒充本地源文件；路径不含开发机绝对目录。安装包检查逐个验证所有 JS 分包与该清单一致。

这项证据补充保守依赖闭包，不能替代它：`renderedLength` 是压缩前模块输出长度，不是每项依赖在最终包中的精确占比；预打包内部组件仍不从外层包版本推断身份。exact-source 记录只接受 source map 与官方归档逐字相同且归档含完整许可正文的组件；其余组件继续保持 unresolved。

当前安装的 ExcelJS 4.4.0 的 browser 入口是 `dist/exceljs.min.js`。其 `dist/LICENSE` 仅包含 Guyon Roche 的 MIT 文本，并不是所有预打包组件的逐项许可清单。

脚本读取随包安装的 `dist/exceljs.min.js.map`，按 source paths 提取内嵌组件名称，记录证据文件及其哈希。当前发现 **68 个组件名称**，包括 core-js、regenerator-runtime、crypto-browserify 等；其中 51 个有独立 exact-source 记录，其余 16 个许可审查状态仍为 `unresolved-vendor-bundle-review`；不会把本机同名包的当前锁定版本误写成 ExcelJS 历史打包版本。source map 的名称也不单独证明该组件在最终发布包中实际保留的代码数量。

源码映射确实内嵌 package.json 时，现在只解析 JSON 或字面 `module.exports =` 包装后的 JSON，绝不执行其中的 JavaScript。记录源路径、原文 SHA-256、声明版本与许可；名称不匹配、版本非法或非 JSON 内容不采信，多份声明冲突保留证据且不选定值。当前能从原始嵌入声明确认 elliptic 6.5.4 / MIT；exact-source 归档则同时绑定文件内容、npm integrity 和许可正文。该声明不是完整许可文本，也不是安全漏洞审查结果，仍有 16 项待完成许可核验，严格门禁不因此放行。

商业再分发前，需要确认这些预打包源的实际版本、对应完整许可和通知义务，或改用可准确追踪的构建输入后重新生成。当前清单如实记录缺口，**商业授权审计尚未通过**。

2026-09-20 补充：生成器现保留源映射中以版权声明、许可授予及免责文字组成的文件头注释，逐份记录原始源文件与注释 SHA-256，不执行源代码。实际找到 core-util-is、events、readable-stream、stream-browserify、string_decoder、util 六个组件的 15 份源注释，已收入 THIRD_PARTY_NOTICES.txt 和清单的 noticeEvidence，并核对实际 tgz 内存在这些原文。注释属于特定源文件的证据，不能证明组件全部文件或具体版本的完整许可，因此 68 项预打包组件与 5 项复核问题仍未关闭。

尝试从 saxes 上游版本读取缺失 LICENSE 时，受限网络无法解析主机；联网申请在执行前遇到自动审批服务 503（请求编号 `202609201223319828356368268d9d69Xciy3I2`）。未获取该文件，也未用通用 ISC 模板或其他版本文本补写授权。

## 当前生成验证

2026-09-21 预打包证据绑定：清单新增 ExcelJS browser 入口的实际字节长度与 SHA-256，安装包检查将其与 Rollup 实际输入记录及当前上游文件逐一对照；同时重新核验 source map 字节哈希，并从原始映射重新提取每项元数据、完整文件头和部分署名。文件变化或证据文本被改写会失败。此项不证明 source map 与压缩代码的语义对应、不补齐未知版本或许可，也不关闭现有待审项。官方 saxes LICENSE 本轮再次因 DNS 失败和审批服务 503（202609202029006039259218268d9d6rr5XxctT）未取得。

2026-09-18，本地普通生成成功：102 个生产闭包安装记录、89 个不同名称/版本组合、135 份许可文件或 README 小节证据、0 个完整性错误、5 项人工复核问题。严格模式如预期返回退出码 1。

未解决事项为：

- `saxes`：声明 ISC，但安装包未找到完整许可文本。
- `binary`：声明 MIT，README 仅声明名称，缺少完整许可文本。
- `buffers`：未找到许可元数据或许可文本。
- `chainsaw`：声明 MIT/X11，但安装包未找到完整许可文本。
- ExcelJS 预打包组件：47 个名称的具体打包版本和对应许可仍待核实；21 个组件已有可复验技术证据（elliptic 加 20 个 exact-source 归档）。

依赖更新后应重新生成并以 JSON 实际输出为准。此文件记录技术证据和核验边界，不替代权利人的授权或法律审核。

0.24 起清单时间来自 `SOURCE_DATE_EPOCH` 或 Git 提交时间，并标注 timestampSource；无来源时为 null。此变化只消除墙钟引入的构建差异，不解决上述许可审查缺口。

2026-09-22 exact-source 增量：ExcelJS browser source map 中的 `buffer/index.js` 已逐字匹配官方 `buffer@5.2.1` npm 归档。清单绑定 MIT 正文、npm integrity、归档 SHA-256 和源文件 SHA-256；归档已随安装包重新核验。未解决预打包组件从 17 降至 16，4 项待审仍保留，严格发布门禁继续阻断。


2026-09-20 部分署名补充：除已有 15 份含授权/免责的文件头，现另收入 11 个组件的 13 份简短源文件署名（buffer、8 个 lodash 子包、regenerator-runtime、sha.js）。保留逐源文件与逐注释哈希，并标为 attributionEvidence；这些原文可能仅指向外部 LICENSE，不能证明完整授权或包版本，也不会关闭待审项。安装包消费校验确认所有 noticeEvidence/attributionEvidence 的文本哈希、源路径和通知文件收录一致。

本轮再次读取 saxes v5.0.1 官方 LICENSE：受限网络 DNS 失败，联网审批在执行前返回 503，请求编号 `202609201437472365196208268d9d6OkhlCDJG`。未获取上游文件；该历史记录不覆盖当前已绑定的 saxes 证据，现有 4 项待审与 51 项未解决预打包组件以 `check:licenses` 输出为准。


2026-09-21 许可文本识别加固：不再仅因文件名为 LICENSE/NOTICE 就当作授权正文。每项证据新增 hasLicenseText，根据授权、保留声明及免责条款的保守文字特征判断；仅名称、链接、署名、截断授予文字仍要求复核。识别器只覆盖当前常见许可形态，不解析完整 SPDX 表达式，也不能证明 AND 组合的每项义务均已履行或代替法律审核；无法识别的其他合法文本仍需人工核验。

现在收录子目录 README 中的原始授权，包含 pako 1.0.11 的 lib/zlib/README 内 Zlib 文字和源作者署名（此前只有根 MIT 文件）。清单为 137 份文件/小节证据，0 个错误、5 项待审、68 个未解决预打包组件，未关闭原待审项。安装包检查逐项对照已安装上游原文，核验文本哈希、长度、识别标记及通知文件收录；JSZip 的 lib/license_header.js 仅含链接，hasLicenseText=false，仍保留其完整 LICENSE.markdown 作为授权文字证据。

本次官方 saxes v5.0.1 LICENSE 再次读取失败：受限网络 DNS 失败，联网申请在执行前遇到审批服务 503（20260920163220753854948268d9d6FkxCWJuy）。没有取得或补造缺失授权。


2026-09-21 声明与正文对应检查：每个安装记录新增 licenseCoverage，报告识别到的正文家族、声明表达式是否支持及 text-evidenced/review 状态。AND 要求所有分支有相应正文，OR 允许已证明的一条路线；当前识别 MIT、ISC、BSD-3-Clause、Apache-2.0、Unlicense、Zlib，并支持本地历史 MIT/X11 声明作为 MIT 家族别名。GPL-3.0-or-later 可以作为表达式操作数，但尚无其正文识别器，不能独立通过；JSZip 的 MIT 路线有实际正文。无法识别的名称、WITH 例外及非法表达式保持 review，不推测授权。

这替代此前“找到任意一份正文即可”的弱判断：pako 必须同时有 MIT 和 Zlib 文本，缺少其中任何一份都新增 LICENSE_DECLARATION_UNEVIDENCED 待审。安装包检查从上游原文重新计算每项 coverage 并逐项对比。仍是保守文字证据分类，不是完整 SPDX/法律求值、权利人核验或许可义务全部履行的结论；复杂组合必须人工复核。实际清单仍为 137 份材料、5 项待审、68 个未解决预打包组件，没有关闭原有缺口。


2026-09-21 组件目录完整性：生成与安装包核验共用原始 source map 组件/路径提取器；验证完整目录，拒绝删除组件、重复组件、遗漏源路径或清空组件列表。该检查补上此前仅逐项验证已列记录的缺口，不补齐授权正文，5 项待审和 68 个组件待核验状态不变。


2026-09-21 elliptic 增量：ExcelJS 内嵌 elliptic 6.5.4 的 15 个 JS 源文件逐字匹配官方 npm tarball，MIT 正文在 README 中完整取得并纳入包。来源、摘要和验证见 [证据](third-party/embedded/elliptic-6.5.4/README.md)。未审内嵌组件计数从 68 降到 67；reviewItems 仍为 4（binary、buffers、chainsaw 及 ExcelJS 整体内嵌依赖）。check:licenses 严格检查和正式版门禁仍拒绝发布。新包 640474 字节，SHA-256 b9b1cd84ea6a7719b20e1a0876b01ffa82e26531f146f1dad193b656095972ec；此增量不是法律/安全审计签署。

2026-09-21 exact-source 增量：又将 ExcelJS 浏览器 source map 中 16 个组件的源文件逐字绑定到完整性校验通过的官方 npm tarball，并保存包内 LICENSE/README 许可正文与 `manifest.json`。已审组件从 17 增至 18，未解决内嵌组件从 67 降至 51；reviewItems 仍包含 ExcelJS 预打包闭包及 binary、buffers、chainsaw。该证据只证明所列字节和正文来源，不推断缺失的组件版本，也不替代法律审查；严格发布门禁仍保持阻断。

2026-09-22 exact-source 增量：继续绑定 ExcelJS 浏览器 source map 中的官方 `buffer@5.2.1` 源文件，并保存 npm registry 地址、integrity、归档 SHA-256、源文件 SHA-256 与完整 MIT 正文。当前安装闭包清单为 102 个安装记录、89 个唯一名称/版本、138 份通知材料；严格检查仍为 4 项 review，未解决内嵌组件为 16 个。`binary`、`buffers`、`chainsaw` 及 ExcelJS 预打包闭包仍需人工复核，不能据此发布商业稳定版。

2026-09-22 供应链复核增量：为 `@fast-csv/format@4.3.5`、`@fast-csv/parse@4.3.6`、`fast-csv@4.3.6`、`xmlchars@2.2.0`、`saxes@5.0.1` 和 `diffie-hellman@5.0.2` 保存官方 npm 归档、integrity、归档摘要与完整许可证正文。source map 中的对应源文件逐项绑定；对 TypeScript/Babel 生成文件使用固定 Babel 7.29.7 插件链和显式单行生成差异记录，JSON 只按字面 `module.exports` 解析。ExcelJS 预打包组件未解决数已降为 0；当前严格门禁只剩 `binary@0.3.0` 的完整 MIT 授权正文缺失，`check:licenses --strict` 仍返回非零，不能发布 `1.0.0` 或稳定 npm 标签。

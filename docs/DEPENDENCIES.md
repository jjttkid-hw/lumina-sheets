# 第三方依赖许可清单

项目自有源码采用 [Apache-2.0](../LICENSE)，署名和项目声明见 [NOTICE](../NOTICE)。第三方依赖继续遵循各自许可证，不因本项目开源而改变。公开源码不包含 `node_modules` 或 `dist`；构建 SDK 时会复制本项目 LICENSE/NOTICE 并生成下列依赖材料。

运行 `node scripts/package-notices.mjs` 会读取当前项目的 `package.json`、`package-lock.json` 和已安装的 `node_modules`，生成：

- `dist/sdk/THIRD_PARTY_NOTICES.txt`：声明的许可、仓库信息和实际找到的上游许可/通知文本。
- `dist/sdk/dependency-inventory.json`：锁定版本、安装位置、依赖边、文本 SHA-256、问题列表和预打包组件证据。

不需要网络，不安装依赖。构建流程可在 SDK 输出目录生成后直接调用上述脚本，也可以从 ES module 包装脚本中使用 `await import('./package-notices.mjs')`。普通运行会在输出 JSON 摘要后结束；必需依赖缺失、锁定版本与安装版本不一致、显式 `UNLICENSED` 等错误使退出码为 1。许可材料不足标记为 `review`，普通构建仍生成产物。`node scripts/package-notices.mjs --strict` 会在任何 error 或 review 存在时返回 1，可作为后续商业发布审核门禁。产物即使存在未解决问题也会写出，便于人工复核。

## 清单范围

这是根 `dependencies` 的保守生产依赖闭包，递归包含依赖、必需 peer 和已锁定的 optional dependency；根 `devDependencies` 不会单独成为遍历起点。依赖解析遵循安装位置逐级向上的 `node_modules` 查找，并与锁文件的安装路径核对。同一名称不同版本或不同安装路径分别记录。由生产路径需要的包即使同时被开发工具使用，仍属于闭包。

它**不是 tree shaking 后最终浏览器包的精确 SBOM**。闭包会包含只用于 Node 功能的包，也可能不包含上游预构建文件已嵌入但未列入生产依赖的历史构建组件。因此，闭包数量不能用作浏览器最终依赖数量或已完成许可审计的证据。

脚本递归收集各依赖自身目录内名为 LICENSE、LICENCE、COPYING、NOTICE 及常见扩展名的文本，跳过嵌套 node_modules 和符号链接。顶层 README 的明确 License 小节也会保留；完整许可文本与仅声明名称分开标记。没有许可元数据时不猜测 SPDX 标识；有元数据但缺少许可文本仍要求人工复核。清单不为 Lumina 自有产品设定或授予授权。

## ExcelJS 预打包边界

当前安装的 ExcelJS 4.4.0 的 browser 入口是 `dist/exceljs.min.js`。其 `dist/LICENSE` 仅包含 Guyon Roche 的 MIT 文本，并不是所有预打包组件的逐项许可清单。

脚本读取随包安装的 `dist/exceljs.min.js.map`，按 source paths 提取内嵌组件名称，记录证据文件及其哈希。当前发现 **68 个组件名称**，包括 core-js、regenerator-runtime、crypto-browserify 等。它们的构建版本和许可状态标记为 `unresolved-vendor-bundle-review`；不会把本机同名包的当前锁定版本误写成 ExcelJS 历史打包版本。source map 的名称也不单独证明该组件在最终发布包中实际保留的代码数量。

商业再分发前，需要确认这些预打包源的实际版本、对应完整许可和通知义务，或改用可准确追踪的构建输入后重新生成。当前清单如实记录缺口，**商业授权审计尚未通过**。

## 当前生成验证

2026-09-18，本地普通生成成功：102 个生产闭包安装记录、89 个不同名称/版本组合、135 份许可文件或 README 小节证据、0 个完整性错误、5 项人工复核问题。严格模式如预期返回退出码 1。

未解决事项为：

- `saxes`：声明 ISC，但安装包未找到完整许可文本。
- `binary`：声明 MIT，README 仅声明名称，缺少完整许可文本。
- `buffers`：未找到许可元数据或许可文本。
- `chainsaw`：声明 MIT/X11，但安装包未找到完整许可文本。
- ExcelJS 预打包组件：68 个名称的具体打包版本和对应许可仍待核实。

依赖更新后应重新生成并以 JSON 实际输出为准。此文件记录技术证据和核验边界，不替代权利人的授权或法律审核。

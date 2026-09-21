# elliptic 6.5.4 上游材料

官方 npm 版本端点与 tarball 见 registry-evidence.json。下载 tarball 的 SHA-512 integrity 与 SHA-1 均实际核对一致，见 archive-verification.json。ExcelJS 4.4.0 browser source map 含 16 条 elliptic 路径：15 个 JS 源文件逐字匹配官方 tarball，另 package.json 字面 JSON 声明 elliptic 6.5.4 / MIT。source-comparison.json 保存全部 15 个源文件摘要；provenance.json 记录来源和版本。LICENSE 是官方 README 中 LICENSE 小节至文件末尾的原文，包含其尾部链接引用，不是自写模板。

已额外下载 registry gitHead 对应 GitHub codeload 源码；该提交没有独立 LICENSE 文件，正文实际位于 README。当前证据以 npm tarball 为比对依据。

校验器固定来源与完整比对清单摘要，逐项核对 source map 内容、文件覆盖和许可正文。包中保存来源记录及许可全文，check:sdk 重新核对。此为来源/正文技术证据，不是法律或漏洞审计。稳定版 schema 1 门禁仍拒绝所有非空 embedded component 列表，不能仅据 status 或 summary 清零放行；后续需在全部取证完成后设计并审核稳定版证据格式。

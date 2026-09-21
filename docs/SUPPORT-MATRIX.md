# Lumina Sheets 支持矩阵

这份矩阵定义当前 0.29 开发线和未来 1.x 稳定线的实际范围。它是产品边界，不是对 SpreadJS、Excel 或浏览器性能的等价承诺。

| 能力 | 当前实现 | 1.0 进入条件 | 明确不承诺 |
| --- | --- | --- | --- |
| Canvas 工作表 | 稀疏静态表、冻结、隐藏、筛选、合并、键盘编辑、公式栏、撤销/重做 | 四类真实浏览器核心闭环通过并绑定候选制品 | 百万实存格结构编辑恒定帧时间 |
| 分页数据 | 只读视区缓存、取消、重试、CSV 全量流式导出 | 真实 SDK 示例完成切表、重绑、销毁和下载验收 | 通过视区缓存自动完成全源 XLSX/PDF/JSON |
| 公式 | 文档列出的安全子集、依赖失效、跨表引用、分页缓存值 | XLSX 语料和真实浏览器结果与支持表一致 | 450+ Excel/SpreadJS 函数、动态数组、3D/结构化引用 |
| 文件 | JSON/CSV/TSV；XLSX/PDF 支持文档列出的子集 | 合成与脱敏 XLSX 语料往返、拒绝边界和报告绑定 | 完整 Excel 对象、图表、透视表、矢量 PDF |
| 输入校验 | 整数、小数、文本长度、列表；批量原子拒绝 | 浏览器键盘、焦点、IME、移动触控闭环 | 服务端权限边界或持续约束所有依赖公式 |
| SDK | 独立 ESM、CSS、TypeScript 声明、普通 JS/React/Vue 生命周期示例 | 实际挂载/销毁/重挂载矩阵和 API 契约绑定 | CommonJS、SSR Canvas 渲染、云同步 |
| 浏览器 | 需要 ES modules、Canvas 2D、ResizeObserver、AbortController、Web Streams | Chromium、Firefox、Safari、移动触控各完成矩阵 | 未测浏览器、屏幕阅读器和设备的性能推断 |
| 商业交付 | Apache-2.0 项目许可，包内带第三方材料 | 依赖清单 `errors/reviewItems/unresolvedVendorComponents` 全为 0，并完成权利人/法务复核 | 当前待复核材料未形成商业授权结论 |

## 稳定版证据规则

1. 所有报告必须引用同一站点摘要、SDK tgz SHA-256 和来源时间。
2. 自动化测试、DOM/hooks 替身、Node 性能不能替代真实浏览器、真实下载或真实 Excel 应用证据。
3. 未覆盖的能力应写成“不支持”或“未验证”，不能仅通过升版本号进入 1.0.0。

详细步骤见 [浏览器验收矩阵](BROWSER-ACCEPTANCE.md)、[v1.0 计划](V1-PLAN.md) 和 [API 稳定性](API-STABILITY.md)。

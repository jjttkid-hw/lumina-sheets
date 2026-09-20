# Lumina 灵表

Lumina 是一个可直接嵌入网页的 JavaScript 表格与报表组件，目标是对齐 SpreadJS Report 性能页描述的前端能力：Canvas 视区绘制、百万逻辑行、分片数据、浏览器内公式和文件导出。后端只需提供分页数据接口，宿主网页不需要 React。本项目为独立开源项目，非葡萄城官方产品，与葡萄城及 SpreadJS 无隶属或授权背书关系。

## 运行与构建

```sh
npm install
npm run dev
npm test
npm run build:all
```

开发页：`http://127.0.0.1:5173/examples/report.html`。其中“行列编辑”工具可直接插入、删除当前选区所在行列并撤销。性能实验室：`http://127.0.0.1:5173/performance`。

`npm run build:all` 会生成 `dist/sdk/`：

- `lumina.js`：ES module，可由普通 JavaScript 使用；
- `lumina.css`：组件样式；
- `types/sdk/index.d.ts`：TypeScript 类型；
- `example.html`：不依赖 React 宿主的完整示例；
- ExcelJS 处理包：只有 XLSX 导入导出路径需要它。

```html
<link rel="stylesheet" href="./lumina.css" />
<div id="report" style="height:600px"></div>
<script type="module">
  import { createSpreadsheet } from './lumina.js';
  const grid = createSpreadsheet(document.querySelector('#report'));
  const records = [{ month: '1月', revenue: 100000, cost: 60000 }];
  grid.report(
    {
      name: '经营报表',
      layout: 'list',
      columns: [
        { field: 'month', title: '月份' },
        { field: 'revenue', title: '营收', aggregate: 'sum', format: 'currency' },
        { field: 'cost', title: '成本', aggregate: 'sum', format: 'currency' },
        { field: 'profit', title: '利润', formula: '=B{row}-C{row}', aggregate: 'sum' },
      ],
    },
    records,
  );
</script>
```

## 已交付能力

- Canvas 双向视区裁剪，逻辑坐标支持最多 1,048,576 行和 16,384 列；滚动条使用有界物理范围映射，不为百万行创建 DOM。
- 合并单元格索引、冻结行、列宽、复制粘贴、填充、IME 编辑、键盘导航和一个无障碍代理单元格。
- `ReportChunkCache` 有界 LRU 分页缓存、重复请求合并、取消、失败重试和 REST/数组数据源；视区只取需要的页。
- 列表、最多 8 级分组小计、交叉统计报表；模板公式占位符、39 个安全公式函数（包含 CONCATENATE 别名）、条件规则和静态样式。
- `setCell` / `setCells`、撤销重做、单格原始值和计算值读取、选择、数据源状态事件、稳定错误码、JSON 快照和只读模式。
- v0.7 增加稀疏行高、隐藏行列、SUMPRODUCT 加权数组计算，以及 Canvas 虚拟化布局支持；XLSX/JSON 往返与 SDK 撤销重做保持一致。
- v0.8 PDF 跳过隐藏行列，保留可见合并区域和原始坐标分页；打印版式、公式、可编辑公式栏、导出进度与取消均有可操作演示。
- v0.9 支持筛选后的合并区域显示与原锚点编辑，以及行高、列宽、隐藏行列、冻结行的一次批量设置与撤销；示例新增“筛选合并区域”和“批量布局”。
- v0.10 默认仅对可见单元格复制、剪切、删除、粘贴和填充；跳过隐藏/筛除行列，保留原公式坐标偏移，可切换为全部单元格。目标不足或合并冲突时整批拒绝。
- v0.11 增加可撤销的多列整行排序：按计算值稳定排序，默认跳过隐藏行，整行单元格及样式一起移动；公式相对引用按行平移，冻结表头和合并冲突明确拒绝。
- SDK 编辑按依赖失效缓存，独立公式保留结果；范围依赖使用动态 AVL 矩形索引，公式解析缓存限制为 4,096 条。
- 订单填报支持列表、整数、小数、文本长度校验；粘贴和批量写入先验证全部候选值，失败整批拒绝。
- 打印设置支持 A4/A3/Letter、横竖方向、页边距、重复行列和手动分页，随 JSON 保存并可撤销重做。
- XLSX、CSV、JSON、PDF；XLSX 可往返受支持的输入规则与纸张、边距、重复标题、双轴手动分页；分页源完整 CSV 支持取消和进度。
- 性能实验室实际生成 10 万/100 万存储单元格、百万逻辑行，单独测量 Canvas、可见编辑和 Web Worker 公式。

## 边界与商业发布前工作

接入 API 与完整示例见 [docs/SDK.md](docs/SDK.md)，函数语义与限制见 [docs/FORMULAS.md](docs/FORMULAS.md)。

SDK 分页模式是只读的，分页 CSV 会逐页扫描完整数据源；其他分页格式会明确拒绝，避免把视区缓存误当成完整文件。CSV Blob 会暂存完整输出，超大文件应使用流；分页源应提供稳定快照和 `totalRows`。缓存遇到未知总数先使用逻辑上限，仅在收到 `totalRows` 后更新滚动尺寸；分页 CSV 扫描在总数仍未知时以短页确认结束。

SDK 的条件规则在 XLSX/PDF/JSON 导出时固化成当前单元格样式，不写入 Excel 动态条件格式。PDF 是 Canvas 栅格报表，中文可读但没有可选择文字、图表或完整 Excel 打印保真，限制与验收见 [docs/PDF.md](docs/PDF.md)。

SDK 编辑公式是同步安全解析器，每批编辑仅使受影响依赖失效，读取时按需重算；范围订阅通过每表动态 AVL 矩形索引查找，跳过不相交子树。大量重叠仍可能遍历很多节点，大范围求值仍需访问成员。性能实验室和工作区另有版本化 Worker。工作区旧编辑路径仍含整表历史/分析扫描，不应拿来承载百万格热编辑；百万规模请使用 SDK 分片模式和补丁 API。实现口径见 [增量计算](docs/INCREMENTAL-CALC.md)。

结构编辑由 SDK 同步执行，扫描全工作簿的已存储单元格与公式，并为受影响工作表保留前后快照；结构历史最多 10 次，与普通编辑保持有序撤销。它不为逻辑空白网格分配密集对象，也不保证百万实存单元格能即时完成插删。普通单格编辑仍使用增量失效。可操作入口为 [examples/report.html](examples/report.html)，“主工作空间”的旧编辑器尚未接入这些结构命令。语义见 [STRUCTURE.md](docs/STRUCTURE.md)、[STRUCTURE-FORMULAS.md](docs/STRUCTURE-FORMULAS.md)，接口与事件见 [SDK.md](docs/SDK.md)。

数据校验只拦截直接编辑的单元格，既有值与未编辑的依赖公式可用 `validateCell` 检查；撤销重做恢复历史。JSON 保留完整 SDK 规则与打印设置。v0.5 的 XLSX 双向转换支持常量数值/长度规则、受限内联文本列表，以及 A4/A3/Letter、方向、边距、前导重复标题和行列手动分页；超出子集时明确拒绝。XLSX 不保留规则 ID，也不保证 Excel 的类型、大小写或 Unicode 长度行为与 SDK 相同。见 [数据校验](docs/DATA-VALIDATION.md)、[XLSX 验证兼容](docs/XLSX-VALIDATION.md) 和 [XLSX 打印兼容](docs/XLSX-PRINT.md)。

当前不宣称 SpreadJS 的 450+ 函数、完整 Excel 兼容、图表/透视表设计器、多人协作、账号权限、云端存储、支付、AI 服务或官方页面中的 CPU/网络/并发数字。性能结论只能引用 [docs/PERFORMANCE.md](docs/PERFORMANCE.md) 中带设备、规模和脚本的实测结果。

已生成生产依赖清单、上游许可文本和预打包组件证据，仍有需人工复核的缺口，商业授权审计尚未通过，见 [依赖许可](docs/DEPENDENCIES.md)。商业发行前仍需固定版本 API、扩大 Excel 兼容语料、模板设计器、更多验证与打印兼容、浏览器认证及企业支持体系。

## 开源与参与贡献

Lumina Sheets 项目代码采用 [Apache License 2.0](LICENSE)。第三方依赖继续遵循各自许可证，许可材料与待复核事项见 [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md)。

欢迎提交问题复现、兼容性用例、文档改进和 Pull Request。开发环境、验证命令及提交要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。请使用脱敏或合成数据，不要在公开 Issue、代码或测试文件中上传真实业务数据、个人信息或密钥。

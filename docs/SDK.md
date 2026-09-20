# JavaScript SDK 接入

SDK 包名为 `lumina-report-sdk`。首次 npm 发布前，从 CI 的 `npm-package` 产物下载 `.tgz`，或本地执行 `npm run build:sdk && npm run check:sdk` 生成可安装包：

```sh
npm install ./lumina-report-sdk-0.14.0.tgz
```

在支持 CSS 的浏览器打包项目中接入：

```js
import { createSpreadsheet } from 'lumina-report-sdk';
import 'lumina-report-sdk/style.css';
const grid = createSpreadsheet(document.getElementById('sheet'));
```

包含严格 TypeScript 类型，支持 `NodeNext` 和 `Bundler` 模块解析；宿主不需要 `react` 或 `@types/react`。挂载仅适用于浏览器 DOM/Canvas，不支持服务端渲染或 CommonJS。安装说明见 [NPM-README.md](NPM-README.md)，发布步骤见 [RELEASING.md](RELEASING.md)。

交付目录 `dist/sdk/` 可以整体放到任意静态网站；通过 HTTP(S) 加载，包含 ES module、CSS、可选 XLSX 分包与类型声明。宿主不必安装 React，组件内部已打包。使用前给容器明确高度。

```html
<link rel="stylesheet" href="./lumina.css" />
<div id="sheet" style="height: 560px"></div>
<script type="module">
  import { createSpreadsheet } from './lumina.js';
  const grid = createSpreadsheet(document.querySelector('#sheet'), {
    onChange: ({ sheetId, changes }) => console.log(sheetId, changes),
    onError: (error) => console.error(error.code, error.message),
    onDataStateChange: (state) => console.log(state.status),
  });
  grid.setCells([
    { key: 'A1', cell: { value: 10 } },
    { key: 'B1', cell: { value: '=A1*2' } },
  ]);
  console.log(grid.getValue('B1')); // 20
  // 页面卸载或容器移除前调用 grid.destroy()
</script>
```

## 常用方法

| API                                        | 用途与边界                                                    |
| ------------------------------------------ | ------------------------------------------------------------- |
| `setCell(address, value, style?)`          | 编辑单格，未指定样式时保留原样式                              |
| `setCells([{key, cell}])`                  | 原子批量编辑；`cell:null` 删除；每次最多 100,000 格           |
| `getCell(address)`                         | 获取单格的原始值/公式及样式隔离副本                           |
| `getValue(address)`                        | 获取当前计算结果；分页模式只返回已经缓存的值                  |
| `activeSheetInfo`                          | 常量级工作表元数据，用于尺寸与只读状态展示                    |
| `getSheetLayout(sheetId?)`                 | 仅复制稀疏布局元数据，不访问单元格                            |
| `setSheetLayout(partial, sheetId?)`        | 原子修改五个布局字段；等值配置不新增历史                      |
| `setFilter(text)` / `filterText`           | 静态行筛选视图；分页源不允许非空本地筛选                      |
| `setClipboardMode(mode)` / `clipboardMode` | 默认 `visible` 仅操作可见坐标；`all` 使用原始矩形             |
| `sortRows(request)`                        | 显式行范围稳定多键排序；整次验证和撤销，见 [SORT.md](SORT.md) |
| `activeSheet` / `toJSON()`                 | 整表/整本隔离快照，会复制已有数据，避免热路径轮询             |
| `select({row,col,endRow?,endCol?})`        | 零基坐标选择与滚动定位                                        |
| `undo()` / `redo()`                        | 补丁撤销历史，最多 100 个事务；只读模式拒绝                   |
| `load(workbook)` / `import(file)`          | 替换工作簿并清空历史；文件导入仍受独立配额限制                |
| `report(definition, records)`              | 在浏览器生成列表、多级分组或交叉统计                          |
| `setConditionalRules(rules)`               | 设置显示规则；导出时固化当前已存储单元格的样式                |
| `bindData(source, options)`                | 只读分页绑定；替换当前表的数据与布局                          |
| `retryData()` / `clearDataCache()`         | 显式重试当前视区 / 清空缓存并刷新                             |
| `dataSourceState`                          | 小型状态对象：idle/loading/ready/error、缓存和请求数量        |
| `export(format, options?)`                 | 下载 XLSX/CSV/PDF/JSON；支持取消与进度，见下文                |
| `destroy()`                                | 取消分页/导出、解除订阅、卸载画布；可重复调用                 |

只读选项限制编辑，不是权限隔离；持有 JS 数据的宿主仍能读取数据。来源访问权限应由宿主服务端控制。

## v0.9 布局批量与筛选

`getSheetLayout(sheetId?)` 返回 `columnWidths`、`rowHeights`、`hiddenRows`、`hiddenColumns`、`frozenRows` 的隔离副本，不读取单元格。`setSheetLayout(partial, sheetId?)` 省略字段时保留配置，显式 `undefined` 清除字段，传入映射/数组替换该字段；整个批量校验成功后只提交一个可撤销事务与一次 `onChange({sheetId, changes: []})`。等值配置不产生历史或事件，不清空重做。`setColumnWidth(col, width, sheetId?)` 与已有行高/隐藏方法复用此契约，取消隐藏只过滤稀疏已存储坐标。

v0.9 起 SDK 列宽校验统一为 `32–2000` CSS 像素，与 Canvas 实际边界一致；旧低于 32 像素的配置明确拒绝。行高为 `1–600`，冻结行及隐藏坐标受当前表尺寸约束。只读和分页表允许读取布局，拒绝修改。

`setFilter(text)` 去除首尾空白并更新静态表的本地行筛选；`filterText` 为只读 getter。筛选是视图状态，不改变数据、计算缓存、导出范围或历史；`load`/`bindData` 会清空。静态只读表可筛选；分页表非空筛选明确拒绝，需在数据源端查询后重新绑定。输入、隔离、错误与 `onRender` 回调边界详见 [SDK-LAYOUT.md](SDK-LAYOUT.md)。

## v0.10 可见单元格操作

构造选项 `clipboardMode` 与 `setClipboardMode(mode)` 接受 `'visible' | 'all'`，省略时为 `visible`；`clipboardMode` getter 返回当前模式。`visible` 下复制、剪切、删除、粘贴与填充跳过筛除行及隐藏行列；`all` 按原始坐标矩形操作。切换只通知视图，不改写工作簿、历史或计算版本，也不使筛选重新扫描；加载与绑定保留此偏好。

筛选尚未完成时，`visible` 交互明确拒绝，避免短暂未筛选视图改变操作范围；`all` 仍可按原始坐标操作。合并区域复制/清除仅处理原锚点一次；多格粘贴/填充遇到可见合并区域明确拒绝，单格粘贴可写入其原锚点。只读与分页实例允许切换模式，既有编辑限制继续生效；分页复制仍只读取已缓存数据，不代表完整数据源导出。完整契约见 [SDK-LAYOUT.md](SDK-LAYOUT.md)。

## v0.11 静态行排序

`sortRows({startRow, rowCount, keys, includeHidden?})` 按零基坐标的明确范围排序整行；每个键为 `{column, direction: 'asc' | 'desc'}`。支持最多 8 个键、100,000 行，默认保留隐藏行原位；筛选与选区不改变排序范围。返回 `{movedRows, changedCells}`，已排序时无操作。成功排序发一次普通 `onChange`，支持整次撤销重做并保留范围选区；目标输入规则失败则整批拒绝。

排序键使用移动前的当前计算值，计划不污染现有公式缓存。移动公式平移相对 A1 引用，区域外引用仍指向原坐标；布局、打印和规则保持原坐标。冻结区域、相交合并格、只读或分页表明确拒绝，不承诺完整 Excel 排序兼容。详细类型、混合值顺序、资源配额与公式边界见 [SORT.md](SORT.md)。

## v0.5 填报、打印与增量计算

- `setDataValidation(rules)` / `getDataValidation()`：设置或读取当前表规则的隔离副本。配置可以撤销重做，并通过 JSON 持久化。
- `validateCell(address)`：返回当前计算值的失败列表，可用于检查既有数据或因其他编辑改变的公式。
- `setPrintSettings(settings?)` / `getPrintSettings()`：设置或清除当前表打印参数；隔离、持久化、撤销重做语义同上。
- `setRowHeight(row, height, sheetId?)`：设置 1–600 CSS 像素的稀疏行高。
- `setRowsHidden(start, count, hidden?, sheetId?)` / `setColumnsHidden(start, count, hidden?, sheetId?)`：原子隐藏或恢复连续行列；可撤销重做，分页数据源拒绝修改。
- `calculationStats`：读取实际计算次数、缓存命中、失效数量及依赖规模，不复制工作表。

```js
grid.setDataValidation([
  {
    id: 'quantity',
    range: { start: { row: 1, col: 1 }, end: { row: 99, col: 1 } },
    kind: 'whole',
    operator: 'between',
    min: 1,
    max: 1000,
    allowBlank: false,
    message: '数量须为 1–1000 的整数',
  },
]);
grid.setPrintSettings({ paperSize: 'A3', orientation: 'portrait', repeatRows: 1, rowBreaks: [20] });
try {
  grid.setCell('B2', -1);
} catch (error) {
  console.log(error.code, error.failures);
}
```

校验只约束直接编辑格，公式按整批候选值计算后校验；任何失败都会拒绝整批，不改变数据、事件、缓存或历史。失败抛出 `DataValidationError`，错误码 `VALIDATION_FAILED`，最多返回 100 个失败项；Canvas 编辑路径保留原值并展示错误。新设置的规则不改写既有内容，撤销重做也不重新强制校验历史。它不是跨表持续约束或服务端权限控制。类型、空白与列表语义见 [DATA-VALIDATION.md](DATA-VALIDATION.md)。

SDK 自动通知计算引擎失效受影响公式，独立结果缓存继续复用；计算仍为同步、按需执行。范围订阅使用每表动态 AVL 矩形索引，一条矩形占一个节点，查询按子树包围框跳过无关范围；大量重叠仍可能访问很多节点，大范围求值仍需读取成员。`calculationStats` 提供候选矩形检查与节点访问计数，解析缓存最多 4,096 条。低层 evaluator 的两种变更契约与实测计数见 [INCREMENTAL-CALC.md](INCREMENTAL-CALC.md)。

打印分页使用零基位置，`rowBreaks: [20]` 表示第 21 行之前分页。PDF 支持双轴分页，合并冲突或空间不足时明确失败。v0.5 XLSX 导入导出保留 A4/A3/Letter、方向、边距、前导重复标题与行列手动分页；不支持的纸张、打印区域、缩放适配或非前导标题会明确拒绝。设置语义见 [PRINT.md](PRINT.md)，文件子集见 [XLSX-PRINT.md](XLSX-PRINT.md)。

XLSX 也支持常量整数/小数/长度边界及受限内联文本列表规则。导入直接预读 OOXML，保持紧凑范围，避免 ExcelJS 将百万行规则逐格展开；数值表达式、引用列表、自定义公式、重叠规则等超出子集时会失败。规则 ID 与 SDK 严格类型语义不完全往返，JSON 是保留完整 SDK 配置的格式。细节见 [XLSX-VALIDATION.md](XLSX-VALIDATION.md)。CSV/PDF 仅输出内容，不保留输入约束。

## v0.7 行列布局与结构编辑

`setRowHeight(row, height, sheetId?)` 设置 1–600 CSS 像素的稀疏行高；`setRowsHidden(start, count, hidden?, sheetId?)` 和 `setColumnsHidden(...)` 原子隐藏或恢复连续轴。布局元数据可撤销、重做并随 JSON/XLSX 保存。v0.8 PDF 仅打印可见行列，公式仍按完整数据计算；重复标题与分页沿用原始坐标。详见 [PRINT.md](PRINT.md)。

## v0.6 行列结构编辑

`insertRows(index, count = 1)`、`deleteRows(index, count = 1)`、`insertColumns(index, count = 1)`、`deleteColumns(index, count = 1)` 操作当前工作表。`index` 使用零基坐标；插入允许位于当前末尾，删除范围必须在现有尺寸内，且不能删除全部行或全部列。参数必须为整数，`count` 必须为正；结果不能超出 Excel 行列上限。

```js
const grid = createSpreadsheet(host, {
  onStructureChange: (event) => {
    // axis: 'row' | 'column'; kind: 'insert' | 'delete'
    // phase: 'apply' | 'undo' | 'redo'
    console.log(event.sheetId, event.axis, event.index, event.count, event.affectedSheetIds);
  },
});
grid.insertRows(1, 2); // 在第 2 行前插入两行
grid.deleteColumns(3); // 删除 D 列
grid.undo(); // 恢复整次列删除
```

结构编辑是原子操作：单元格、相关本表/跨表 A1 公式引用、合并、冻结行、列宽、打印参数、数据验证范围和条件格式范围一起调整；被删除的单格引用产生 `#REF!`。公式字符串常量不会被当作引用重写。`getConditionalRules()` 返回条件格式的隔离副本；首次结构操作会把未指定 `sheetId` 的全局条件规则展开为各表作用域，仅移动目标表范围。选择区域跟随位置移动，落入删除区的选择夹紧至剩余范围；撤销恢复操作前的选区。

结构操作通过 `onStructureChange` 通知，事件为 `{sheetId, axis, kind, index, count, phase, affectedSheetIds}`；它不触发普通单元格补丁 `onChange`。每次成功结构操作、撤销或重做触发一次订阅更新。错误输入不会改变数据、历史或事件；宿主回调抛错会转交 `onError`，已完成操作仍可撤销。

同步订阅回调看到的是已经提交的状态。如果订阅者立即调用 `load()`、`destroy()`、`undo()` 或其他变更替代了这次状态，尚未发出的旧 `onStructureChange` 和选区通知会被抑制，避免宿主收到已过期的结构事件；重入操作自己的有效通知仍照常发送。

结构与普通编辑共用有序历史，但结构历史最多保留 10 次。超过上限时最早结构事务及之前的历史前缀一起移除，避免跨结构恢复单元格补丁时使用错误坐标。结构编辑会重建公式计算缓存；单格编辑仍使用增量失效。此操作涉及已有单元格与引用扫描，不是百万表格的常量时间操作。

结构编辑只用于可写静态工作表；只读和分页源模式抛出 `READ_ONLY`，销毁后的调用抛出 `DESTROYED`，无效参数抛出 `INVALID_ARGUMENT`。它不增加插图、图表、透视表、命名范围、外部工作簿或其他未支持的 Excel 对象引用重写能力。

## 报表配置

```js
const columns = [
  { field: 'region', title: '区域' },
  { field: 'product', title: '产品' },
  { field: 'revenue', title: '营收', aggregate: 'sum', format: 'currency' },
  { field: 'cost', title: '成本', aggregate: 'sum', format: 'currency' },
  { field: 'profit', title: '利润', formula: '=C{row}-D{row}', aggregate: 'sum' },
];
grid.report(
  {
    name: '区域经营报表',
    layout: 'group',
    columns,
    groupBy: ['region', 'product'],
    pagination: { rowsPerPage: 12, repeatHeader: true },
  },
  records,
);
```

`groupBy` 支持单字段和最多 8 个不同字段。分组按数据首次出现的顺序排列，各级汇总只引用明细，避免累计子小计。`sum`、`count`（COUNTA）和 `average` 可选，平均值根据全部明细计算，忽略非数值。空字符串与真正空单元格的 COUNTA 语义不同。

`pagination` 仅在生成的工作表每 N 条明细插入重复标题，不创建打印分页指令；PDF 依纸张、列宽和折行重新分页。交叉统计不接受该选项。连续明细引用会压缩为范围；单个范围最多 100,000 格；碎片过多导致公式超过 8,192 字符时明确拒绝生成。

## 分页与取消

```js
import { restDataSource } from './lumina.js';
await grid.bindData(restDataSource('/api/report', { columnCount: 8, rowCount: 1000000 }), {
  pageSize: 256,
  maxPages: 8,
});
const controller = new AbortController();
const exporting = grid.export('csv', {
  signal: controller.signal,
  onProgress: (completed, total) => console.log(completed, total),
});
// controller.abort() 可取消；用 try/catch 等待 exporting
await exporting;
```

REST 适配器按 `offset` 与 `limit` 传参，期望 `{rows: CellValue[][], totalRows?: number}`。不要把受保护数据凭据写进示例或 URL。每次导出应读取稳定的数据快照；总数变化、缺行、响应无效或达到无法证明完整性的扫描上限均明确失败。未声明总数时缓存先使用逻辑上限，服务端返回准确总数后更新滚动尺寸。

分页表只支持全源 CSV 下载；XLSX/PDF/JSON 拒绝只导出可视缓存。CSV/PDF 在分块边界检查取消；XLSX 底层写文件和 JSON 同步序列化不能被即时中断，下载前会检查取消。CSV 进度单位为行，PDF 为页。没有云端处理。

静态工作簿在 `export()` 开始时捕获一次隔离快照，期间编辑不会混入本次文件。快照会额外占用与已有数据同量级的内存。

静态 XLSX 导出也受文件层校验配额限制：最多 100,000 个已存储单元格、每表 100,000 行和 256 列、50 个工作表、20 个冻结行。百万级 Canvas 数据规模不意味着可以直接导出同等规模的 XLSX；导入配额同样独立于 SDK 的逻辑尺寸。

XLSX 归档预检限制压缩输入 20 MB、实际总解压 64 MB、单 XML/rels 16 MB，并验证所有 XML 后重封装再交 ExcelJS。当前完整导入只接受 `xl/workbook.xml` 与 `xl/worksheets/sheetN.xml` 标准路径；底层元数据工具可按关系读取自定义路径，但完整导入会明确拒绝，见 [XLSX-PRINT.md](XLSX-PRINT.md)。

`export()` 下载使用 Blob，会持有完整输出。大数据可调用 `reportDataCsvReadableStream(source, options).pipeTo(destination)` 并由宿主提供文件写入目标；不需要物化成 Workbook。流出现错误后，宿主需丢弃不完整文件。

## 支持范围

错误分类包括 `INVALID_ARGUMENT`、`READ_ONLY`、`DESTROYED`、`DATA_SOURCE`、`EXPORT_CANCELLED`、`VALIDATION_FAILED`；文件格式层的错误详情保留原始原因。公式子集与参数限制见 [FORMULAS.md](FORMULAS.md)，PDF 限制见 [PDF.md](PDF.md)。本 SDK 不是 SpreadJS API 的逐接口替换，接入需要迁移数据与调用方式。

依赖清单与许可材料由构建生成，详见 [DEPENDENCIES.md](DEPENDENCIES.md)。仍有预打包组件和许可文本缺口待核实，商业授权审计尚未通过；当前 XLSX 子集不等于完整 Excel 兼容认证。

## v0.8 可见 PDF 与 Canvas 修复

示例新增“打印版式”和“检查空闲绘制”。PDF 跳过隐藏行列但保留原始公式来源；部分隐藏合并格的锚点内容仍显示在剩余可见区域。打印语义与真实导出样本见 [PRINT.md](PRINT.md)、[PDF.md](PDF.md)。

Canvas 修复反向跨隐藏列、跨合并格、冻结行遮挡、变行高翻页和重复观察事件造成的空闲绘制；冻结区域同样按视区裁剪。39 个函数名称及边界见 [FORMULAS.md](FORMULAS.md)。

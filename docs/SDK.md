# JavaScript SDK 接入

文本文件 UTF-8 解码现以 256 KiB 字节块推进，块间让出任务并检查取消；保留解码器状态以正确处理跨块中文/Emoji、起始 BOM 和文件末尾截断错误。普通 CSV/TSV/JSON 及工作空间恢复预读共用此路径。原始字节仍一次读取，最终字符串拼接与 JSON.parse 仍同步，此改进不是流式文件读取或恒定内存承诺。

CSV/TSV 工作簿导入逐行构建单元格，不再额外保留全部解析行数组；parseCsv 的二维数组返回契约不变。构建工作在解析检查点之间进行，取消或后续坏行会丢弃整个候选，原件与历史保持。仍保留原文本、候选单元格及最终校验副本，因此不是恒定内存；峰值改善需真实浏览器测量。

CSV/TSV 文件解析在分隔符检测及正文扫描中每约 32 Ki UTF-16 单元让出一次任务执行机会，支持长文本解析期间取消。同步 parseCsv/csvToWorkbook 沿用同一解析器，但保持同步返回。原文件与已解析行仍占用内存，UTF-8 解码、构建单元格及最终工作簿校验仍是同步阶段；分段不等于流式文件读取或恒定内存。

大 XML 部件现以每次 128 Ki UTF-16 单元喂入同一个严格解析器，块间让出浏览器任务执行机会并检查取消；XML 标签、实体、命名空间及跨块 Emoji 保持。单块解析、整部件 UTF-8 解码、后续同步校验仍占用主线程，因此不承诺固定帧时长或总内存硬上限。此行为应用于 XLSX 归档预检；其他直接调用同步 XML 工具的内部路径保持原行为。

ZIP 解压读取现接收导入取消信号：取消时暂停当前条目输出并释放已收集分块，后续条目不再启动；目录读取迟到结果也不启动解压。正常结束、失败和取消均移除监听。暂停输出不等于第三方库内部计算立即终止，已完成条目与当前同步 XML 解析仍有内存和响应开销。

XLSX 文件导入取消进一步覆盖异步阶段边界：等待模块、解压归档、读取元数据、重写归档和 ExcelJS 解码时可以结束等待，迟到结果不会启动下一阶段或构造提交工作簿。内部库已开始的处理可能继续；同步校验循环尚不能中途取消。SDK import 继续使用既有 signal；底层 workbookFromXlsx(buffer, name) 签名不变，不提供取消选项。

导入取消会停止等待尚未完成的文件读取，并跳过迟到字节的文本解码或 XLSX 解析启动。外部 signal、编辑、新导入和销毁沿用 IMPORT_CANCELLED 与原数据保护。原生 File.arrayBuffer 本身可能继续读取；已启动的同步 JSON/CSV 解析或 ExcelJS 解码不支持中途终止，此项不代表恒定内存或实时响应保证。

文本文件导入编码：CSV、TSV、JSON 必须使用有效 UTF-8，可带起始 BOM；损坏字节明确拒绝，不替换文本。合法中文、Emoji 和 U+FFFD 保持。不会自动猜测 GBK/UTF-16，请从原文件转换后重试。文件大小仍限制 20 MiB；此限制不代表解析过程总内存上限。SDK 导入失败保留当前工作簿与撤销/重做历史。

SDK 包名为 `lumina-report-sdk`。首次 npm 发布前，从 CI 的 `npm-package` 产物下载 `.tgz`，或本地执行 `npm run build:sdk && npm run check:sdk` 生成可安装包：

```sh
npm install ./lumina-report-sdk-0.29.0.tgz
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

React/Vue 生命周期接入见 [FRAMEWORKS.md](FRAMEWORKS.md)。同一容器不能重复挂载活动实例；应先 destroy 再创建。

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

SDK 画布获得焦点时支持 `Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Shift+Z` 与 `Ctrl/Cmd+Y` 重做。快捷键只作用于当前 SDK 实例；公式输入框、组合输入、只读状态以及宿主已调用 `preventDefault()` 的事件不会触发工作簿历史。宿主若自行监听键盘事件，应先判断事件是否已默认处理，避免重复调用 `undo()` / `redo()`。

只读选项限制编辑，不是权限隔离；持有 JS 数据的宿主仍能读取数据。来源访问权限应由宿主服务端控制。

## v0.9 布局批量与筛选

`getSheetLayout(sheetId?)` 返回 `columnWidths`、`rowHeights`、`hiddenRows`、`hiddenColumns`、`frozenRows` 的隔离副本，不读取单元格。`setSheetLayout(partial, sheetId?)` 省略字段时保留配置，显式 `undefined` 清除字段，传入映射/数组替换该字段；整个批量校验成功后只提交一个可撤销事务与一次 `onChange({sheetId, changes: []})`。等值配置不产生历史或事件，不清空重做。`setColumnWidth(col, width, sheetId?)` 与已有行高/隐藏方法复用此契约，取消隐藏只过滤稀疏已存储坐标。

v0.9 起 SDK 列宽校验统一为 `32–2000` CSS 像素，与 Canvas 实际边界一致；旧低于 32 像素的配置明确拒绝。行高为 `1–600`，冻结行及隐藏坐标受当前表尺寸约束。只读和分页表允许读取布局，拒绝修改。

`setFilter(text)` 去除首尾空白并更新静态表的本地行筛选；`filterText` 为只读 getter。筛选是视图状态，不改变数据、计算缓存、导出范围或历史；`load`/`bindData` 会清空。静态只读表可筛选；分页表非空筛选明确拒绝，需在数据源端查询后重新绑定。输入、隔离、错误与 `onRender` 回调边界详见 [SDK-LAYOUT.md](SDK-LAYOUT.md)。

## v0.10 可见单元格操作

构造选项 `clipboardMode` 与 `setClipboardMode(mode)` 接受 `'visible' | 'all'`，省略时为 `visible`；`clipboardMode` getter 返回当前模式。`visible` 下复制、剪切、删除、粘贴与填充跳过筛除行及隐藏行列；`all` 按原始坐标矩形操作。切换只通知视图，不改写工作簿、历史或计算版本，也不使筛选重新扫描；加载与绑定保留此偏好。

筛选尚未完成时，`visible` 交互明确拒绝，避免短暂未筛选视图改变操作范围；`all` 仍可按原始坐标操作。合并区域复制/清除仅处理原锚点一次；多格粘贴/填充遇到可见合并区域明确拒绝，单格粘贴可写入其原锚点。只读与分页实例允许切换模式，既有编辑限制继续生效；分页复制仍只读取已缓存数据，不代表完整数据源导出。完整契约见 [SDK-LAYOUT.md](SDK-LAYOUT.md)。

## v0.11 静态行排序

`sortRows({startRow, rowCount, keys, includeHidden?})` 按零基坐标的明确范围排序整行；每个键为 `{column, direction: 'asc' | 'desc'}`。支持最多 8 个键、100,000 行，默认保留隐藏行原位；筛选与选区不改变排序范围。返回 `{movedRows, changedCells}`，已排序时无操作。成功排序对每个受影响工作表各发一次普通 `onChange`，所有工作表在首个回调前已完成提交，支持整次撤销重做并保留范围选区；目标输入规则失败则整批拒绝。

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

结构与普通编辑共用有序历史，但结构和重命名快照历史合计最多保留 10 次。超过上限时最早结构事务及之前的历史前缀一起移除，避免跨结构恢复单元格补丁时使用错误坐标。结构编辑会重建公式计算缓存；单格编辑仍使用增量失效。此操作涉及已有单元格与引用扫描，不是百万表格的常量时间操作。

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

分页表只支持全源 CSV 下载；XLSX/PDF/JSON 拒绝只导出可视缓存。CSV/PDF 在协作边界检查取消；XLSX 取消会立即结束调用方对异步编码的等待，迟到结果不报告完成或触发下载，但底层编码仍可能继续。JSON 同步序列化不能被即时中断，下载前会检查取消。CSV 进度单位为行，PDF 为页。没有云端处理。

静态工作簿在 `export()` 开始时捕获一次隔离快照，期间编辑不会混入本次文件。快照会额外占用与已有数据同量级的内存。

静态 XLSX 导出也受文件层校验配额限制：最多 100,000 个已存储单元格、每表 100,000 行和 256 列、50 个工作表、20 个冻结行。百万级 Canvas 数据规模不意味着可以直接导出同等规模的 XLSX；导入配额同样独立于 SDK 的逻辑尺寸。

0.25 起 XLSX 导入保留文件中实际存储的空白单元格所带的受支持样式（包括空白合并主格），避免报表输入区底色或格式丢失。读取按存储坐标进行，不展开整张表；10 万格导入配额在解码前按所有 `<c>` 节点累计，包含空白格和合并从格，跨表共享。坐标必须是标准大写 A1 格式且与所属行一致，重复或越界时明确拒绝。未存储成单元格的整行/整列样式、主题色、边框等仍不在本次保真范围内。

0.29 日期导入保留原始数值序列（含序列 60 与小数时间），避免通过 JavaScript Date 后改变日期。只支持 1900 日期系统；1904 系统、无效日期系统属性或重复工作簿属性会在 ExcelJS 解码前拒绝。日期公式仍保留公式文本，不以缓存日期值替换。

XLSX `t="d"` 的 ISO 日期文本转换为相同的 1900 数值序列：支持四位公历年、日期及可选时间/小数秒，显式时区归一到 UTC，无时区按写出的日期时间处理；保留来源数字格式。非法日期（包括公历不存在的 1900-02-29）、损坏格式或无效时区明确拒绝。原始数值序列 60 继续支持；导出以数值日期表示，不承诺保留原日期文本拼写或时区标记。

XLSX 富文本展开按全工作簿累计，最多 8,000,000 UTF-16 文本单元及 100,000 个片段（包含空片段）。共享字符串每次引用按独立单元格计数；超限在创建下一格副本前拒绝，不截断内容。此限制用于导入，普通文本不计入富文本展开量；它不是总内存硬限，归档、解析树和后续解码仍占用内存。

XLSX 合并区域若包含非主格内容，导入/导出会报出工作表和地址，防止 ExcelJS 静默清空该内容。导出中零、false、空格及公式均算非空；导入按原始 XML 的数值、字符串索引、内联文本与公式节点检查，因此共享字符串索引即使最终指向空文本也保守拒绝。空白样式从格允许转换，但不承诺从格独立样式往返保留；合并主格的支持样式按原有规则保留。此检查只用于 XLSX 转换，不改变 JSON 快照和合并布局的存储契约。

XLSX 归档预检限制压缩输入 20 MB、实际总解压 64 MB、单 XML/rels 16 MB，并验证所有 XML 后重封装再交 ExcelJS。当前完整导入只接受 `xl/workbook.xml` 与 `xl/worksheets/sheetN.xml` 标准路径；底层元数据工具可按关系读取自定义路径，但完整导入会明确拒绝，见 [XLSX-PRINT.md](XLSX-PRINT.md)。

`export()` 下载使用 Blob，会持有完整输出。大数据可调用 `reportDataCsvReadableStream(source, options).pipeTo(destination)` 并由宿主提供文件写入目标；不需要物化成 Workbook。流出现错误后，宿主需丢弃不完整文件。

## 支持范围

错误分类包括 `INVALID_ARGUMENT`、`READ_ONLY`、`DESTROYED`、`DATA_SOURCE`、`EXPORT_CANCELLED`、`IMPORT_CANCELLED`、`VALIDATION_FAILED`；文件格式层的错误详情保留原始原因。公式子集与参数限制见 [FORMULAS.md](FORMULAS.md)，PDF 限制见 [PDF.md](PDF.md)。本 SDK 不是 SpreadJS API 的逐接口替换，接入需要迁移数据与调用方式。

依赖清单与许可材料由构建生成，详见 [DEPENDENCIES.md](DEPENDENCIES.md)。仍有预打包组件和许可文本缺口待核实，商业授权审计尚未通过；当前 XLSX 子集不等于完整 Excel 兼容认证。

## v0.8 可见 PDF 与 Canvas 修复

示例新增“打印版式”和“检查空闲绘制”。PDF 跳过隐藏行列但保留原始公式来源；部分隐藏合并格的锚点内容仍显示在剩余可见区域。打印语义与真实导出样本见 [PRINT.md](PRINT.md)、[PDF.md](PDF.md)。

Canvas 修复反向跨隐藏列、跨合并格、冻结行遮挡、变行高翻页和重复观察事件造成的空闲绘制；冻结区域同样按视区裁剪。52 个函数名称及边界见 [FORMULAS.md](FORMULAS.md)。

### 单元格超链接元数据

`Cell.hyperlink?: { target: string; tooltip?: string }` 用于普通文本单元格，保留 XLSX 中的目标和提示文字，并参与 JSON/SDK 快照与撤销。使用 `setCells([{ key: 'A1', cell: { value: '详情', hyperlink: { target: 'https://example.com', tooltip: '来源' } } }])` 设置；用不含 hyperlink 的完整 cell 替换可移除。`setCell` 保留原链接，因此将其改为数字/布尔/公式前需要先移除链接，否则明确报错。

目标不会被自动执行或打开。工作空间工具栏的“链接”入口可查看/修改/移除当前格链接，也可显式跳转已保存的内部单地址目标，或打开已保存的 HTTP(S)/mailto 目标。内部目标必须存在且可见，合并从属格定位到主格；跳转清除当前搜索/筛选。其他协议仅保留，不生成可点击入口。草稿目标须先保存才能打开；外部链接使用新窗口与 noopener/noreferrer。Canvas 格内目前仍只呈现显示文字，SDK 宿主可通过 setCells 管理。本地单个 A1 地址目标（含跨表、绝对地址）会随插入/删除行列调整；被删除的目标变为 #REF!，结构撤销可恢复；目标移出网格时拒绝整次结构操作并保留原内容。URL、文件、名称和范围目标保持原文。排序会在同一撤销事务中重写同表和跨表的单 A1 链接目标（含绝对地址），隐藏且未参与排序的目标保持原位；工作空间的“重命名当前工作表”会同时更新显式公式表名和单 A1 内部链接，支持一次撤销；SDK 的 `renameSheet(name, sheetId?)` 提供同样的引用重写；直接修改快照再 load 不会自动重写引用。CSV 只输出显示值，不包含链接。XLSX 支持带实际存储单元格的单地址链接；范围链接、无存储单元格、冲突定义及公式/数字链接明确拒绝。富文本的已支持属性与限制见 RICH-TEXT.md。


## 异步导入与并发编辑

`import(file, { signal? })` 返回 Promise，文件解析和验证成功后一次替换工作簿。`load()`、报表替换、绑定数据源、有效单元格/样式/布局/规则/打印/结构修改或撤销重做，以及 `destroy()`，会取消尚未完成的导入；新的导入也会取消旧导入，防止迟到文件覆盖新内容。选择、筛选和剪贴板视图模式不会取消导入；失败的修改不会取消它。

取消以 `LuminaError.code === 'IMPORT_CANCELLED'` 拒绝，可用 `cause` 区分调用者取消与替换操作；解析失败保留 `INVALID_ARGUMENT`，在已销毁实例上启动导入为 `DESTROYED`。可传入 AbortSignal 主动取消等待和提交。已运行的文件解析未必能被中止，但其结果或失败都会被消费，不会提交，也不会产生额外的 onError 通知。直接调用者负责处理返回 Promise。

`load`/`import`/`report` 属于宿主的数据替换接口，保留只读实例可接收宿主数据的原契约；readOnly 限制用户和普通编辑操作，不代替后端权限。


## 工作表重命名与事件

`renameSheet(name, sheetId?)` 默认作用于当前表，也可传入其他静态工作表 ID。它同步更新显式跨表公式与单 A1 内部链接，完整校验后一次提交；不改变活动工作表、选区、工作表 ID 或规则。名称规则和不支持的引用边界与工作空间一致。完全等名不写历史、不清空 redo、不取消导入；成功修改取消尚未完成的导入。只读实例、绑定分页源及目标分页表返回 `READ_ONLY`，已销毁返回 `DESTROYED`；其余名称/引用/候选校验失败返回 `INVALID_ARGUMENT`，保留原内容与历史。

使用可选 `onSheetRename(event)` 接收 `sheetId`、`previousName`、`name`、`affectedSheetIds` 和 `phase: 'apply' | 'undo' | 'redo'`。previousName/name 表示本次操作前后名称，因此 undo 时顺序反转。每次操作先提交所有关联表、重建计算缓存并通知订阅，再发送一次重命名事件，不额外合成 `onChange` 或 `onStructureChange`；宿主自动保存需同时监听重命名事件。事件是隔离副本，回调抛错交给 onError；订阅重入替换、撤销或销毁后不发送过期事件。

重命名与行列结构事务共用最多 10 个快照，超限删除最早快照及之前的历史前缀；总历史仍最多 100 个事务。扫描和复制成本与实际存储格有关，尚无浏览器性能承诺。

```js
const grid = createSpreadsheet(host, {
  workbook,
  onSheetRename: ({ previousName, name, phase }) => {
    console.log(previousName, name, phase);
    saveSnapshot(grid.toJSON()); // saveSnapshot 由宿主实现
  },
});
grid.renameSheet('销售明细', workbook.sheets[0].id);
grid.undo();
grid.redo();
```


## 富文本单元格

使用 `Cell.richText: RichTextRun[]` 保存局部文字样式，`RichTextStyle` 支持 bold/italic/underline/strike、六位 RGB color、6–96 fontSize 和 fontFamily。片段拼接必须与普通字符串 value 完全相同，公式/数字不接受富文本。`setCells` 可整体替换片段；`setCell` 改变文字时清除旧片段、文字相同时保留片段，撤销可恢复。JSON、XLSX 和 SDK 快照保留已支持片段；Canvas 与 PDF 分段绘制。完整限制和示例见 [RICH-TEXT.md](RICH-TEXT.md)。


富文本上下标使用 `RichTextStyle.verticalAlign`（baseline/superscript/subscript），支持显示、PDF 和 XLSX 往返。`fontFamilyClass`（0–5）与 `charset`（0–255）保留 Excel 字体分类和字符集元数据。主题色/字体关系尚未支持；详情见 RICH-TEXT.md。


## SDK 多工作表切换

通过 `sheetInfos` 获取表目录（id/name/rowCount/colCount/readOnly），不复制单元格数据。返回对象可独立修改，不影响工作簿。`setActiveSheet(sheetId)` 允许只读实例切表；成功后选区回到 A1、清空本地筛选，保留全工作簿撤销/重做、计算缓存和正在解析的导入，不修改 updatedAt。相同 ID 不通知、不改变选区；不存在或非字符串 ID 返回 INVALID_ARGUMENT；销毁后返回 DESTROYED。

切表先通知 subscribe，再发 `onActiveSheetChange({ previousSheetId, sheetId })` 与 A1 的 onSelectionChange；回调重入改变状态后不发送过期通知。切表不合成 onChange，不写编辑历史。要保存活动表偏好，监听 onActiveSheetChange 并读取 toJSON。撤销仍作用于最近的工作簿编辑；目标为非当前表时不改变当前选区。

```js
const grid = createSpreadsheet(host, {
  workbook,
  onActiveSheetChange: ({ sheetId }) => console.log('活动表', sheetId),
});
const sheets = grid.sheetInfos;
grid.setActiveSheet(sheets[1].id);
```

绑定分页源期间实例仍整体只读，但可浏览并本地筛选其他静态表；分页表必须由数据源端筛选。切表取消旧视口请求，保留初始请求及缓存，迟到响应仅更新绑定表。CSV 导出当前表：活动分页表使用绑定源，活动静态表使用其快照；未绑定的分页快照拒绝 CSV。含分页表的工作簿拒绝 XLSX/PDF/JSON 完整导出，避免把缺失数据当成完整文件；先生成有界静态报表。dataSourceState/dataSourceStats 描述实例的绑定源，即使该表当前不活动。

旧 Canvas 视图的编辑在切走再切回后仍被拒绝；旧选择/滚动回调忽略。以上已有控制器回归，实际浏览器切表、焦点与框架生命周期尚未验收。


数据绑定通知的同步重入：subscribe 在 bindData 提交状态时可调用 load、destroy 或再次 bindData。被替换的原绑定以 AbortError 拒绝，且不会读取新绑定的请求控制器、发起旧请求或把新源状态标为旧空源的 ready。调用方应处理 bindData 返回的 Promise（取消与网络失败不同）。clearDataCache 在取消请求或清缓存的通知中遇到重绑/销毁后即停止，不清除或重试新绑定。

视口参数与生命周期：`viewport({ firstRow, lastRow })` 要求起止行号为有限数值；`NaN`、无穷值、字符串、空值或缺失字段同步抛出 `LuminaError`（`code: 'INVALID_ARGUMENT'`），不会创建请求或触碰数据源。已销毁实例调用 `viewport` 统一同步抛出 `DESTROYED`，即使此前没有绑定分页源。


切表/视口取消也可能同步触发 subscribe。若该通知中加载、销毁、重绑、切表或发起新视口请求，较新的操作优先，原操作停止；不向新工作簿写入旧表 ID、不用新数据源抓取旧滚动范围、不发送旧请求错误。尤其切表取消通知中若宿主主动请求新视口，原切表会被取代；宿主应以 activeSheetInfo / onActiveSheetChange 的实际提交结果更新目录，而非假定调用必定完成。普通切表且无重入时仍按原契约重置 A1 与筛选。


分页跨表公式读取当前已缓存页，未缓存/未绑定的分页值为计算错误 `#N/A`，已知总行数之外或已缓存空格为空值。不会为了计算自动拉取远端页面；大范围汇总需要数据源端汇总或先生成静态报表，不应把仅当前视区的值当作全量数据。可用 IFERROR 显示“待加载”，但应避免用 0 掩盖数据未加载。页到达、淘汰或清理时 SDK 清空公式结果缓存后按需计算，目前未做按页精确失效。分页值中的 `=` 开头文字是原始文字，不执行为公式。

含分页来源时，活动静态表 CSV 在导出开始固定其公式结果，随后分页淘汰不会改变导出结果；未加载引用导出 #N/A，不能当成完整远端汇总。getCell 只读取当前表，静态表返回原公式文本；分页表直接显示的未缓存格仍为空白，公式引用则明确 #N/A。分页完整 CSV 导出仍逐页读取数据源。


CSV 冻结值通过独立结果表传给编码器，不覆盖公式源码。返回以 `=` 开头文字的公式不会被二次执行；CSV 仍按现有防公式注入规则添加单引号。false、0、空字符串及错误文字按其原结果输出。跨分块期间切表或淘汰分页缓存不改变已固定结果；调用方取消导出仍阻止下载。


生命周期约定：销毁会取消导入、分页和导出，清除订阅并释放容器占用；已排队的数据状态微任务在销毁后不再调用宿主。销毁完成后同一容器可重新挂载，新实例从 idle、无缓存开始。旧实例的重复 destroy 是幂等的；renderer unmount 抛错时仍释放容器占用，但会把原异常抛给调用方。旧实例的方法统一返回 DESTROYED，不能继续提交异步结果。

`productBuildIdentity()` 返回 SDK 打包时嵌入的构建指纹，未使用生产构建定义时返回 `null`。身份包含 `version`、`mode`、`sourceSha256`、`sourceFiles`、`sourceTimestamp` 和 `timestampSource`，用于遥测与问题定位；它不是签名，也不能代替发布包和部署站点的 SHA-256 校验。


Canvas 网格在实际渲染时使用 `role="grid"`，提供行列总数、当前活动代理 `gridcell` 的一基坐标及选中状态；代理文本包含地址和值，Canvas 本身标记为 aria-hidden。宿主应保留网格容器焦点来使用方向键、Shift 多选、复制粘贴和 F2。分页/只读仍可导航，编辑输入框会临时获得焦点并在提交/取消后返回网格。ARIA 树与键盘行为已做 JSX 回归，浏览器和屏幕阅读器组合仍需人工验收。

### CSV / TSV 分隔符

文件名为 `.tsv`（不区分大小写）时固定按制表符分列，逗号作为普通文字。`.csv` 保留自动检测：只统计第一条逻辑记录引号外的逗号与制表符，只有制表符而无逗号时选制表符，否则选逗号；引号内换行不会提前结束检测。无引号、同时含两种分隔符的内容存在歧义，明确 TSV 应使用 `.tsv` 文件名。底层 parseCsv 的显式 delimiter 仍优先。

两种文件继续遵循 20 MB、100,000 单元格、100,000 行、256 列导入限额；保持前导零/长数字标识符、数值转换与现有公式语义。损坏引号或超限整次拒绝，SDK 当前工作簿和编辑历史保持不变。

### 静态 CSV 流与取消

`workbookCsvReadableStream` 只有读取方请求数据后才扫描和求值；取消流会中止正在等待的生成器，并清理外部 AbortSignal 监听。空表、进度回调中取消和最后一块输出后的取消均检查信号，不报告正常完成。已经交给消费者的字节不可收回；写入文件或上传时需由宿主丢弃未完成结果。

静态表与分页源的 CSV ReadableStream 在外部 AbortSignal 取消时立即进入错误状态，即使读取方尚未开始读取或正在两次读取之间等待，`reader.closed` 也会以 AbortError 拒绝，无需再调用 read 才结束。已经开始的底层数据请求可能继续运行；迟到结果不会写入流。宿主应处理读取/pipeTo/closed 的拒绝并丢弃部分文件。读取方调用 cancel 则按 Web Streams 语义关闭，不将其当作完整导出成功。

`chunkRows` 必须为正安全整数（默认 256），不再将 0/负数/小数自动修正；NaN/Infinity 明确拒绝。分隔符为单个非引号、非 CR/LF 字符，行结束符仅支持 LF/CRLF，与分页 CSV 一致。累计文本达到 256 Ki UTF-16 单元时在字段边界输出，超宽行可以跨块，单块最多额外包含一个转义字段和分隔符/行尾；chunkRows 是块内完成行数的刷新阈值。每 256 列、32 行及输出块之后让出事件循环，不能中断当前单格同步公式或初始已用范围扫描。调用方须按顺序拼接/写入块，不能逐块当成独立 CSV 解析；取消/失败时丢弃部分文件。Blob 便利方法仍需保留完整结果，超大导出优先消费流。

分页 CSV 使用相同的结束边界约定：已知空源在进度回调后检查取消，最终块输出后、生成器报告完成前再次检查取消，未知总数以短页结束时也如此。消费者已收到的字节不能撤回；只有正常完成才可把文件标记为完整，已结束后的取消不追溯改变结果。

分页 CSV 在每页响应验证时复制这一页的行和值；随后分块输出/让出任务期间，数据源复用数组、截短行列表或改写数值不会改变已经接收的那一页。只复制当前页，不会预取或复制整个数据源。不同页之间的版本一致性仍由数据源提供稳定快照保证：相同 totalRows 不能证明内容版本相同。字符串为不可变值，额外分配主要是当前页的行数组；这不是跨网络事务快照或持久化备份。

视区缓存对于已知总行数的页面，要求返回本次请求范围内的完整行数（最后一页可按总数缩短）。总数可以来自数据源 rowCount、此前成功响应，或当前响应 totalRows。缺行/多行页不进入缓存，不更新总数，状态为可重试错误；retryData 会重新请求，其他成功缓存页保留。空行应返回 `[]` 这一行记录，短行的尾列仍是空白，不能省略整行造成后续错位。总数仍未知时保留短页接收行为，不据此缩短视区；实际全源 CSV 的短页 EOF 约定不变。视区明确收到更小 totalRows 且请求已越过结尾时，空响应仍有效。

### 显式写入一页数据

`hydrateSheetPage(sheet, source, offset, limit, signal?)` 是低层小页合并工具，返回新 Sheet，不修改传入对象或自动提交 SDK 历史。每个实际返回的行覆盖从第 0 列起的 source.columnCount 列：短行尾列、空行和空字符串会删除该范围旧单元格（包括样式），0/false 保留。返回行以外和数据源列范围以外的单元格保留，不根据短页/较小总数清空其他业务数据。宿主如需完整替换须另行明确执行。

已知总行数时缺行整次拒绝，取消在验证后再次检查；响应省略 totalRows 时使用请求开始时 source.rowCount 扩展逻辑行数，既有更大尺寸不缩小。单次请求仍最多 100,000 格；该函数会复制既有 cells 索引，不能替代高性能视区缓存。保留既有 dataSource.kind=paged 标记，不代表已获得完整静态工作簿或全量导出能力。


视区总数变化：成功响应的 totalRows 与已知总数不同，会清除旧缓存页和错误、取消此前其他页请求，再保留新响应中完整且在范围内的页。被取消的调用以 AbortError 拒绝；即使数据源忽略信号，迟到响应也不更新状态。旧尾页请求的 limit 若小于增长后的完整页长，该响应可返回给调用方，但不会作为完整页缓存，后续访问将重新请求。首次获知总数时保留符合新范围和长度的旧页，移除不完整或越界页；总数不变则保留其他页。取消监听器中 clear/dispose/新请求的效果不会被旧流程覆盖。

这不是远端版本协议：行数相同的内容变化仍需主动 clearDataCache/重新绑定，跨页一致性由数据源的稳定快照保证。数据总数仅在请求时发现，不自动轮询。缓存刷新后尚未加载的页按原契约显示空白，公式引用为 #N/A；宿主需请求当前视区或使用 retryData。


底层导出完整性：直接调用 workbookToXlsx 也会拒绝含任何分页表的工作簿，检查在静态校验丢弃分页元数据之前执行。iterateCsvChunks、workbookCsvReadableStream、workbookCsvBlob 拒绝活动分页表，避免输出其部分 cells；流在读取时报告错误。活动表为静态表时仍可导出 CSV，其他分页表不阻止该单表导出。全源分页 CSV 请使用 reportDataCsvReadableStream/reportDataCsvBlob 并提供实际数据源。exportWorkbook 的非 CSV 下载入口也拒绝分页工作簿；toJSON 仍可作为明确的本地结构快照读取，但不是全源备份。


JSON 快照导入保留并复制 dataSource 元数据：kind 仅可为 static/paged，totalRows 可省略或为 0–1,048,576 的整数，pageSize 可省略或为 1–1,048,576 的整数。它不会自动扩展本地行数、取回远端数据或建立连接。分页快照经 import、validateWorkbook 或恢复副本后仍保持分页语义：SDK 只读并拒绝无源完整导出。无效元数据整次拒绝，既有工作簿不变；SDK load 同样校验。工作空间展示不完整快照提示，网格和公式栏只读，地址导航仍可用。


PDF 取消补充：等待字体就绪、Canvas JPEG 回调和 Blob 字节读取期间也响应 AbortSignal，销毁 SDK 时该等待以 EXPORT_CANCELLED 结束。迟到结果或异常被接收但不会继续导出或发出页面完成进度。所有画布分配后的失败（含测量/分页/上下文创建）都重置画布尺寸释放缓冲。浏览器内部字体/编码工作不能被此 API 强制终止；同步绘制和测量仍只在协作边界处理取消，没有新增自动超时。


### 完整分页源生成静态工作簿

`workbookFromReportData(source, options?)` 从独立数据源顺序读取全部页面，成功后返回新的静态 Workbook，可交给 `grid.load` 编辑或导出。它不读取已有视区缓存，不修改已有工作簿；独立示例“分页生成完整报表”演示一个完整的 200 行查询。

```js
import { workbookFromReportData } from 'lumina-report-sdk';
const controller = new AbortController();
try {
  const workbook = await workbookFromReportData(source, {
    name: '完整订单报表', pageSize: 128,
    maxRows: 10000, maxCells: 100000,
    signal: controller.signal,
    onProgress: (rows, total) => console.log(rows, total),
  });
  grid.load(workbook);
  await grid.export('xlsx');
} catch (error) {
  if (error.name !== 'AbortError') throw error;
}
// 取消读取：controller.abort();
```

`maxRows`、`maxCells` 默认及硬上限均为 100,000，必须为正整数；按行数 × 源列数计容量（含空白），源列数最多 256。`pageSize` 默认为 256，实际请求会缩小到剩余容量；这些值是拒绝上限，不是截取数据的数量。总文本最多 8,000,000 UTF-16 单元，单格沿用分页源的 32,767 字符限制。超限、缺行、总数变化或晚到总数小于已读取行数时整次失败，不返回部分报表。

总数未知时仅短页确认结束；恰好填满容量但没有明确总数也会拒绝，调用方应提供可靠 totalRows。分页数据必须来自稳定快照；相同总数不保证跨页内容版本一致。每页在接收时复制，避免源复用数组污染后续处理。保留数字、布尔值和普通文本，缺少尾列为空白；以 `=` 开头的源文字明确拒绝，避免静态模型将其执行为公式，可改用现有全源 CSV（遵守 CSV 防注入编码）。不自动加入表头、样式或公式。

完成后 dataSource.kind 为 static、totalRows 为实际行数；空源仍有一行可编辑画布、totalRows 为 0。取消返回 AbortError，源忽略 signal 也会结束等待，但不能强制停止源自身网络或同步工作。每 32 行和页间让出事件循环；生成过程保存整个有界工作簿，不是流式 XLSX/PDF。PDF 另有自身布局/容量限制，生成成功不保证所有输出格式均能容纳。宿主加载前应验证请求所有权；示例在切换、编辑、导入和卸载时取消旧生成，避免覆盖较新的操作。


完整源空白范围：静态报表在源非空时保留右下角单元格（若原本为空则保存 `{ value: '' }`），使按已存格范围导出的 CSV、XLSX 与 PDF 保留尾部空记录和空字段；最多额外保存一个空白格，不分配整张空白矩阵，也不覆盖该格原有的 0/false 等值。零行源不添加占位格，CSV 仍为零记录，工作表画布仍至少一行；零行 PDF 沿用空白工作表的页面表示。JSON 保存该空白格，XLSX 往返保留已用范围，但不承诺恢复分页元数据；普通静态表的导出范围规则不变。用户后续删除该边界格或执行结构编辑后，导出按编辑后的静态内容处理。


独立报表示例的“取消操作”适用于文件导入、完整源生成及导出。新导入/新示例/生成静态报表/导出会取消先前的文件导入等待；旧导入在新生成完成之前也不能写入。共享按钮按当前仍在运行的任务显示，旧任务 finally 不会隐藏新任务的取消入口；卸载取消全部任务。切工作表本身继续遵循 SDK 允许待导入的契约，按钮保持可用；编辑引发 SDK 导入取消。取消只结束等待和阻止提交，浏览器文件读取可能继续完成。


CSV/TSV 空白范围：文件导入保留实际记录数和最大字段数构成的范围。若已有非空格不足以表达末行或末列，最多增加一个右下角空白格；不会导出为编辑体验预留的 100 行/16 列，也不填满空白矩阵。全空记录与零记录不同：空文件保持零记录，明确的空行/空字段可再次导出。长短行仍按最大字段数补空；该行为不保留原始分隔符、引号、行尾或不规则行宽，数值解析与 CSV 防注入规则不变。删除边界空白格后按编辑后的已用范围导出。


CSV/TSV 数值识别：仍保留前导零及超过 15 位数字字符的原始文本；对可识别数字另外比较标准化十进制值与 Number 的往返表示。转换为无穷、下溢为零、可见十进制值被舍入改变以及负零时保留原文，例如 `1e-999`、`3e-324`、`-0.00`。`123.5`、`1.20E+3`、`0.1` 等继续转换为数字，因此不保留数值的原始排版或末尾小数零。此规则保护导入值，不将公式引擎变为十进制定点运算；后续数字计算仍用 IEEE 754。保留为文本的负号开头字段导出 CSV 时仍会按既有防公式注入规则加单引号；XLSX/JSON 保留文本类型。


分页缓存通知与刷新：ReportChunkCache 的订阅回调可能在 getPage/getRow Promise 交付之前运行。在加载完成或失败通知中调用 clear/dispose，会使尚未交付的旧请求以 AbortError 拒绝，而不会返回已失效的数据或旧错误；共享该页的消费者同样取消。clear 后的新请求不受旧请求清理影响。宿主需处理这些 Promise 拒绝，避免把主动刷新当成数据源失败；正常成功、未刷新时的真实错误和 LRU 淘汰语义不变。


数据源替换取消回调：bindData/load 会先分离旧缓存、请求和订阅，再取消它们。旧数据源的 AbortSignal 回调若调用新的 bindData/load/destroy，新操作保留优先权；旧 bindData 以 AbortError 结束，不请求被替代的数据源。旧 load 在被重入操作替代时停止提交。若旧取消回调切换活动工作表，原 bindData 不会把新表清空并绑定到错误目标。宿主应避免无条件在每次取消中反复重新绑定，并处理绑定 Promise 的取消结果。


导入提交边界：import 的解析完成不等于成功。校验候选工作簿并清理旧数据源期间仍保留取消所有权；此时外部取消或后续 load/bindData/import/destroy 会让旧导入以 IMPORT_CANCELLED 结束，不安装旧文件。只有工作簿已提交才返回成功；提交后的渲染订阅若再加载其他内容，属于独立新操作，不追溯取消已经完成的导入。取消无法恢复已经释放的旧远端缓存，但不会把未提交的文件报告为成功。


分页请求背压：ReportChunkCache 最多同时等待 maxPages 个数据源页面（默认 8），额外页面按请求顺序排队；重复页共享同一个排队/在途请求。loading 统计全部尚未结束的页面，包括排队项。最后一个消费者取消后，尚未开始的页面不会调用 fetchPage；成功、失败或取消释放等待名额，clear/dispose 取消全部排队与在途等待。该限制不截断数据，也不限制调用方保留的返回值。数据源若忽略 signal，其底层网络仍可能继续；SDK 只能结束等待，无法保证这些失控请求也服从并发上限。maxPages 仍由宿主配置，单页另受下述容量限制；宿主自身排队数量需按数据规模控制，不能据此宣称恒定总内存。


手工输入转换：SDK 根入口 parseCellInput(text) 返回 CellValue，供自定义公式栏调用 grid.setCell(address, parseCellInput(text))。Canvas 编辑/外部粘贴、工作空间公式栏和独立示例使用同一规则：TRUE/FALSE 转布尔值，一个前导单引号作为文本输入前缀移除；普通十进制和科学计数数字仅在 Number 转换不会改变规范化十进制值、不是负零且整数安全时转数字。前导零编号、不安全整数、下溢/溢出、可见舍入保留原文本。数字周围空白沿用编辑器原有 trim 转换；保留为文本时不改空白。公式字符串仍按工作簿公式语义处理；前导单引号不提供持久的公式文字类型。此函数不校验格大小或执行公式，setCell 仍执行其验证。CSV/TSV 文件解析保留独立的 15 位及空白策略，不使用编辑器布尔/单引号惯例；不是任意精度运算。独立示例输入 .5/1. 现在按共同规则保留文本，可输入 0.5/1.0 作为数字。


计算结果类型：createEvaluator(book) 的调用签名仍返回 CellValue，错误以错误码字符串显示。需要判断实际错误时使用 evaluate.result(sheet, key)：返回 {kind:'value', value} 或 {kind:'error', error}，类型 EvaluationResult 可从 SDK 根导入；结果对象为独立副本，与普通求值共用依赖缓存/失效规则。例如公式 ="#N/A" 是普通文本，=#N/A 是错误，不能仅凭显示字符串判断。XLSX 导出使用该区分；#CYCLE!/#ERROR! 无对应标准 Excel 缓存码，因此不写缓存值，保留原公式并请求宿主重算。不保证 Excel 能计算本产品专用或不合法公式，也不改变已有 CSV/显示层的字符串结果契约。


XLSX 常量错误迁移：文件中没有公式的标准错误单元格（#N/A、#REF!、#NAME?、#DIV/0!、#NULL!、#VALUE!、#NUM!）现在导入为等价错误字面量公式，例如 value:'=#N/A'，因此 IFERROR 和依赖传播保持错误含义；原来静默转成普通文本的行为不再保留。普通字符串 '#N/A' 仍为文本。再次导出会包含字面量公式与错误缓存，故保持计算语义但不保留原文件“常量错误/公式”存储类别；JSON 保存使用相同公式表示。未知/空/重复值的常量错误明确拒绝，不降级。公式错误缓存本身不替代公式正文。若业务必须保留常量错误类别，本数据模型尚未提供该能力。


分页容量：`ChunkCacheOptions`（含 `bindData`）新增 `maxPageCells` 和 `maxPageTextUnits`。前者默认 100,000、最大 1,000,000，按整页行数 × 数据源列数（含空格）计；后者默认 8,000,000、最大 32,000,000，按所有文本的 UTF-16 单元累计，均须为正整数。`pageSize` 现在是请求行数上限，实际值为 `min(pageSize, floor(maxPageCells / columnCount))`，不足一整行的配置在绑定前拒绝。应从缓存 pageSize 或 SDK dataSourceState.pageSize 读取实际页长，不要继续用请求值计算页号。

宽表分小页，不截断列或记录。文本超限的响应整页拒绝并进入可重试错误状态，不更新总数或替换成功页；可减少 pageSize、筛选长文本或在硬上限内调整预算后重新绑定。原有单格 32,767 字符上限不变。最多保留 maxPages 个成功页，成功页的逻辑格数/文本容量分别不超过 maxPages × 两项单页上限；这不是进程总内存或字节数保证：原始响应、适配器 JSON 解析、同时等待的请求、排队元数据、对象开销、调用方持有的页面和忽略取消的源均不在此保留量内。其他静态生成/CSV 导出入口使用各自限制。


分页 CSV 分块按字段边界触发：累计约 256 Ki UTF-16 单元即交付，单块最多再包含一个转义后的字段及分隔符/行尾；不会把一整条超宽记录先拼成巨大字符串。字段保持完整，避免 UTF-8 编码时拆开 Emoji 的代理对。每 256 列或块交付后让出事件循环并检查取消；进度只报告整页已序列化的行。块可能在记录中间结束，调用方必须按顺序拼接或写入同一文件，不能逐块独立解析 CSV；取消/失败时丢弃部分文件。此项不限制源响应文本体积、整页校验复制或 Blob 最终文件内存，不能据此宣称端到端恒定内存。


分页 CSV 文本容量：ReportDataCsvOptions 新增 maxPageTextUnits，默认 8,000,000、硬上限 32,000,000，须为正整数，按响应每页所有文本 UTF-16 单元累计；单格仍不得超过 32,767。超过上限在该页任何字节/进度输出前拒绝，不截断；若此前已写入其他页，整次导出仍失败，调用方必须丢弃部分文件。容量按页重置，可减小 pageSize 后重新完整导出。SDK 下载支持 grid.export('csv', { pagedCsv: { pageSize: 32, maxPageTextUnits: 8000000, maxRows: 100000 } })，仅应用于绑定分页源的 CSV，独立于视区缓存配置；普通静态表和其他格式忽略该选项。maxRows 仍为拒绝扫描上限，不能用于截取文件。成功页面的文本副本受限，但源响应/JSON 解析和 Blob 完整文件不在此保证内。

分页 CSV 选项校验：`grid.export('csv', { pagedCsv })` 会在发起任何分页请求前校验嵌套对象。`pageSize`、`maxRows` 必须为 1–1,048,576 的安全整数，`maxPageTextUnits` 必须为 1–32,000,000 的整数，且不接受未知字段、数组、`NaN` 或无穷值。配置错误统一抛出 `LuminaError`（`code: 'INVALID_ARGUMENT'`），不会被包装成数据源错误，也不会清空缓存或改变现有工作簿；修正配置后可直接重试。


REST 响应取消：restDataSource 对忽略 AbortSignal 的迟到响应不再读取或解析 JSON，并尝试取消未使用的响应体；HTTP 非成功响应也释放未消费的 body，清理失败或悬挂不会替代原始 HTTP 错误。已开始 JSON 解析时无法强制中断解析，但解析完成后若已取消，不再校验/复制结果。请求取消仍及时以 AbortError 结束等待。此保护不承诺底层网络一定停止，真实浏览器网络资源回收待实测。


REST 字节容量：`restDataSource(url, { columnCount, maxResponseBytes? })` 默认最多读取每个响应体 16 MiB，配置须为正整数且不超过 64 MiB。按 Fetch body 实际交付的字节累计（浏览器解压之后），不相信 Content-Length；超过预算后取消 reader 并拒绝，未截断为有效页面。连续读取每 256 KiB 或 256 次读取让出事件循环，支持取消；按流解码 UTF-8，跨块字符/BOM 保持标准解码语义。自定义 fetcher 必须提供标准 Response/body，只有 json() 的替身不再适用。源响应已在网络层缓存、单块分配、解码字符串、JSON 对象、后续页面复制均有额外内存，故不是总内存硬上限；同步 JSON.parse 无法中途取消。遇到容量错误可降低请求页长或重建源提高预算后重试。


REST 编码完整性：JSON 响应体按严格 UTF-8 解码，非法字节、过长编码、代理区码点、超出 Unicode 范围或截断多字节序列明确拒绝，不静默替换为 U+FFFD。合法 UTF-8 编码的 U+FFFD、中文/Emoji 跨块及可选起始 BOM 保持。失败页不进入缓存，已成功页不变，可修复数据源后重试；此检查不能恢复上游在生成 JSON 前已经丢失的信息。


视区容量失败也会进入 dataSourceState.status=error 并包含 DATA_SOURCE 错误，即使没有实际网络请求。旧初始请求后来完成不能把当前失败范围误报 ready；相同视区重绘不自动重试，retryData 可显式重试。缩小视区到缓存可容纳范围会清除该视区错误，已有缓存命中时也恢复状态；重绑/load 清除旧范围错误。maxPages 必须足以覆盖实际视区涉及的页，缩小的有效页长可能要求更多缓存页，超范围不会偷偷截取视区。


切表后的数据状态：离开失败视区时清除该范围专属错误，并立即按当前绑定缓存重新生成 dataSourceState/onDataStateChange；仍在初始加载则 loading，已有真实分页错误则保留 error，其他情况 ready。数据状态描述绑定源，不因切到静态表而伪造 idle；只有 load/解除绑定才回到 idle。


XLSX 公式存储类型：普通公式（省略 t 或 t=normal）和共享公式（t=shared）导入为逐格公式；共享公式按相对/绝对引用展开，重新导出无需保留压缩共享存储。数组公式 t=array、数据表公式 t=dataTable 和未知类型在 ExcelJS 解码前明确拒绝，避免数组从属格成为固定缓存值而失去重算语义。当前引擎不支持数组/溢出公式，不能把拒绝检查当作该能力已经实现。该检查也不是完整共享公式结构或 OOXML 校验。


共享公式展开改用本产品的 A1 引用转换逻辑，字符串常量与带引号的工作表名不随行列偏移改写；相对/绝对引用按各格偏移处理。按工作表独立索引 si，先收集主公式再展开存储的从属格，支持从属行先于主行存储；检查编号为非负十进制安全整数、唯一主公式、主公式为声明范围左上格、从属格位于范围内，损坏组拒绝。只展开实际存储格，不按 ref 填充巨大矩形；不承诺结构化/外部/3D 引用等未支持公式语法兼容。


XLSX 公式容量：预处理在解码前检查每格公式（含前导 =）最多 32,767 UTF-16 单元，普通公式与共享公式展开结果跨工作表合计最多 8,000,000 单元。共享主公式过长先拒绝；每个从属引用转换后再次检查并累计，超过上限即停止，不继续展开剩余格，不截断输入。此项限制是公式文本容量，不是导入进程总内存上限；压缩包/XML/文本/对象仍有独立开销。

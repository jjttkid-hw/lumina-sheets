# SDK 布局与本地筛选

`SheetLayout` 是 `Sheet` 中 `columnWidths`、`rowHeights`、`hiddenRows`、`hiddenColumns`、`frozenRows` 五个字段的公开类型。坐标从零开始，尺寸为 CSS 像素。

```js
const previous = grid.getSheetLayout();
grid.setSheetLayout({
  columnWidths: { 0: 160, 1: 100 },
  rowHeights: { 0: 52 },
  hiddenRows: [3, 7],
  hiddenColumns: [4],
  frozenRows: 1,
});
grid.undo(); // 一次恢复全部五个字段
grid.redo();
grid.setSheetLayout({ hiddenRows: undefined, hiddenColumns: undefined });
```

`getSheetLayout(sheetId?)` 返回隔离副本，只读取稀疏布局字段，不枚举、访问或复制单元格数据。省略工作表 ID 时使用当前表；可读取只读表与分页表的布局。返回值可由宿主修改，修改不会影响实例。

`setSheetLayout(partial, sheetId?)` 只接受上述五个字段的普通对象。省略字段保留原配置；显式传入 `undefined` 清除该字段。提供的列宽和行高映射、隐藏坐标数组替换整个对应字段，不合并其中成员。所有字段校验通过后才提交，输入及历史中的映射和数组保持隔离；一次批量只产生一个撤销事务、一次订阅通知和一次 `onChange({sheetId, changes: []})`。

布局修改与其撤销/重做保留当前范围选区，不折叠为单个格。布局读写不枚举单元格数据；成本取决于稀疏布局和相关元数据的大小。`onChange` 或订阅回调可以读取已提交的布局、撤销该事务或加载新工作簿，旧操作不会覆盖回调提交的新状态。

与当前配置等值的批量不产生历史、通知或修改时间，也不清空重做记录。映射键顺序、隐藏坐标数组顺序不影响等值判断。`undefined`、空数组和空映射是可区分的显式配置。

- 列宽为有限数值，范围 `32–2000`；v0.9 起 SDK 工作簿校验也采用这个范围，与 Canvas 的实际列宽边界一致。更窄的旧配置会明确拒绝。
- 行高为有限数值，范围 `1–600`。映射键必须为规范的非负整数文本，并位于工作表尺寸内。
- 隐藏坐标必须为范围内的整数，不允许重复、空洞或非数值成员。冻结行数为 `0–rowCount` 的整数。
- 未知字段、无效工作表 ID 或无效配置抛出 `LuminaError`，错误码为 `INVALID_ARGUMENT`。只读和分页修改返回 `READ_ONLY`；销毁后的读写返回 `DESTROYED`。

`setColumnWidth(col, width, sheetId?)`、`setRowHeight(row, height, sheetId?)` 只修改指定轴成员，其他已有尺寸保留。`setRowsHidden(start, count, hidden = true, sheetId?)` 与 `setColumnsHidden(...)` 修改连续范围；这些方法复用批量布局的原子历史和等值判断。取消隐藏只过滤已存储的隐藏坐标，不遍历整个指定范围。新增隐藏坐标仍与实际新增数量成正比，不是常量时间操作。

隐藏仅改变可见版式，不删除值或改变公式引用，也不是数据权限控制。布局通过 JSON 保存；XLSX/PDF 各自的导出边界见 [XLSX-VISIBILITY.md](XLSX-VISIBILITY.md) 和 [PDF.md](PDF.md)。

## 本地筛选

```js
grid.setFilter('已完成');
console.log(grid.filterText); // 已完成
grid.setFilter(''); // 清除
```

`setFilter(text)` 只接受字符串，去除首尾空白后保存在实例视图状态中。`filterText` 是只读 getter。相同文本不重复通知；变更只刷新视图，不改写工作簿、公式结果缓存、修改时间或撤销/重做历史，也不触发 `onChange`。加载工作簿与绑定数据源会清空筛选。静态只读表允许本地筛选。

SDK 将值来源版本与选区、布局等视图通知分开。选择单元格、修改列宽/行高/隐藏轴及对应撤销不会因此重新扫描筛选；原始值编辑、编辑撤销重做、工作簿替换与结构变化会使筛选重新计算。冻结行数等筛选条件自身的变化仍按条件更新。

筛选传给 Canvas 的静态行筛选功能，匹配行为为不区分大小写的包含匹配。该状态不写入 JSON/XLSX/PDF，导出仍按工作簿中的持久化隐藏行列处理。筛选大量已存储数据需要扫描，不能把它当作服务端查询。

筛选匹配已存储单元格的计算值，保留已配置的冻结前导行作为表头；冻结行数为零时不会强留第一行。隐藏行列继续生效。扫描有短暂延迟并分批处理；新结果完成前显示当前工作表的未筛选视图和“正在筛选”提示，旧工作表或旧查询的结果不会套用到新表。

原合并区域只要仍有可见行列，就压缩到这些可见坐标，并显示原锚点的值、样式和公式结果；双击、输入或方向键选中该区域仍定位原锚点。全部被排除的区域不绘制；编辑中的区域完全消失时取消尚未提交的草稿。跨冻结边界分别裁剪，编辑框位于首个可见片段。批量交互的坐标策略由下述 `clipboardMode` 决定。

分页数据的非空本地筛选返回 `INVALID_ARGUMENT`，避免只筛选缓存页而呈现不完整结果；应在服务端查询后重新绑定数据源。空字符串允许清除状态。销毁后的 getter 和 setter 均返回 `DESTROYED`。

`onRender` 在当前绘制版本有效且实例仍存活时调用，回调异常交给 `onError`。回调可以修改视图或销毁实例，旧绘制版本随后送达的指标会被忽略。

## 可见坐标交互

```js
const grid = createSpreadsheet(host, { workbook, clipboardMode: 'visible' });
grid.setClipboardMode('all');
console.log(grid.clipboardMode); // all
grid.setClipboardMode('visible');
```

公开类型 `ClipboardMode = 'visible' | 'all'` 同时用于构造选项 `clipboardMode` 和 `setClipboardMode(mode)`。默认值为 `visible`；getter `clipboardMode` 只读。模式是实例视图偏好，`load` 与 `bindData` 后保留，不写入工作簿或导出文件。

- `visible`：复制、剪切、删除、粘贴和填充跳过筛选排除的行与持久化隐藏行列，目标按剩余可见坐标处理。复制得到的是可见内容的紧凑矩形。
- `all`：保持原始矩形坐标，范围可以包含隐藏和筛除单元格。选择该模式前，宿主应让用户了解其操作范围。
- 筛选进行中，`visible` 操作明确拒绝；等待结果后重试。`all` 使用原始坐标，不依赖尚未完成的筛选结果。
- `visible` 模式的合并区域复制与清除只处理原锚点一次，包括锚点本身位于隐藏行列但合并区域仍有可见部分的情况。复制矩阵的其余合并成员留空。多格粘贴或填充遇到可见合并区域会明确拒绝，避免部分覆盖；单格粘贴可写入原锚点。

可见模式粘贴不扩展工作表，剩余可见行列不足时整批拒绝。单次可见矩阵最多 100,000 个位置，复制和粘贴文本最多 20 MB；外部粘贴沿用 100,000 行、256 列的文本形状限制。填充按可见行列的顺序循环源块，公式平移使用每个源格与目标格的真实坐标差。

同一组件实例内复制时保存隔离的源数据与坐标，并在剪贴板写入本次复制的唯一标识；粘贴同时匹配标识和文本才保留原公式及样式。内部矩阵保留末尾空白行。跨实例、外部文本或浏览器丢弃标识时，按普通 TSV 值粘贴，不推测原公式。浏览器跨应用剪贴板格式保留行为尚未逐平台认证。

模式切换只产生视图订阅通知，保留选区、筛选结果、计算版本、修改时间和撤销/重做记录，不触发 `onChange`。相同模式为无操作。非法值抛出 `INVALID_ARGUMENT`，不会产生通知或改变状态；构造时省略/`undefined` 使用默认值，但 setter 必须明确传入合法模式。销毁后的 getter/setter 返回 `DESTROYED`。

静态只读与分页实例可以调整模式，但模式不会解除编辑限制。分页复制仅读取已有缓存，不自动加载整个选区；需要完整数据时使用全源 CSV 导出。隐藏/筛选和此交互模式均不是数据权限控制。

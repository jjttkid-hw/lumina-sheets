# XLSX 打印设置兼容子集

`xlsx-print.ts` 在原始 OOXML 层读取和写入打印设置，补足 ExcelJS 未保留手动行分页、未写出手动列分页的缺口。只承诺下表中的明确子集，遇到无法保留的打印语义会报错。

| 能力     | 支持范围                                             |
| -------- | ---------------------------------------------------- |
| 纸张     | A4、A3、Letter                                       |
| 方向     | portrait、landscape                                  |
| 页边距   | 上、右、下、左；XLSX 英寸与内部 PDF point 按 72 换算 |
| 重复标题 | 本工作表前 N 行、前 N 列；可同时使用                 |
| 手动分页 | 整行/整列分页，每方向最多 1,000 处；保留顺序与位置   |
| 合并保护 | 重复标题边界和手动分页不可切开合并区域               |

内部分页索引是零基“在该行/列前分页”。OOXML `<brk id>` 表示前一段结束的位置，采用相同整数可以表达这一语义。例如内部 `rowBreaks: [20]` 对应 `<brk id="20">`，在第 21 行前分页。

明确不支持并拒绝导入：其他纸张、非前导重复标题、打印区域、非 100% 缩放、启用 fitToPage、局部区间分页、自动分页记录、自定义页眉页脚、横向优先页序、黑白/草稿模式和自定义起始页码。`fitToWidth` / `fitToHeight` 在 fitToPage 未启用时是无效属性，允许 ExcelJS 默认写入的值。打印机驱动数据、Excel 所有页面布局选项不在此兼容子集内。

## 与导入导出的连接

```ts
const archive = await readXlsxArchive(buffer);
assertExcelJsCompatiblePaths(archive);
const printBySheetName = readXlsxPrintSettings(archive);
// 在这里提取其他受支持的 XML 元数据。
const verifiedBuffer = await writeXlsxArchive(archive);
// 交给 ExcelJS 读取 verifiedBuffer；再按工作表名称绑定 printBySheetName。
```

导出先由 ExcelJS 创建 XLSX，然后：

```ts
const archive = await readXlsxArchive(excelJsBuffer);
applyXlsxPrintSettings(archive, workbook.sheets);
const result = await writeXlsxArchive(archive);
```

`applyXlsxPrintSettings` 修改解析树上的 pageMargins/pageSetup、rowBreaks/colBreaks 和 workbook 的 `_xlnm.Print_Titles`，不重新生成单元格或公式。只有设有 `Sheet.printSettings` 的工作表会写入该元数据。

完整 `workbookFromXlsx()` 会将重复标题数、手动分页位置和其他验证范围的逻辑末端计入导入工作表尺寸，以免稀疏文件的元数据在导入后失效。此尺寸仍受应用导入配额限制（最多 100,000 行、256 列）；超出时明确拒绝。底层打印读取工具和 `readXlsxValidationRules` 可识别 Excel 上限范围，但不等于完整工作簿导入会放宽配额。

## 安全边界与路径

共享 `xlsx-archive.ts` 用 JSZip 和 saxes 读取。先检查每个 ZIP 部件的声明体积，然后实际有界流式解压每个部件（含 sharedStrings、styles 和未使用部件），累计最多 64 MB，单个 XML/rels 最多 16 MB；压缩输入最多 20 MB，2,000 个 ZIP 部件，50 张工作表，XML 最深 64 层、每部件最多 1,000,000 个元素。所有 XML/rels 都验证语法并拒绝 DTD 和处理指令。

预检将已验证字节重建为新的 ZIP 对象；`writeXlsxArchive` 输出后交给 ExcelJS，避免 ExcelJS 再读取未经检查的原始压缩流。代价是一次额外解压、XML 解析和重打包，以及有上限的内存占用；这是导入正确性和资源限制检查，不是大文件吞吐优化。

0.26 起，完整导入在 ExcelJS 解码前检查所有合并区域的坐标、命名空间、重叠与累计覆盖面积（整个工作簿最多 10,000 格），避免解码器先展开超大合并区再拒绝。可见列和隐藏列的 min/max 同样受 256 列限额约束，所有行（含空白行）受 100,000 行限额约束；重复 sheetData/cols/mergeCells 容器明确拒绝。单格合并视为普通格，不保留无布局效果的合并声明。最终工作簿仍执行原有尺寸与合并布局限制。

`tests/xlsx-merges.test.ts` 使用真实 XLSX 字节并监测解码器调用，确认不合规输入在解码前失败；覆盖恰好 10,000 格合法合并往返、相邻区域、空白远端列宽。上述限制针对已识别的展开路径，不代表对所有 OOXML 对象的全面安全认证。

工作簿和工作表通过真实关系文件查找，不假设 sheet1 对应第一张工作表。仅接受本地关系，拒绝外部工作簿/工作表目标、ZIP 路径逃逸和伪造 relationship 属性命名空间。

底层元数据工具支持关系指向自定义 worksheet 路径；当前 ExcelJS 单元格导入只支持 `xl/workbook.xml` 与 `xl/worksheets/sheetN.xml`。`assertExcelJsCompatiblePaths` 在导入前明确拒绝其他路径，避免 ExcelJS 忽略单元格。底层自定义路径测试不代表完整导入器支持自定义路径。

## 验证

### 对象内容丢失保护

完整导入会在 ExcelJS 解码前检查图片/图形、旧版图形与批注容器、背景图片、页眉页脚图形、透视表及缓存、嵌入对象和控件；也检查内容类型清单中声明的图表、宏和相关对象部件。发现当前模型无法保留的对象时，明确停止导入并建议保留原件、处理副本，避免导入后再次保存时静默丢失。类型的 Default 声明只有存在对应扩展名的实际部件时才触发检查，允许生成器预置的空声明。

这是对已知丢失路径的保护，不是新增图表/图片/透视表编辑能力，也不是对全部 OOXML 扩展的无损保证；完整对象兼容仍待实现。`tests/xlsx-objects.test.ts` 覆盖真实 ExcelJS 图片、工作表对象引用、任意路径的对象类型声明、透视缓存和普通单元格往返，并检查拒绝发生于解码前。

`tests/xlsx-print.test.ts` 使用真实 ExcelJS XLSX 字节，验证三种纸张、方向、四边距、含引号和逗号的工作表名、重复行列标题、行列手动分页往返，确认单元格末尾内容保持。还覆盖关系定位的改名 worksheet 路径、合并冲突、未支持设置拒绝、XML DTD、伪造命名空间、外部/逃逸关系和高压缩率的大 XML 预检。

这些测试验证本产品的明确兼容子集，不代表任意 Excel 文件的打印版式完全保真。


PDF 异步资源清理：字体、JPEG 编码回调和 Blob 字节读取的等待支持取消；取消后不继续装配文件或报告后续进度，迟到失败不会造成未处理拒绝。像素比例在等待字体前验证。画布的 finally 清理覆盖上下文创建、测量、分页和编码，失败也将尺寸重置为 1×1。底层浏览器工作可能仍完成，取消不等同于强制中断原生编码；同步绘制不可抢占。

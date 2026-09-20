# 工作表打印设置

`Sheet.printSettings` 是可随工作簿 JSON 保存的打印设置。PDF 导出时自动读取，单次 `PdfExportOptions` 的同名字段优先于工作表设置；没有提供的字段继续继承。`margins` 作为完整对象覆盖，数组作为完整数组覆盖，传入 `rowBreaks: []` / `columnBreaks: []` 可取消本次导出的手动分页。

```js
sheet.printSettings = {
  paperSize: 'A4',
  orientation: 'landscape',
  margins: { top: 28, right: 28, bottom: 28, left: 28 },
  repeatRows: 1,
  repeatColumns: 1,
  rowBreaks: [40, 80],
  columnBreaks: [8],
};
```

纸张支持 A4（595.28 × 841.89 point）、A3（841.89 × 1190.55 point）和 Letter（612 × 792 point）。纵向使用上述尺寸，横向交换宽高。1 PDF point = 1/72 英寸；页边距均为 PDF point，允许 0，要求四边都提供且为有限非负数。

`repeatRows` 和 `repeatColumns` 是从第 1 行/列开始重复的数量。例如 `repeatRows: 2` 表示每页重复第 1、2 行。

`rowBreaks` 和 `columnBreaks` 使用零基索引，表示在该行/列**之前**开始新页。例如 `rowBreaks: [40]` 在第 41 行前分页，前 40 行属于前一段。手动分页位置须严格递增、不重复、位于重复标题之后、且小于工作表相应维度。每个方向最多允许 1,000 处分页。

没有设置时保持原有行为：A4 横向、四边 28 point，默认重复冻结行，不重复列，不设置手动分页。手动分页之外仍会按真实列宽和内容折行高度自动分页；某一手动分段放不下一页时会继续自动分页，不会挤压、遗漏或截断单元格。

## 校验与复制

`src/lib/print-settings.ts` 提供：

```ts
validatePrintSettings(
  value: unknown,
  bounds?: { rowCount: number; colCount: number },
): asserts value is PrintSettings

copyPrintSettings(
  value: unknown,
  bounds?: { rowCount: number; colCount: number },
): PrintSettings | undefined
```

校验不会修改输入，拒绝未知字段及非法参数。`copyPrintSettings(undefined)` 返回 `undefined`；其他输入先校验，再深复制页边距和分页数组，适合 SDK、JSON 导入和历史记录使用。

校验时可传工作表维度。PDF 另以实际已用区域校验：显式重复标题或分页超出已用区域会拒绝，不会静默收敛。只有旧有的冻结行默认值会按已用区域收敛。

## 合并与输出限制

手动分页不可穿过合并区域；可以放在合并区域之前或之后。重复标题边界同样不可穿过合并区域。自动分页会尽量将合并区域整体移至下一页；单行、单列或合并区域无法放入一页时会明确失败。

页边距扣除后须保留网格空间，PDF 另为标题和页脚预留 40、20 point。页面规划与实际 Canvas 绘制消费同一组页边距和纸张尺寸。页眉、行列段标签和页脚均位于所选可用区域内。

原有安全上限继续生效：默认 5,000 行、256 列、200,000 格、200 页。页数上限在分页过程中检查，无法通过大量手动分页绕过。仍不支持打印区域、缩放适配、Excel 打印版式完全兼容、未物化分页数据源的 PDF 导出。

这里的打印分页不同于 `ReportDefinition.pagination`：后者只向工作表插入重复标题行，不设置物理纸张分页。

SDK 的 `setPrintSettings` / `getPrintSettings` 提供隔离副本与撤销重做，JSON 导入导出保留设置。v0.5 XLSX 可双向保留纸张、方向、换算成英寸的页边距、前导重复标题及手动行列分页；原始 OOXML 读写补足 ExcelJS 的行分页读取与列分页写出缺口。非支持纸张、打印区域、缩放适配、非前导标题和合并冲突会明确失败，不构成完整 Excel 打印往返兼容。详见 [XLSX-PRINT.md](XLSX-PRINT.md) 和 [SDK.md](SDK.md)。

## 验证

`tests/report-print-settings.test.ts` 覆盖纸张尺寸、深复制、严格校验、覆盖优先级、双向手动分页、重复标题、合并保护、自动分页补充、范围/页数拒绝，以及模拟 Canvas 的实际 PDF 绘制坐标和 PDF MediaBox。已有 PDF 测试继续通过。模拟绘制测试验证布局与输出一致性，不替代真实浏览器的字体和打印机验收。

XLSX 兼容使用的第三方依赖与许可复核边界见 [DEPENDENCIES.md](DEPENDENCIES.md)；已有自动测试不等于商业授权审计或各版本 Excel/WPS 打印认证。

## v0.8 隐藏行列

PDF 页面的行列索引仍指向原工作表；隐藏轴尺寸为 0 且不绘制，其余单元格的公式按完整工作簿计算。隐藏的重复标题也不打印；手动分页若落在连续隐藏区，映射到后面的首个可见轴，重复边界合并，不生成空白页。全部已用行或全部已用列隐藏时明确提示没有可打印内容。

部分隐藏的合并区域保留剩余可见部分，原左上角的内容绘制一次（即使锚点自身位于隐藏轴）；完全隐藏的合并区域不参与分页。重复标题或手动分页若拆开仍可见的合并区域，会拒绝导出。隐藏不是保密或访问权限机制，公式和合并内容仍可能呈现相关数值。

行高按 CSS 像素 × 0.75 转换为 PDF point，非隐藏行允许最小 1 px。为完整输出文本，PDF 可继续扩展行高以容纳折行；不承诺逐像素等同于 Canvas。隐藏不绕过原始已用区域的行/列/单元格配额。Canvas 栅格 PDF 无可选择文本，Excel 打印完全保真仍未实现。

`tests/report-pdf-visibility.test.ts` 覆盖分页与实际绘制调用；包含隐藏文本不绘制、隐藏输入仍参与公式、隐藏锚点合并、隐藏超长文本不触发折行计算、重复标题与分页去重。

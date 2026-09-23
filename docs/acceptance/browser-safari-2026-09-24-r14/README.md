# macOS Safari 27.0 实机公式与历史验收 r14

执行日期：2026-09-24（Asia/Shanghai）  
环境：macOS 26.7 arm64，Safari 27.0  
页面：GitHub Pages `examples/report.html?acceptance=r12-safari`  
候选提交：`e51d3a0`  
站点摘要：`6cfad7b747f837df98b68702cf6c9b1cd04785a80c7c26baea23fff8506ea18c`  
SDK 摘要：`8833fde167d56b59446110f34f54fbe1d186af18a4580a24819cefba2af68a3e`

## 实际操作

1. 通过页面的报表类型开关进入“公式示例”，状态显示“已生成公式示例 · 可直接编辑或导出”。
2. 在地址栏输入 `D5` 并点击“定位”，AX 树选中 `D5`，单元格值和结果均为 `40`。
3. 在“单元格内容或公式”栏输入 `50` 并点击“应用”，页面显示“单元格已更新 · 相关公式随之重算”，D5 和“结果”均变为 `50`。
4. 点击“撤销”，D5 和结果恢复为 `40`；点击“重做”，D5 和结果恢复为 `50`。
5. 每次状态读取均保留 `table`、`row`、`cell` 语义；本轮未观察到页面错误、控制台错误或运行级错误。

原始 AX 关键片段见 [safari-ax.txt](safari-ax.txt)，结构化记录见 [result.json](result.json)。

边界：本记录只覆盖 macOS Safari 的公式编辑、重算、撤销和重做。它不代表原生中文 IME 候选窗口、VoiceOver/NVDA/JAWS、实体移动触控、跨设备性能、完整 Excel/WPS 兼容或 npm registry 发布已经通过。

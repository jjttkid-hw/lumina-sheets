# 性能预算

Lumina 的表格绘制路径使用 Canvas，XLSX 解析器保持按需加载。每次站点或 SDK 构建后，`node scripts/check-bundle-performance.mjs` 会检查首屏入口，避免 ExcelJS 意外进入静态加载链路，并限制两个公开示例页面的入口与 module-preload JavaScript 总量。

当前预算为每个页面 700,000 字节（未压缩）。这个数字覆盖模块依赖的网络传输上限，不把用户主动导入/导出 XLSX 时才加载的 ExcelJS 计入首屏。构建输出中的 `exceljs.min-*.js` 可以很大，但必须只通过动态 import 加载。

预算门禁是回归保护，不等同于所有设备上的性能认证。正式版本仍需要浏览器、真实业务数据和目标设备验收记录。

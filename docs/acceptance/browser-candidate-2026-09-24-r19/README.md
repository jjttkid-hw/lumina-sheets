# Lumina Sheets 0.29.0 候选 r20

受测源码提交：`db53ea2d836825ae65c9711988b00ea3f52e1818`。来源时间：`1790122493`。执行环境：macOS arm64、Node v24.14.0；浏览器实际版本见各报告。

- 站点 SHA-256：`d23aa5a69c9b72610496589d4f1654a0bc51d975394bd222949e9ba22c16e54c`
- SDK SHA-256：`d97b8ebfa30f99fc68120084b98c7c2b1913240014c019395f956c7e7aa0f432`（721,929 字节）

本候选在分页缓存热路径优化后重新生成。Chromium、Firefox、WebKit 分别执行 smoke、交互、焦点、布局、性能、DOM/ARIA、合成输入事件和原生存储持久化检查；另执行 Chromium 触控模拟、XLSX 5 项与 WPS 2 项检查。全部通过，页面、控制台及运行错误均为零。

本记录不代表原生 IME 候选窗口、真实屏幕阅读器、实体移动触控、正式 Safari 全矩阵、完整 Excel/SpreadJS 兼容、跨设备性能、法务复核或 npm registry 首发通过。

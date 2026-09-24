# Lumina Sheets 0.29.0 候选 r19

受测源码提交：`3115a0b5f4214bbecc06b9b0aa95645280ba06b7`。来源时间：`1790122493`。执行环境：macOS arm64、Node v24.14.0，浏览器实际版本见各报告。

- 站点 SHA-256：`5e5ddf98a039b854d5822a6765854c44b78ef2abe3d63c8684eeffae545fa8d2`
- SDK SHA-256：`4a8f0ea731889fcd8e61dafe263d48294a29a40da3c78f9f4db94830a0f242a0`（721,747 字节）

新增 npm 语料检查入口改变 package.json，进而改变内嵌来源指纹；旧 r18 证据不能用于新包。新包在本机与 CI 得到相同摘要，本次失败并非已证实的 Node 跨版本差异。此目录的 25 份报告均由当前制品重新运行产生，没有改签旧报告。

Chromium、Firefox、WebKit 分别执行 smoke、交互、焦点、布局、性能、DOM/ARIA、合成输入事件和原生存储持久化检查；另执行 Chromium 触控模拟、XLSX 5 项与保留 WPS 桌面文件 2 项检查。全部通过，页面、控制台及运行错误均为零。

本记录不代表原生 IME 候选窗口、真实屏幕阅读器、实体移动触控、正式 Safari 全矩阵、完整 Excel/SpreadJS 兼容、跨设备性能、法务复核或 npm registry 首发通过。

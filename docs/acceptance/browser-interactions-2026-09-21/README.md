# 2026-09-21 真实交互与 SDK 编辑修复

Chrome 153.0.8010.50、Playwright Firefox 144.0.2、Playwright WebKit 26.0 各通过 6 组新增交互检查，并在同一重建制品上复测原有 8 组冒烟，合计每引擎 14 组。环境 macOS arm64、Node v24.14.0、Playwright 1.57.0、headless 实际浏览器，页面异常与控制台错误均为零。

## 真实浏览器发现并修复的问题

SDK 网格 F2 进入编辑会通知选区，SDK 的选区通知原先也递增 Canvas 内容修订。React 重新渲染后，草稿所有权认为内容已替换，新输入框被清除。受控 hooks 测试未覆盖此真实 React 订阅时序。首次失败报告和截图已保留，不能解释为测试通过。

SDK 现在分别维护订阅更新序号与内容绘制修订；纯选区更新继续通知 React，但不再冒充内容变化。实际单元格、布局及其他内容变更仍递增内容修订。Canvas 同时核对草稿与当前选区，切到其他单元格或扩展选择仍阻止旧草稿提交。未扩大公开 API。

## 新增操作和结果

- 订单填报 B2：F2 输入 -1，Enter 拒绝且保留草稿；更正为 7 后成功，撤销回到 2、重做回到 7。
- D2 列表：Alt+下箭头打开，搜索“取消”并 Enter 提交；再次搜索“确认”后 Escape 保持原值；撤销恢复“待审核”。
- 原生剪贴板：使用真实 textarea、键盘 Cmd+C / Cmd+V，不伪造 ClipboardEvent。粘贴 `8\t-1` 到 B2:C2，验证两格都不改变；粘贴 `8\t600` 两格成功，一次撤销同时恢复。各引擎串行操作共享系统剪贴板。
- 网格原生复制、剪切和粘贴：F2 文本复制到 F3，再剪切 F3 到 F4，逐次核对值。
- 在真实页面通过包内公开 JS API 挂载两个 SDK，检查焦点实例键盘撤销隔离、重复挂载报错、destroy 重复调用、DOM 清理、宿主 class 恢复、同宿主重建和旧实例写入拒绝。
- 异步分页请求未返回时 destroy，绑定返回 AbortError；同宿主创建新实例，旧数据迟到后无旧回调、无覆盖新值。

原有 8 组范围见 [首轮冒烟说明](../browser-smoke-2026-09-21/README.md)。本目录六份通过报告属于以下新制品，不能混用首轮旧制品哈希：

- SDK 0.29.0，39 文件 / 638413 字节；SHA-256 `8371aab6f6db7e4aa6cf696c5c08f1b0c3b4d70c9bdc1a140fcd7a3eaf9bdabe`。
- 站点 SHA-256 `8dd656afc3289e02241e9126bd1b7ac4fa3dda8944f1daffae993aa0f8b9da57`。
- 完整站点清单见 site-manifest.json；执行脚本哈希见 scripts.json；原始错误与通过结果及截图均随本目录保存。

执行方式：先 build:site、check:sdk，并启动 4273 端口、/lumina-sheets/ 基路径预览；设置 PLAYWRIGHT_MODULE 指向已安装 Playwright 的 index.mjs，BROWSER_ENGINE 依次为 chromium、firefox、webkit，运行 scripts/browser-interactions.mjs。脚本在操作前核对实际 HTTP 文件字节与 dist。剪贴板检查不要并行运行不同引擎。

全量 160 文件 / 2278 测试通过，format:check、git diff --check、build:site、check:api、check:sdk 通过。真实浏览器原生 IME、正式 Safari、物理触控、屏幕阅读器、完整性能/文件语料矩阵仍未完成；这里不是完整稳定版验收签署。

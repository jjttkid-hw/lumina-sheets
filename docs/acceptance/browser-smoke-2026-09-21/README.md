# 2026-09-21 真实浏览器冒烟记录

本轮不构成完整稳定版签署。使用隔离浏览器上下文和新建验收工作簿，不修改用户原有浏览器数据。受测为本地 Pages 基路径构建，通过 HTTP 逐文件核对后再操作页面。

| 引擎 | 实际版本 | 结果 |
| --- | --- | --- |
| Google Chrome | 153.0.8010.50 | 8 组通过，页面异常及控制台错误 0 |
| Playwright Firefox | 144.0.2 | 8 组通过，页面异常及控制台错误 0 |
| Playwright WebKit | 26.0 | 8 组通过，页面异常及控制台错误 0 |

环境为 macOS arm64 / Node v24.14.0 / Playwright 1.57.0，headless 实际浏览器。WebKit 不是正式 Safari 验收，窄屏不是物理触控验收。

## 操作与断言

1. 工作空间实际加载，Canvas 有非零尺寸，保存状态就绪，保存截图。
2. 新建工作簿，A1 输入 42，工具栏撤销与重做；B1 输入 =A1*2 并读取活动格结果 84；F2 修改为 =A1*3 得到 126；Escape 丢弃新草稿。
3. 等待本地已保存，刷新页面后 A1、B1 和计算结果保持。
4. 缩放至 110%，390×844 窄屏页面无横向溢出。截图显示导航展开；未宣称全部控件可操作或移动体验通过。
5. 点击全部 12 种报表类型，检查成功状态和实际网格。计时指标来自示例展示，属于观察值，不能证明性能预算通过。
6. 实际下载 JSON、CSV、XLSX、PDF，检查非空及 JSON/ZIP/PDF 文件结构标志；上传刚下载的 XLSX，等待“报表已恢复”。此项不是完整数据逐格往返比较或 Excel 应用实测。
7. 点击空闲绘制检查，实际结果为 1 秒内额外绘制 0 次。
8. 访问 dist/sdk/example.html，切换两张工作表并核对网格名称。

原始结果与每组耗时见三个引擎 JSON。首次 Chrome 捕获报表示例默认请求 /favicon.ico 返回 404，见 before-fix-chromium.json；补齐网页与包内本地图标后复测通过。制品：

- SDK 0.29.0，39 文件、638341 字节，SHA-256 `e12fb27e0e348d66bd64ab1d49dde68b60ed3dbfc8b02d4de0d7e3020a78e342`。
- 站点 SHA-256 `406d6d2cb21201bbb98181129f49a86d6d8f0fea7f0d60a850fc902a327b1b0b`，逐文件清单见 site-manifest.json。
- 下载文件及其他截图保留在本地 artifacts/browser-acceptance/ 下；重要截图已复制到本目录。下载哈希见 JSON。

运行前准备当前构建与安装包，启动本地预览，然后执行：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs BROWSER_ENGINE=chromium node scripts/browser-smoke.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs BROWSER_ENGINE=firefox node scripts/browser-smoke.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs BROWSER_ENGINE=webkit node scripts/browser-smoke.mjs
```

默认地址为 http://127.0.0.1:4273/lumina-sheets/，可设置 BROWSER_TEST_URL；脚本仅允许本机地址，并核对响应字节与 dist。浏览器驱动和引擎需要预先安装。Chrome 使用本机 Chrome channel；环境没有 Chrome 时可指定 BROWSER_CHANNEL。

尚待：原生中文 IME、完整剪贴板与规则交互、真实 Safari、物理移动触控、屏幕阅读器、完整生命周期及性能矩阵、受支持 Excel 语料与完整发布证据。不得将这里的 passed 复制为 stable-release.json 的全部浏览器通过项。

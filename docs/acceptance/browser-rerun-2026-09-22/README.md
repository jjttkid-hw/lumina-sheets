# 2026-09-22 候选构建浏览器复验

本目录保存对同一 `0.29.0` 候选构建执行的真实 Playwright 浏览器复验。报告不是 v1.0 稳定版签收单；它们只记录当前候选的自动化浏览器证据。

候选绑定：

- 站点 `dist/` 摘要：`fec2fa53ea4e8d5813e8cdbbb7fd7e6a6e70cd8a2ab4c054316326efe5c2c858`
- SDK `lumina-report-sdk-0.29.0.tgz` 摘要：`47099f8b5bf603a6054ec5c234acdd9a36f91350bb5f0111395b1705177ca940`
- Node `v24.14.0`、npm `11.9.0`、macOS `darwin/arm64`
- Playwright 模块：`/tmp/lumina-playwright-48011/node_modules/playwright/index.mjs`
- 本地服务基路径：`http://127.0.0.1:4274/lumina-sheets/`

执行前生成候选：

```text
npm run build:site
npm run check:sdk
npm run check:site-runtime
npm run check:api
```

然后将 `dist/` 复制到 `/lumina-sheets/` 子目录后启动静态服务器，并对 Chromium 153.0.8010.53、Firefox 144.0.2、WebKit 26.0 分别执行：

```text
scripts/browser-smoke.mjs
scripts/browser-interactions.mjs
scripts/browser-layout.mjs
scripts/browser-focus.mjs
scripts/browser-performance.mjs
```

Chromium 另外执行 `scripts/browser-touch.mjs`。三引擎的上述五组套件均通过；每个 `result.json` 均为 `passed`，包含 0 个 page error、console error 和 run error。触控套件通过 3 项检查。

报告目录按套件拆分：`smoke/`、`interactions/`、`layout/`、`focus/`、`performance/`、`touch/`。性能目录保留三引擎的原始测量 JSON。`summary.json` 提供机器可读汇总，`sha256-manifest.json` 绑定本目录当前文件字节。

限制：WebKit 运行器不是正式 Safari；Chromium 触控使用 CDP 注入，不等于实体手机触摸；原生输入法组合、屏幕阅读器、真实系统剪贴板权限、干净安装/跨机器可重复构建及第三方商业许可证审计仍未完成。因而本目录不能单独证明 v1.0 或完整 SpreadJS/Excel 兼容。

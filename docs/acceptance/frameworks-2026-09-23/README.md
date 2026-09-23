# React / Vue 安装包实际浏览器验收（2026-09-23）

当前 SDK 0.29.0 从本地 tgz 安装进独立临时项目，经 Vite 开发服务和生产构建分别运行。12 份报告共 72 项检查全部通过，pageErrors / consoleErrors / runErrors 均为 0。这是本地安装包证据，不是 npm 注册表发布或下载证据。

- SDK SHA-256：`4cdae46eeb77d8d13f985f5ff33126829376882095dde088276048aae8770e0e`
- React / react-dom 19.3.0，Vue 3.5.43，Vite 6.4.3，Playwright 1.57.0。
- 环境：macOS arm64，无头浏览器；每份 JSON 记录完整浏览器版本、Node 版本、执行时间、夹具和脚本 SHA-256。
- 宿主依赖使用专用 package-lock.json；SDK 安装后核对 JS/CSS 与 tgz 提取文件摘要相同，无源码 alias。

| 模式 | 浏览器 | 宿主 | 检查 | 原始报告 |
| --- | --- | --- | --- | --- |
| development | chromium 153.0.8010.54 | react | 6 / passed | [JSON](development/chromium/react/result.json) |
| development | chromium 153.0.8010.54 | vue | 6 / passed | [JSON](development/chromium/vue/result.json) |
| development | firefox 144.0.2 | react | 6 / passed | [JSON](development/firefox/react/result.json) |
| development | firefox 144.0.2 | vue | 6 / passed | [JSON](development/firefox/vue/result.json) |
| development | webkit 26.0 | react | 6 / passed | [JSON](development/webkit/react/result.json) |
| development | webkit 26.0 | vue | 6 / passed | [JSON](development/webkit/vue/result.json) |
| production | chromium 153.0.8010.54 | react | 6 / passed | [JSON](production/chromium/react/result.json) |
| production | chromium 153.0.8010.54 | vue | 6 / passed | [JSON](production/chromium/vue/result.json) |
| production | firefox 144.0.2 | react | 6 / passed | [JSON](production/firefox/react/result.json) |
| production | firefox 144.0.2 | vue | 6 / passed | [JSON](production/firefox/vue/result.json) |
| production | webkit 26.0 | react | 6 / passed | [JSON](production/webkit/react/result.json) |
| production | webkit 26.0 | vue | 6 / passed | [JSON](production/webkit/vue/result.json) |

## 检查内容

1. 真实 Canvas 已绘制；开发 React StrictMode 确实创建两次并清理一次，生产创建一次。
2. 鼠标选中 A2、编辑提交；父组件替换初始工作簿对象和回调后不覆盖用户编辑，使用最新回调，撤销仍有效。
3. 同容器重复实例拒绝；显式切换文档后仅保留一个画布与活动实例。
4. 延迟文件读取在切换文档后返回 IMPORT_CANCELLED；迟到字节不覆盖新文档。
5. 分页请求在卸载后返回 AbortError，AbortSignal 已取消；迟到结果不回写、无旧事件通知。
6. 十轮挂载/卸载后创建与销毁计数一致，DOM 中无遗留 Canvas/grid/SDK 容器；最终销毁可重复调用。

## 重跑与边界

仓库根目录存在经 check:sdk 生成的 `artifacts/lumina-report-sdk-0.29.0.tgz` 后运行：

```sh
npm ci --ignore-scripts --prefix scripts/fixtures/frameworks
node scripts/fixtures/frameworks/node_modules/playwright/cli.js install chromium firefox webkit
node scripts/browser-frameworks.mjs
```

脚本自行创建临时项目、锁定安装宿主依赖、安装当前 tgz、执行两种模式三引擎检查并清理项目。输出在 `artifacts/browser-frameworks/`。可用 `PLAYWRIGHT_MODULE` 指定已有同版本驱动，`BROWSER_CHANNEL=chrome` 使用 Chrome，`BROWSER_ENGINE=chromium` 缩小本地诊断范围；CI 固定运行完整矩阵并保留失败报告。

开发模式测试曾暴露 macOS 临时目录别名问题，首轮完整运行还暴露测试器混淆 DOMException 数字 code 与 name、同进程 Vite 构建沿用开发 NODE_ENV 的问题。修正测试器后重新完整运行；这里保留的是实际重跑结果，未修改失败报告为成功。

DOM 清理计数不等于堆内存无泄漏认证。该矩阵不覆盖 SSR、Next/Nuxt、其他框架版本、原生 Safari、系统输入法、真实屏幕阅读器或实体触控。当前没有因此宣布完整商业替代或 v1.0。

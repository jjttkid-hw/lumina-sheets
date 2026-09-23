# 原生浏览器存储救援验收（2026-09-23）

当前 0.29.0 站点在 Chromium 153.0.8010.54、Firefox 144.0.2、WebKit 26.0 各通过 3 项检查，共 9 项；页面/控制台/运行错误为零。环境为 macOS arm64 / Node 24.14.0 / Playwright 1.57.0。使用独立浏览器上下文的原生 IndexedDB、真实下载事件和文件输入；不替换数据库实现。

- 站点 SHA-256：`209e8f6485f146cc41ed15b352f7760a5a3a47b35ac9dcd273980d66ac79bb45`
- SDK tgz SHA-256：`4cdae46eeb77d8d13f985f5ff33126829376882095dde088276048aae8770e0e`
- 来源时间：`1790122493`；运行器摘要、执行时间、环境和逐项结果在各 JSON 中。

## 已执行流程

1. **损坏日志救援**：植入有效快照和非法序号的日志，页面拒绝打开工作空间；实际点击“下载恢复备份”，核对 partial 标记、警告、原始快照与损坏日志完整保留。把下载文件导入另一个干净上下文，明确使用“原始快照（未重放日志）”，恢复为新工作簿，刷新后仍可读取。原上下文数据库逐项保持不变，损坏日志没有写进目标数据库。
2. **部分损坏备份**：有效工作簿和损坏条目并存，实际下载再导入。选损坏条目恢复时显示错误且没有写入；搜索隐藏当前选择会禁用恢复，搜索 Enter 不恢复、无结果禁用、清除搜索保留已选项、取消不写入。重新导入后恢复有效条目，刷新可读取，原有效/损坏记录都保持。
3. **历史恢复点**：合成备份中当前快照损坏而历史版本有效，按版本名搜索后显式选择。恢复副本拥有新的工作簿和工作表 ID，公式原文、规则及规则的工作表关联保留；刷新可读取，批注和历史列表未被隐式导入，原工作簿保持。

| 浏览器 | 报告 | 真实下载示例 | 截图 |
| --- | --- | --- | --- |
| Chromium | [结果](chromium/result.json) | [损坏日志备份](chromium/damaged-journal-backup.json) | [启动救援](chromium/startup-rescue.png) / [历史选择](chromium/history-selection.png) |
| Firefox | [结果](firefox/result.json) | [损坏日志备份](firefox/damaged-journal-backup.json) | [启动救援](firefox/startup-rescue.png) / [历史选择](firefox/history-selection.png) |
| WebKit | [结果](webkit/result.json) | [损坏日志备份](webkit/damaged-journal-backup.json) | [启动救援](webkit/startup-rescue.png) / [历史选择](webkit/history-selection.png) |

所有输入和下载均为合成业务数据，不含用户文档。首轮历史恢复测试误用了不受支持的校验 kind，应用正确拒绝；修正夹具为 whole/between 后三引擎重新执行通过，没有改变应用来放过无效数据。

## 重跑

CI 下载同一 validate 任务生成的站点和 SDK 包，安装 `scripts/fixtures/frameworks/package-lock.json` 锁定的工具及三个浏览器，再执行 `node scripts/check-recovery-browser.mjs`。运行器启动临时端口的本地预览，逐个运行三引擎并自动关闭服务；失败返回非零，阻止部署，并保留失败报告。

已有预览服务时可运行：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs BROWSER_ENGINE=chromium BROWSER_TEST_URL=http://127.0.0.1:4273/lumina-sheets/ node scripts/browser-recovery.mjs
```

默认 Chromium 使用 Chrome；使用锁定下载的 Chromium 时设 `BROWSER_CHANNEL=bundled`。执行前核对 HTTP 站点字节与本地 dist 摘要。此证据不覆盖物理断电/磁盘损坏、所有存储异常、原生 Safari、辅助技术、实体触控或跨设备同步；版本仍为 0.29.0。

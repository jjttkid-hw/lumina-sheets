# 2026-09-21 全套浏览器复跑与地址框修复

按用户要求，重新执行全部现有浏览器脚本；本记录为范围明确的真实浏览器自动化验收，不是整个 v1 平台矩阵全部通过。

## 最终结果

Chrome 153.0.8010.50、Firefox 144.0.2、Playwright WebKit 26.0 各通过 24 组，共 **72 组通过**。每组原始结果见 final/<engine>/<suite>/result.json；运行起止和退出码见 final/runs.json。三引擎每份报告的 pageErrors、consoleErrors 均为空。

- smoke：8 组，工作空间、新建/编辑/撤销重做、IndexedDB 刷新、缩放和窄屏、12 种报表、JSON/CSV/XLSX/PDF 下载与 XLSX 重导入、空闲零额外绘制、独立 SDK 多表切换。
- interactions：6 组，非法输入纠正、列表键盘选择、原生剪贴板整批拒绝/提交、复制剪切粘贴、实例隔离与销毁重挂载、未完成数据源销毁隔离。
- focus：4 组，Enter/Escape 宿主接管焦点、普通键盘取消、同步提交回调接管焦点。前两组在真实 DOM/React 中派发 KeyboardEvent 来固定时序，其余使用浏览器键盘操作；不是原生 IME 测试。
- performance：6 组，10 万/100 万实存单元格、跨 40 个视区、5 次编辑与后台公式值、取消/清空、独立与重叠范围基准。

额外窄屏检查：390×844 直接加载，展开导航、点击导航外露遮罩关闭、选格、放大至 110%、确认页面无横向溢出；三个桌面引擎均通过。截图与记录见 final/narrow。初版脚本默认点击遮罩中心，被覆盖该区域的侧栏拦截，修正为点击外露遮罩坐标后通过；没有修改产品或强制绕过点击命中。此项不代替物理触控。

## 本轮发现并修复

初次 Chrome smoke 的 create-edit-history 与 indexeddb-reload 失败，源于 A1 定位草稿被迟到的地址同步覆盖，42 实际写入 D2，B1 的 =A1*2 得到 0。独立新建 12 次，复现 4 次错误单元格写入；原始事件日志 address-probe.jsonl 与 before-fix 截图保留。其他初次套件仍独立完成，未把失败覆写为通过。

App 地址框改为按工作簿/工作表/选中坐标归属的草稿，在选区渲染时同步重置，移除被动 effect 的地址覆盖；同坐标重建选区或单元格值更新保留用户定位草稿。增加两项回归，smoke 定位后检查实际活动格，避免错误延后到公式计算才暴露。修复后独立 12 次均写入 A1；见 address-probe-after.jsonl。随后重新构建并全套重跑三引擎，没有只重试失败项。

## 制品与环境

- 版本 0.29.0；未升级或声明 v1.0。
- 最终站点 SHA-256：b71d36ea270ccefcf2e858eee6f2213f65b9e46c8bd5863d1eceeae6f3ce14a8。
- SDK tgz SHA-256：3976d561c6153bb3f7df88f33cf1612ad3ce705149ed7672b670effcedce620f，39 文件 / 639089 字节。修复仅涉及工作空间，SDK 字节未变。
- 修复前站点 SHA-256：406a14ff6cbbdf8d89a92c5479c5bea17837e166892ff6d7fad923c710c92e1b。
- 环境 macOS arm64、Node v24.14.0、Playwright 1.57.0、headless。设备资源和脚本哈希见 final/environment.json。默认 1440×1000；引擎与套件串行，剪贴板不并发。
- 所有套件执行前逐字节核对 HTTP 站点，完整文件摘要见 final/site-manifest.json；下载文件、性能逐次样本和截图均随报告归档。
- 生产构建、SDK 包/消费者检查与 15 文件公开 API 契约通过；本轮 131 项针对性回归通过。全量 162 文件 / 2296 项测试通过，原始结果见 unit-tests.json。

## 百万实存格本机观测

100000 行 × 10 列，100000 个公式；下表单位 ms。无延迟通过预算，不是 SLA 或竞品对比。

| 引擎 | 数据准备 | 首次绘制 | Canvas P95 | Worker 往返 |
| --- | ---: | ---: | ---: | ---: |
| chromium 153.0.8010.50 | 1732.0 | 1750.2 | 5.5 | 1108.8 |
| firefox 144.0.2 | 1855.0 | 1876.0 | 6.0 | 4125.0 |
| webkit 26.0 | 2156.0 | 2171.0 | 3.0 | 1316.0 |

40 个目标视区包括填充区和空白边界。每档只有 5 次编辑，数据准备/后台计算各为单轮观测；未控制其他应用负载和功耗模式，不能用于稳定分位数或跨设备性能承诺。

## 未覆盖与复跑

正式 Safari、物理移动触控、原生中文输入法、屏幕阅读器、完整框架矩阵与真实 Excel 语料仍未验收。WebKit 不是正式 Safari；窄屏桌面不是手机。BROWSER-ACCEPTANCE.md 中扩展故障恢复清单并未全部纳入这四份脚本，本轮不宣称完整平台认证。许可证待审项和 v1 发布门禁没有因浏览器通过而解除。

复跑：以 /lumina-sheets/ 基路径构建并在 127.0.0.1:4273 预览，设置 PLAYWRIGHT_MODULE 为已安装 Playwright index.mjs，依次设置 BROWSER_ENGINE=chromium/firefox/webkit，串行运行 scripts/browser-{smoke,interactions,focus,performance}.mjs。补充探针 address-probe.mjs 和 narrow-check.mjs 内使用本机驱动路径，其他环境需调整路径。

# elliptic 证据入包后的浏览器复验

版本 0.29.0。三引擎 Chrome 153.0.8010.50、Firefox 144.0.2、WebKit 26.0 串行完成 smoke 8、interactions 6、focus 4、performance 6、layout 6，各 30 组，总计 90 组通过。另 Chromium 浏览器触摸包 3 组通过。最终报告的页面异常与控制台错误均为空。

站点 SHA-256：13f7abd24d863bc609dd1e89ed6c1c1bd13d007ec49d41ba465e94b4c0f1e944
SDK SHA-256：b9b1cd84ea6a7719b20e1a0876b01ffa82e26531f146f1dad193b656095972ec

每份报告均绑定以上摘要，并在执行前核对全部 HTTP 资源字节。原始结果、下载、性能样本和截图见引擎目录，summary.json 记录报告哈希。环境 macOS arm64 / Node v24.14.0 / Playwright 1.57.0，headless；性能无预算，其他应用负载/功耗模式未控制。前两项焦点竞态使用 DOM KeyboardEvent 固定时序，其余常规按键使用浏览器键盘。

触摸验收仅 Chromium 390×844 触摸能力模拟：Playwright touchscreen.tap 点选 A2；CDP touch packets 原生平移导致 scrollTop > 0；显式在测试宿主网格设置 touch-action:none 后取消列宽调整不写入，再次拖动提交 156px。不是物理手机、默认移动端列宽手势或系统软键盘认证；未向 Firefox/WebKit 合成 DOM PointerEvent 冒充真实触摸通过。

本轮运行代码未变，仅依赖清单加入 elliptic 6.5.4 的官方源码比对与 MIT 正文。未审内嵌组件计数 67，reviewItems 4，严格许可证与正式稳定版门槛仍未通过。正式 Safari、物理触控、原生 IME、屏幕阅读器及其他 v1 门槛继续待验。本目录不包含 stable-release.json。

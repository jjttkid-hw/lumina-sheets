# 触摸输入真实浏览器验收

2026-09-21 在当前 0.29.0 站点以 Chromium 153.0.8010.50、390×844、Playwright 1.57.0 运行 3 组浏览器级触摸检查，全部通过，页面异常与控制台错误均为零。

- `touch-tap-selection`：Playwright `touchscreen.tap` 触摸点选格，SDK 选区为 A2。
- `touch-native-scroll`：原生触摸拖动使表格滚动，实际 scrollTop 大于 0；未关闭浏览器平移。
- `touch-resize-cancel-retry`：宿主明确将触控策略设为 none 后，触摸取消列宽拖动不写入布局，下一次拖动写入 156px。

站点摘要：`b71d36ea270ccefcf2e858eee6f2213f65b9e46c8bd5863d1eceeae6f3ce14a8`；SDK 制品摘要：`3976d561c6153bb3f7df88f33cf1612ad3ce705149ed7672b670effcedce620f`。完整原始 JSON、截图和脚本在本目录。

这是浏览器级触摸包/触摸能力模拟，不是实体手机、真实移动 GPU、系统软键盘、物理多指或不同厂商浏览器认证。Firefox/WebKit 未执行此套件，因为 CDP 原生触摸包接口只在本次 Chromium 证据中可复现；三引擎的窄屏布局证据见 [布局验收](../browser-layout-2026-09-21/README.md)。

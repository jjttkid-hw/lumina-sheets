# 延迟恢复焦点修复与浏览器回归

真实 Firefox 复现了宿主移走焦点后，Canvas 的下一动画帧又抢回焦点的问题。Enter / Escape 均受影响；修复前结果见 before-fix-firefox.json。

新增 returnFocusNextFrame：只在原焦点仍属于该交互区域，且下一帧没有移向其他控件时恢复焦点；React 移除编辑器导致焦点回到 body 时允许正常恢复。目标已卸载不聚焦。列表选择使用整个表格容器作为原交互区域；失败编辑恢复、提交与取消均复用此规则。宿主在提交回调中同步 focus 自己的输入框也被保留。

Chrome 153.0.8010.50、Firefox 144.0.2、WebKit 26.0 各通过四组焦点回归，并复测六组规则/原生剪贴板/SDK 生命周期检查，页面异常与控制台错误均为零：

1. Enter 后宿主立即移走焦点，下一帧保留宿主焦点；数据成功提交。
2. Escape 后宿主立即移走焦点，下一帧保留宿主焦点；草稿未提交。
3. 普通真实键盘 Escape，无宿主接管时回到网格。
4. 真实键盘 Enter，宿主 onChange 同步聚焦另一输入框，提交值正确且焦点保留。

前两项是在真实浏览器 DOM/React 中派发 KeyboardEvent，再同步移动焦点，固定在“按键处理结束、延迟帧执行之前”的时序；它们不是物理键盘或原生输入法证据。初版使用捕获阶段微任务，Chrome/WebKit 可在 React 处理 Escape 前执行微任务而先触发 blur 提交，因此改用明确的事件后顺序。不能把这种 blur-first 情况误报为 Escape 本身失效。其他常规交互和同步宿主回调使用浏览器键盘操作。

制品版本 0.29.0，SDK 39 文件 / 638573 字节，SHA-256 `95086fc6eeeb33eb7511024937d0664d779e1d7f29abf53ed4f9bb24434cffed`；站点 SHA-256 `a09ab6954d43c94f45848f8b842bbbe6a9fa7b2c61030538790bf0db03873168`。环境 macOS arm64 / Node v24.14.0 / Playwright 1.57.0，headless。报告 JSON、最终脚本哈希和站点清单随本目录保存。运行 scripts/browser-focus.mjs 方式与既有 browser-interactions.mjs 相同。

161 文件 / 2285 项自动化测试通过；格式、差异、生产构建、公开 API、SDK 安装包检查通过。所有浏览器执行前核对 HTTP 资源字节。此前性能测量与八组冒烟绑定旧制品，本轮未把它们改签为新制品通过。正式 Safari、原生 IME、物理触控、完整验收与许可证仍待完成。

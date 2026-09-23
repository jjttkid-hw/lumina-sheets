# WPS 12.1.26055 桌面保存语料

`edited-report.xlsx` 来自当前项目合成工作簿，无客户业务数据。0.29.0 SDK 包（SHA-256 `57f26f4d1da11a787072ddc988a416495d3921120820c836aa30b98b4509029e`）生成原件，在 macOS 26.7 arm64 的 WPS Office 2026 秋季更新 12.1.26055 实际打开，将“业务 数据”A2 从 120 改为 200；“汇总”A1 显示 ¥340.00，然后本地保存。

原 SDK 文件 SHA-256：`7eb8a91fba1c36adba23e35d848c8ef8767aeacf9d12e8016f4f9b5946b6f503`。原 WPS 保存文件 SHA-256：`e827f449f8c8f18ec63253f77206708163a61a1bf1fc69b7ead4a4b8c0fb92c8`。

公开夹具只将 docProps/core.xml 的 lastModifiedBy 改为 Acceptance fixture，并删除 docProps/custom.xml 的 ICV 追踪属性；其余 ZIP 条目内容不变。夹具 SHA-256：`1e3eec7e59d716fc5a164f641e7bb331bb716db072771c6c2a02864f8404087c`。

B5 的原始 sharedStrings 内容为 `_x005f_x0041_&#13;&#10;中文😀`，应单次解码为字面 `_x0041_`、CRLF、中文与 Emoji。旧读取器返回 `_x005fA`，新回归禁止这种静默损坏。同时检查公式、验证、打印、富文本、合并、冻结、隐藏轴和超链接的受支持语义。WPS 可能补齐默认字体、纸张等元数据，不承诺无差异 XML 或完整 Excel/WPS 兼容。

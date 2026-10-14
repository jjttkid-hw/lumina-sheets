# Lumina 灵表

[![CI](https://github.com/jjttkid-hw/lumina-sheets/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jjttkid-hw/lumina-sheets/actions/workflows/ci.yml)
[![CD](https://github.com/jjttkid-hw/lumina-sheets/actions/workflows/cd.yml/badge.svg)](https://github.com/jjttkid-hw/lumina-sheets/actions/workflows/cd.yml)
[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![GitHub forks](https://img.shields.io/github/forks/jjttkid-hw/lumina-sheets?style=flat&logo=github)](https://github.com/jjttkid-hw/lumina-sheets/forks)
[![npm](https://img.shields.io/badge/npm-coming%20soon-lightgrey?logo=npm)](docs/RELEASING.md)

Lumina 是一个面向业务系统的高性能 JavaScript 表格与报表 SDK。它以 Canvas 绘制可见区域，以稀疏数据结构保存工作簿，并为分页数据、公式计算、XLSX/CSV/PDF 导出和浏览器内分析提供统一 API。

当前开发版本：**0.30.0**（v3.0 开发线）。

它适合财务填报、经营分析、订单录入、管理报表和嵌入式数据工作台。宿主页面可以直接使用原生 JavaScript，不需要安装 React；React 和 Vue 集成示例也随仓库提供。

> Lumina 是独立开源项目，与葡萄城、SpreadJS 没有隶属、授权或官方背书关系。当前仍是 `0.x` 开发线，文档中的能力边界和验收证据优先于营销性兼容承诺。

## 在线体验

- [在线工作空间](https://jjttkid-hw.github.io/lumina-sheets/)
- [JavaScript 报表示例](https://jjttkid-hw.github.io/lumina-sheets/examples/report.html)
- [性能实验室](https://jjttkid-hw.github.io/lumina-sheets/?view=performance)
- [SDK 接入文档](docs/NPM-README.md)
- [支持矩阵](docs/SUPPORT-MATRIX.md)

## 能力概览

- Canvas 虚拟化网格：可见区域绘制、冻结行、合并单元格、隐藏行列、列宽行高、键盘导航和 IME 编辑。
- 稀疏工作簿：最多 1,048,576 个逻辑行和 16,384 列，不为逻辑空白单元格创建密集对象。
- 公式引擎：跨表依赖、增量失效、范围索引、数组计算和受限的安全函数集合；工作区可将计算移交 Web Worker。
- 分页数据：有界 LRU 缓存、重复请求合并、取消、失败重试、视区预取和完整分页 CSV 导出。
- 报表生成：列表、分组小计、交叉统计、模板公式、条件规则、数据校验、撤销重做和持久化。
- 文件链路：XLSX、CSV、JSON、PDF 导入导出；XLSX 相关代码按需加载。
- 可编程透视：`createPivot`、`createPivotAsync`、`grid.pivot()` 和 `grid.pivotAsync()` 支持多级分组、多指标聚合、稳定排序、总计、进度回调与取消。
- SDK 生命周期：只读模式、统一错误码、异步导入/导出取消、过期任务隔离和严格 TypeScript 声明。

透视和分页分析都有明确预算，超限会整批拒绝，不会静默截断。当前透视结果是普通可编辑工作表快照，不伪装成 Excel 原生透视缓存；源记录改变后需要重新生成。

## 快速开始

```sh
npm install
npm run dev
```

打开 <http://127.0.0.1:5173/examples/report.html> 查看完整示例。构建站点和 SDK：

```sh
npm run build:all
```

SDK 构建产物位于 `dist/sdk/`：`lumina.js` 是 ES module 入口，`lumina.css` 是组件样式，`types/` 是 TypeScript 声明，`example.html` 是不依赖 React 宿主的示例。

### 原生 JavaScript

```html
<link rel="stylesheet" href="./lumina.css" />
<div id="report" style="height: 600px"></div>
<script type="module">
  import { createSpreadsheet } from './lumina.js';
  const grid = createSpreadsheet(document.querySelector('#report'));
  grid.report(
    {
      name: '经营报表',
      layout: 'list',
      columns: [
        { field: 'month', title: '月份' },
        { field: 'revenue', title: '营收', aggregate: 'sum', format: 'currency' },
        { field: 'cost', title: '成本', aggregate: 'sum', format: 'currency' },
        { field: 'profit', title: '利润', formula: '=B{row}-C{row}', aggregate: 'sum' },
      ],
    },
    [{ month: '1月', revenue: 100000, cost: 60000 }],
  );
</script>
```

### 异步透视分析

```ts
const controller = new AbortController();
await grid.pivotAsync(
  {
    rows: ['region', 'product'],
    columns: 'month',
    values: [
      { field: 'revenue', title: '营收', aggregate: 'sum' },
      { field: 'revenue', title: '平均', aggregate: 'average' },
      { field: 'revenue', title: '记录数', aggregate: 'count' },
    ],
    sort: 'label',
  },
  records,
  {
    batchSize: 512,
    signal: controller.signal,
    onProgress: ({ completed, total }) => console.log(`${completed}/${total}`),
  },
);
```

`pivotAsync` 会在批次之间让出事件循环，保证界面可以响应输入；取消、编辑、重新加载或销毁实例时，未完成结果不会覆盖当前工作簿。同步场景可使用 `createPivot` 或 `grid.pivot()`。

## 验证与质量门禁

```sh
npm test
npm run format:check
npx tsc -b
npm run check:sdk
npm run check:bundle-performance
```

`npm run check:sdk` 会在隔离目录安装打包结果，检查 NodeNext/Bundler 类型、ES module 导入、声明文件、示例和依赖闭包。`npm run check:bundle-performance` 会检查首屏预算，并确认 ExcelJS 只在 XLSX 路径按需加载。

浏览器验收和制品摘要保存在 [`docs/acceptance/`](docs/acceptance/)。历史候选证据不可替代当前代码；发布前应生成新的候选目录并重新绑定站点、SDK 和测试摘要。

## 当前边界

Lumina 当前不宣称完整 Excel/SpreadJS 兼容，也不包含原生 Excel 图表/透视表对象、多人协作、账号权限、云端存储、计费或 AI 服务。PDF 是 Canvas 栅格报表，分页数据源是只读视图；大规模热编辑应使用分页数据和补丁 API，并根据目标设备重新测量。

性能结论只引用带设备、规模和脚本的实测记录，见 [性能说明](docs/PERFORMANCE.md)。公式、XLSX、打印、数据校验和结构编辑的兼容范围分别见 [公式文档](docs/FORMULAS.md)、[SDK 文档](docs/SDK.md) 和 [支持矩阵](docs/SUPPORT-MATRIX.md)。

## 开源与发布

代码采用 [Apache License 2.0](LICENSE)。第三方依赖、许可文本和预打包组件证据见 [依赖许可](docs/DEPENDENCIES.md)。

首次 npm 发布尚未完成账号授权，因此仓库目前以 GitHub 源码、GitHub Actions 制品和本地 `.tgz` 验证包为主；发布步骤见 [发布与交付](docs/RELEASING.md)。

欢迎提交问题复现、兼容性用例、文档改进和 Pull Request。贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，不要上传真实业务数据、个人信息或密钥。

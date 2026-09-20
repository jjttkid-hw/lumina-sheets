# CI、CD 与 npm 发布

仓库为 `jjttkid-hw/lumina-sheets`，源项目 `lumina-sheets` 保持 `private: true`，防止误发开发工程；生成的浏览器 SDK 包名为 `lumina-report-sdk`，许可证 Apache-2.0。发布只使用检查过的 SDK `.tgz`。

## 持续检查与演示部署

- `CI` 在主分支推送、Pull Request 和手动触发时执行：锁定依赖安装、全部测试、格式检查、TypeScript 与生产构建、真实 npm 包隔离安装检查。
- 安装检查在全新临时目录运行，不借用工程的 React 类型。严格 NodeNext/Bundler、CSS 子路径、ES module 入口、公开类型/动态 JS 分包和示例引用均需通过。制品 `npm-package` 包含 `.tgz` 和 SHA-256，保留 14 天。
- 主分支 CI 另保留 `lumina-site` 产物 7 天。`CD` 只在本仓库成功的主分支 CI 后触发，下载该次 CI 已验证的站点，不重新构建。PR 不能触发部署。
- 部署前检查被验证的提交仍是当前主分支，跳过旧版本。Pages 部署串行执行，站点使用 `/lumina-sheets/` 路径。`build-info.json` 提供版本与提交 ID，便于确认部署内容。

演示入口：[工作空间](https://jjttkid-hw.github.io/lumina-sheets/)、[报表](https://jjttkid-hw.github.io/lumina-sheets/examples/report.html)、[性能实验室](https://jjttkid-hw.github.io/lumina-sheets/?view=performance)。性能页使用查询参数，在静态站刷新仍可加载。示例工作簿在浏览器本地保存，不提供服务器账号或云端同步。

GitHub 仓库的 Pages 来源需要设置为 **GitHub Actions**。`github-pages` 环境使用 `pages: write` 与短期 OIDC 部署身份；无需把访问令牌写入源码。

## 本地生成可安装包

使用 Node.js 24 和 npm 11：

```sh
npm ci
npm test
npm run format:check
npm run build:all
npm run check:sdk
```

安装包位于 `artifacts/lumina-report-sdk-<版本>.tgz`，旁边提供 `.sha256`。可在另一个项目 `npm install /完整路径/lumina-report-sdk-<版本>.tgz`。生成包包含 ESM、CSS、类型、可运行 HTML 示例及依赖许可材料，不包含应用源工程。`npm run build:site` 额外按 Pages 子目录构建完整演示站。

## 首次 npm 发布与账号授权

GitHub 登录不能代替 npm 登录。首次创建包需要包维护者完成 npm 官方身份验证；如果包名已经被他人注册，应选用维护者有权发布的作用域，不能覆盖其他人的包。

```sh
npm login --auth-type=web
npm whoami
npm publish ./artifacts/lumina-report-sdk-<版本>.tgz --access public
npm view lumina-report-sdk version
```

首次本地发布没有 GitHub Actions 来源证明。发布成功后，在 npm 的包设置中配置 **Trusted Publisher → GitHub Actions**：

| 字段                        | 值              |
| --------------------------- | --------------- |
| GitHub organization or user | `jjttkid-hw`    |
| Repository                  | `lumina-sheets` |
| Workflow filename           | `npm.yml`       |
| Environment                 | `npm`           |

后续发布使用 GitHub OIDC，不需要长期 npm token。应确保仓库已存在 `npm` 环境，并按维护者需要设置环境审批或分支限制。若账号暂不能配置 Trusted Publishing，可把有发布权限且允许 CI 非交互发布的 granular token 保存为仓库或 `npm` 环境的 `NPM_TOKEN` secret；工作流支持此备选。不要提交 token、密码或 `.npmrc`。

## 后续版本自动发布

1. 更新 `package.json` 和 `package-lock.json` 的版本，补充变化与验证记录，提交主分支并确认 CI 通过。
2. 创建与版本完全相同的 `v<版本>` Git tag，并发布 GitHub Release。发布 **draft** 不触发，点击正式发布后触发 `npm release`。
3. 工作流检出对应 tag，核对版本，重新完成测试、构建与安装验证，将 `.tgz` 和 SHA-256 上传到该 GitHub Release，然后以 `--provenance --access public` 发布同一个包。
4. 确认 npm 页面版本、来源证明、安装结果和 `npm release` 状态，再更新对外发布说明。

也可从 Actions 手动运行 `npm release`，输入已存在的 Release tag，用于修复账号设置后重试。npm 版本不可覆盖；若已发布该版本，不要重跑发布步骤，应递增版本。预发布也需要使用新的版本号；当前流程默认发布到 npm `latest`，因此不应使用它发布实验版。

没有 npm 账号授权、Trusted Publisher 或可用 `NPM_TOKEN` 时，工作流会在 npm 发布步骤失败，不能把配置完成等同于包已经上架。npm 版本/下载量徽章只在注册表确认包存在后启用。

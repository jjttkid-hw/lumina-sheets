# CI、CD 与 npm 发布

仓库为 `jjttkid-hw/lumina-sheets`，源项目 `lumina-sheets` 保持 `private: true`，防止误发开发工程；生成的浏览器 SDK 包名为 `lumina-report-sdk`，许可证 Apache-2.0。发布只使用检查过的 SDK `.tgz`。

## 持续检查与演示部署

- `CI` 在主分支推送、Pull Request 和手动触发时执行：锁定依赖安装、全部测试、格式检查、TypeScript 与生产构建、真实 npm 包隔离安装检查及严格第三方许可证证据检查。浏览器证据门禁只读取当前候选目录 `docs/acceptance/browser-candidate-2026-09-24-r14`，避免历史候选重复运行或掩盖当前制品绑定。
- CI 和 npm 发布工作流都执行 `check:reproducibility`；站点和 SDK 包必须在同一候选构建中连续两次得到相同摘要/字节哈希，失败不会上传或发布。
- 安装检查在全新临时目录运行，不借用工程的 React 类型。严格 NodeNext/Bundler、CSS 子路径、ES module 入口、公开类型/动态 JS 分包和示例引用均需通过。制品 `npm-package` 包含 `.tgz` 和 SHA-256，保留 14 天。
- 主分支 CI 另保留 `lumina-site` 产物 7 天。`CD` 只在本仓库成功的主分支 CI 后触发，下载该次 CI 已验证的站点，不重新构建。PR 不能触发部署。
- 正式 1.x 及以后在 CI 上传前执行 `check-stable-release.mjs --site`，同时绑定实际包哈希与站点 `siteSha256`；站点内容变化必须重新验收。npm 发布工作流用 `build:site` 生成 `/lumina-sheets/` 基路径，再执行 HTTP 冒烟检查，避免根路径开发构建与 Pages 制品混用。0.x/预发布继续作为开发演示，不声明稳定验收。
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
npm run check:api
npm run check:sdk
npm run check:licenses -- --strict
npm run check:stable
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

如果包页面尚不存在，先由拥有发布权限的 npm 账号完成这一次本地发布；`lumina-report-sdk` 出现在注册表后才能在包 Settings 中新增 Trusted Publisher。npm 登录账号属于维护者个人凭据，不写入仓库文档；GitHub Trusted Publisher 的组织/用户字段固定填写仓库所有者 `jjttkid-hw`。

首次或后续发布如果为 1.0.0 及以上的正式版，必须先通过 `npm run check:stable`；直接运行 npm publish 不会自动执行本仓库门禁。0.x 开发线和预发布版本本地发布都应显式加 `--tag next`，避免 npm 默认写入 latest。

| 字段                        | 值              |
| --------------------------- | --------------- |
| GitHub organization or user | `jjttkid-hw`    |
| Repository                  | `lumina-sheets` |
| Workflow filename           | `npm.yml`       |
| Environment                 | `npm`           |

后续发布使用 GitHub OIDC，不需要长期 npm token。应确保仓库已存在 `npm` 环境，并按维护者需要设置环境审批或分支限制。若账号暂不能配置 Trusted Publishing，可把有发布权限且允许 CI 非交互发布的 granular token 保存为仓库或 `npm` 环境的 `NPM_TOKEN` secret；工作流支持此备选。不要提交 token、密码或 `.npmrc`。

Trusted Publisher 的逐字段配置和发布后核验步骤见 [npm Trusted Publisher 配置](NPM-TRUSTED-PUBLISHER.md)。

## 后续版本自动发布

1. 更新 `package.json` 和 `package-lock.json` 的版本，补充变化与验证记录，提交主分支并确认 CI 通过。
2. 创建与版本完全相同的 `v<版本>` Git tag，并发布 GitHub Release。发布 **draft** 不触发，点击正式发布后触发 `npm release`。
3. 工作流检出对应 tag，核对版本，重新完成测试、构建与安装验证，将 `.tgz` 和 SHA-256 上传到该 GitHub Release，然后以 `--provenance --access public` 发布同一个包。
4. 确认 npm 页面版本、来源证明、安装结果和 `npm release` 状态，再更新对外发布说明。

也可从 Actions 手动运行 `npm release`，输入已存在的 Release tag，用于修复账号设置后重试。npm 版本不可覆盖；若已发布该版本，不要重跑发布步骤，应递增版本。0.x 开发线和带预发布后缀的新版本自动发布到 npm `next`；首个 1.x 及以后无预发布后缀的正式版本发布到 `latest`。GitHub Release 的 prerelease 标志必须与版本后缀一致，否则发布前失败。手动触发也按版本号选择通道。上传和发布均使用精确版本制品路径，不使用匹配历史包的通配符。

没有 npm 账号授权、Trusted Publisher 或可用 `NPM_TOKEN` 时，工作流会在 npm 发布步骤失败，不能把配置完成等同于包已经上架。npm 版本/下载量徽章只在注册表确认包存在后启用。

公开声明门禁和兼容政策见 [API-STABILITY.md](API-STABILITY.md)；v1.0 完成条件见 [V1-PLAN.md](V1-PLAN.md)。

所有 npm 发布候选在构建后先执行 `check:licenses` 严格依赖审计；任何 error/review 或预打包组件未核实都会阻止发布。正式 1.x 及以上版本还执行 `check:stable`。它要求 [稳定版验收记录](acceptance/README.md) 绑定实际 tgz 哈希，检查浏览器核心项目与独立门槛、报告文件及哈希，并从包内读取零未解决问题的依赖清单。缺失或旧证据不能发布。当前没有通过的稳定版记录，因此简单修改版本为 1.0.0 会失败。仓库变量 `RELEASE_SOURCE_DATE_EPOCH` 可固定候选与正式重建的来源时间，防止仅提交验收文档就改变包哈希；值必须与候选构建一致。


## 构建来源时间与重复验证

依赖清单的时间字段取 `SOURCE_DATE_EPOCH`（整数 Unix 秒），未指定时取当前 Git 提交时间；没有 Git 且未指定时为 null，不写当前墙钟时间。`timestampSource` 标明来源，避免把提交时间误当实际构建时间。无效显式时间会失败，不能静默忽略。源码归档构建建议显式设置来源时间。

锁定依赖、工具链和来源时间后可两次 `build:sdk` / `check:sdk`，比较 tgz 的 SHA-256 与字节内容。0.24 本机两次成功一致，不代表已验证不同操作系统、Node/npm 版本或 locale 间的可重复性。构建时源码仍有未提交修改，Git 时间也不证明产物完全来自该提交；对外发布前应使用干净的已审查 tag。


## 本地重复构建核验

运行 `npm run check:reproducibility`，会使用同一个 SOURCE_DATE_EPOCH（未设置时取 Git 提交时间），连续两次执行 build:site、check:api、check:sdk，逐文件比较站点内容摘要及实际 tgz 字节哈希。输出位于 artifacts/reproducibility/：result.json 记录平台、Node/npm、提交与未提交状态、输入摘要及两次结果，inputs.json 记录输入文件，site-1.json/site-2.json 为站点清单，两份日志保留构建结果。失败会写 failed 并返回非零，不可把失败或旧结果用于发布。

它会替换 dist 与当前版本本地产物，且只证明同一依赖安装和同一机器上的重复构建。源码/文档在运行中改变会使核验失败；跨机器、全新依赖安装、真实浏览器和商业许可不由此证明。此工具不发布、不写 stable-release.json、不自动填写正式验收通过。交付候选仍需保留包、清单和实际验收证据。

## HTTP 部署检查

CI 在最终构建完成后生成 build-info.json，记录实际检出 HEAD 的提交、版本与 siteSha256，不使用触发工作流的 GITHUB_SHA 猜测构建来源。摘要与 siteDigest 的口径一致，覆盖站点内容但排除 build-info.json 本身。它用于线上内容核对，不证明工作区干净或代替验收签署；没有 Git 提交时生成失败。

`npm run check:site-runtime` 在随机本地端口启动 Vite 预览，显式使用 `/lumina-sheets/` 基路径；结束时关闭本次服务器，不接管已有的开发服务。先执行 `build:site`，或执行最终输出同样基路径的 `check:reproducibility`。CI 与 npm 工作流将 HTTP 检查放在最后一次构建之后。

检查逐个获取站点摘要中的文件（包括 SDK、延迟 XLSX 分包、Worker），比较响应字节 SHA-256、大小和 HTML/JS/CSS 类型；核验 HTML 入口引用与 SDK 示例内联模块路径，并检查首页和性能页查询参数。错误路径回退首页不能充当成功。可用 `SITE_RUNTIME_URL=http://127.0.0.1:端口` 指向自己启动的候选站点，值必须是无路径/查询/凭据的 HTTP(S) origin，内容必须与本地 dist 相同。

此检查不执行页面 JavaScript，不证明 Canvas、Worker 执行、输入法、触控、剪贴板或实际下载通过。受限环境不允许监听端口时检查会失败，不跳过后报通过。本地运行当前因沙箱 EPERM 与自动审批服务 503 未完成，CI 配置也尚未在远端执行验证。

## 发布回退与数据保护

- 发布前保存上一份已验证的 SDK tgz、SHA-256、完整站点产物、验收报告与实际来源时间；记录 npm dist-tag 原值。不要只保存源码提交，因为重建可能产生不同字节。
- npm 已发布版本不能覆盖。发现问题时先暂停后续发布和站点部署，消费者锁回已验证版本；维护者审核后可把 `latest` 或 `next` 指回上一已发布版本并标记问题版本为 deprecated。更改 dist-tag 不会自动改变已经安装或锁定的依赖。
- Pages 自动部署要求当前 main 的成功 CI。正常修复通过新提交运行同一门禁，部署新 CI 的确切产物。紧急恢复旧产物需要维护者单独审核与实际部署，当前工作流没有一键回滚入口；不能通过重新运行旧 CI/CD 就宣称恢复成功，因为旧提交会被 current-main 检查跳过。
- 产品降级前从当前版本导出工作簿 JSON/恢复包并保留原件。旧版可能不认识新增元数据，先在副本上验证导入和往返。不要清空 IndexedDB 或覆盖仅存的一份业务数据来解决兼容问题。
- 恢复后检查线上 build-info、实际文件摘要、包版本、关键工作簿与浏览器闭环；记录事故版本、受影响行为、数据处置和修复版本。只有检查确认后才恢复发布。

问题反馈通过仓库 [Issues](https://github.com/jjttkid-hw/lumina-sheets/issues)，提供版本、环境、脱敏样本、最小操作、期望与实际结果。不要公开密码、令牌或真实客户数据。当前没有付费支持或响应时限承诺。


CD 下载 `lumina-site` 后，签出该 CI 运行的精确提交，运行 `scripts/check-deploy-site.mjs`，核对 `build-info.json` 中的提交号、版本与实际站点文件摘要后才上传 Pages。缺失元数据、额外/修改文件或符号链接均拒绝。该检查依赖可信 CI 生成的元数据及运行编号，不是独立签名认证；真实远端运行仍需核验。

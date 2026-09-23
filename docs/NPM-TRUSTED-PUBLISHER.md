# npm Trusted Publisher 配置

Lumina 的发布工作流已经使用 GitHub Actions OIDC：`.github/workflows/npm.yml` 声明了 `id-token: write`，发布命令使用 `npm publish --provenance`。配置完成后，GitHub Actions 不需要长期 npm token。

## npm 侧配置

在 npmjs.com 登录拥有 `lumina-report-sdk` 发布权限的账号，进入包的 **Settings → Trusted Publishers**，新增 **GitHub Actions**，填写：

首次发布前包页面可能尚不存在：先由拥有发布权限的 npm 账号完成一次本地 `0.29.0` `next` 发布，包出现后再打开 Settings 配置 Trusted Publisher。npm 账号名属于维护者个人凭据，不记录在仓库；表格中的 `jjttkid-hw` 是 GitHub 仓库所有者，不能与 npm 账号混用。

| 字段 | 值 |
| --- | --- |
| Organization or user | `jjttkid-hw` |
| Repository | `lumina-sheets` |
| Workflow filename | `npm.yml` |
| Environment | `npm` |

`Environment` 必须与工作流中的 `environment: npm` 完全一致。若 npm 页面要求先选择包，目标包名是 `lumina-report-sdk`；仓库根目录的 `private: true` 是刻意保留的，不能直接发布根工程。

## GitHub 侧检查

1. 仓库的 **Settings → Environments** 中存在名为 `npm` 的环境。
2. 如果设置了环境审批，审批人必须能批准正式发布；分支限制应允许发布使用的版本 tag。
3. **Actions → General → Workflow permissions** 至少允许工作流读取仓库内容。发布工作流自身已经声明 `contents: write` 和 `id-token: write`。
4. 不要把 npm 密码、一次性验证码或长期 token 写入仓库。Trusted Publisher 使用短期 OIDC 身份；工作流保留 `NPM_TOKEN` 仅作为明确配置的兼容回退。

## 发布前检查

Trusted Publisher 只解决身份认证，不代表版本已经满足项目发布门槛。正式发布前必须在候选提交上通过：

```sh
npm test
npm run check:api
npm run check:sdk
npm run check:licenses -- --strict
npm run check:reproducibility
npm run check:stable
```

随后创建与 `package.json` 完全一致的 `v<version>` tag，并发布对应的 GitHub Release。工作流会重新构建并校验 tag、上传同一份 `.tgz`，然后通过 OIDC 发布到 npm。0.x 开发线和所有带预发布后缀的版本使用 `next`；首个 1.x 正式版本起才使用 `latest`。

## 如何确认绑定成功

在 GitHub Actions 的 `npm release` 运行中，应看到发布步骤完成且生成 provenance。发布后再检查：

```sh
npm view lumina-report-sdk version dist-tags --json
npm view lumina-report-sdk@<version> dist.integrity --json
```

如果运行在发布步骤前失败，优先检查包名权限、Trusted Publisher 四个字段和 `npm` 环境名称；不要反复生成 CLI 登录验证码。CLI 登录状态与 GitHub Actions OIDC 是两条独立链路。

# 网站进不去时的检查顺序

## 1. 先看 GitHub Actions

打开：

https://github.com/young1236661/sjbzgtycp-young/actions/workflows/vercel-deploy.yml

如果最新运行失败，先点进失败的 run 看红色步骤。

常见问题：

- `VERCEL_TOKEN is missing`：GitHub Actions 里没有配置 Vercel Token。
- `VERCEL_ORG_ID is missing`：GitHub Actions 里没有配置 Vercel 团队/账号 ID。
- `VERCEL_PROJECT_ID is missing`：GitHub Actions 里没有配置 Vercel 项目 ID。
- `vercel pull` 失败：Token 无权限，或项目 ID/团队 ID 填错。

## 2. 必须配置的 GitHub Secrets

路径：

GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret

需要添加：

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

这些值来自 Vercel 项目。配置完成后，回到 Actions 页面，手动运行 `Deploy Private World Cup Advisor`。

## 3. 必须配置的 Vercel 环境变量

路径：

Vercel project -> Settings -> Environment Variables

需要添加：

```text
AUTH_SECRET
SITE_ACCESS_CODE_SHA256
THE_ODDS_API_KEY
```

`THE_ODDS_API_KEY` 可选；前两个用于远程访问码登录，必须配置。

生成 `AUTH_SECRET`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

生成访问码哈希：

```bash
pnpm hash:access-code "你的访问码"
```

线上登录时输入的是原始访问码，不是哈希。

## 4. 当前代码侧已确认

- `pnpm lint` 通过。
- `pnpm build` 通过。
- Vercel workflow 已先安装 pnpm，再安装依赖和部署。
- 如果 Actions 仍失败，优先看 Secrets 和 Vercel 项目绑定。

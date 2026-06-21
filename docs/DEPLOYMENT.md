# 发布清单

这份清单用于把世界杯体彩决策台发布成一个可异地登录使用的私人网站。

## 1. 提交到 GitHub

在 GitHub 新建一个私有仓库，然后在本地执行：

```bash
git branch -M main
git remote add origin <你的 GitHub 仓库地址>
git push -u origin main
```

如果本地还没有提交，先执行：

```bash
git add .
git commit -m "init world cup ticai advisor"
```

## 2. 导入 Vercel

1. 打开 Vercel。
2. 选择 Add New Project。
3. 选择刚才的 GitHub 仓库。
4. 确认项目设置：

```text
Framework Preset: Vite
Build Command: pnpm build
Output Directory: dist
```

项目已包含 `vercel.json`，Vercel 会把 `/api/*` 交给服务端函数，把其他路径交给前端应用。

## 3. 配置远程登录变量

Vercel 项目 Settings -> Environment Variables 中添加：

```bash
AUTH_SECRET=<至少 32 个字符的随机密钥>
SITE_ACCESS_CODE_SHA256=<访问码的 sha256 哈希>
THE_ODDS_API_KEY=<可选，更多赔率源>
```

生成 `AUTH_SECRET`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

生成访问码哈希：

```bash
pnpm hash:access-code "你的私人访问码"
```

线上登录时输入的是原始访问码，不是哈希。

## 4. 自动更新数据

仓库已包含 `.github/workflows/daily-update.yml`，每天北京时间 09:15 刷新数据文件并提交。

如果希望 GitHub Actions 也自动部署到 Vercel，需要在 GitHub 仓库 Secrets 中添加：

```bash
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

如果只使用 Vercel 的 Git 集成，也可以不启用 `.github/workflows/vercel-deploy.yml`。每日数据提交到 GitHub 后，Vercel 会根据仓库更新自动部署。

## 5. 发布后检查

发布完成后检查：

- 访问网站会先出现访问码登录页。
- 输入访问码后能看到“远程已登录”。
- 首页更新时间是当天数据。
- 比赛切换、专业答案、比分矩阵、风险分歧都能显示。
- 中国体彩官方赔率仍需购票前人工核验。

## 6. 安全边界

- 不要提交 `.env`。
- 不要把原始访问码写进代码。
- `AUTH_SECRET` 和 `SITE_ACCESS_CODE_SHA256` 只放在 Vercel 环境变量里。
- 本网站只做信息分析和风险预算辅助，不保证盈利。

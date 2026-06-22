# 世界杯体彩决策台

这是一个面向中国体育彩票用户的世界杯信息分析网站。它会每日聚合公开赛程、新闻、海外市场赔率和数据源健康状态，生成谨慎的“观望 / 小额娱乐 / 避免追高”辅助判断。

## 重要边界

- 本项目定位为纯娱乐和赛前信息整理工具，不应被当作投资、套利或稳定收益系统。
- 本项目只做信息分析和风险预算辅助，不保证盈利，也不构成任何稳赚建议。
- 中国体育彩票购买前必须以中国体彩网、实体销售终端和官方截止时间为准。
- 海外博彩网站赔率只作为市场情绪参考，不建议、也不引导用户在非官方渠道投注。

## 本地运行

```bash
pnpm install
pnpm update:data
pnpm dev
```

打开终端输出的本地地址即可查看网站。

## 每日更新

数据文件位于 `public/data/worldcup-brief.json`。运行下面命令会刷新：

```bash
pnpm update:data
```

项目已包含 `.github/workflows/daily-update.yml`，默认每天北京时间 09:15 执行一次，刷新数据并提交 `public/data/worldcup-brief.json`。

## 异地登录与部署

项目现在包含 Vercel Serverless API 登录层，适合部署成一个只有你自己能访问的远程网站。线上访问流程是：

1. 打开部署后的网址。
2. 输入私人访问码。
3. 服务端校验访问码哈希，签发 HttpOnly 会话 Cookie。
4. 登录后可在手机、外地电脑或平板查看同一套每日分析。

需要配置的环境变量：

```bash
AUTH_SECRET=至少 32 个字符的随机密钥
SITE_ACCESS_CODE_SHA256=访问码的 sha256 哈希
THE_ODDS_API_KEY=可选，用于接入更多海外赔率源
```

生成访问码哈希：

```bash
pnpm hash:access-code "你的私人访问码"
```

生成 `AUTH_SECRET`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

部署方式：

- Vercel 项目中设置上面的环境变量。
- 构建命令使用 `pnpm build`，输出目录使用 `dist`。
- 仓库已包含 `vercel.json` 和 `.github/workflows/vercel-deploy.yml`。
- 如果使用 GitHub Actions 部署，还需要配置 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` 三个 GitHub Secrets。

本地 `pnpm dev` 不会强制登录；没有 `/api/session` 时会自动进入“本地预览模式”。真正的登录保护会在 Vercel 部署环境生效。

完整发布步骤见 `docs/DEPLOYMENT.md`。

## 更专业的赛前分析

每场比赛现在会生成：

- 本场专业答案：最适合买的比分、备选比分、胜平负方向、总进球校验、执行条件和放弃条件。
- 情景推演：基准剧本、僵持剧本、冷门剧本、进球节奏剧本。
- 风险分歧：赔率压缩、比分方差、候选分歧、综合风险。
- 组合建议：比分、胜平负、总进球和平局防守是否值得进入同一场预算。
- 赛前清单：官方赔率、首发、停售状态、临场赔率变化。

注意：当前中国体彩网接口不稳定时，系统不会伪造官方赔率。页面给出的是“建议最低赔率”和“核验门槛”，购买前仍要以中国体彩官方页面或销售终端为准。

## 可选赔率源

默认数据来自 ESPN 世界杯赛程、ESPN 新闻，以及 ESPN 响应中携带的 DraftKings 市场赔率。若想接入多博彩公司聚合赔率，可在 GitHub Secrets 或本地环境变量中设置：

```bash
THE_ODDS_API_KEY=你的密钥
```

脚本会尝试读取 The Odds API，但没有密钥时会保持跳过状态，不影响网站运行。

## 比分与数学期望

每场比赛会生成比分矩阵：

- 胜平负去水概率：从公开市场赔率换算并去除水位。
- 预期进球：结合胜平负、大小球、让球信号和强弱差做进攻尾部校准，估算双方 xG。
- 比分候选：用校准后的 Poisson 分布生成 0-0 到 6-6 的比分概率，并显示原始概率与尾部上调系数。
- 盈亏线：该比分的模型盈亏平衡赔率，公式为 `1 / 模型概率`。
- 建议最低赔率：在盈亏线基础上加入风险缓冲。只有中国体彩官方比分赔率高于这个门槛时，模型期望才可能转正。
- 数学期望：当前中国体彩网接口不可稳定抓取时不会伪造官方 EV，页面会显示“官方待核验”。购买前必须人工核验官方比分赔率。

## 数据源

- FIFA 官方赛程页
- ESPN FIFA World Cup Scoreboard API
- ESPN FIFA World Cup News API
- ESPN 响应中的 DraftKings 市场赔率
- 中国体彩网竞彩官方页面
- 可选：The Odds API

## 设计资产

视觉概念图保存在 `docs/concept-dashboard.png`，实现按“中文体彩风控工作台”的方向落地：克制、可读、以数据和风险为中心。

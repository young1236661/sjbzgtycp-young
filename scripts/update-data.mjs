import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const TIMEZONE = 'Asia/Shanghai'
const SCOREBOARD_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard'
const NEWS_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/news'
const FIFA_URL =
  'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums'
const SPORTTERY_URL = 'https://www.sporttery.cn/jc/'
const SPORTTERY_API = 'https://webapi.sporttery.cn/gateway/jc/football/getMatchListV1.qry?clientCode=3001'
const ODDS_API_SPORT = 'soccer_fifa_world_cup'

const teamNames = new Map([
  ['Netherlands', '荷兰'],
  ['Sweden', '瑞典'],
  ['Germany', '德国'],
  ['Ivory Coast', '科特迪瓦'],
  ['Curaçao', '库拉索'],
  ['Curacao', '库拉索'],
  ['Ecuador', '厄瓜多尔'],
  ['United States', '美国'],
  ['Brazil', '巴西'],
  ['Argentina', '阿根廷'],
  ['France', '法国'],
  ['England', '英格兰'],
  ['Spain', '西班牙'],
  ['Portugal', '葡萄牙'],
  ['Italy', '意大利'],
  ['Norway', '挪威'],
  ['Turkey', '土耳其'],
  ['Haiti', '海地'],
  ['Japan', '日本'],
  ['Tunisia', '突尼斯'],
  ['Saudi Arabia', '沙特阿拉伯'],
  ['Belgium', '比利时'],
  ['Iran', '伊朗'],
  ['Uruguay', '乌拉圭'],
  ['Cape Verde', '佛得角'],
  ['New Zealand', '新西兰'],
  ['Egypt', '埃及'],
  ['Serbia', '塞尔维亚'],
  ['Mexico', '墨西哥'],
  ['Denmark', '丹麦'],
])

const now = new Date()
const checkedAt = now.toISOString()
const targetDateChina = formatDateKey(now, 0, '-')

const sources = []

async function main() {
  const scoreboardDates = [-1, 0, 1, 2].map((offset) => formatDateKey(now, offset, ''))
  const scoreboards = await Promise.all(scoreboardDates.map(fetchScoreboard))
  const events = dedupeEvents(scoreboards.flatMap((board) => board.events))
  const newsResult = await fetchNews()
  const oddsApiResult = await fetchOddsApi()
  const sportteryResult = await checkSporttery()
  const fifaResult = await checkFifa()

  sources.push(fifaResult, ...scoreboards.map((board) => board.source), newsResult.source, oddsApiResult.source, sportteryResult)

  const upcomingWindow = events
    .filter((event) => {
      const kickoff = new Date(event.date).getTime()
      const lower = now.getTime() - 3 * 60 * 60 * 1000
      const upper = now.getTime() + 54 * 60 * 60 * 1000
      return kickoff >= lower && kickoff <= upper
    })
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
    .slice(0, 8)

  const matches = upcomingWindow.map((event) => normalizeMatch(event, newsResult.news))
  const healthySources = sources.filter((source) => source.status === 'ok').length

  const brief = {
    generatedAt: checkedAt,
    generatedAtChina: formatChinaDateTime(checkedAt),
    targetDateChina,
    timezone: TIMEZONE,
    summary: {
      headline:
        matches.length > 0
          ? `未来 54 小时跟踪 ${matches.length} 场世界杯比赛`
          : '未来 54 小时暂无可解析比赛',
      note:
        '系统将公开赛程、新闻和海外市场赔率转为概率视图，再给出谨慎的体彩核验方向。所有判断只作信息分析，不保证盈利。',
      trackedMatches: matches.length,
      healthySources,
      updateMode: process.env.GITHUB_ACTIONS ? 'GitHub 定时' : '本地脚本',
    },
    sources,
    news: newsResult.news,
    matches,
    bankroll: {
      title: '负责任购彩预算',
      disclaimer:
        '彩票具有随机性。先设娱乐预算，再看比赛；不要借钱、不要追损、不要把模型信心当作收益承诺。',
      rules: [
        {
          label: '每日娱乐上限',
          value: '≤ 可支配娱乐预算 2%',
          note: '把世界杯购彩和餐饮/娱乐放在同一预算池，而不是投资账户。',
        },
        {
          label: '单场最高',
          value: '≤ 当日上限 25%',
          note: '再强的热门也会爆冷，避免把一天预算压在一场。',
        },
        {
          label: '追损规则',
          value: '亏损后不加码',
          note: '连续判断失误时暂停一天，比扩大投注更重要。',
        },
      ],
    },
  }

  await writeJson('public/data/worldcup-brief.json', brief)
  console.log(`Updated ${brief.matches.length} matches at ${brief.generatedAtChina}`)
}

async function fetchScoreboard(dateKey) {
  const url = `${SCOREBOARD_URL}?dates=${dateKey}`
  try {
    const data = await fetchJson(url)
    return {
      events: data.events ?? [],
      source: {
        id: `espn-scoreboard-${dateKey}`,
        name: `ESPN 赛程 ${dateKey}`,
        status: 'ok',
        url,
        lastCheckedAt: checkedAt,
        detail: `${data.events?.length ?? 0} 场比赛`,
      },
    }
  } catch (error) {
    return {
      events: [],
      source: {
        id: `espn-scoreboard-${dateKey}`,
        name: `ESPN 赛程 ${dateKey}`,
        status: 'error',
        url,
        lastCheckedAt: checkedAt,
        detail: shortError(error),
      },
    }
  }
}

async function fetchNews() {
  try {
    const data = await fetchJson(NEWS_URL)
    const news = (data.articles ?? []).slice(0, 10).map((article) => ({
      id: String(article.id ?? article.nowId ?? article.headline),
      title: article.headline ?? 'Untitled',
      summary: article.description ?? '暂无摘要',
      url: article.links?.web?.href ?? article.link ?? NEWS_URL,
      publishedAt: article.published ?? article.lastModified ?? checkedAt,
      impact: classifyNewsImpact(`${article.headline ?? ''} ${article.description ?? ''}`),
    }))

    return {
      news,
      source: {
        id: 'espn-news',
        name: 'ESPN 世界杯新闻',
        status: 'ok',
        url: NEWS_URL,
        lastCheckedAt: checkedAt,
        detail: `${news.length} 条新闻`,
      },
    }
  } catch (error) {
    return {
      news: [],
      source: {
        id: 'espn-news',
        name: 'ESPN 世界杯新闻',
        status: 'error',
        url: NEWS_URL,
        lastCheckedAt: checkedAt,
        detail: shortError(error),
      },
    }
  }
}

async function fetchOddsApi() {
  const apiKey = process.env.THE_ODDS_API_KEY
  const url = `https://api.the-odds-api.com/v4/sports/${ODDS_API_SPORT}/odds/?regions=us,uk,eu&markets=h2h,spreads,totals&oddsFormat=decimal`

  if (!apiKey) {
    return {
      data: [],
      source: {
        id: 'the-odds-api',
        name: 'The Odds API',
        status: 'skipped',
        url: 'https://the-odds-api.com/',
        lastCheckedAt: checkedAt,
        detail: '未设置 THE_ODDS_API_KEY',
      },
    }
  }

  try {
    const data = await fetchJson(`${url}&apiKey=${encodeURIComponent(apiKey)}`)
    return {
      data,
      source: {
        id: 'the-odds-api',
        name: 'The Odds API',
        status: 'ok',
        url: 'https://the-odds-api.com/',
        lastCheckedAt: checkedAt,
        detail: `${data.length ?? 0} 场赔率`,
      },
    }
  } catch (error) {
    return {
      data: [],
      source: {
        id: 'the-odds-api',
        name: 'The Odds API',
        status: 'error',
        url: 'https://the-odds-api.com/',
        lastCheckedAt: checkedAt,
        detail: shortError(error),
      },
    }
  }
}

async function checkSporttery() {
  try {
    const response = await fetchWithTimeout(SPORTTERY_API, {
      headers: {
        referer: 'https://www.sporttery.cn/',
        'user-agent': 'Mozilla/5.0 WorldCupTicaiAdvisor/1.0',
      },
    })
    const text = await response.text()
    return {
      id: 'sporttery',
      name: '中国体彩网竞彩',
      status: response.ok ? 'ok' : 'warn',
      url: SPORTTERY_URL,
      lastCheckedAt: checkedAt,
      detail: response.ok ? `接口响应 ${Math.round(text.length / 1024)} KB` : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      id: 'sporttery',
      name: '中国体彩网竞彩',
      status: 'warn',
      url: SPORTTERY_URL,
      lastCheckedAt: checkedAt,
      detail: `需人工核验：${shortError(error)}`,
    }
  }
}

async function checkFifa() {
  try {
    const response = await fetchWithTimeout(FIFA_URL)
    return {
      id: 'fifa-official',
      name: 'FIFA 官方赛程',
      status: response.ok ? 'ok' : 'warn',
      url: FIFA_URL,
      lastCheckedAt: checkedAt,
      detail: response.ok ? '官方页面可访问' : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      id: 'fifa-official',
      name: 'FIFA 官方赛程',
      status: 'warn',
      url: FIFA_URL,
      lastCheckedAt: checkedAt,
      detail: shortError(error),
    }
  }
}

function normalizeMatch(event, newsItems) {
  const competition = event.competitions?.[0] ?? {}
  const competitors = competition.competitors ?? []
  const home = competitors.find((item) => item.homeAway === 'home') ?? competitors[0] ?? {}
  const away = competitors.find((item) => item.homeAway === 'away') ?? competitors[1] ?? {}
  const normalizedHome = normalizeTeam(home)
  const normalizedAway = normalizeTeam(away)
  const market = normalizeMarket(competition.odds?.[0], home, away)
  const judgement = buildJudgement(market, event, newsItems)
  const scoreline = buildScorelineAnalysis(market, normalizedHome, normalizedAway, judgement, newsItems)
  const professional = buildProfessionalBrief(market, normalizedHome, normalizedAway, judgement, scoreline, newsItems)

  return {
    id: String(event.id),
    name: event.name ?? `${teamName(home)} vs ${teamName(away)}`,
    group: competition.altGameNote ?? event.season?.type?.name ?? 'FIFA World Cup',
    status: event.status?.type?.shortDetail ?? event.status?.type?.description ?? '未开赛',
    kickoffUtc: event.date,
    kickoffChina: formatChinaDateTime(event.date),
    venue: competition.venue?.fullName
      ? `${competition.venue.fullName}, ${competition.venue.address?.city ?? ''}`.trim()
      : '待确认场地',
    home: normalizedHome,
    away: normalizedAway,
    score: `${home.score ?? 0}-${away.score ?? 0}`,
    market,
    judgement,
    scoreline,
    professional,
    sporttery: {
      status: '需赛前核验',
      officialUrl: SPORTTERY_URL,
      markets: ['胜平负', '让球胜平负', '总进球', '比分'],
      note:
        '海外市场盘口与竞彩官方赔率、开售状态、让球设定可能不同。购买前请用中国体彩网或销售终端核验最终赔率和截止时间。',
    },
  }
}

function normalizeTeam(competitor) {
  const team = competitor.team ?? {}
  const name = team.displayName ?? team.name ?? 'Unknown'
  return {
    id: String(team.id ?? name),
    name,
    zhName: teamNames.get(name) ?? name,
    abbreviation: team.abbreviation ?? name.slice(0, 3).toUpperCase(),
    logo: team.logo,
    form: competitor.form,
    record: competitor.records?.[0]?.summary,
  }
}

function normalizeMarket(odds, home, away) {
  if (!odds) return null
  const homeLabel = teamNames.get(teamName(home)) ?? teamName(home)
  const awayLabel = teamNames.get(teamName(away)) ?? teamName(away)
  const moneyline = [
    outcome(homeLabel, 'home', odds.moneyline?.home?.open?.odds, odds.moneyline?.home?.close?.odds),
    outcome('平局', 'draw', odds.moneyline?.draw?.open?.odds, odds.moneyline?.draw?.close?.odds),
    outcome(awayLabel, 'away', odds.moneyline?.away?.open?.odds, odds.moneyline?.away?.close?.odds),
  ]
  const probabilitySum = moneyline.reduce((sum, item) => sum + (item.impliedProbability ?? 0), 0)
  moneyline.forEach((item) => {
    item.normalizedProbability = probabilitySum > 0 ? (item.impliedProbability ?? 0) / probabilitySum : null
  })

  return {
    provider: odds.provider?.name ?? 'ESPN 市场',
    details: odds.details ?? '暂无详情',
    moneyline,
    total: [
      outcome('大球', 'over', odds.total?.over?.open?.odds, odds.total?.over?.close?.odds, odds.total?.over?.close?.line),
      outcome('小球', 'under', odds.total?.under?.open?.odds, odds.total?.under?.close?.odds, odds.total?.under?.close?.line),
    ],
    spread: [
      outcome(homeLabel, 'spreadHome', odds.pointSpread?.home?.open?.odds, odds.pointSpread?.home?.close?.odds, odds.pointSpread?.home?.close?.line),
      outcome(awayLabel, 'spreadAway', odds.pointSpread?.away?.open?.odds, odds.pointSpread?.away?.close?.odds, odds.pointSpread?.away?.close?.line),
    ],
    updatedAt: checkedAt,
  }
}

function outcome(label, side, openOdds, closeOdds, line = null) {
  const implied = impliedFromAmerican(closeOdds)
  return {
    label,
    side,
    american: closeOdds ?? null,
    decimal: decimalFromAmerican(closeOdds),
    impliedProbability: implied,
    normalizedProbability: null,
    line,
    movement: implied !== null && impliedFromAmerican(openOdds) !== null ? round((implied - impliedFromAmerican(openOdds)) * 100, 1) : null,
  }
}

function buildScorelineAnalysis(market, homeTeam, awayTeam, judgement, newsItems) {
  if (!market) {
    return {
      model: '等待赔率后生成比分分布',
      homeExpectedGoals: 0,
      awayExpectedGoals: 0,
      totalExpectedGoals: 0,
      resultProbabilities: [],
      bestPick: null,
      candidates: [],
      avoid: [],
      notes: ['缺少可验证赔率时，不生成比分建议。'],
    }
  }

  const resultProbabilities = resultProbabilitiesFromMarket(market)
  const homeProbability = resultProbabilities.find((item) => item.side === 'home')?.probability ?? 0.33
  const drawProbability = resultProbabilities.find((item) => item.side === 'draw')?.probability ?? 0.26
  const awayProbability = resultProbabilities.find((item) => item.side === 'away')?.probability ?? 0.33
  const totalExpectedGoals = estimateTotalGoals(market)
  const goalDiff = estimateGoalDifference(homeProbability, awayProbability, drawProbability, market)
  const homeExpectedGoals = clamp(round((totalExpectedGoals + goalDiff) / 2, 2), 0.18, 4.8)
  const awayExpectedGoals = clamp(round(totalExpectedGoals - homeExpectedGoals, 2), 0.18, 4.8)
  const newsRisk = newsItems.slice(0, 5).some((item) => /伤|红牌|fit|injur|red card|lineup/i.test(item.title + item.summary))

  const allScores = []
  for (let homeGoals = 0; homeGoals <= 5; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 5; awayGoals += 1) {
      const probability = poisson(homeGoals, homeExpectedGoals) * poisson(awayGoals, awayExpectedGoals)
      const fairOdds = probability > 0 ? 1 / probability : null
      if (!fairOdds) continue

      allScores.push({
        score: `${homeGoals}-${awayGoals}`,
        result: scoreResult(homeGoals, awayGoals),
        probability,
        fairOdds: round(fairOdds, 2),
        suggestedMinOdds: round(fairOdds * uncertaintyMultiplier(judgement.risk, newsRisk), 2),
        officialOdds: null,
        expectedValue: null,
        expectedValueAtSuggestedOdds: round(probability * fairOdds * uncertaintyMultiplier(judgement.risk, newsRisk) - 1, 3),
        grade: '备选',
        reason: scoreReason(homeGoals, awayGoals, homeTeam, awayTeam, resultProbabilities, totalExpectedGoals, judgement),
      })
    }
  }

  const resultStrength = {
    主胜: homeProbability,
    平局: drawProbability,
    客胜: awayProbability,
  }
  const candidates = allScores
    .filter((item) => item.probability >= 0.025)
    .sort((left, right) => scoreCandidateRank(right, resultStrength) - scoreCandidateRank(left, resultStrength))
    .slice(0, 7)
    .map((item, index) => ({
      ...item,
      grade: index === 0 ? '首选核验' : '备选',
    }))

  const avoid = allScores
    .filter((item) => item.probability < 0.018 && item.fairOdds > 55)
    .sort((left, right) => left.probability - right.probability)
    .slice(0, 3)
    .map((item) => ({
      ...item,
      grade: '回避',
      reason: '概率过低，除非官方赔率极端偏高，否则不适合作为主要比分方向。',
    }))

  return {
    model: '胜平负去水概率 + 大小球盘口校准 Poisson 比分分布',
    homeExpectedGoals,
    awayExpectedGoals,
    totalExpectedGoals,
    resultProbabilities,
    bestPick: candidates[0] ?? null,
    candidates,
    avoid,
    notes: [
      '比分玩法方差很大，候选只适合小额娱乐或赛前核验。',
      'expectedValue 只有抓到中国体彩官方比分赔率后才会填充；当前显示的是盈亏平衡与建议最低赔率。',
      newsRisk ? '最新新闻触发阵容/纪律风险词，建议等首发和官方停售前赔率。' : '最新新闻未触发高风险词，但仍需赛前核验首发。',
    ],
  }
}

function buildProfessionalBrief(market, homeTeam, awayTeam, judgement, scoreline, newsItems) {
  if (!market || !scoreline.bestPick) {
    return {
      rankScore: 35,
      grade: '观望',
      headline: '等待赔率恢复后再判断',
      finalAdvice: '缺少足够市场数据时，不建议给出购买方向。',
      stakingPlan: '本场跳过，保留预算。',
      deepThinking: {
        label: '深度推演层',
        conclusion: '数据不足，本场最合适的买法是放弃。',
        confidenceScore: 25,
        purchasePlan: [
          {
            label: '最终动作',
            selection: '放弃本场',
            allocation: '0%',
            minOdds: '等待官方赔率',
            action: '放弃',
            rationale: '缺少可验证赔率和比分分布时，无法判断赔率是否补偿风险。',
          },
        ],
        reasoningSummary: ['赔率、盘口和比分分布缺口过大。', '没有足够数据时，保留预算比猜比分更重要。'],
        noBuyRules: ['任一关键数据源不可用时不买。', '中国体彩未开售或停售时不买。'],
        updateSensitivity: '等待赔率源恢复后重新计算。',
      },
      expertAnswer: {
        verdict: '观望，不给出购买答案',
        recommendedScore: '不选比分',
        secondaryScores: [],
        marketDirection: '等待赔率',
        totalGoals: '等待盘口',
        buyCondition: '至少恢复胜平负、总进球和比分概率后再判断。',
        passCondition: '数据源不可核验时直接放弃本场。',
        stakeCeiling: '0%',
        confidenceBand: '低',
      },
      primary: null,
      plays: [
        {
          playType: '回避',
          selection: '暂无推荐',
          priority: '不建议',
          confidence: 35,
          budgetShare: '0%',
          minOdds: '等待官方赔率',
          expectedValueNote: '数据不足，不计算期望。',
          reason: '没有可验证赔率时，模型无法判断赔率是否补偿风险。',
          noBetIf: '赔率源或中国体彩官方信息不可核验。',
        },
      ],
      scenarios: [
        {
          title: '数据缺口剧本',
          probability: '无法估计',
          scorePath: '赔率与比分分布不足',
          action: '只记录赛程，不做任何购买建议。',
        },
      ],
      signals: [],
      riskControls: [
        {
          label: '数据完整性',
          level: '高',
          detail: '没有可验证赔率，所有具体比分都缺少期望值基础。',
        },
      ],
      checklist: ['等待赛前官方赔率', '确认比赛开售状态', '确认首发阵容'],
      downgradeTriggers: ['任一关键数据源不可用'],
    }
  }

  const resultProbabilities = scoreline.resultProbabilities
  const favorite = [...resultProbabilities].sort((left, right) => right.probability - left.probability)[0]
  const favoriteFairOdds = favorite?.probability ? 1 / favorite.probability : null
  const favoriteSuggestedMinOdds = favoriteFairOdds ? round(favoriteFairOdds * (1.04 + judgement.risk / 900), 2) : null
  const bestScore = scoreline.bestPick
  const scoreConcentration = bestScore.probability * 100
  const overheatPenalty = judgement.tier === '避免追高' ? 8 : 0
  const rankScore = clamp(
    Math.round(judgement.confidence * 0.52 + (100 - judgement.risk) * 0.24 + scoreConcentration * 1.15 - overheatPenalty),
    20,
    91,
  )
  const grade = professionalGrade(rankScore, judgement)
  const totalBand = totalGoalsBand(scoreline.totalExpectedGoals)
  const winnerSide = favorite?.side === 'home' ? '主胜' : favorite?.side === 'away' ? '客胜' : '平局'
  const favoriteName = favorite?.label ?? '市场主方向'
  const newsRisk = newsItems.slice(0, 5).some((item) => /伤|红牌|fit|injur|red card|lineup/i.test(item.title + item.summary))

  const scorePlay = {
    playType: '比分',
    selection: `${bestScore.score}（${bestScore.result}）`,
    priority: '主方案',
    confidence: clamp(Math.round(55 + bestScore.probability * 170 - judgement.risk * 0.12), 45, 78),
    budgetShare: judgement.tier === '避免追高' ? '单场预算 3%-6%' : '单场预算 5%-9%',
    minOdds: `≥ ${bestScore.suggestedMinOdds.toFixed(2)}`,
    expectedValueNote: `模型概率 ${formatPct(bestScore.probability)}，盈亏线 ${bestScore.fairOdds.toFixed(2)}；官方赔率低于门槛则放弃。`,
    reason: bestScore.reason,
    noBetIf: `中国体彩该比分赔率低于 ${bestScore.suggestedMinOdds.toFixed(2)}，或赛前首发显示明显轮换。`,
  }

  const resultPlay = {
    playType: '胜平负',
    selection: `${favoriteName} ${winnerSide}`,
    priority: judgement.tier === '避免追高' ? '防守' : '备选',
    confidence: clamp(Math.round((favorite?.probability ?? 0.33) * 100), 35, 88),
    budgetShare: judgement.tier === '避免追高' ? '仅核验，不主动追' : '单场预算 8%-15%',
    minOdds: favoriteSuggestedMinOdds ? `≥ ${favoriteSuggestedMinOdds.toFixed(2)}` : '等待官方赔率',
    expectedValueNote: favoriteSuggestedMinOdds
      ? `去水概率 ${formatPct(favorite.probability)}，低于建议赔率时性价比不足。`
      : '缺少可计算赔率门槛。',
    reason:
      judgement.tier === '避免追高'
        ? `${favoriteName} 胜面很高，但胜平负通常容易被压低，重点看官方赔率是否还有补偿。`
        : `${favoriteName} 是市场主方向，可作为比分玩法之外的低方差核验项。`,
    noBetIf: '官方胜平负赔率明显低于门槛，或临场赔率短时间大幅下压。',
  }

  const totalPlay = {
    playType: '总进球',
    selection: totalBand.selection,
    priority: '备选',
    confidence: totalBand.confidence,
    budgetShare: '单场预算 4%-8%',
    minOdds: '以官方组合赔率核验',
    expectedValueNote: `模型总进球均值 ${scoreline.totalExpectedGoals.toFixed(2)}，只适合与比分方向交叉验证。`,
    reason: totalBand.reason,
    noBetIf: '首发防守倾向或天气/场地导致节奏判断与模型相反。',
  }

  const hedgePlay = drawHedgePlay(resultProbabilities, scoreline, judgement)
  const plays = [scorePlay, resultPlay, totalPlay, hedgePlay].filter(Boolean)
  const expertAnswer = buildExpertAnswer(grade, scorePlay, resultPlay, totalPlay, hedgePlay, judgement, scoreline)
  const scenarios = buildScenarios(scoreline, favoriteName, winnerSide, totalBand)
  const riskControls = buildRiskControls(market, judgement, scoreline, favorite)
  const deepThinking = buildDeepThinkingPlan({
    grade,
    expertAnswer,
    plays,
    scenarios,
    riskControls,
    judgement,
    scoreline,
    newsItems,
  })

  return {
    rankScore,
    grade,
    headline: professionalHeadline(grade, favoriteName, bestScore, scoreline),
    finalAdvice: professionalFinalAdvice(grade, scorePlay, resultPlay, totalPlay, judgement),
    stakingPlan: stakingPlanForGrade(grade, judgement),
    deepThinking,
    expertAnswer,
    primary: scorePlay,
    plays,
    scenarios,
    signals: [
      {
        label: '市场主方向',
        score: Math.round((favorite?.probability ?? 0) * 100),
        tone: (favorite?.probability ?? 0) > 0.76 ? 'watch' : 'good',
        evidence: `${favoriteName} 去水后约 ${formatPct(favorite?.probability ?? 0)}，当前判断为 ${winnerSide} 主方向。`,
      },
      {
        label: '比分集中度',
        score: Math.round(scoreConcentration * 10),
        tone: scoreConcentration >= 13 ? 'good' : scoreConcentration >= 9 ? 'watch' : 'bad',
        evidence: `首选比分 ${bestScore.score} 概率约 ${formatPct(bestScore.probability)}，盈亏线 ${bestScore.fairOdds.toFixed(2)}。`,
      },
      {
        label: '赔率过热',
        score: judgement.risk,
        tone: judgement.tier === '避免追高' ? 'bad' : judgement.risk > 60 ? 'watch' : 'good',
        evidence: judgement.tier === '避免追高' ? '热门方向赔率偏薄，优先核验比分/总进球，不追低赔。' : '市场热度尚可，但仍需赛前赔率确认。',
      },
      {
        label: '新闻与阵容',
        score: newsRisk ? 62 : 42,
        tone: newsRisk ? 'watch' : 'good',
        evidence: newsRisk ? '新闻中出现阵容/纪律风险词，需等首发。' : '最新新闻未触发高风险词，常规核验即可。',
      },
    ],
    riskControls,
    checklist: [
      `中国体彩比分 ${scorePlay.selection} 官方赔率是否 ${scorePlay.minOdds}`,
      `胜平负 ${resultPlay.selection} 是否达到 ${resultPlay.minOdds}`,
      '赛前 30 分钟确认首发、门将、核心前锋和中卫组合',
      '停售前确认赔率没有突然下压，且比赛仍在竞彩开售列表',
    ],
    downgradeTriggers: [
      '官方比分赔率低于建议最低赔率',
      '热门方向 30 分钟内继续大幅降赔',
      '主力前锋/门将/核心中卫缺阵或明显轮换',
      '临场天气、红牌停赛、战意信息与当前模型假设冲突',
    ],
  }
}

function buildDeepThinkingPlan({ grade, expertAnswer, plays, scenarios, riskControls, judgement, scoreline, newsItems }) {
  const scorePlay = plays.find((play) => play.playType === '比分' && play.priority === '主方案') ?? plays[0]
  const resultPlay = plays.find((play) => play.playType === '胜平负')
  const totalPlay = plays.find((play) => play.playType === '总进球')
  const hedgePlay = plays.find((play) => play.priority === '防守')
  const hotRisk = riskControls.find((risk) => risk.label === '赔率压缩')
  const scoreRisk = riskControls.find((risk) => risk.label === '比分方差')
  const newsRisk = newsItems.slice(0, 6).some((item) => /伤|红牌|injur|red card|lineup|suspend|doubt/i.test(item.title + item.summary))
  const confidenceScore = clamp(
    Math.round(
      judgement.confidence * 0.46 +
        (100 - judgement.risk) * 0.24 +
        (scoreline.bestPick?.probability ?? 0) * 180 +
        (grade === '重点核验' ? 8 : grade === '小额分散' ? 3 : grade === '只核验不追高' ? -6 : -14) -
        (newsRisk ? 5 : 0),
    ),
    15,
    92,
  )

  const purchasePlan = []

  if (grade === '观望' || !scorePlay) {
    purchasePlan.push({
      label: '最终动作',
      selection: '放弃本场',
      allocation: '0%',
      minOdds: '不适用',
      action: '放弃',
      rationale: '综合分不足或数据缺口过大，保留预算。',
    })
  } else {
    purchasePlan.push({
      label: '主票',
      selection: scorePlay.selection,
      allocation:
        grade === '重点核验'
          ? '本场预算 35%-45%'
          : grade === '小额分散'
            ? '本场预算 25%-35%'
            : '本场预算 15%-25%',
      minOdds: scorePlay.minOdds,
      action: grade === '只核验不追高' ? '只看不买' : '买入核验',
      rationale: `首选比分概率 ${formatPct(scoreline.bestPick?.probability ?? 0)}，盈亏线 ${scoreline.bestPick?.fairOdds.toFixed(2) ?? '待定'}，低于门槛不买。`,
    })

    if (resultPlay) {
      purchasePlan.push({
        label: '低方差票',
        selection: resultPlay.selection,
        allocation:
          grade === '重点核验'
            ? '本场预算 35%-45%'
            : grade === '小额分散'
              ? '本场预算 25%-35%'
              : '只看赔率，不主动追',
        minOdds: resultPlay.minOdds,
        action: grade === '只核验不追高' ? '只看不买' : '买入核验',
        rationale: '胜平负只用于降低比分玩法方差，赔率被压低时不参与。',
      })
    }

    if (totalPlay) {
      purchasePlan.push({
        label: '节奏校验',
        selection: totalPlay.selection,
        allocation: '本场预算 10%-20%',
        minOdds: totalPlay.minOdds,
        action: '小额防守',
        rationale: '总进球用于校验比分区间，不作为扩大投注的理由。',
      })
    }

    if (hedgePlay) {
      purchasePlan.push({
        label: '平局防守',
        selection: hedgePlay.selection,
        allocation: '本场预算 5%-8%',
        minOdds: hedgePlay.minOdds,
        action: '小额防守',
        rationale: '只在平局噪音偏高且官方赔率给足时使用。',
      })
    }
  }

  return {
    label: '深度推演层',
    conclusion: deepThinkingConclusion(grade, expertAnswer, scorePlay, resultPlay, totalPlay),
    confidenceScore,
    purchasePlan: purchasePlan.slice(0, 4),
    reasoningSummary: [
      `模型最集中比分：${expertAnswer.recommendedScore}；备选：${expertAnswer.secondaryScores.slice(0, 2).join(' / ') || '不扩展'}。`,
      `胜平负方向：${expertAnswer.marketDirection}；总进球校验：${expertAnswer.totalGoals}。`,
      `主要风险：${hotRisk?.label ?? '赔率'}为${hotRisk?.level ?? '中'}，${scoreRisk?.label ?? '比分方差'}为${scoreRisk?.level ?? '中'}。`,
      scenarios[0] ? `基准剧本：${scenarios[0].scorePath}` : '等待更多情景数据。',
    ],
    noBuyRules: [
      `中国体彩比分赔率低于 ${scorePlay?.minOdds ?? '建议门槛'} 时不买。`,
      resultPlay ? `胜平负 ${resultPlay.selection} 低于 ${resultPlay.minOdds} 时不买。` : '胜平负赔率不可核验时不买。',
      '首发出现核心前锋、门将或中卫明显轮换时不买。',
      '临场 30 分钟内热门方向继续大幅降赔时不追。',
      newsRisk ? '最新新闻存在阵容/纪律风险，必须等首发后再决定。' : '中国体彩未开售、停售或让球口径变化时不买。',
    ],
    updateSensitivity:
      grade === '重点核验'
        ? '对官方赔率和首发最敏感，赛前 30 分钟需要重新核验。'
        : grade === '只核验不追高'
          ? '对降赔最敏感，只要官方赔率低于门槛就直接放弃。'
          : '对赔率、首发和新闻中等敏感，适合小额而非重仓。',
  }
}

function deepThinkingConclusion(grade, expertAnswer, scorePlay, resultPlay, totalPlay) {
  if (grade === '观望' || !scorePlay) return '最合适买法：不买。本场保留预算。'
  if (grade === '只核验不追高') {
    return `最合适买法：只核验 ${scorePlay.selection}，官方赔率达标才小额；不追 ${resultPlay?.selection ?? '热门方向'}。`
  }
  if (grade === '重点核验') {
    return `最合适买法：主票 ${scorePlay.selection}，低方差票 ${resultPlay?.selection ?? expertAnswer.marketDirection}，用 ${totalPlay?.selection ?? expertAnswer.totalGoals} 校验节奏。`
  }
  return `最合适买法：小额分散，首看 ${scorePlay.selection}，再用 ${resultPlay?.selection ?? expertAnswer.marketDirection} 和 ${totalPlay?.selection ?? expertAnswer.totalGoals} 交叉确认。`
}

function buildExpertAnswer(grade, scorePlay, resultPlay, totalPlay, hedgePlay, judgement, scoreline) {
  const secondaryScores = scoreline.candidates
    .filter((item) => item.score !== scoreline.bestPick?.score)
    .slice(0, 3)
    .map((item) => `${item.score}（${item.result}）`)

  const confidenceBand =
    grade === '重点核验'
      ? '中高：只在赔率达标且首发无冲突时执行'
      : grade === '小额分散'
        ? '中等：用小额分散而不是重仓单点'
        : grade === '只核验不追高'
          ? '中低：市场过热时宁可放弃'
          : '低：不进入购买清单'

  const verdict =
    grade === '观望'
      ? '本场没有足够优势，不建议购买。'
      : grade === '只核验不追高'
        ? `答案是先看 ${scorePlay.selection}，但只在官方赔率达到 ${scorePlay.minOdds} 以上时小额核验。`
        : `答案是以 ${scorePlay.selection} 为首选，${resultPlay.selection} 与 ${totalPlay.selection} 只做交叉验证。`

  const hedgeText = hedgePlay ? `；若平局赔率给足，可用 ${hedgePlay.selection} 做极小防守` : ''

  return {
    verdict,
    recommendedScore: scorePlay.selection,
    secondaryScores,
    marketDirection: resultPlay.selection,
    totalGoals: totalPlay.selection,
    buyCondition: `必须同时满足：比分赔率 ${scorePlay.minOdds}、胜平负方向 ${resultPlay.minOdds}、首发无明显轮换${hedgeText}。`,
    passCondition: `任一核心条件不满足就放弃；${judgement.avoid}`,
    stakeCeiling: stakingPlanForGrade(grade, judgement),
    confidenceBand,
  }
}

function buildScenarios(scoreline, favoriteName, winnerSide, totalBand) {
  const base = scoreline.bestPick
  const draw = scoreline.candidates.find((item) => item.result === '平局')
  const upset = scoreline.candidates.find((item) => item.result !== base?.result && item.result !== '平局')
  const scenarios = []

  if (base) {
    scenarios.push({
      title: '基准剧本',
      probability: formatPct(base.probability),
      scorePath: `${favoriteName} ${winnerSide}，比分落在 ${base.score} 附近。`,
      action: `只核验 ${base.score}，不追更偏的高比分。`,
    })
  }

  if (draw) {
    scenarios.push({
      title: '僵持剧本',
      probability: formatPct(draw.probability),
      scorePath: `若上半场节奏慢，比分可能滑向 ${draw.score}。`,
      action: '平局只做防守，不把它升级成主方案。',
    })
  }

  if (upset) {
    scenarios.push({
      title: '冷门剧本',
      probability: formatPct(upset.probability),
      scorePath: `若热门方首发轮换或早段失球，风险比分是 ${upset.score}。`,
      action: '冷门只作为风险提醒，不主动追高赔率。',
    })
  }

  scenarios.push({
    title: '进球节奏剧本',
    probability: `${scoreline.totalExpectedGoals.toFixed(2)} xG`,
    scorePath: `总进球主区间是 ${totalBand.selection}。`,
    action: '比分和总进球方向冲突时，以放弃为优先。',
  })

  return scenarios.slice(0, 4)
}

function buildRiskControls(market, judgement, scoreline, favorite) {
  const favoriteMarket = market.moneyline.find((item) => item.side === favorite?.side)
  const favoriteMove = Math.abs(favoriteMarket?.movement ?? 0)
  const bestScoreProbability = scoreline.bestPick?.probability ?? 0
  const topTwoGap = (scoreline.candidates[0]?.probability ?? 0) - (scoreline.candidates[1]?.probability ?? 0)

  return [
    {
      label: '赔率压缩',
      level: favoriteMove >= 6 ? '高' : favoriteMove >= 3 ? '中' : '低',
      detail:
        favoriteMove >= 6
          ? '热门方向短时间变化较大，必须等临场官方赔率确认，不追下压后的低回报。'
          : '盘口变化尚可接受，但仍要以中国体彩最终赔率为准。',
    },
    {
      label: '比分方差',
      level: bestScoreProbability < 0.08 ? '高' : bestScoreProbability < 0.12 ? '中' : '低',
      detail: `首选比分模型概率约 ${formatPct(bestScoreProbability)}，比分玩法天然高方差，金额必须明显低于胜平负。`,
    },
    {
      label: '候选分歧',
      level: topTwoGap < 0.015 ? '高' : topTwoGap < 0.035 ? '中' : '低',
      detail: `前两名比分差距约 ${formatPct(Math.max(topTwoGap, 0))}，差距越小越不适合单点重仓。`,
    },
    {
      label: '综合风险',
      level: judgement.risk > 62 ? '高' : judgement.risk > 45 ? '中' : '低',
      detail: `当前风险指数 ${judgement.risk}/100；超过中档时只做核验，不扩大组合。`,
    },
  ]
}

function professionalGrade(rankScore, judgement) {
  if (judgement.tier === '避免追高') return '只核验不追高'
  if (rankScore >= 68 && judgement.risk < 58) return '重点核验'
  if (rankScore >= 58) return '小额分散'
  return '观望'
}

function professionalHeadline(grade, favoriteName, bestScore, scoreline) {
  if (grade === '只核验不追高') {
    return `${favoriteName} 热度高，首看比分 ${bestScore.score} 与总进球交叉核验`
  }
  if (grade === '重点核验') {
    return `主方向较清晰，比分 ${bestScore.score} 是本场优先核验项`
  }
  if (grade === '小额分散') {
    return `可小额分散，围绕 ${bestScore.score} 与 ${scoreline.totalExpectedGoals.toFixed(1)} 球环境展开`
  }
  return `信息优势不足，等待官方赔率与首发后再判断`
}

function professionalFinalAdvice(grade, scorePlay, resultPlay, totalPlay, judgement) {
  if (grade === '只核验不追高') {
    return `不建议重仓胜平负。优先看 ${scorePlay.selection} 是否达到 ${scorePlay.minOdds}，再用 ${totalPlay.selection} 辅助判断；达不到门槛就放弃。`
  }
  if (grade === '重点核验') {
    return `先核验 ${scorePlay.selection}，再看 ${resultPlay.selection} 是否达到 ${resultPlay.minOdds}。两者都满足时才考虑小额组合。`
  }
  if (grade === '小额分散') {
    return `只做小额娱乐，比分、胜平负、总进球不要同时放大金额；任一核心条件不满足就降级为观望。`
  }
  return `${judgement.avoid} 当前不适合主动购买，等待官方赔率和首发。`
}

function stakingPlanForGrade(grade, judgement) {
  if (grade === '重点核验') return '本场最多使用当日预算 18%-25%，比分玩法不超过单场预算 35%。'
  if (grade === '小额分散') return '本场最多使用当日预算 10%-16%，分成 2 个以内方向。'
  if (grade === '只核验不追高') return '本场最多使用当日预算 6%-10%，只在赔率达标时小额尝试。'
  return `保留预算。${judgement.stake}`
}

function totalGoalsBand(totalExpectedGoals) {
  if (totalExpectedGoals <= 2.25) {
    return {
      selection: '总进球 1/2',
      confidence: 58,
      reason: '总进球均值偏低，低比分候选更集中，适合防守型比分交叉核验。',
    }
  }
  if (totalExpectedGoals <= 2.75) {
    return {
      selection: '总进球 2/3',
      confidence: 61,
      reason: '总进球均值中低，2-3 球区间覆盖多数主流比分。',
    }
  }
  if (totalExpectedGoals <= 3.25) {
    return {
      selection: '总进球 2/3/4',
      confidence: 63,
      reason: '总进球环境中性偏开放，2-4 球区间比单点比分更稳。',
    }
  }
  return {
    selection: '总进球 3/4/5',
    confidence: 57,
    reason: '进球环境偏开放，但高总进球波动更大，只适合小额配合比分方向。',
  }
}

function drawHedgePlay(resultProbabilities, scoreline, judgement) {
  const draw = resultProbabilities.find((item) => item.side === 'draw')
  const drawCandidate = scoreline.candidates.find((item) => item.result === '平局')
  if (!draw || draw.probability < 0.23 || !drawCandidate) return null

  return {
    playType: '比分',
    selection: `${drawCandidate.score} 平局防守`,
    priority: '防守',
    confidence: clamp(Math.round(draw.probability * 100 + 34), 40, 64),
    budgetShare: '单场预算 2%-4%',
    minOdds: `≥ ${drawCandidate.suggestedMinOdds.toFixed(2)}`,
    expectedValueNote: `平局去水概率 ${formatPct(draw.probability)}，只作为防守小票，不扩大金额。`,
    reason: '平局噪音不低，若官方赔率给足，可用最集中平局比分小额防守。',
    noBetIf: '平局比分赔率低于门槛，或双方首发明显偏进攻导致总进球环境上移。',
  }
}

function formatPct(value) {
  return `${Math.round(value * 100)}%`
}

function resultProbabilitiesFromMarket(market) {
  return market.moneyline.map((item) => ({
    label: item.label,
    side: item.side,
    probability: round(item.normalizedProbability ?? item.impliedProbability ?? 0, 4),
  }))
}

function estimateTotalGoals(market) {
  const over = market.total.find((item) => item.side === 'over')
  const under = market.total.find((item) => item.side === 'under')
  const line = parseFloat(String(over?.line ?? under?.line ?? '2.5').replace(/[ou]/gi, '')) || 2.5
  const overRaw = over?.impliedProbability ?? null
  const underRaw = under?.impliedProbability ?? null
  const overProbability = overRaw !== null && underRaw !== null ? overRaw / (overRaw + underRaw) : 0.5
  const baseMean = invertPoissonOverLine(overProbability, line)
  return round(clamp(baseMean, 1.65, 4.15), 2)
}

function invertPoissonOverLine(probability, line) {
  if (line !== 2.5) {
    return 2.45 + (probability - 0.5) * 1.3 + (line - 2.5) * 0.45
  }

  let bestMean = 2.55
  let bestGap = Infinity
  for (let mean = 1.4; mean <= 4.6; mean += 0.01) {
    const underOrEqualTwo = poisson(0, mean) + poisson(1, mean) + poisson(2, mean)
    const overTwoPointFive = 1 - underOrEqualTwo
    const gap = Math.abs(overTwoPointFive - probability)
    if (gap < bestGap) {
      bestGap = gap
      bestMean = mean
    }
  }
  return bestMean
}

function estimateGoalDifference(homeProbability, awayProbability, drawProbability, market) {
  const nonDraw = Math.max(0.2, 1 - drawProbability)
  const marketTilt = (homeProbability - awayProbability) / nonDraw
  const spreadHome = market.spread.find((item) => item.side === 'spreadHome')
  const spreadLine = parseFloat(String(spreadHome?.line ?? '0').replace(/[^\d.-]/g, '')) || 0
  const spreadSignal = Number.isFinite(spreadLine) ? -spreadLine * 0.32 : 0
  return clamp(round(marketTilt * 1.15 + spreadSignal, 2), -2.4, 2.4)
}

function uncertaintyMultiplier(risk, newsRisk) {
  return round(1.06 + risk / 500 + (newsRisk ? 0.04 : 0), 2)
}

function scoreCandidateRank(item, resultStrength) {
  const resultWeight = 0.85 + (resultStrength[item.result] ?? 0.25)
  const oddsPenalty = item.fairOdds > 38 ? 0.86 : item.fairOdds > 24 ? 0.94 : 1
  return item.probability * resultWeight * oddsPenalty
}

function scoreReason(homeGoals, awayGoals, homeTeam, awayTeam, resultProbabilities, totalExpectedGoals, judgement) {
  const result = scoreResult(homeGoals, awayGoals)
  const homeWin = resultProbabilities.find((item) => item.side === 'home')?.probability ?? 0
  const awayWin = resultProbabilities.find((item) => item.side === 'away')?.probability ?? 0
  const draw = resultProbabilities.find((item) => item.side === 'draw')?.probability ?? 0
  const totalGoals = homeGoals + awayGoals
  const tempo = totalExpectedGoals >= 2.85 ? '进球环境偏开放' : totalExpectedGoals <= 2.25 ? '进球环境偏谨慎' : '进球环境中性'

  if (result === '平局') {
    return `${tempo}，平局概率约 ${Math.round(draw * 100)}%，${homeTeam.zhName} 与 ${awayTeam.zhName} 的胜负差距不宜过度放大。`
  }

  const winner = homeGoals > awayGoals ? homeTeam.zhName : awayTeam.zhName
  const winnerProbability = homeGoals > awayGoals ? homeWin : awayWin
  const marginText = Math.abs(homeGoals - awayGoals) >= 2 ? '两球以上优势' : '一球小胜'
  const totalText = totalGoals >= 4 ? '比分偏大，需要更高官方赔率补偿风险' : totalGoals <= 1 ? '低比分，对临场节奏和首发依赖更强' : '比分区间贴近市场总进球'

  return `${winner} 胜面约 ${Math.round(winnerProbability * 100)}%，${marginText}；${totalText}。${judgement.tier === '避免追高' ? '热门过热时只核验，不追低赔。' : ''}`
}

function scoreResult(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return '主胜'
  if (homeGoals < awayGoals) return '客胜'
  return '平局'
}

function poisson(k, lambda) {
  return (Math.exp(-lambda) * lambda ** k) / factorial(k)
}

function factorial(number) {
  let value = 1
  for (let index = 2; index <= number; index += 1) {
    value *= index
  }
  return value
}

function buildJudgement(market, event, newsItems) {
  if (!market) {
    return {
      confidence: 42,
      risk: 72,
      tier: '观望',
      lean: '等待官方赔率',
      stake: '不建议提前下注',
      guidance: '缺少可验证赔率时，只记录赛程和新闻，不做具体方向。',
      avoid: '不要根据社交媒体热度或单条消息提前加码。',
      factors: defaultFactors(),
    }
  }

  const outcomes = market.moneyline.filter((item) => typeof item.normalizedProbability === 'number')
  const favorite = [...outcomes].sort((left, right) => (right.normalizedProbability ?? 0) - (left.normalizedProbability ?? 0))[0]
  const draw = outcomes.find((item) => item.side === 'draw')
  const favoriteProbability = favorite?.normalizedProbability ?? 0
  const drawProbability = draw?.normalizedProbability ?? 0
  const lineMove = favorite?.movement ?? 0
  const newsHeat = newsItems.slice(0, 5).some((item) => /伤|红牌|fit|injur|red card|lineup/i.test(item.title + item.summary)) ? 12 : 5
  const priceRisk = favoriteProbability > 0.76 ? 78 : favoriteProbability > 0.64 ? 58 : 46
  const drawRisk = drawProbability > 0.27 ? 66 : 42
  const moveRisk = Math.min(85, Math.abs(lineMove) * 7 + 38)
  const scheduleRisk = new Date(event.date).getTime() - now.getTime() < 5 * 60 * 60 * 1000 ? 62 : 48
  const risk = Math.round((priceRisk + drawRisk + moveRisk + scheduleRisk + newsHeat) / 5)
  const confidence = clamp(Math.round(48 + favoriteProbability * 38 + Math.max(lineMove, 0) * 1.2 - risk * 0.12), 38, 84)

  let tier = '观望'
  let stake = '只做观察，不主动加码'
  let lean = `倾向 ${favorite?.label ?? '市场热门'}，但需要赔率核验`
  let guidance = '市场分歧和不确定性仍高，优先看赛前阵容、官方竞彩赔率和盘口变化。'
  let avoid = '避免把平局风险低估，尤其是小组赛阶段。'

  if (favoriteProbability > 0.76) {
    tier = '避免追高'
    stake = '热门方向回报偏低，最多极小额娱乐'
    lean = `${favorite.label} 是明显热门，但赔率已经很薄`
    guidance = '如果中国体彩主胜/客胜赔率被压得过低，性价比会下降；更适合核验让球和总进球，不适合重仓胜平负。'
    avoid = '不要因为“看起来稳”而放大金额，强弱分明的比赛也有轮换和爆冷风险。'
  } else if (confidence >= 62 && risk < 62) {
    tier = '小额娱乐'
    stake = '建议控制在单场预算 15%-25%'
    lean = `可小额关注 ${favorite.label} 方向`
    guidance = '市场热门有一定支撑，但仍需等中国体彩最终赔率；若赔率继续下压，宁可放弃而不是追价。'
    avoid = '不要串太多场，避免一个冷门毁掉整组判断。'
  }

  return {
    confidence,
    risk,
    tier,
    lean,
    stake,
    guidance,
    avoid,
    factors: [
      {
        label: '市场强度',
        value: Math.round(favoriteProbability * 100),
        tone: favoriteProbability > 0.7 ? 'watch' : 'good',
        note: `${favorite.label} 去水后约 ${Math.round(favoriteProbability * 100)}%`,
      },
      {
        label: '赔率移动',
        value: Math.round(Math.abs(lineMove) * 10),
        tone: Math.abs(lineMove) > 3 ? 'watch' : 'good',
        note: lineMove === 0 ? '暂无明显变化' : `热门方向隐含概率变化 ${lineMove > 0 ? '+' : ''}${lineMove}%`,
      },
      {
        label: '平局噪音',
        value: Math.round(drawProbability * 100),
        tone: drawProbability > 0.27 ? 'bad' : 'good',
        note: `平局去水后约 ${Math.round(drawProbability * 100)}%`,
      },
      {
        label: '新闻热度',
        value: newsHeat,
        tone: newsHeat > 8 ? 'watch' : 'good',
        note: newsHeat > 8 ? '近期新闻包含阵容或纪律风险词' : '最新新闻未触发高风险词',
      },
    ],
  }
}

function defaultFactors() {
  return [
    { label: '市场强度', value: 0, tone: 'watch', note: '暂无市场赔率' },
    { label: '赔率移动', value: 0, tone: 'watch', note: '暂无开盘/临盘对比' },
    { label: '平局噪音', value: 0, tone: 'watch', note: '暂无胜平负概率' },
    { label: '新闻热度', value: 0, tone: 'watch', note: '暂无新闻特征' },
  ]
}

function teamName(competitor) {
  return competitor?.team?.displayName ?? competitor?.team?.name ?? 'Unknown'
}

function dedupeEvents(events) {
  const map = new Map()
  for (const event of events) {
    if (event?.id) map.set(String(event.id), event)
  }
  return [...map.values()]
}

function classifyNewsImpact(text) {
  if (/injur|fit|伤|lineup|squad/i.test(text)) return '阵容'
  if (/odds|projection|scenario|path|qualif|出线/i.test(text)) return '形势'
  if (/red card|suspension|红牌|停赛/i.test(text)) return '纪律'
  if (/daily|action|match|比赛/i.test(text)) return '赛程'
  return '新闻'
}

function decimalFromAmerican(value) {
  const number = parseAmerican(value)
  if (number === null) return null
  return round(number > 0 ? number / 100 + 1 : 100 / Math.abs(number) + 1, 2)
}

function impliedFromAmerican(value) {
  const number = parseAmerican(value)
  if (number === null) return null
  return number > 0 ? 100 / (number + 100) : Math.abs(number) / (Math.abs(number) + 100)
}

function parseAmerican(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(String(value).replace('+', ''))
  return Number.isFinite(number) ? number : null
}

function round(value, digits = 0) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

async function fetchJson(url, init) {
  const response = await fetchWithTimeout(url, init)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json()
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 16000)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'user-agent': 'WorldCupTicaiAdvisor/1.0',
        ...(init.headers ?? {}),
      },
    })
  } finally {
    clearTimeout(timeout)
  }
}

function formatDateKey(date, offsetDays, separator) {
  const shifted = new Date(date.getTime() + offsetDays * 24 * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return [year, month, day].join(separator)
}

function formatChinaDateTime(iso) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIMEZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

function shortError(error) {
  return error instanceof Error ? error.message.slice(0, 90) : String(error).slice(0, 90)
}

async function writeJson(path, data) {
  const fullPath = resolve(path)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

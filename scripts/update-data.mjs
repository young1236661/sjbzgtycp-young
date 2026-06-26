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
const TEAM_SCHEDULE_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer/all/teams'
const TEAM_INJURY_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer/all/teams'
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
const NEWS_RISK_PATTERN =
  /injur|伤|fit|doubt|lineup|squad|starter|starting|rotation|rested|rest|suspend|suspension|red card|yellow|yellows|booking|booked|discipline|停赛|红牌|黄牌|轮换|首发|阵容/i
const DISCIPLINE_RISK_PATTERN = /red card|yellow|yellows|booking|booked|discipline|suspend|suspension|停赛|红牌|黄牌/i

const contextStats = {
  teamSchedulesTried: 0,
  teamSchedulesOk: 0,
  injuriesTried: 0,
  injuriesOk: 0,
  weatherTried: 0,
  weatherOk: 0,
}

const indoorStadiums = new Set(['AT&T Stadium', 'Mercedes-Benz Stadium', 'SoFi Stadium', 'BC Place', 'State Farm Stadium'])

const teamNewsAliasMap = new Map([
  ['United States', ['united states', 'usa', 'u.s.', 'usmnt', '美国']],
  ['Türkiye', ['türkiye', 'turkiye', 'turkey', '土耳其']],
  ['Turkey', ['türkiye', 'turkiye', 'turkey', '土耳其']],
  ['Ivory Coast', ['ivory coast', 'cote d’ivoire', "cote d'ivoire", 'côte d’ivoire', 'côte d\'ivoire', '科特迪瓦']],
  ['Curaçao', ['curaçao', 'curacao', '库拉索']],
  ['Curacao', ['curaçao', 'curacao', '库拉索']],
  ['Netherlands', ['netherlands', 'dutch', '荷兰']],
])

const countryProfiles = new Map([
  ['Argentina', { zhName: '阿根廷', lat: -34.6, lon: -58.38, region: '南美南部', climate: '温带/亚热带', element: '水' }],
  ['Austria', { zhName: '奥地利', lat: 48.21, lon: 16.37, region: '中欧内陆', climate: '温带大陆', element: '土' }],
  ['France', { zhName: '法国', lat: 48.86, lon: 2.35, region: '西欧', climate: '温带海洋', element: '金' }],
  ['Iraq', { zhName: '伊拉克', lat: 33.31, lon: 44.36, region: '西亚', climate: '干热大陆', element: '火' }],
  ['Norway', { zhName: '挪威', lat: 59.91, lon: 10.75, region: '北欧', climate: '冷凉海洋', element: '水' }],
  ['Senegal', { zhName: '塞内加尔', lat: 14.69, lon: -17.45, region: '西非', climate: '热带草原', element: '火' }],
  ['Jordan', { zhName: '约旦', lat: 31.95, lon: 35.93, region: '西亚', climate: '干燥半干旱', element: '土' }],
  ['Algeria', { zhName: '阿尔及利亚', lat: 36.75, lon: 3.06, region: '北非', climate: '地中海/沙漠', element: '土' }],
  ['Portugal', { zhName: '葡萄牙', lat: 38.72, lon: -9.14, region: '西南欧', climate: '地中海海洋', element: '金' }],
  ['Uzbekistan', { zhName: '乌兹别克斯坦', lat: 41.31, lon: 69.24, region: '中亚内陆', climate: '干燥大陆', element: '土' }],
  ['England', { zhName: '英格兰', lat: 51.51, lon: -0.13, region: '西北欧海岛', climate: '温带海洋', element: '水' }],
  ['Ghana', { zhName: '加纳', lat: 5.56, lon: -0.2, region: '西非湾岸', climate: '热带湿热', element: '火' }],
  ['Panama', { zhName: '巴拿马', lat: 8.98, lon: -79.52, region: '中美洲', climate: '热带湿热', element: '木' }],
  ['Croatia', { zhName: '克罗地亚', lat: 45.81, lon: 15.98, region: '东南欧', climate: '地中海/大陆', element: '金' }],
  ['Colombia', { zhName: '哥伦比亚', lat: 4.71, lon: -74.07, region: '南美北部', climate: '热带高原', element: '木' }],
  ['Congo DR', { zhName: '刚果民主共和国', lat: -4.32, lon: 15.31, region: '中非', climate: '赤道湿热', element: '木' }],
  ['DR Congo', { zhName: '刚果民主共和国', lat: -4.32, lon: 15.31, region: '中非', climate: '赤道湿热', element: '木' }],
])

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
  ['Austria', '奥地利'],
  ['France', '法国'],
  ['Iraq', '伊拉克'],
  ['England', '英格兰'],
  ['Spain', '西班牙'],
  ['Portugal', '葡萄牙'],
  ['Italy', '意大利'],
  ['Norway', '挪威'],
  ['Senegal', '塞内加尔'],
  ['Jordan', '约旦'],
  ['Algeria', '阿尔及利亚'],
  ['Uzbekistan', '乌兹别克斯坦'],
  ['Ghana', '加纳'],
  ['Panama', '巴拿马'],
  ['Croatia', '克罗地亚'],
  ['Colombia', '哥伦比亚'],
  ['Congo DR', '刚果民主共和国'],
  ['DR Congo', '刚果民主共和国'],
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

  const upcomingWindow = events
    .filter((event) => {
      const kickoff = new Date(event.date).getTime()
      const lower = now.getTime() - 3 * 60 * 60 * 1000
      const upper = now.getTime() + 54 * 60 * 60 * 1000
      return kickoff >= lower && kickoff <= upper
    })
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
    .slice(0, 8)

  const matches = await Promise.all(upcomingWindow.map((event) => normalizeMatch(event, newsResult.news)))
  sources.push(
    fifaResult,
    ...scoreboards.map((board) => board.source),
    newsResult.source,
    oddsApiResult.source,
    sportteryResult,
    buildContextSource('espn-team-schedules', 'ESPN 球队近 5 场', contextStats.teamSchedulesOk, contextStats.teamSchedulesTried),
    buildContextSource('espn-injuries', 'ESPN 伤病名单', contextStats.injuriesOk, contextStats.injuriesTried),
    buildContextSource('open-meteo-weather', 'Open-Meteo 天气', contextStats.weatherOk, contextStats.weatherTried),
  )
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

async function normalizeMatch(event, newsItems) {
  const competition = event.competitions?.[0] ?? {}
  const competitors = competition.competitors ?? []
  const home = competitors.find((item) => item.homeAway === 'home') ?? competitors[0] ?? {}
  const away = competitors.find((item) => item.homeAway === 'away') ?? competitors[1] ?? {}
  const normalizedHome = normalizeTeam(home)
  const normalizedAway = normalizeTeam(away)
  const market = normalizeMarket(competition.odds?.[0], home, away)
  const context = await buildMatchContext(event, competition, normalizedHome, normalizedAway, home, away, newsItems)
  const judgement = buildJudgement(market, event, newsItems, context)
  const scoreline = buildScorelineAnalysis(market, normalizedHome, normalizedAway, judgement, newsItems, context)
  const professional = buildProfessionalBrief(market, normalizedHome, normalizedAway, judgement, scoreline, newsItems, context)

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
    context,
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

async function buildMatchContext(event, competition, homeTeam, awayTeam, homeCompetitor, awayCompetitor, newsItems) {
  const venueName = competition.venue?.fullName ?? ''
  const venueCity = competition.venue?.address?.city ?? ''
  const [homeRecent, awayRecent, homeInjuries, awayInjuries, weather] = await Promise.all([
    fetchTeamRecentContext(homeTeam, event.date),
    fetchTeamRecentContext(awayTeam, event.date),
    fetchTeamInjuryContext(homeTeam, newsItems),
    fetchTeamInjuryContext(awayTeam, newsItems),
    fetchWeatherContext(venueName, venueCity, event.date),
  ])

  const homeContext = {
    ...homeRecent,
    injuries: homeInjuries,
    playerSignals: extractPlayerSignals(homeCompetitor),
  }
  const awayContext = {
    ...awayRecent,
    injuries: awayInjuries,
    playerSignals: extractPlayerSignals(awayCompetitor),
  }
  const geography = buildGeographyContext(homeTeam, awayTeam, weather)
  const divination = buildDivinationContext(event, homeTeam, awayTeam, geography)
  const adjustment = buildContextAdjustment(homeContext, awayContext, weather, geography, divination)

  return {
    home: homeContext,
    away: awayContext,
    weather,
    geography,
    divination,
    adjustment,
    note: '近况、球员、伤病、天气和地理因素进入主模型；古法占卜仅作低权重文化校验，不覆盖可验证事实。',
  }
}

async function fetchTeamRecentContext(team, kickoffUtc) {
  contextStats.teamSchedulesTried += 1
  const url = `${TEAM_SCHEDULE_URL}/${encodeURIComponent(team.id)}/schedule`

  try {
    const data = await fetchJson(url)
    contextStats.teamSchedulesOk += 1
    const cutoff = new Date(kickoffUtc).getTime()
    const recentMatches = (data.events ?? [])
      .map((event) => normalizeRecentMatch(event, team, cutoff))
      .filter(Boolean)
      .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
      .slice(0, 5)
    const formLetters = recentMatches.map((match) => match.result).join('') || team.form || ''
    const wins = recentMatches.filter((match) => match.result === 'W').length
    const draws = recentMatches.filter((match) => match.result === 'D').length
    const goalsFor = recentMatches.reduce((sum, match) => sum + match.goalsFor, 0)
    const goalsAgainst = recentMatches.reduce((sum, match) => sum + match.goalsAgainst, 0)
    const sampleSize = recentMatches.length
    const goalDiff = goalsFor - goalsAgainst
    const formScore = clamp(Math.round(50 + wins * 9 + draws * 3 + goalDiff * 2 - Math.max(0, 5 - sampleSize) * 4), 18, 88)

    return {
      formString: formLetters,
      recentMatches,
      sampleSize,
      formScore,
      goalsForAvg: sampleSize ? round(goalsFor / sampleSize, 2) : null,
      goalsAgainstAvg: sampleSize ? round(goalsAgainst / sampleSize, 2) : null,
      trendNote:
        sampleSize >= 3
          ? `近 ${sampleSize} 场 ${wins} 胜 ${draws} 平，场均 ${round(goalsFor / sampleSize, 2)}-${round(goalsAgainst / sampleSize, 2)}。`
          : `ESPN 实际比分样本只有 ${sampleSize} 场，剩余趋势参考 form：${team.form ?? '暂无'}。`,
      sourceUrl: url,
    }
  } catch (error) {
    return {
      formString: team.form ?? '',
      recentMatches: [],
      sampleSize: 0,
      formScore: formScoreFromLetters(team.form),
      goalsForAvg: null,
      goalsAgainstAvg: null,
      trendNote: `队伍赛程抓取失败：${shortError(error)}；仅使用 ESPN form 字符串。`,
      sourceUrl: url,
    }
  }
}

function normalizeRecentMatch(event, team, cutoff) {
  const eventTime = new Date(event.date).getTime()
  if (!Number.isFinite(eventTime) || eventTime >= cutoff) return null

  const competitors = event.competitions?.[0]?.competitors ?? []
  const own = competitors.find((item) => String(item.team?.id) === String(team.id) || item.team?.displayName === team.name)
  const opponent = competitors.find((item) => item !== own)
  const ownScore = readScore(own?.score)
  const opponentScore = readScore(opponent?.score)
  if (!own || !opponent || ownScore === null || opponentScore === null) return null

  const result = ownScore > opponentScore ? 'W' : ownScore < opponentScore ? 'L' : 'D'
  const homeAway = own.homeAway === 'home' ? '主' : own.homeAway === 'away' ? '客' : '中'
  const league = event.league?.abbreviation ?? event.season?.slug ?? '赛事'

  return {
    date: formatShortDate(event.date),
    opponent: opponent.team?.displayName ?? 'Unknown',
    opponentZhName: teamNames.get(opponent.team?.displayName) ?? opponent.team?.displayName ?? 'Unknown',
    result,
    score: `${ownScore}-${opponentScore}`,
    goalsFor: ownScore,
    goalsAgainst: opponentScore,
    homeAway,
    competition: league,
    note: `${homeAway}场 ${result} ${ownScore}-${opponentScore} vs ${teamNames.get(opponent.team?.displayName) ?? opponent.team?.displayName ?? 'Unknown'}`,
  }
}

function readScore(score) {
  const value = typeof score === 'object' && score !== null ? score.value ?? score.displayValue : score
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formScoreFromLetters(form) {
  if (!form) return 46
  const letters = String(form).slice(-5).toUpperCase().split('')
  const score = letters.reduce((sum, letter) => sum + (letter === 'W' ? 10 : letter === 'D' ? 4 : letter === 'L' ? -5 : 0), 42)
  return clamp(score, 22, 84)
}

async function fetchTeamInjuryContext(team, newsItems) {
  contextStats.injuriesTried += 1
  const url = `${TEAM_INJURY_URL}/${encodeURIComponent(team.id)}/injuries`
  const aliases = teamNewsAliases(team)
  const relatedNews = newsItems
    .filter((item) => {
      const text = `${item.title} ${item.summary}`.toLowerCase()
      return aliases.some((alias) => alias && text.includes(alias))
    })
    .slice(0, 2)
  const newsRisk = relatedNews.some((item) => hasNewsRisk(`${item.title} ${item.summary}`))
  const disciplineRisk = relatedNews.some((item) => DISCIPLINE_RISK_PATTERN.test(`${item.title} ${item.summary}`))

  try {
    const data = await fetchJson(url)
    contextStats.injuriesOk += 1
    const items = extractInjuryItems(data)
    const riskScore = clamp(items.length * 18 + (newsRisk ? 16 : 0) + (disciplineRisk ? 10 : 0), 0, 78)

    return {
      status: items.length > 0 ? `${items.length} 条伤病/出战信息` : 'ESPN 未列出明确伤病',
      riskScore,
      items,
      relatedNews: relatedNews.map((item) => item.title),
      note:
        items.length > 0
          ? items.slice(0, 2).map((item) => `${item.player} ${item.status}`).join('；')
          : newsRisk
            ? disciplineRisk
              ? '新闻出现黄牌/纪律或轮换风险词，需等首发确认。'
              : '新闻出现阵容风险词，需等首发确认。'
            : '公开伤病源未给出明确缺阵，仍需赛前首发核验。',
      sourceUrl: url,
    }
  } catch (error) {
    return {
      status: '伤病接口不可用',
      riskScore: newsRisk ? 42 : 20,
      items: [],
      relatedNews: relatedNews.map((item) => item.title),
      note: `伤病接口失败：${shortError(error)}；按新闻风险词保守处理。`,
      sourceUrl: url,
    }
  }
}

function teamNewsAliases(team) {
  const base = [
    team.name,
    team.zhName,
    team.abbreviation,
    ...(teamNewsAliasMap.get(team.name) ?? []),
    ...(teamNewsAliasMap.get(team.zhName) ?? []),
  ]

  return [...new Set(base.filter(Boolean).map((item) => String(item).toLowerCase()))]
}

function hasNewsRisk(text) {
  return NEWS_RISK_PATTERN.test(String(text ?? ''))
}

function hasMatchNewsRisk(newsItems, homeTeam, awayTeam, limit = 8) {
  const aliases = [...teamNewsAliases(homeTeam), ...teamNewsAliases(awayTeam)]
  return newsItems.slice(0, limit).some((item) => {
    const text = `${item.title} ${item.summary}`.toLowerCase()
    return hasNewsRisk(text) && aliases.some((alias) => alias && text.includes(alias))
  })
}

function contextNewsRisk(context) {
  if (!context) return false
  return Math.max(context.home?.injuries?.riskScore ?? 0, context.away?.injuries?.riskScore ?? 0) > 20
}

function extractInjuryItems(data) {
  const candidates = Array.isArray(data?.injuries)
    ? data.injuries
    : Array.isArray(data?.athletes)
      ? data.athletes
      : Array.isArray(data?.items)
        ? data.items
        : []

  return candidates.slice(0, 5).map((item) => ({
    player: item.athlete?.displayName ?? item.displayName ?? item.name ?? '未命名球员',
    status: item.status ?? item.type ?? item.details ?? '待确认',
    detail: item.details ?? item.description ?? '',
  }))
}

function extractPlayerSignals(competitor) {
  const seen = new Set()
  const signals = []

  for (const group of competitor.leaders ?? []) {
    const label = group.displayName ?? group.name ?? '数据榜'
    if (/leaders/i.test(group.name ?? '') && signals.some((item) => item.label === label)) continue

    for (const leader of (group.leaders ?? []).slice(0, 2)) {
      const key = `${label}-${leader.athlete?.displayName ?? leader.displayName}`
      if (seen.has(key)) continue
      seen.add(key)
      signals.push({
        label,
        player: leader.athlete?.displayName ?? leader.displayName ?? 'Unknown',
        value: leader.displayValue ?? String(leader.value ?? ''),
        position: leader.athlete?.position?.abbreviation ?? '',
      })
    }
  }

  return signals.slice(0, 4)
}

async function fetchWeatherContext(venueName, venueCity, kickoffUtc) {
  contextStats.weatherTried += 1
  const city = venueCity.split(',')[0]?.trim() || venueCity.trim()
  const state = venueCity.split(',')[1]?.trim() ?? ''
  const roofLikely = indoorStadiums.has(venueName)

  if (!city) {
    return {
      status: '缺少场馆城市',
      venueName,
      city: venueCity || '待确认',
      roofLikely,
      temperatureC: null,
      precipitationProbability: null,
      windKph: null,
      humidity: null,
      riskLevel: '中',
      summary: '场馆城市缺失，天气只做赛前人工核验。',
    }
  }

  try {
    const location = await geocodeCity(city, state)
    if (!location) throw new Error(`无法定位 ${venueCity}`)
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,relative_humidity_2m',
      timezone: 'UTC',
      forecast_days: '7',
    })
    const data = await fetchJson(`${WEATHER_URL}?${params}`)
    contextStats.weatherOk += 1
    const hour = pickWeatherHour(data.hourly, kickoffUtc)
    const riskLevel = weatherRiskLevel(hour, roofLikely)
    const summary = weatherSummary(hour, roofLikely)

    return {
      status: '小时预报已读取',
      venueName,
      city: `${location.name}${location.admin1 ? `, ${location.admin1}` : ''}`,
      latitude: location.latitude,
      longitude: location.longitude,
      roofLikely,
      temperatureC: hour?.temperatureC ?? null,
      precipitationProbability: hour?.precipitationProbability ?? null,
      windKph: hour?.windKph ?? null,
      humidity: hour?.humidity ?? null,
      riskLevel,
      summary,
    }
  } catch (error) {
    return {
      status: '天气抓取失败',
      venueName,
      city: venueCity || city,
      roofLikely,
      temperatureC: null,
      precipitationProbability: null,
      windKph: null,
      humidity: null,
      riskLevel: roofLikely ? '低' : '中',
      summary: `天气接口失败：${shortError(error)}；赛前需人工核验。`,
    }
  }
}

async function geocodeCity(city, state) {
  const params = new URLSearchParams({
    name: city,
    count: '5',
    language: 'en',
    format: 'json',
  })
  const data = await fetchJson(`${GEOCODE_URL}?${params}`)
  const results = data.results ?? []
  return (
    results.find((item) => state && item.admin1 && item.admin1.toLowerCase().includes(state.toLowerCase())) ??
    results.find((item) => ['United States', 'Canada', 'Mexico'].includes(item.country)) ??
    results[0] ??
    null
  )
}

function pickWeatherHour(hourly, kickoffUtc) {
  const times = hourly?.time ?? []
  if (times.length === 0) return null
  const target = new Date(kickoffUtc).getTime()
  let bestIndex = 0
  let bestGap = Infinity
  times.forEach((time, index) => {
    const gap = Math.abs(new Date(`${time}Z`).getTime() - target)
    if (gap < bestGap) {
      bestGap = gap
      bestIndex = index
    }
  })

  return {
    time: times[bestIndex],
    temperatureC: hourly.temperature_2m?.[bestIndex] ?? null,
    precipitationProbability: hourly.precipitation_probability?.[bestIndex] ?? null,
    windKph: hourly.wind_speed_10m?.[bestIndex] ?? null,
    humidity: hourly.relative_humidity_2m?.[bestIndex] ?? null,
  }
}

function weatherRiskLevel(hour, roofLikely) {
  if (!hour) return roofLikely ? '低' : '中'
  const heatRisk = (hour.temperatureC ?? 22) >= 31 || (hour.humidity ?? 50) >= 78
  const rainRisk = (hour.precipitationProbability ?? 0) >= 45
  const windRisk = (hour.windKph ?? 0) >= 28
  if (roofLikely) return heatRisk ? '中' : '低'
  if (heatRisk || rainRisk || windRisk) return '高'
  if ((hour.temperatureC ?? 22) >= 28 || (hour.precipitationProbability ?? 0) >= 30) return '中'
  return '低'
}

function weatherSummary(hour, roofLikely) {
  if (!hour) return roofLikely ? '场馆可能有顶棚，天气影响偏低。' : '天气小时预报缺失，赛前人工核验。'
  const parts = [
    `${Math.round(hour.temperatureC ?? 0)}°C`,
    `降水 ${Math.round(hour.precipitationProbability ?? 0)}%`,
    `风 ${Math.round(hour.windKph ?? 0)} km/h`,
    `湿度 ${Math.round(hour.humidity ?? 0)}%`,
  ]
  return `${parts.join('，')}。${roofLikely ? '场馆可能有顶棚，天气权重下调。' : '露天影响按正常权重计入。'}`
}

function buildGeographyContext(homeTeam, awayTeam, weather) {
  const homeProfile = countryProfiles.get(homeTeam.name) ?? countryProfiles.get(homeTeam.zhName)
  const awayProfile = countryProfiles.get(awayTeam.name) ?? countryProfiles.get(awayTeam.zhName)
  const venueLocation = Number.isFinite(weather.latitude) && Number.isFinite(weather.longitude)
    ? { lat: weather.latitude, lon: weather.longitude }
    : null
  const homeDistanceKm = homeProfile && venueLocation ? Math.round(haversineKm(homeProfile, venueLocation)) : null
  const awayDistanceKm = awayProfile && venueLocation ? Math.round(haversineKm(awayProfile, venueLocation)) : null
  const distanceEdgeKm = homeDistanceKm !== null && awayDistanceKm !== null ? awayDistanceKm - homeDistanceKm : 0
  const travelEdge =
    Math.abs(distanceEdgeKm) < 1200
      ? '旅行距离差不大'
      : distanceEdgeKm > 0
        ? `${homeTeam.zhName} 旅行距离少约 ${Math.round(distanceEdgeKm / 100) * 100} km`
        : `${awayTeam.zhName} 旅行距离少约 ${Math.round(Math.abs(distanceEdgeKm) / 100) * 100} km`

  return {
    homeRegion: homeProfile?.region ?? '未知',
    awayRegion: awayProfile?.region ?? '未知',
    homeClimate: homeProfile?.climate ?? '未知',
    awayClimate: awayProfile?.climate ?? '未知',
    homeElement: homeProfile?.element ?? '中',
    awayElement: awayProfile?.element ?? '中',
    homeDistanceKm,
    awayDistanceKm,
    distanceEdgeKm,
    travelEdge,
    summary: `${homeTeam.zhName} 来自${homeProfile?.region ?? '未知地区'}，${awayTeam.zhName} 来自${awayProfile?.region ?? '未知地区'}；${travelEdge}。`,
  }
}

function buildDivinationContext(event, homeTeam, awayTeam, geography) {
  const kickoff = new Date(event.date)
  const seed =
    Number(event.id ?? 0) +
    kickoff.getUTCFullYear() +
    (kickoff.getUTCMonth() + 1) * 13 +
    kickoff.getUTCDate() * 17 +
    kickoff.getUTCHours() * 19 +
    stringScore(homeTeam.name) -
    stringScore(awayTeam.name)
  const trigrams = ['乾', '兑', '离', '震', '巽', '坎', '艮', '坤']
  const trigramElements = ['金', '金', '火', '木', '木', '水', '土', '土']
  const fiveElements = ['木', '火', '土', '金', '水']
  const homeIndex = positiveModulo(seed, 8)
  const awayIndex = positiveModulo(seed * 3 + stringScore(awayTeam.name), 8)
  const dayElement = fiveElements[positiveModulo(kickoff.getUTCDate() + kickoff.getUTCHours(), 5)]
  const homeHarmony = elementHarmony(dayElement, geography.homeElement) + elementHarmony(trigramElements[homeIndex], geography.homeElement)
  const awayHarmony = elementHarmony(dayElement, geography.awayElement) + elementHarmony(trigramElements[awayIndex], geography.awayElement)
  const delta = clamp(homeHarmony - awayHarmony, -3, 3)
  const lean = Math.abs(delta) <= 1 ? 'neutral' : delta > 0 ? 'home' : 'away'

  return {
    method: '梅花易数取数 + 五行方位取象 + 干支时气简化校验',
    homeSymbol: `${trigrams[homeIndex]}(${trigramElements[homeIndex]})`,
    awaySymbol: `${trigrams[awayIndex]}(${trigramElements[awayIndex]})`,
    dayElement,
    lean,
    delta,
    weight: '≤3%，只作文化辅助',
    summary:
      lean === 'neutral'
        ? `取象双方差距很小，不改变主模型。日时五行取 ${dayElement}。`
        : `取象略偏${lean === 'home' ? homeTeam.zhName : awayTeam.zhName}，只作为低权重校验；日时五行取 ${dayElement}。`,
  }
}

function buildContextAdjustment(homeContext, awayContext, weather, geography, divination) {
  const formEdge = homeContext.formScore - awayContext.formScore
  const injuryEdge = awayContext.injuries.riskScore - homeContext.injuries.riskScore
  const travelEdge = clamp((geography.distanceEdgeKm ?? 0) / 4500, -0.9, 0.9)
  const divinationEdge = divination.lean === 'home' ? divination.delta * 0.25 : divination.lean === 'away' ? divination.delta * 0.25 : 0
  const weatherRisk = weather.riskLevel === '高' ? 8 : weather.riskLevel === '中' ? 4 : 0
  const formReliability = Math.min(homeContext.sampleSize, awayContext.sampleSize) >= 3 ? 1 : 0.55
  const weatherTempoDrag =
    (weather.riskLevel === '高' ? 0.14 : weather.riskLevel === '中' ? 0.06 : 0) +
    ((weather.precipitationProbability ?? 0) >= 35 ? 0.08 : 0) +
    ((weather.humidity ?? 0) >= 80 && weather.riskLevel === '高' ? 0.06 : 0) +
    ((weather.windKph ?? 0) >= 24 ? 0.05 : 0)
  const homeGoalDiffDelta = clamp(round(formEdge * 0.012 * formReliability + injuryEdge * 0.006 + travelEdge * 0.08 + divinationEdge * 0.03, 2), -0.34, 0.34)
  const totalGoalsDelta = clamp(
    round(
      ((homeContext.goalsForAvg ?? 1.2) + (awayContext.goalsForAvg ?? 1.2) - 2.6) * 0.09 - weatherTempoDrag,
      2,
    ),
    -0.34,
    0.24,
  )
  const confidenceDelta = clamp(Math.round(Math.abs(formEdge) * 0.08 * formReliability - weatherRisk * 0.35 - Math.max(homeContext.injuries.riskScore, awayContext.injuries.riskScore) * 0.04), -8, 7)
  const riskDelta = clamp(Math.round(weatherRisk + Math.max(homeContext.injuries.riskScore, awayContext.injuries.riskScore) * 0.08 + (formReliability < 1 ? 3 : 0)), 0, 16)

  return {
    homeGoalDiffDelta,
    totalGoalsDelta,
    confidenceDelta,
    riskDelta,
    notes: [
      `近况差修正 ${homeGoalDiffDelta > 0 ? '+' : ''}${homeGoalDiffDelta} 球。`,
      `天气/节奏修正 ${totalGoalsDelta > 0 ? '+' : ''}${totalGoalsDelta} 总进球。`,
      `伤病与天气风险使风险指数 ${riskDelta > 0 ? '+' : ''}${riskDelta}。`,
      `古法取象 ${divination.weight}：${divination.summary}`,
    ],
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

function buildScorelineAnalysis(market, homeTeam, awayTeam, judgement, newsItems, context = null) {
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
  const baseTotalExpectedGoals = estimateTotalGoals(market)
  const favoriteSide = homeProbability >= awayProbability ? 'home' : 'away'
  const spreadSignal = favoriteSpreadSignal(market, favoriteSide)
  const totalSignal = totalMarketSignal(market)
  const stalemateSignal = favoriteStalemateSignal(homeProbability, awayProbability, drawProbability, context)
  const totalExpectedGoals = clamp(
    round(calibrateTotalGoals(baseTotalExpectedGoals, homeProbability, awayProbability, drawProbability, market) + (context?.adjustment?.totalGoalsDelta ?? 0), 2),
    1.55,
    4.65,
  )
  const drawCompression = drawCompressionSignal(homeProbability, awayProbability, drawProbability, totalExpectedGoals, market)
  const rawGoalDiff =
    calibrateGoalDifference(
      estimateGoalDifference(homeProbability, awayProbability, drawProbability, market),
      homeProbability,
      awayProbability,
      drawProbability
    ) + (context?.adjustment?.homeGoalDiffDelta ?? 0)
  const goalDiff = calibrateHomeUnderdogGoalShare(
    rawGoalDiff,
    homeProbability,
    awayProbability,
    drawProbability,
    totalExpectedGoals,
    context,
    market
  )
  const goalShareAdjustment = round(goalDiff - rawGoalDiff, 2)
  const homeExpectedGoals = clamp(round((totalExpectedGoals + goalDiff) / 2, 2), 0.18, 4.8)
  const awayExpectedGoals = clamp(round(totalExpectedGoals - homeExpectedGoals, 2), 0.18, 4.8)
  const newsRisk = hasMatchNewsRisk(newsItems, homeTeam, awayTeam) || contextNewsRisk(context)
  const uncertainty = uncertaintyMultiplier(judgement.risk, newsRisk)

  const rawScores = []
  for (let homeGoals = 0; homeGoals <= 6; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 6; awayGoals += 1) {
      const baseProbability = poisson(homeGoals, homeExpectedGoals) * poisson(awayGoals, awayExpectedGoals)
      const tailMultiplier = scoreTailMultiplier(
        homeGoals,
        awayGoals,
        totalExpectedGoals,
        resultProbabilities,
        judgement,
        context,
        market
      )

      rawScores.push({
        homeGoals,
        awayGoals,
        score: `${homeGoals}-${awayGoals}`,
        result: scoreResult(homeGoals, awayGoals),
        baseProbability,
        tailMultiplier,
        weightedProbability: baseProbability * tailMultiplier,
      })
    }
  }

  const baseMass = rawScores.reduce((sum, item) => sum + item.baseProbability, 0)
  const weightedMass = rawScores.reduce((sum, item) => sum + item.weightedProbability, 0) || 1
  const allScores = rawScores
    .map((item) => {
      const probability = (item.weightedProbability / weightedMass) * baseMass
      const fairOdds = probability > 0 ? 1 / probability : null
      if (!fairOdds) return null

      return {
        score: item.score,
        result: item.result,
        probability: round(probability, 4),
        baseProbability: round(item.baseProbability, 4),
        tailMultiplier: round(item.tailMultiplier, 2),
        fairOdds: round(fairOdds, 2),
        suggestedMinOdds: round(fairOdds * uncertainty, 2),
        officialOdds: null,
        expectedValue: null,
        expectedValueAtSuggestedOdds: round(probability * fairOdds * uncertainty - 1, 3),
        grade: '备选',
        reason: scoreReason(
          item.homeGoals,
          item.awayGoals,
          homeTeam,
          awayTeam,
          resultProbabilities,
          totalExpectedGoals,
          judgement,
          item.tailMultiplier,
          context,
          market
        ),
      }
    })
    .filter(Boolean)

  const resultStrength = {
    主胜: homeProbability,
    平局: drawProbability,
    客胜: awayProbability,
  }
  const candidates = allScores
    .filter((item) => item.probability >= 0.018)
    .sort(
      (left, right) =>
        scoreCandidateRank(right, resultStrength, context, totalExpectedGoals, market) -
        scoreCandidateRank(left, resultStrength, context, totalExpectedGoals, market),
    )
    .slice(0, 9)
    .map((item, index) => ({
      ...item,
      grade: index === 0 ? '首选核验' : '备选',
    }))

  const avoid = allScores
    .filter((item) => item.probability < 0.014 && item.fairOdds > 70)
    .sort((left, right) => left.probability - right.probability)
    .slice(0, 3)
    .map((item) => ({
      ...item,
      grade: '回避',
      reason: '概率过低，除非官方赔率极端偏高，否则不适合作为主要比分方向。',
    }))

  return {
    model: '胜平负去水概率 + 大小球盘口 + 平局压缩/抗热门校准 + Poisson 比分分布',
    homeExpectedGoals,
    awayExpectedGoals,
    totalExpectedGoals,
    resultProbabilities,
    bestPick: candidates[0] ?? null,
    candidates,
    avoid,
    notes: [
      '比分玩法方差很大，候选只适合小额娱乐或赛前核验。',
      `本版把总进球从基础 ${baseTotalExpectedGoals.toFixed(2)} 校准到 ${totalExpectedGoals.toFixed(2)}，并对强弱分明场景的 3+ 进球比分做尾部上调。`,
      ...(Math.abs(goalShareAdjustment) >= 0.01
        ? [
            `复盘校准：保留总进球 ${totalExpectedGoals.toFixed(2)} 不变，仅把主场弱势方的一球贡献修正 ${goalShareAdjustment > 0 ? '+' : ''}${goalShareAdjustment}。`,
          ]
        : []),
      ...(totalSignal.line <= 2.5 && totalSignal.underProbability >= 0.55
        ? ['复盘校准：大小球盘口偏小，降低 3+ 进球扩张，优先保留 1-0 / 2-0 / 1-1。']
        : []),
      ...(spreadSignal.favoriteCoverProbability !== null && spreadSignal.favoriteCoverProbability < 0.46
        ? ['复盘校准：让球盘口不支持热门穿盘，比分排序优先保留一球小胜路径。']
        : []),
      ...(spreadSignal.favoriteCoverProbability !== null && spreadSignal.favoriteCoverProbability < 0.44
        ? ['复盘校准：热门让球穿盘信号过弱，降低三球以上大胜，优先核验两球或一球胜。']
        : []),
      ...(drawCompression >= 3
        ? ['复盘校准：平局赔率热且总进球偏低，0-0 / 1-1 不再只是防守票，而是进入主判断层。']
        : drawCompression >= 1
          ? ['复盘校准：平局噪音偏高，主胜/客胜比分需要用平局比分对冲。']
          : []),
      ...(stalemateSignal >= 3
        ? ['复盘校准：高湿/降水环境下增加 0-0、1-0 等闷局防守权重。']
        : []),
      ...(context?.adjustment?.notes?.slice(0, 2) ?? []),
      'expectedValue 只有抓到中国体彩官方比分赔率后才会填充；当前显示的是盈亏平衡与建议最低赔率。',
      newsRisk ? '最新新闻触发阵容/纪律风险词，建议等首发和官方停售前赔率。' : '最新新闻未触发高风险词，但仍需赛前核验首发。',
    ],
  }
}

function buildProfessionalBrief(market, homeTeam, awayTeam, judgement, scoreline, newsItems, context = null) {
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
  const marketLeader = [...resultProbabilities].sort((left, right) => right.probability - left.probability)[0]
  const bestScore = scoreline.bestPick
  const resultSide = bestScore.result === '主胜' ? 'home' : bestScore.result === '客胜' ? 'away' : 'draw'
  const resultDirection = resultProbabilities.find((item) => item.side === resultSide) ?? marketLeader
  const directionFairOdds = resultDirection?.probability ? 1 / resultDirection.probability : null
  const directionSuggestedMinOdds = directionFairOdds ? round(directionFairOdds * (1.04 + judgement.risk / 900), 2) : null
  const scoreConcentration = bestScore.probability * 100
  const overheatPenalty = judgement.tier === '避免追高' ? 8 : 0
  const contextConfidence = context?.adjustment?.confidenceDelta ?? 0
  const contextRisk = context?.adjustment?.riskDelta ?? 0
  const rankScore = clamp(
    Math.round(judgement.confidence * 0.52 + (100 - judgement.risk) * 0.24 + scoreConcentration * 1.15 - overheatPenalty + contextConfidence - contextRisk * 0.4),
    20,
    91,
  )
  const grade = professionalGrade(rankScore, judgement)
  const totalBand = totalGoalsBand(scoreline.totalExpectedGoals)
  const winnerSide = resultDirection?.side === 'home' ? '主胜' : resultDirection?.side === 'away' ? '客胜' : '平局'
  const favoriteName = resultDirection?.label ?? '市场主方向'
  const newsRisk = hasMatchNewsRisk(newsItems, homeTeam, awayTeam) || contextNewsRisk(context)

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
    selection: winnerSide === '平局' ? '平局' : `${favoriteName} ${winnerSide}`,
    priority: judgement.tier === '避免追高' ? '防守' : '备选',
    confidence: clamp(Math.round((resultDirection?.probability ?? 0.33) * 100), 35, 88),
    budgetShare: judgement.tier === '避免追高' ? '仅核验，不主动追' : '单场预算 8%-15%',
    minOdds: directionSuggestedMinOdds ? `≥ ${directionSuggestedMinOdds.toFixed(2)}` : '等待官方赔率',
    expectedValueNote: directionSuggestedMinOdds
      ? `去水概率 ${formatPct(resultDirection.probability)}，低于建议赔率时性价比不足。`
      : '缺少可计算赔率门槛。',
    reason:
      winnerSide === '平局'
        ? '比分主方案已经转向平局，胜平负也应以平局核验，不再硬跟市场热门。'
        : judgement.tier === '避免追高'
          ? `${favoriteName} 胜面很高，但胜平负通常容易被压低，重点看官方赔率是否还有补偿。`
          : `${favoriteName} 是当前比分推导方向，可作为比分玩法之外的低方差核验项。`,
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
  const riskControls = buildRiskControls(market, judgement, scoreline, marketLeader, context)
  const deepThinking = buildDeepThinkingPlan({
    grade,
    expertAnswer,
    plays,
    scenarios,
    riskControls,
    judgement,
    scoreline,
    newsItems,
    context,
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
        label: '当前方向',
        score: Math.round((resultDirection?.probability ?? 0) * 100),
        tone: (resultDirection?.probability ?? 0) > 0.76 ? 'watch' : 'good',
        evidence: `${favoriteName} 去水后约 ${formatPct(resultDirection?.probability ?? 0)}，当前判断为 ${winnerSide} 主方向。`,
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
        score: context ? Math.max(context.home.injuries.riskScore, context.away.injuries.riskScore, newsRisk ? 62 : 42) : newsRisk ? 62 : 42,
        tone: newsRisk || (context && Math.max(context.home.injuries.riskScore, context.away.injuries.riskScore) > 35) ? 'watch' : 'good',
        evidence: context
          ? `${homeTeam.zhName}: ${context.home.injuries.note} ${awayTeam.zhName}: ${context.away.injuries.note}`
          : newsRisk
            ? '新闻中出现阵容/纪律风险词，需等首发。'
            : '最新新闻未触发高风险词，常规核验即可。',
      },
      ...(context
        ? [
            {
              label: '近5场与球员',
              score: Math.round((context.home.formScore + context.away.formScore) / 2),
              tone: Math.abs(context.home.formScore - context.away.formScore) > 16 ? 'good' : 'watch',
              evidence: `${homeTeam.zhName} ${context.home.trendNote} ${awayTeam.zhName} ${context.away.trendNote}`,
            },
            {
              label: '天气/地理',
              score: context.weather.riskLevel === '高' ? 70 : context.weather.riskLevel === '中' ? 52 : 35,
              tone: context.weather.riskLevel === '高' ? 'bad' : context.weather.riskLevel === '中' ? 'watch' : 'good',
              evidence: `${context.weather.summary} ${context.geography.summary}`,
            },
            {
              label: '古法占卜低权重',
              score: Math.round(50 + context.divination.delta * 8),
              tone: 'watch',
              evidence: `${context.divination.homeSymbol} vs ${context.divination.awaySymbol}；${context.divination.summary}`,
            },
          ]
        : []),
    ],
    riskControls,
    checklist: [
      `中国体彩比分 ${scorePlay.selection} 官方赔率是否 ${scorePlay.minOdds}`,
      `胜平负 ${resultPlay.selection} 是否达到 ${resultPlay.minOdds}`,
      context ? `近5场实况是否仍支持：${context.home.formString || homeTeam.form || '暂无'} vs ${context.away.formString || awayTeam.form || '暂无'}` : '补充近5场走势',
      context ? `天气地理是否冲突：${context.weather.summary}` : '补充天气和旅行距离',
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

function buildDeepThinkingPlan({ grade, expertAnswer, plays, scenarios, riskControls, judgement, scoreline, newsItems, context }) {
  const scorePlay = plays.find((play) => play.playType === '比分' && play.priority === '主方案') ?? plays[0]
  const resultPlay = plays.find((play) => play.playType === '胜平负')
  const totalPlay = plays.find((play) => play.playType === '总进球')
  const hedgePlay = plays.find((play) => play.priority === '防守')
  const hotRisk = riskControls.find((risk) => risk.label === '赔率压缩')
  const scoreRisk = riskControls.find((risk) => risk.label === '比分方差')
  const newsRisk = contextNewsRisk(context)
  const confidenceScore = clamp(
    Math.round(
      judgement.confidence * 0.46 +
        (100 - judgement.risk) * 0.24 +
        (scoreline.bestPick?.probability ?? 0) * 180 +
        (grade === '重点核验' ? 8 : grade === '小额分散' ? 3 : grade === '只核验不追高' ? -6 : -14) -
        (newsRisk ? 5 : 0) +
        (context?.adjustment?.confidenceDelta ?? 0) -
        (context?.adjustment?.riskDelta ?? 0) * 0.4,
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
      context
        ? `近5场：${context.home.trendNote}；${context.away.trendNote}`
        : '近5场数据暂未接入。',
      context
        ? `天气/地理：${context.weather.summary} ${context.geography.travelEdge}`
        : '天气和地理信息待核验。',
      context
        ? `古法低权重校验：${context.divination.summary}`
        : '古法校验未参与本次评分。',
      `主要风险：${hotRisk?.label ?? '赔率'}为${hotRisk?.level ?? '中'}，${scoreRisk?.label ?? '比分方差'}为${scoreRisk?.level ?? '中'}。`,
      scenarios[0] ? `基准剧本：${scenarios[0].scorePath}` : '等待更多情景数据。',
    ].slice(0, 6),
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

function buildRiskControls(market, judgement, scoreline, favorite, context = null) {
  const favoriteMarket = market.moneyline.find((item) => item.side === favorite?.side)
  const favoriteMove = Math.abs(favoriteMarket?.movement ?? 0)
  const bestScoreProbability = scoreline.bestPick?.probability ?? 0
  const topTwoGap = (scoreline.candidates[0]?.probability ?? 0) - (scoreline.candidates[1]?.probability ?? 0)

  const controls = [
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

  if (context) {
    controls.push(
      {
        label: '天气地理',
        level: context.weather.riskLevel,
        detail: `${context.weather.summary} ${context.geography.summary}`,
      },
      {
        label: '伤病首发',
        level: Math.max(context.home.injuries.riskScore, context.away.injuries.riskScore) > 45 ? '高' : Math.max(context.home.injuries.riskScore, context.away.injuries.riskScore) > 24 ? '中' : '低',
        detail: `${context.home.injuries.note} ${context.away.injuries.note}`,
      },
      {
        label: '占卜只作校验',
        level: '低',
        detail: `${context.divination.method}，权重 ${context.divination.weight}；若与盘口相反，只用于提醒不要加码。`,
      },
    )
  }

  return controls
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
  const { line, overProbability } = totalMarketSignal(market)
  const baseMean = invertPoissonOverLine(overProbability, line)
  return round(clamp(baseMean, 1.65, 4.15), 2)
}

function totalMarketSignal(market) {
  const over = market.total.find((item) => item.side === 'over')
  const under = market.total.find((item) => item.side === 'under')
  const line = parseFloat(String(over?.line ?? under?.line ?? '2.5').replace(/[ou]/gi, '')) || 2.5
  const overRaw = over?.impliedProbability ?? null
  const underRaw = under?.impliedProbability ?? null
  const overProbability = overRaw !== null && underRaw !== null ? overRaw / (overRaw + underRaw) : 0.5
  const underProbability = overRaw !== null && underRaw !== null ? underRaw / (overRaw + underRaw) : 0.5

  return { line, overProbability, underProbability }
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

function calibrateTotalGoals(baseMean, homeProbability, awayProbability, drawProbability, market) {
  const { line, overProbability, underProbability } = totalMarketSignal(market)
  const favoriteProbability = Math.max(homeProbability, awayProbability)
  const winGap = Math.abs(homeProbability - awayProbability)
  const favoriteSide = homeProbability >= awayProbability ? 'home' : 'away'
  const spreadSignal = favoriteSpreadSignal(market, favoriteSide)
  let boost = 0

  if (baseMean >= 2.65) boost += 0.08
  if (baseMean >= 2.95) boost += 0.1
  if (favoriteProbability >= 0.58) boost += 0.08
  if (favoriteProbability >= 0.68) boost += 0.12
  if (winGap >= 0.32) boost += 0.06
  if (drawProbability <= 0.22) boost += 0.05
  if (overProbability >= 0.56) boost += 0.06
  if (line >= 3) boost += 0.08
  if (line >= 3.5 && favoriteProbability >= 0.8) boost += 0.08
  if (line <= 2.5 && underProbability >= 0.55) boost -= 0.12
  if (line <= 2.5 && underProbability >= 0.58) boost -= 0.06
  if (spreadSignal.favoriteCoverProbability !== null && spreadSignal.favoriteCoverProbability < 0.46 && favoriteProbability < 0.72) boost -= 0.12
  if (spreadSignal.favoriteCoverProbability !== null && spreadSignal.favoriteCoverProbability < 0.43) boost -= 0.08

  return round(clamp(baseMean + boost, 1.7, 4.55), 2)
}

function favoriteSpreadSignal(market, favoriteSide) {
  const favoriteSpread = market.spread.find((item) => item.side === (favoriteSide === 'home' ? 'spreadHome' : 'spreadAway'))
  const underdogSpread = market.spread.find((item) => item.side === (favoriteSide === 'home' ? 'spreadAway' : 'spreadHome'))
  const favoriteRaw = favoriteSpread?.impliedProbability ?? null
  const underdogRaw = underdogSpread?.impliedProbability ?? null
  const favoriteCoverProbability =
    favoriteRaw !== null && underdogRaw !== null ? favoriteRaw / (favoriteRaw + underdogRaw) : null
  const favoriteSpreadLine = parseFloat(String(favoriteSpread?.line ?? '0').replace(/[^\d.-]/g, '')) || 0

  return {
    favoriteCoverProbability: favoriteCoverProbability === null ? null : round(favoriteCoverProbability, 4),
    favoriteSpreadLine,
  }
}

function favoriteStalemateSignal(homeProbability, awayProbability, drawProbability, context) {
  const favoriteProbability = Math.max(homeProbability, awayProbability)
  if (!context || favoriteProbability < 0.72) return 0

  const favoriteContext = homeProbability >= awayProbability ? context.home : context.away
  const underdogContext = homeProbability >= awayProbability ? context.away : context.home
  const weather = context.weather ?? {}
  let signal = 0

  if (weather.riskLevel === '高') signal += 1
  if ((weather.precipitationProbability ?? 0) >= 35) signal += 1
  if ((weather.humidity ?? 0) >= 80) signal += 1
  if (drawProbability >= 0.12) signal += 1
  if ((underdogContext?.goalsForAvg ?? 1.2) <= 0.8) signal += 1
  if ((favoriteContext?.goalsAgainstAvg ?? 1.2) <= 0.4) signal += 1

  return signal
}

function calibrateGoalDifference(baseDiff, homeProbability, awayProbability, drawProbability) {
  const favoriteProbability = Math.max(homeProbability, awayProbability)
  const winGap = Math.abs(homeProbability - awayProbability)
  const direction = homeProbability >= awayProbability ? 1 : -1
  let calibratedDiff = baseDiff

  if (favoriteProbability >= 0.62) calibratedDiff += direction * 0.1
  if (favoriteProbability >= 0.72) calibratedDiff += direction * 0.12
  if (winGap >= 0.38) calibratedDiff += direction * 0.08
  if (drawProbability <= 0.21) calibratedDiff += direction * 0.05

  return clamp(round(calibratedDiff, 2), -2.85, 2.85)
}

function calibrateHomeUnderdogGoalShare(
  goalDiff,
  homeProbability,
  awayProbability,
  drawProbability,
  totalExpectedGoals,
  context,
  market = null,
) {
  const favoriteProbability = Math.max(homeProbability, awayProbability)
  const homeIsUnderdog = homeProbability < awayProbability

  if (
    !context ||
    !homeIsUnderdog ||
    totalExpectedGoals < 2.55 ||
    favoriteProbability < 0.55 ||
    favoriteProbability > 0.7
  ) {
    return clamp(round(goalDiff, 2), -2.85, 2.85)
  }

  const homeGoalsFor = context.home?.goalsForAvg ?? 0
  const homeGoalsAgainst = context.home?.goalsAgainstAvg ?? 1.2
  const homeDraws = countFormResult(context.home?.formString, 'D')
  const awayGoalsAgainst = context.away?.goalsAgainstAvg ?? 0
  const spreadSignal = market ? favoriteSpreadSignal(market, 'away') : null
  let pull = 0

  if (homeGoalsFor >= 0.95) pull += 0.14
  if (homeGoalsFor >= 1.25) pull += 0.12
  if (homeGoalsAgainst <= 0.55) pull += 0.1
  if (homeGoalsAgainst <= 0.2) pull += 0.05
  if (drawProbability >= 0.2) pull += 0.06
  if (homeDraws >= 2) pull += 0.04
  if (awayGoalsAgainst >= 0.35) pull += 0.04
  if (spreadSignal?.favoriteCoverProbability !== null && spreadSignal?.favoriteCoverProbability < 0.44) pull += 0.12
  if (context.home?.formScore >= (context.away?.formScore ?? 50) - 10) pull += 0.06
  if ((context.home?.sampleSize ?? 0) < 3 || (context.away?.sampleSize ?? 0) < 3) pull *= 0.65

  return clamp(round(goalDiff + clamp(round(pull, 2), 0, 0.58), 2), -2.85, 2.85)
}

function countFormResult(formString, result) {
  return String(formString ?? '')
    .split('')
    .filter((letter) => letter === result).length
}

function homeUnderdogConsolationSignal(homeGoals, awayGoals, homeWin, awayWin, draw, totalExpectedGoals, context) {
  const favoriteProbability = Math.max(homeWin, awayWin)

  if (
    !context ||
    homeWin >= awayWin ||
    awayWin < 0.55 ||
    favoriteProbability > 0.7 ||
    totalExpectedGoals < 2.55
  ) {
    return 0
  }

  const homeGoalsFor = context.home?.goalsForAvg ?? 0
  const homeDraws = countFormResult(context.home?.formString, 'D')
  const awayGoalsAgainst = context.away?.goalsAgainstAvg ?? 0
  let signal = 0

  if (homeGoalsFor >= 0.95) signal += 1
  if (homeGoalsFor >= 1.25) signal += 1
  if (draw >= 0.2) signal += 1
  if (homeDraws >= 2) signal += 1
  if (awayGoalsAgainst >= 0.35) signal += 1

  if (homeGoals === 1 && awayGoals > homeGoals) return signal
  if (homeGoals === 0 && awayGoals >= 2) return -signal
  return 0
}

function drawCompressionSignal(homeProbability, awayProbability, drawProbability, totalExpectedGoals, market) {
  const favoriteSide = homeProbability >= awayProbability ? 'home' : 'away'
  const spreadSignal = market ? favoriteSpreadSignal(market, favoriteSide) : { favoriteCoverProbability: null }
  let signal = 0

  if (drawProbability >= 0.27) signal += 1
  if (drawProbability >= 0.34) signal += 2
  if (drawProbability >= Math.max(homeProbability, awayProbability) + 0.04) signal += 1
  if (totalExpectedGoals <= 2.15) signal += 1
  if (totalExpectedGoals <= 2.0) signal += 1
  if (Math.abs(homeProbability - awayProbability) <= 0.18) signal += 1
  if (spreadSignal.favoriteCoverProbability !== null && spreadSignal.favoriteCoverProbability < 0.46) signal += 1

  return signal
}

function resilientHomeUnderdogSignal(
  homeGoals,
  awayGoals,
  homeWin,
  awayWin,
  draw,
  totalExpectedGoals,
  context,
  market,
) {
  if (!context || homeWin >= awayWin || awayWin < 0.5 || awayWin > 0.68 || totalExpectedGoals < 2.35) return 0

  const spreadSignal = market ? favoriteSpreadSignal(market, 'away') : { favoriteCoverProbability: null }
  const homeGoalsFor = context.home?.goalsForAvg ?? 0
  const homeGoalsAgainst = context.home?.goalsAgainstAvg ?? 1.2
  const awayGoalsAgainst = context.away?.goalsAgainstAvg ?? 1.2
  let signal = 0

  if (spreadSignal.favoriteCoverProbability !== null && spreadSignal.favoriteCoverProbability < 0.46) signal += 1
  if (spreadSignal.favoriteCoverProbability !== null && spreadSignal.favoriteCoverProbability < 0.42) signal += 1
  if (homeGoalsFor >= 1.1) signal += 1
  if (homeGoalsAgainst <= 0.55) signal += 1
  if (awayGoalsAgainst >= 0.45) signal += 1
  if (draw >= 0.18) signal += 1
  if ((context.home?.formScore ?? 50) >= (context.away?.formScore ?? 50) - 10) signal += 1
  if ((context.away?.injuries?.riskScore ?? 0) > (context.home?.injuries?.riskScore ?? 0) + 10) signal += 1

  if (homeGoals > awayGoals) return signal
  if (homeGoals === awayGoals) return Math.max(0, signal - 1)
  if (awayGoals - homeGoals === 1) return -Math.min(3, signal)
  if (homeGoals === 0 && awayGoals >= 2) return -signal
  return 0
}

function strongUnderdogConsolationSignal(homeGoals, awayGoals, homeWin, awayWin, totalExpectedGoals, context) {
  const favoriteProbability = Math.max(homeWin, awayWin)
  const homeIsUnderdog = homeWin < awayWin

  if (!context || !homeIsUnderdog || favoriteProbability < 0.72 || totalExpectedGoals < 2.7) return 0

  const underdogGoalsFor = context.home?.goalsForAvg ?? 0
  const favoriteGoalsAgainst = context.away?.goalsAgainstAvg ?? 1.2
  const weather = context.weather ?? {}
  let signal = 0

  if (underdogGoalsFor >= 1.5) signal += 1
  if (favoriteGoalsAgainst >= 0.45) signal += 1
  if (weather.riskLevel === '高' || (weather.humidity ?? 0) >= 80 || (weather.precipitationProbability ?? 0) >= 30) signal += 1

  if (homeGoals === 1 && awayGoals > homeGoals) return signal
  if (homeGoals === 0 && awayGoals >= 2) return -signal
  return 0
}

function scoreTailMultiplier(homeGoals, awayGoals, totalExpectedGoals, resultProbabilities, judgement, context = null, market = null) {
  const result = scoreResult(homeGoals, awayGoals)
  const homeWin = resultProbabilities.find((item) => item.side === 'home')?.probability ?? 0
  const awayWin = resultProbabilities.find((item) => item.side === 'away')?.probability ?? 0
  const draw = resultProbabilities.find((item) => item.side === 'draw')?.probability ?? 0
  const favoriteSide = homeWin >= awayWin ? 'home' : 'away'
  const favoriteResult = favoriteSide === 'home' ? '主胜' : '客胜'
  const favoriteProbability = Math.max(homeWin, awayWin)
  const spreadSignal = market ? favoriteSpreadSignal(market, favoriteSide) : { favoriteCoverProbability: null }
  const stalemateSignal = favoriteStalemateSignal(homeWin, awayWin, draw, context)
  const drawCompression = drawCompressionSignal(homeWin, awayWin, draw, totalExpectedGoals, market)
  const favoriteGoals = favoriteSide === 'home' ? homeGoals : awayGoals
  const underdogGoals = favoriteSide === 'home' ? awayGoals : homeGoals
  const favoriteMargin = favoriteGoals - underdogGoals
  const totalGoals = homeGoals + awayGoals
  let multiplier = 1

  if (totalExpectedGoals >= 2.75 && totalGoals >= 3) multiplier += 0.08
  if (totalExpectedGoals >= 3.05 && totalGoals >= 4) multiplier += 0.1
  if (favoriteProbability >= 0.58 && result === favoriteResult && favoriteMargin >= 2) multiplier += 0.12
  if (favoriteProbability >= 0.68 && result === favoriteResult && favoriteGoals >= 3 && favoriteMargin >= 2) multiplier += 0.15
  if (favoriteProbability >= 0.75 && result === favoriteResult && favoriteGoals >= 4) multiplier += 0.12
  if (draw <= 0.23 && result === '平局' && totalGoals <= 2) multiplier -= 0.08
  if (totalExpectedGoals >= 2.85 && totalGoals <= 1) multiplier -= 0.1
  if (favoriteProbability >= 0.64 && result !== favoriteResult && result !== '平局' && Math.abs(homeGoals - awayGoals) >= 2) {
    multiplier -= 0.16
  }
  if (judgement.tier === '避免追高' && favoriteProbability >= 0.65 && result === favoriteResult && favoriteGoals >= 3) {
    multiplier -= 0.04
  }
  if (spreadSignal.favoriteCoverProbability !== null && spreadSignal.favoriteCoverProbability < 0.46 && result === favoriteResult) {
    if (favoriteMargin === 1) multiplier += underdogGoals === 0 ? 0.16 : 0.1
    if (favoriteMargin >= 2 && favoriteProbability < 0.72) multiplier -= 0.14
    if (totalGoals >= 3 && favoriteProbability < 0.72) multiplier -= 0.08
  }
  if (spreadSignal.favoriteCoverProbability !== null && spreadSignal.favoriteCoverProbability < 0.44 && result === favoriteResult) {
    if (favoriteMargin === 2) multiplier += 0.1
    if (favoriteMargin >= 3) multiplier -= 0.16
  }
  if (drawCompression >= 3) {
    if (result === '平局' && totalGoals === 0) multiplier += Math.min(0.42, drawCompression * 0.07)
    if (result === '平局' && totalGoals === 2) multiplier += Math.min(0.22, drawCompression * 0.04)
    if (result !== '平局' && totalGoals <= 2 && favoriteProbability < 0.48) multiplier -= Math.min(0.2, drawCompression * 0.035)
  } else if (drawCompression >= 1 && result === '平局' && totalGoals === 2) {
    multiplier += 0.08
  }
  if (stalemateSignal >= 3) {
    if (result === '平局' && totalGoals === 0) multiplier += Math.min(0.28, stalemateSignal * 0.05)
    if (totalGoals <= 1) multiplier += Math.min(0.16, stalemateSignal * 0.03)
    if (result === favoriteResult && totalGoals >= 3) multiplier -= Math.min(0.14, stalemateSignal * 0.025)
  }

  const consolationSignal = homeUnderdogConsolationSignal(
    homeGoals,
    awayGoals,
    homeWin,
    awayWin,
    draw,
    totalExpectedGoals,
    context,
  )
  if (consolationSignal > 0) multiplier += Math.min(0.18, consolationSignal * 0.05)
  if (consolationSignal < 0) multiplier -= Math.min(0.12, Math.abs(consolationSignal) * 0.03)

  const resilientSignal = resilientHomeUnderdogSignal(
    homeGoals,
    awayGoals,
    homeWin,
    awayWin,
    draw,
    totalExpectedGoals,
    context,
    market,
  )
  if (resilientSignal > 0) multiplier += Math.min(0.28, resilientSignal * 0.055)
  if (resilientSignal < 0) multiplier -= Math.min(0.2, Math.abs(resilientSignal) * 0.04)

  const strongConsolationSignal = strongUnderdogConsolationSignal(
    homeGoals,
    awayGoals,
    homeWin,
    awayWin,
    totalExpectedGoals,
    context,
  )
  if (strongConsolationSignal > 0) multiplier += Math.min(0.2, strongConsolationSignal * 0.06)
  if (strongConsolationSignal < 0) multiplier -= Math.min(0.14, Math.abs(strongConsolationSignal) * 0.04)

  return clamp(round(multiplier, 2), 0.72, 1.55)
}

function uncertaintyMultiplier(risk, newsRisk) {
  return round(1.06 + risk / 500 + (newsRisk ? 0.04 : 0), 2)
}

function scoreCandidateRank(item, resultStrength, context = null, totalExpectedGoals = null, market = null) {
  const resultWeight = 0.85 + (resultStrength[item.result] ?? 0.25)
  const [homeGoals, awayGoals] = item.score.split('-').map(Number)
  const totalGoals = homeGoals + awayGoals
  const margin = Math.abs(homeGoals - awayGoals)
  const highScoreLift = totalGoals >= 3 ? 1.06 : 1
  const marginLift = margin >= 2 ? 1.04 : 1
  const tailLift = item.tailMultiplier > 1 ? 1 + (item.tailMultiplier - 1) * 0.22 : 1
  const homeWinStrength = resultStrength[scoreResult(1, 0)] ?? 0
  const drawStrength = resultStrength[scoreResult(0, 0)] ?? 0
  const awayWinStrength = resultStrength[scoreResult(0, 1)] ?? 0
  const favoriteSide = homeWinStrength >= awayWinStrength ? 'home' : 'away'
  const favoriteResult = favoriteSide === 'home' ? scoreResult(1, 0) : scoreResult(0, 1)
  const favoriteGoals = favoriteSide === 'home' ? homeGoals : awayGoals
  const underdogGoals = favoriteSide === 'home' ? awayGoals : homeGoals
  const favoriteMargin = favoriteGoals - underdogGoals
  const favoriteProbability = Math.max(homeWinStrength, awayWinStrength)
  const spreadSignal = market ? favoriteSpreadSignal(market, favoriteSide) : { favoriteCoverProbability: null }
  const stalemateSignal = favoriteStalemateSignal(homeWinStrength, awayWinStrength, drawStrength, context)
  const drawCompression = drawCompressionSignal(homeWinStrength, awayWinStrength, drawStrength, totalExpectedGoals ?? totalGoals, market)
  const consolationSignal = homeUnderdogConsolationSignal(
    homeGoals,
    awayGoals,
    homeWinStrength,
    awayWinStrength,
    drawStrength,
    totalExpectedGoals ?? totalGoals,
    context
  )
  const consolationLift =
    consolationSignal > 0
      ? 1 + Math.min(0.16, consolationSignal * 0.04)
      : consolationSignal < 0
        ? 1 - Math.min(0.1, Math.abs(consolationSignal) * 0.025)
        : 1
  const spreadLift =
    spreadSignal.favoriteCoverProbability !== null &&
    spreadSignal.favoriteCoverProbability < 0.46 &&
    item.result === favoriteResult
      ? favoriteMargin === 1
        ? underdogGoals === 0
          ? 1.18
          : 1.1
        : favoriteMargin >= 2 && favoriteProbability < 0.72
          ? 0.9
          : 1
      : 1
  const stalemateLift =
    stalemateSignal >= 3
      ? item.result === scoreResult(0, 0) && totalGoals === 0
        ? 1 + Math.min(0.26, stalemateSignal * 0.045)
        : totalGoals <= 1
          ? 1 + Math.min(0.12, stalemateSignal * 0.025)
          : item.result === favoriteResult && totalGoals >= 3
            ? 1 - Math.min(0.12, stalemateSignal * 0.02)
        : 1
      : 1
  const drawCompressionLift =
    drawCompression >= 3
      ? item.result === scoreResult(0, 0) && totalGoals === 0
        ? 1 + Math.min(0.38, drawCompression * 0.06)
        : item.result === scoreResult(1, 1) && totalGoals === 2
          ? 1 + Math.min(0.22, drawCompression * 0.04)
          : item.result !== scoreResult(0, 0) && totalGoals <= 2 && favoriteProbability < 0.48
            ? 1 - Math.min(0.16, drawCompression * 0.03)
            : 1
      : drawCompression >= 1 && item.result === scoreResult(1, 1) && totalGoals === 2
        ? 1.08
        : 1
  const resilientSignal = resilientHomeUnderdogSignal(
    homeGoals,
    awayGoals,
    homeWinStrength,
    awayWinStrength,
    drawStrength,
    totalExpectedGoals ?? totalGoals,
    context,
    market,
  )
  const resilientLift =
    resilientSignal > 0
      ? 1 + Math.min(0.22, resilientSignal * 0.045)
      : resilientSignal < 0
        ? 1 - Math.min(0.16, Math.abs(resilientSignal) * 0.035)
        : 1
  const strongConsolationSignal = strongUnderdogConsolationSignal(
    homeGoals,
    awayGoals,
    homeWinStrength,
    awayWinStrength,
    totalExpectedGoals ?? totalGoals,
    context,
  )
  const strongConsolationLift =
    strongConsolationSignal > 0
      ? 1 + Math.min(0.18, strongConsolationSignal * 0.05)
      : strongConsolationSignal < 0
        ? 1 - Math.min(0.12, Math.abs(strongConsolationSignal) * 0.035)
        : 1
  const oddsPenalty = item.fairOdds > 85 ? 0.82 : item.fairOdds > 55 ? 0.9 : item.fairOdds > 34 ? 0.97 : 1

  return (
    item.probability *
    resultWeight *
    highScoreLift *
    marginLift *
    tailLift *
    consolationLift *
    spreadLift *
    stalemateLift *
    drawCompressionLift *
    resilientLift *
    strongConsolationLift *
    oddsPenalty
  )
}

function scoreReason(
  homeGoals,
  awayGoals,
  homeTeam,
  awayTeam,
  resultProbabilities,
  totalExpectedGoals,
  judgement,
  tailMultiplier = 1,
  context = null,
  market = null,
) {
  const result = scoreResult(homeGoals, awayGoals)
  const homeWin = resultProbabilities.find((item) => item.side === 'home')?.probability ?? 0
  const awayWin = resultProbabilities.find((item) => item.side === 'away')?.probability ?? 0
  const draw = resultProbabilities.find((item) => item.side === 'draw')?.probability ?? 0
  const totalGoals = homeGoals + awayGoals
  const tempo = totalExpectedGoals >= 2.85 ? '进球环境偏开放' : totalExpectedGoals <= 2.25 ? '进球环境偏谨慎' : '进球环境中性'
  const favoriteSide = homeWin >= awayWin ? 'home' : 'away'
  const favoriteResult = favoriteSide === 'home' ? '主胜' : '客胜'
  const favoriteGoals = favoriteSide === 'home' ? homeGoals : awayGoals
  const underdogGoals = favoriteSide === 'home' ? awayGoals : homeGoals
  const favoriteMargin = favoriteGoals - underdogGoals
  const spreadSignal = market ? favoriteSpreadSignal(market, favoriteSide) : { favoriteCoverProbability: null }
  const stalemateSignal = favoriteStalemateSignal(homeWin, awayWin, draw, context)
  const drawCompression = drawCompressionSignal(homeWin, awayWin, draw, totalExpectedGoals, market)
  const consolationSignal = homeUnderdogConsolationSignal(
    homeGoals,
    awayGoals,
    homeWin,
    awayWin,
    draw,
    totalExpectedGoals,
    context,
  )
  const resilientSignal = resilientHomeUnderdogSignal(
    homeGoals,
    awayGoals,
    homeWin,
    awayWin,
    draw,
    totalExpectedGoals,
    context,
    market,
  )
  const strongConsolationSignal = strongUnderdogConsolationSignal(
    homeGoals,
    awayGoals,
    homeWin,
    awayWin,
    totalExpectedGoals,
    context,
  )
  const calibrationText =
    drawCompression >= 3 && result === '平局'
      ? '复盘校准把平局热度和小总进球纳入主判断，这类比分不能只当防守票。'
      : resilientSignal > 0
        ? '复盘校准上调主队抗压/爆冷权重，避免中等客队热门被过度放大。'
        : resilientSignal < 0
          ? '复盘校准下调客队中热门的一球路径，因为主队近况或让球信号支持不败。'
          : strongConsolationSignal > 0
            ? '复盘校准上调强热门场景下弱队进一球路径，避免过度迷信零封。'
            : strongConsolationSignal < 0
              ? '复盘校准下调强热门零封路径，弱队近期进攻和天气条件提示有进球风险。'
              : stalemateSignal >= 3 && totalGoals <= 1
      ? '复盘校准加入天气闷局权重，低比分不再被进攻均值完全挤出。'
      : spreadSignal.favoriteCoverProbability !== null &&
          spreadSignal.favoriteCoverProbability < 0.46 &&
          result === favoriteResult &&
          favoriteMargin === 1
        ? '复盘校准参考让球盘口，热门方一球小胜路径已上调。'
        : consolationSignal > 0
      ? '复盘校准上调弱势主队一球贡献，说明这个比分比零封路径更值得核验。'
      : consolationSignal < 0
        ? '复盘校准下调热门方零封路径，防止模型过度相信 0 进球。'
        : tailMultiplier >= 1.12
          ? '进攻尾部校准已上调，说明该高进球路径不是单纯搏冷。'
          : tailMultiplier <= 0.9
            ? '尾部校准下调，需防模型把罕见路径估得过高。'
            : ''

  if (result === '平局') {
    return `${tempo}，平局概率约 ${Math.round(draw * 100)}%，${homeTeam.zhName} 与 ${awayTeam.zhName} 的胜负差距不宜过度放大。${calibrationText}`
  }

  const winner = homeGoals > awayGoals ? homeTeam.zhName : awayTeam.zhName
  const winnerProbability = homeGoals > awayGoals ? homeWin : awayWin
  const marginText = Math.abs(homeGoals - awayGoals) >= 2 ? '两球以上优势' : '一球小胜'
  const totalText = totalGoals >= 4 ? '比分偏大，需要更高官方赔率补偿风险' : totalGoals <= 1 ? '低比分，对临场节奏和首发依赖更强' : '比分区间贴近市场总进球'

  return `${winner} 胜面约 ${Math.round(winnerProbability * 100)}%，${marginText}；${totalText}。${calibrationText}${judgement.tier === '避免追高' ? '热门过热时只核验，不追低赔。' : ''}`
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

function buildJudgement(market, event, newsItems, context = null) {
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
  const newsHeat = contextNewsRisk(context) ? 12 : 5
  const priceRisk = favoriteProbability > 0.76 ? 78 : favoriteProbability > 0.64 ? 58 : 46
  const drawRisk = drawProbability > 0.27 ? 66 : 42
  const moveRisk = Math.min(85, Math.abs(lineMove) * 7 + 38)
  const scheduleRisk = new Date(event.date).getTime() - now.getTime() < 5 * 60 * 60 * 1000 ? 62 : 48
  const contextRiskDelta = context?.adjustment?.riskDelta ?? 0
  const risk = clamp(Math.round((priceRisk + drawRisk + moveRisk + scheduleRisk + newsHeat) / 5 + contextRiskDelta), 28, 92)
  const confidence = clamp(
    Math.round(48 + favoriteProbability * 38 + Math.max(lineMove, 0) * 1.2 - risk * 0.12 + (context?.adjustment?.confidenceDelta ?? 0)),
    34,
    88,
  )

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
      ...(context
        ? [
            {
              label: '近5场实况',
              value: Math.round((context.home.formScore + context.away.formScore) / 2),
              tone: Math.abs(context.home.formScore - context.away.formScore) > 18 ? 'good' : 'watch',
              note: `${context.home.trendNote} ${context.away.trendNote}`,
            },
            {
              label: '天气地理',
              value: context.weather.riskLevel === '高' ? 72 : context.weather.riskLevel === '中' ? 52 : 32,
              tone: context.weather.riskLevel === '高' ? 'bad' : context.weather.riskLevel === '中' ? 'watch' : 'good',
              note: `${context.weather.summary} ${context.geography.travelEdge}`,
            },
            {
              label: '古法校验',
              value: Math.round(50 + (context.divination.delta ?? 0) * 8),
              tone: context.divination.lean === 'neutral' ? 'watch' : 'good',
              note: `${context.divination.method}；${context.divination.summary}`,
            },
          ]
        : []),
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
  if (DISCIPLINE_RISK_PATTERN.test(text)) return '纪律'
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

function buildContextSource(id, name, ok, tried) {
  return {
    id,
    name,
    status: ok > 0 ? (ok === tried ? 'ok' : 'warn') : 'warn',
    url: id === 'open-meteo-weather' ? 'https://open-meteo.com/' : 'https://www.espn.com/soccer/',
    lastCheckedAt: checkedAt,
    detail: tried > 0 ? `${ok}/${tried} 项成功` : '未触发',
  }
}

function formatShortDate(iso) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIMEZONE,
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

function haversineKm(from, to) {
  const radius = 6371
  const dLat = toRadians(to.lat - from.lat)
  const dLon = toRadians(to.lon - from.lon)
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(value))
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function stringScore(value) {
  return String(value)
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

function positiveModulo(value, mod) {
  return ((value % mod) + mod) % mod
}

function elementHarmony(dayElement, teamElement) {
  if (!dayElement || !teamElement || teamElement === '中') return 0
  if (dayElement === teamElement) return 2
  const generates = new Map([
    ['木', '火'],
    ['火', '土'],
    ['土', '金'],
    ['金', '水'],
    ['水', '木'],
  ])
  const controls = new Map([
    ['木', '土'],
    ['土', '水'],
    ['水', '火'],
    ['火', '金'],
    ['金', '木'],
  ])
  if (generates.get(dayElement) === teamElement) return 1
  if (generates.get(teamElement) === dayElement) return 0.5
  if (controls.get(dayElement) === teamElement) return -1.5
  if (controls.get(teamElement) === dayElement) return -0.5
  return 0
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

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { buildOpenSourceModelLab, OPEN_MODEL_SOURCE } from './model-lab.mjs'

const TIMEZONE = 'Asia/Shanghai'
const SCOREBOARD_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard'
const NEWS_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/news'
const FIFA_URL =
  'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums'
const SPORTTERY_URL = 'https://www.sporttery.cn/jc/'
const SPORTTERY_API = 'https://webapi.sporttery.cn/gateway/jc/football/getMatchListV1.qry?clientCode=3001'
const ODDS_API_SPORT = 'soccer_fifa_world_cup'
const HISTORY_SOURCE_URL = 'https://www.fifa.com/en/tournaments/mens/worldcup'
const PREDICTION_HISTORY_PATH = 'public/data/prediction-history.json'
const MONTE_CARLO_RUNS = 10000
const UPCOMING_WINDOW_HOURS = 54
const MIN_TRACKED_MATCHES = 2
const FUTURE_SCOREBOARD_DAYS = 5
const SCORE_CONSENSUS_ALIGNMENT_MARGIN = 0.01
const REGULATION_SCOPE = '90分钟常规时间 + 上下半场补时，不含加时赛和点球大战'
const REGULATION_SCOPE_SHORT = '90分钟含补时'
const TEAM_SCHEDULE_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer/all/teams'
const TEAM_INJURY_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer/all/teams'
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
const TOURNAMENT_START_DATE = '2026-06-11'
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

let activeModelCalibration = {
  favoriteTailBoost: 0,
  lowDrawRetention: 0,
  oneGoalBaseline: 0,
  favoriteControlBoost: 0,
  knockoutDrawFade: 0,
  underdogGoalRetention: 0,
  highGoalVolatility: 0,
  drawGuard: 0,
  homeNarrativeDampening: 0,
  awayFavoriteTailGuard: 0,
  eliteLowScoreGuard: 0,
  underdogMultiGoalGuard: 0,
  zeroGoalTotalGuard: 0,
  favoriteCleanSheetReorder: 0,
  lateKnockoutDrawOvercall: 0,
}

let regulationScoreOverrides = new Map()

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

const verifiedAvailabilityOverrides = new Map([
  [
    'England',
    {
      effectiveThrough: '2026-07-16T05:00:00Z',
      riskFloor: 24,
      headline: '英格兰半决赛可用性更新：Quansah确认停赛；Rice预计克服生病首发，Konsa、Henderson和James均可进入选择范围',
      note: 'Quansah两场禁赛覆盖半决赛；Rice状态明显好转并预计首发，Konsa抽筋后仍有望出战，Henderson和Reece James已回到比赛名单。英格兰仍少一名后防轮换，但不把恢复球员按确认缺阵处理。',
      sourceUrl: 'https://www.theguardian.com/football/2026/jul/13/england-declan-rice-winning-fitness-battle-argentina-world-cup',
      items: [
        { player: 'Jarell Quansah', status: '确认停赛', detail: '红牌后两场停赛，第二场为半决赛' },
      ],
    },
  ],
  [
    'France',
    {
      effectiveThrough: '2026-07-15T05:00:00Z',
      riskFloor: 8,
      headline: '法国半决赛可用性更新：Tchouaméni与Mbappé均已正常合练，预计可以出战西班牙',
      note: 'Tchouaméni已正常参加合练并倾向回到首发，Mbappé也被确认身体无碍；只保留伤后负荷的轻微风险，不再按出战存疑处理。',
      sourceUrl: 'https://as.com/futbol/mundial/dos-ausencias-en-francia-mbappe-y-tchouameni-ok-f202607-n/',
      items: [],
    },
  ],
  [
    'Spain',
    {
      effectiveThrough: '2026-07-20T00:30:00Z',
      riskFloor: 8,
      headline: '西班牙决赛可用性更新：Yamal与Porro预计可出战；Yeremy Pino确认缺席',
      note: 'Yamal与Porro预计可以出战；Pino肩伤缺席，但他并非当前主力且此前淘汰赛表现已反映其缺阵，因此只保留低权重阵容深度风险。',
      sourceUrl: 'https://www.sportsmole.co.uk/football/spain/world-cup-2026/injuries-and-suspensions/yamal-porro-latest-spain-injury-suspension-list-vs-argentina_601315.html',
      items: [{ player: 'Yeremy Pino', status: '确认缺阵', detail: '肩伤，本届余下比赛无法出场', riskWeight: 6 }],
    },
  ],
  [
    'Switzerland',
    {
      effectiveThrough: '2026-07-12T10:30:00Z',
      riskFloor: 40,
      headline: '瑞士赛前确认：Johan Manzambi因左膝伤缺席对阿根廷的四分之一决赛',
      note: 'Manzambi确认缺阵；他是瑞士本届队内头号得分点，模型下调瑞士进攻持续性并上调阿根廷零封路径。',
      sourceUrl: 'https://as.com/futbol/mundial/manzambi-baja-contra-argentina-f202607-n/',
      items: [{ player: 'Johan Manzambi', status: '确认缺阵', detail: '左膝伤，主教练确认无法出场' }],
    },
  ],
])

const knockoutStageLabels = new Map([
  ['round-of-32', '32强淘汰赛'],
  ['round-of-16', '16强淘汰赛'],
  ['quarterfinals', '四分之一决赛'],
  ['semifinals', '半决赛'],
  ['third-place', '三四名决赛'],
  ['3rd-place-match', '三四名决赛'],
  ['final', '决赛'],
])

const countryProfiles = new Map([
  ['South Africa', { zhName: '南非', lat: -25.75, lon: 28.23, region: '非洲南部高原', climate: '温带/亚热带', element: '土' }],
  ['Canada', { zhName: '加拿大', lat: 45.42, lon: -75.69, region: '北美北部', climate: '寒温带大陆', element: '水' }],
  ['Brazil', { zhName: '巴西', lat: -15.78, lon: -47.93, region: '南美东部', climate: '热带/亚热带', element: '木' }],
  ['Japan', { zhName: '日本', lat: 35.68, lon: 139.76, region: '东亚海岛', climate: '温带季风海洋', element: '水' }],
  ['Argentina', { zhName: '阿根廷', lat: -34.6, lon: -58.38, region: '南美南部', climate: '温带/亚热带', element: '水' }],
  ['Austria', { zhName: '奥地利', lat: 48.21, lon: 16.37, region: '中欧内陆', climate: '温带大陆', element: '土' }],
  ['France', { zhName: '法国', lat: 48.86, lon: 2.35, region: '西欧', climate: '温带海洋', element: '金' }],
  ['Sweden', { zhName: '瑞典', lat: 59.33, lon: 18.07, region: '北欧', climate: '冷凉大陆/海洋', element: '水' }],
  ['Iraq', { zhName: '伊拉克', lat: 33.31, lon: 44.36, region: '西亚', climate: '干热大陆', element: '火' }],
  ['Norway', { zhName: '挪威', lat: 59.91, lon: 10.75, region: '北欧', climate: '冷凉海洋', element: '水' }],
  ['Ivory Coast', { zhName: '科特迪瓦', lat: 5.35, lon: -4.03, region: '西非几内亚湾', climate: '热带湿热', element: '木' }],
  ['Mexico', { zhName: '墨西哥', lat: 19.43, lon: -99.13, region: '北美高原', climate: '高原/热带', element: '土' }],
  ['Ecuador', { zhName: '厄瓜多尔', lat: -0.18, lon: -78.47, region: '南美安第斯', climate: '热带高原', element: '木' }],
  ['Bosnia-Herzegovina', { zhName: '波黑', lat: 43.86, lon: 18.41, region: '巴尔干半岛', climate: '温带大陆/山地', element: '土' }],
  ['Bosnia and Herzegovina', { zhName: '波黑', lat: 43.86, lon: 18.41, region: '巴尔干半岛', climate: '温带大陆/山地', element: '土' }],
  ['Senegal', { zhName: '塞内加尔', lat: 14.69, lon: -17.45, region: '西非', climate: '热带草原', element: '火' }],
  ['Paraguay', { zhName: '巴拉圭', lat: -25.26, lon: -57.58, region: '南美内陆', climate: '亚热带草原', element: '木' }],
  ['Australia', { zhName: '澳大利亚', lat: -35.28, lon: 149.13, region: '大洋洲大陆', climate: '干热/温带海洋', element: '火' }],
  ['Türkiye', { zhName: '土耳其', lat: 39.93, lon: 32.86, region: '欧亚交界', climate: '地中海/大陆', element: '土' }],
  ['Turkey', { zhName: '土耳其', lat: 39.93, lon: 32.86, region: '欧亚交界', climate: '地中海/大陆', element: '土' }],
  ['United States', { zhName: '美国', lat: 38.9, lon: -77.04, region: '北美大陆', climate: '多气候带', element: '金' }],
  ['Cape Verde', { zhName: '佛得角', lat: 14.92, lon: -23.51, region: '西非大西洋群岛', climate: '海岛干热', element: '水' }],
  ['Saudi Arabia', { zhName: '沙特阿拉伯', lat: 24.71, lon: 46.67, region: '阿拉伯半岛', climate: '沙漠干热', element: '火' }],
  ['Uruguay', { zhName: '乌拉圭', lat: -34.9, lon: -56.16, region: '南美东南岸', climate: '温带湿润', element: '水' }],
  ['Spain', { zhName: '西班牙', lat: 40.42, lon: -3.7, region: '西南欧伊比利亚', climate: '地中海', element: '火' }],
  ['Egypt', { zhName: '埃及', lat: 30.04, lon: 31.24, region: '北非尼罗河', climate: '沙漠/河谷', element: '土' }],
  ['Iran', { zhName: '伊朗', lat: 35.69, lon: 51.39, region: '西亚高原', climate: '干燥高原', element: '土' }],
  ['New Zealand', { zhName: '新西兰', lat: -41.29, lon: 174.78, region: '南太平洋海岛', climate: '温带海洋', element: '水' }],
  ['Belgium', { zhName: '比利时', lat: 50.85, lon: 4.35, region: '西欧低地', climate: '温带海洋', element: '金' }],
  ['Switzerland', { zhName: '瑞士', lat: 46.95, lon: 7.45, region: '中欧阿尔卑斯', climate: '温带山地', element: '土' }],
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

const worldCupHistoryProfiles = new Map([
  [
    'Argentina',
    {
      zhName: '阿根廷',
      appearances: 19,
      titles: 3,
      finals: 6,
      semifinals: 6,
      quarterfinals: 11,
      knockoutRunsSince2002: 5,
      bestFinish: '1978、1986、2022 冠军',
      recentBest: '2014 亚军、2022 冠军',
      score: 90,
    },
  ],
  [
    'England',
    {
      zhName: '英格兰',
      appearances: 16,
      titles: 1,
      finals: 1,
      semifinals: 3,
      quarterfinals: 10,
      knockoutRunsSince2002: 5,
      bestFinish: '1966 冠军',
      recentBest: '2018 四强、2022 八强',
      score: 78,
    },
  ],
  [
    'Congo DR',
    {
      zhName: '刚果民主共和国',
      appearances: 2,
      titles: 0,
      finals: 0,
      semifinals: 0,
      quarterfinals: 0,
      knockoutRunsSince2002: 0,
      bestFinish: '1974 以扎伊尔身份参赛，小组赛',
      recentBest: '2026 重返世界杯',
      score: 42,
    },
  ],
  [
    'DR Congo',
    {
      zhName: '刚果民主共和国',
      appearances: 2,
      titles: 0,
      finals: 0,
      semifinals: 0,
      quarterfinals: 0,
      knockoutRunsSince2002: 0,
      bestFinish: '1974 以扎伊尔身份参赛，小组赛',
      recentBest: '2026 重返世界杯',
      score: 42,
    },
  ],
  [
    'Belgium',
    {
      zhName: '比利时',
      appearances: 14,
      titles: 0,
      finals: 0,
      semifinals: 2,
      quarterfinals: 5,
      knockoutRunsSince2002: 3,
      bestFinish: '2018 季军',
      recentBest: '2014 八强、2018 季军',
      score: 72,
    },
  ],
  [
    'Senegal',
    {
      zhName: '塞内加尔',
      appearances: 4,
      titles: 0,
      finals: 0,
      semifinals: 0,
      quarterfinals: 1,
      knockoutRunsSince2002: 2,
      bestFinish: '2002 八强',
      recentBest: '2022 十六强',
      score: 58,
    },
  ],
  [
    'United States',
    {
      zhName: '美国',
      appearances: 12,
      titles: 0,
      finals: 0,
      semifinals: 1,
      quarterfinals: 2,
      knockoutRunsSince2002: 4,
      bestFinish: '1930 四强',
      recentBest: '2002 八强、2010/2014/2022 十六强',
      score: 66,
    },
  ],
  [
    'Bosnia-Herzegovina',
    {
      zhName: '波黑',
      appearances: 2,
      titles: 0,
      finals: 0,
      semifinals: 0,
      quarterfinals: 0,
      knockoutRunsSince2002: 0,
      bestFinish: '2014 小组赛',
      recentBest: '2026 再次参赛',
      score: 43,
    },
  ],
  [
    'Bosnia and Herzegovina',
    {
      zhName: '波黑',
      appearances: 2,
      titles: 0,
      finals: 0,
      semifinals: 0,
      quarterfinals: 0,
      knockoutRunsSince2002: 0,
      bestFinish: '2014 小组赛',
      recentBest: '2026 再次参赛',
      score: 43,
    },
  ],
  [
    'Spain',
    {
      zhName: '西班牙',
      appearances: 16,
      titles: 1,
      finals: 1,
      semifinals: 2,
      quarterfinals: 6,
      knockoutRunsSince2002: 4,
      bestFinish: '2010 冠军',
      recentBest: '2010 冠军、2022 十六强',
      score: 76,
    },
  ],
  [
    'Austria',
    {
      zhName: '奥地利',
      appearances: 8,
      titles: 0,
      finals: 0,
      semifinals: 2,
      quarterfinals: 3,
      knockoutRunsSince2002: 0,
      bestFinish: '1954 季军',
      recentBest: '长期缺席世界杯正赛',
      score: 55,
    },
  ],
  [
    'Portugal',
    {
      zhName: '葡萄牙',
      appearances: 9,
      titles: 0,
      finals: 0,
      semifinals: 2,
      quarterfinals: 4,
      knockoutRunsSince2002: 4,
      bestFinish: '1966 季军',
      recentBest: '2006 四强、2022 八强',
      score: 70,
    },
  ],
  [
    'Croatia',
    {
      zhName: '克罗地亚',
      appearances: 7,
      titles: 0,
      finals: 1,
      semifinals: 3,
      quarterfinals: 3,
      knockoutRunsSince2002: 2,
      bestFinish: '2018 亚军',
      recentBest: '2018 亚军、2022 季军',
      score: 73,
    },
  ],
  [
    'Switzerland',
    {
      zhName: '瑞士',
      appearances: 12,
      titles: 0,
      finals: 0,
      semifinals: 0,
      quarterfinals: 3,
      knockoutRunsSince2002: 4,
      bestFinish: '1934/1938/1954 八强',
      recentBest: '近几届多次十六强',
      score: 62,
    },
  ],
  [
    'Algeria',
    {
      zhName: '阿尔及利亚',
      appearances: 5,
      titles: 0,
      finals: 0,
      semifinals: 0,
      quarterfinals: 0,
      knockoutRunsSince2002: 1,
      bestFinish: '2014 十六强',
      recentBest: '2014 十六强',
      score: 52,
    },
  ],
  [
    'Mexico',
    {
      zhName: '墨西哥',
      appearances: 18,
      titles: 0,
      finals: 0,
      semifinals: 0,
      quarterfinals: 2,
      knockoutRunsSince2002: 6,
      bestFinish: '1970/1986 八强',
      recentBest: '长期稳定进入淘汰赛',
      score: 67,
    },
  ],
  [
    'France',
    {
      zhName: '法国',
      appearances: 17,
      titles: 2,
      finals: 4,
      semifinals: 7,
      quarterfinals: 9,
      knockoutRunsSince2002: 4,
      bestFinish: '1998、2018 冠军',
      recentBest: '2018 冠军、2022 亚军',
      score: 88,
    },
  ],
])

const teamNames = new Map([
  ['Netherlands', '荷兰'],
  ['Sweden', '瑞典'],
  ['Germany', '德国'],
  ['Ivory Coast', '科特迪瓦'],
  ['Curaçao', '库拉索'],
  ['Curacao', '库拉索'],
  ['Ecuador', '厄瓜多尔'],
  ['Switzerland', '瑞士'],
  ['Bosnia-Herzegovina', '波黑'],
  ['Bosnia and Herzegovina', '波黑'],
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
  ['Paraguay', '巴拉圭'],
  ['Australia', '澳大利亚'],
  ['Türkiye', '土耳其'],
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
  ['South Africa', '南非'],
  ['Canada', '加拿大'],
])

const now = new Date()
const checkedAt = now.toISOString()
const targetDateChina = formatDateKey(now, 0, '-')

const sources = []

async function main() {
  const scoreboardDates = uniqueDateKeys([
    ...dateKeysBetween(TOURNAMENT_START_DATE, formatDateKey(now, 0, '-')),
    ...Array.from({ length: FUTURE_SCOREBOARD_DAYS + 2 }, (_, index) => formatDateKey(now, index - 1, '')),
  ])
  const scoreboards = await mapWithConcurrency(scoreboardDates, 4, fetchScoreboard)
  const failedScoreboards = scoreboards.filter((board) => board.source.status !== 'ok')
  if (failedScoreboards.length > 0) {
    const failedDates = failedScoreboards.map((board) => board.source.id.replace('espn-scoreboard-', '')).join(', ')
    throw new Error(`Scoreboard refresh incomplete after retries (${failedDates}); keeping the previous complete dataset.`)
  }
  const events = dedupeEvents(scoreboards.flatMap((board) => board.events))
  regulationScoreOverrides = buildRegulationScoreOverrides(events)
  const tournamentRecords = buildTournamentRecords(events)
  const groupStandings = buildGroupStandings(events)
  const knockoutPaths = buildKnockoutPaths(events, tournamentRecords)
  const predictionHistory = await readPredictionHistory()
  const openModelLab = buildOpenSourceModelLab(buildModelLabRecords(events), predictionHistory.predictions)
  const newsResult = await fetchNews()
  const oddsApiResult = await fetchOddsApi()
  const oddsApiBook = buildOddsApiBook(oddsApiResult.data)
  const sportteryResult = await checkSporttery()
  const fifaResult = await checkFifa()

  const allUpcoming = events
    .filter((event) => {
      const kickoff = new Date(event.date).getTime()
      return isPreMatchEvent(event) && kickoff >= now.getTime()
    })
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
  const nearTermWindow = allUpcoming.filter(
    (event) => new Date(event.date).getTime() <= now.getTime() + UPCOMING_WINDOW_HOURS * 60 * 60 * 1000,
  )
  const upcomingWindow = (nearTermWindow.length >= MIN_TRACKED_MATCHES ? nearTermWindow : allUpcoming)
    .slice(0, Math.max(MIN_TRACKED_MATCHES, nearTermWindow.length))
  const recentCompleted = completedEventsForReview(events, predictionHistory)
  const modelReview = buildModelReview(recentCompleted, openModelLab.evaluation)
  activeModelCalibration = modelReview.calibration

  const matches = await Promise.all(
    upcomingWindow.map((event) =>
      normalizeMatch(event, newsResult.news, tournamentRecords, groupStandings, knockoutPaths, oddsApiBook, openModelLab),
    ),
  )
  const updatedPredictionHistory = updatePredictionHistory(predictionHistory, matches)
  sources.push(
    fifaResult,
    ...scoreboards.map((board) => board.source),
    newsResult.source,
    oddsApiResult.source,
    sportteryResult,
    buildContextSource('espn-team-schedules', 'ESPN 球队近 5 场', contextStats.teamSchedulesOk, contextStats.teamSchedulesTried),
    buildContextSource('espn-injuries', 'ESPN 伤病名单', contextStats.injuriesOk, contextStats.injuriesTried),
    buildContextSource('open-meteo-weather', 'Open-Meteo 天气', contextStats.weatherOk, contextStats.weatherTried),
    {
      id: 'prediction-history',
      name: '本地预测档案',
      status: updatedPredictionHistory.count > 0 ? 'ok' : 'warn',
      url: PREDICTION_HISTORY_PATH,
      lastCheckedAt: checkedAt,
      detail: `${updatedPredictionHistory.count} 场赛前预测用于后续赛后训练`,
    },
    {
      id: 'fifa-history-profile',
      name: 'FIFA 历届世界杯表现档案',
      status: 'ok',
      url: HISTORY_SOURCE_URL,
      lastCheckedAt: checkedAt,
      detail: `${worldCupHistoryProfiles.size} 条球队历史档案参与低权重校准`,
    },
    {
      id: OPEN_MODEL_SOURCE.id,
      name: OPEN_MODEL_SOURCE.name,
      status: 'ok',
      url: OPEN_MODEL_SOURCE.url,
      lastCheckedAt: checkedAt,
      detail: `MIT开源独立基线；本届走步回测 ${openModelLab.evaluation.openSourceBaseline.canonical.samples} 场`,
    },
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
          ? `跟踪未来最近 ${matches.length} 场世界杯比赛`
          : '未来暂无可解析比赛',
      note:
        '系统将公开赛程、新闻和海外市场赔率转为概率视图，再给出谨慎的体彩核验方向。所有判断只作信息分析，不保证盈利。',
      predictionScope: REGULATION_SCOPE,
      trackedMatches: matches.length,
      healthySources,
      updateMode: process.env.GITHUB_ACTIONS ? 'GitHub 定时' : '本地脚本',
    },
    sources,
    news: newsResult.news,
    modelReview,
    tournament: {
      ...buildTournamentSummary(tournamentRecords),
      groups: summarizeGroupStandings(groupStandings),
      knockoutPaths: summarizeKnockoutPaths(knockoutPaths),
    },
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
  await writeJson(PREDICTION_HISTORY_PATH, updatedPredictionHistory)
  console.log(`Updated ${brief.matches.length} matches at ${brief.generatedAtChina}`)
}

async function fetchScoreboard(dateKey) {
  const url = `${SCOREBOARD_URL}?dates=${dateKey}`
  let lastError

  for (let attempt = 1; attempt <= 3; attempt += 1) {
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
          detail: `${data.events?.length ?? 0} 场比赛${attempt > 1 ? `，第 ${attempt} 次请求成功` : ''}`,
        },
      }
    } catch (error) {
      lastError = error
      if (attempt < 3) await delay(350 * attempt)
    }
  }

  return {
    events: [],
    source: {
      id: `espn-scoreboard-${dateKey}`,
      name: `ESPN 赛程 ${dateKey}`,
      status: 'error',
      url,
      lastCheckedAt: checkedAt,
      detail: shortError(lastError),
    },
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

function buildOddsApiBook(data = []) {
  const book = new Map()

  for (const game of data ?? []) {
    const market = normalizeOddsApiMarket(game)
    if (!market) continue
    book.set(matchupKey(game.home_team, game.away_team), market)
  }

  return book
}

function normalizeOddsApiMarket(game) {
  const bookmakers = Array.isArray(game?.bookmakers) ? game.bookmakers : []
  if (!bookmakers.length || !game?.home_team || !game?.away_team) return null

  const homeTeam = game.home_team
  const awayTeam = game.away_team
  const bookmakerNames = bookmakers.map((book) => book.title ?? book.key).filter(Boolean)
  const moneyline = [
    oddsApiOutcome(homeTeam, 'home', collectOutcomePrices(bookmakers, 'h2h', homeTeam)),
    oddsApiOutcome('平局', 'draw', collectOutcomePrices(bookmakers, 'h2h', 'Draw')),
    oddsApiOutcome(awayTeam, 'away', collectOutcomePrices(bookmakers, 'h2h', awayTeam)),
  ]
  const probabilitySum = moneyline.reduce((sum, item) => sum + (item.impliedProbability ?? 0), 0)
  moneyline.forEach((item) => {
    item.normalizedProbability = probabilitySum > 0 ? (item.impliedProbability ?? 0) / probabilitySum : null
  })

  return {
    provider: 'The Odds API consensus',
    details: `多博彩公司中位数：${bookmakerNames.slice(0, 4).join(' / ')}${bookmakerNames.length > 4 ? ` 等 ${bookmakerNames.length} 家` : ''}`,
    moneyline,
    total: [
      oddsApiOutcome('大球', 'over', collectOutcomePrices(bookmakers, 'totals', 'Over')),
      oddsApiOutcome('小球', 'under', collectOutcomePrices(bookmakers, 'totals', 'Under')),
    ],
    spread: [
      oddsApiOutcome(homeTeam, 'spreadHome', collectOutcomePrices(bookmakers, 'spreads', homeTeam)),
      oddsApiOutcome(awayTeam, 'spreadAway', collectOutcomePrices(bookmakers, 'spreads', awayTeam)),
    ],
    updatedAt: checkedAt,
  }
}

function collectOutcomePrices(bookmakers, marketKey, outcomeName) {
  const prices = []
  const points = []
  const target = marketTeamKey(outcomeName)

  for (const bookmaker of bookmakers) {
    const market = bookmaker.markets?.find((item) => item.key === marketKey)
    const outcome = market?.outcomes?.find((item) => marketTeamKey(item.name) === target)
    if (!outcome) continue
    if (Number.isFinite(Number(outcome.price))) prices.push(Number(outcome.price))
    if (Number.isFinite(Number(outcome.point))) points.push(Number(outcome.point))
  }

  return {
    price: median(prices),
    line: median(points),
    count: prices.length,
  }
}

function oddsApiOutcome(label, side, aggregate) {
  const decimal = aggregate?.price ?? null
  const implied = decimal && decimal > 1 ? 1 / decimal : null

  return {
    label: teamNames.get(label) ?? label,
    side,
    american: decimal ? decimalToAmerican(decimal) : null,
    decimal: decimal ? round(decimal, 2) : null,
    impliedProbability: implied,
    normalizedProbability: null,
    line: aggregate?.line ?? null,
    movement: null,
    bookmakerCount: aggregate?.count ?? 0,
  }
}

function mergeMarkets(espnMarket, oddsApiMarket) {
  if (!oddsApiMarket) return espnMarket
  if (!espnMarket) return oddsApiMarket

  return {
    ...oddsApiMarket,
    provider: oddsApiMarket.provider,
    details: `${oddsApiMarket.details}；ESPN/DraftKings 备用：${espnMarket.details}`,
    backupProvider: espnMarket.provider,
    moneyline: marketHasPrices(oddsApiMarket.moneyline) ? oddsApiMarket.moneyline : espnMarket.moneyline,
    total: marketHasPrices(oddsApiMarket.total) ? oddsApiMarket.total : espnMarket.total,
    spread: marketHasPrices(oddsApiMarket.spread) ? oddsApiMarket.spread : espnMarket.spread,
  }
}

function marketHasPrices(outcomes = []) {
  return Array.isArray(outcomes) && outcomes.some((item) => Number.isFinite(item?.impliedProbability))
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : round((sorted[middle - 1] + sorted[middle]) / 2, 3)
}

function decimalToAmerican(decimal) {
  if (!decimal || decimal <= 1) return null
  const value = decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1))
  return value > 0 ? `+${value}` : String(value)
}

function matchupKey(homeName, awayName) {
  return `${marketTeamKey(homeName)}__${marketTeamKey(awayName)}`
}

function marketTeamKey(value) {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  const aliases = new Map([
    ['usa', 'united states'],
    ['us', 'united states'],
    ['u s', 'united states'],
    ['congo dr', 'congo dr'],
    ['dr congo', 'congo dr'],
    ['democratic republic of congo', 'congo dr'],
    ['bosnia herzegovina', 'bosnia herzegovina'],
    ['bosnia and herzegovina', 'bosnia herzegovina'],
    ['draw', 'draw'],
    ['tie', 'draw'],
  ])

  return aliases.get(normalized) ?? normalized
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

async function normalizeMatch(
  event,
  newsItems,
  tournamentRecords = new Map(),
  groupStandings = new Map(),
  knockoutPaths = new Map(),
  oddsApiBook = new Map(),
  openModelLab = null,
) {
  const competition = event.competitions?.[0] ?? {}
  const competitors = competition.competitors ?? []
  const home = competitors.find((item) => item.homeAway === 'home') ?? competitors[0] ?? {}
  const away = competitors.find((item) => item.homeAway === 'away') ?? competitors[1] ?? {}
  const normalizedHome = normalizeTeam(home)
  const normalizedAway = normalizeTeam(away)
  const espnMarket = normalizeMarket(competition.odds?.[0], home, away)
  const oddsApiMarket = oddsApiBook.get(matchupKey(normalizedHome.name, normalizedAway.name))
  const market = mergeMarkets(espnMarket, oddsApiMarket)
  const context = await buildMatchContext(
    event,
    competition,
    normalizedHome,
    normalizedAway,
    home,
    away,
    newsItems,
    tournamentRecords,
    groupStandings,
    knockoutPaths,
  )
  const openPrediction = openModelLab?.predict(normalizedHome.name, normalizedAway.name, {
    homeHost: context.situational?.host?.homeHost,
    awayHost: context.situational?.host?.awayHost,
  })
  const probabilityEnsemble = market
    ? openModelLab?.combineWithMarket(resultProbabilitiesFromMarket(market), openPrediction)
    : null
  const judgement = buildJudgement(market, event, newsItems, context, probabilityEnsemble)
  const scoreline = buildScorelineAnalysis(
    market,
    normalizedHome,
    normalizedAway,
    judgement,
    newsItems,
    context,
    probabilityEnsemble,
  )
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
      scope: REGULATION_SCOPE,
      markets: ['胜平负', '让球胜平负', '总进球', '比分'],
      note:
        `本系统胜平负、比分、总进球均按${REGULATION_SCOPE_SHORT}判断。海外市场盘口与竞彩官方赔率、开售状态、让球设定可能不同。购买前请用中国体彩网或销售终端核验最终赔率和截止时间。`,
    },
  }
}

function buildTournamentRecords(events) {
  const records = new Map()

  for (const event of events) {
    if (!isCompletedEvent(event)) continue

    const competitors = event.competitions?.[0]?.competitors ?? []
    const home = competitors.find((item) => item.homeAway === 'home') ?? competitors[0] ?? {}
    const away = competitors.find((item) => item.homeAway === 'away') ?? competitors[1] ?? {}
    const regulationScore = regulationScoreForEvent(event)
    const homeScore = regulationScore?.home ?? null
    const awayScore = regulationScore?.away ?? null

    if (homeScore === null || awayScore === null) continue

    addTournamentTeamResult(records, home, away, homeScore, awayScore, event.date)
    addTournamentTeamResult(records, away, home, awayScore, homeScore, event.date)
  }

  for (const record of records.values()) finalizeTournamentRecord(record)

  return records
}

function addTournamentTeamResult(records, own, opponent, goalsFor, goalsAgainst, date) {
  const name = teamName(own)
  const key = normalizeTeamKey(name)
  const record =
    records.get(key) ??
    {
      name,
      zhName: teamNames.get(name) ?? name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      cleanSheets: 0,
      failedToScore: 0,
      bigWins: 0,
      heavyLosses: 0,
      matches: [],
    }
  const result = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D'
  const opponentName = teamName(opponent)

  record.played += 1
  record.wins += result === 'W' ? 1 : 0
  record.draws += result === 'D' ? 1 : 0
  record.losses += result === 'L' ? 1 : 0
  record.goalsFor += goalsFor
  record.goalsAgainst += goalsAgainst
  record.goalDiff = record.goalsFor - record.goalsAgainst
  record.cleanSheets += goalsAgainst === 0 ? 1 : 0
  record.failedToScore += goalsFor === 0 ? 1 : 0
  record.bigWins += goalsFor - goalsAgainst >= 3 ? 1 : 0
  record.heavyLosses += goalsAgainst - goalsFor >= 3 ? 1 : 0
  record.matches.push({
    date: formatShortDate(date),
    dateUtc: date,
    opponent: teamNames.get(opponentName) ?? opponentName,
    result,
    score: `${goalsFor}-${goalsAgainst}`,
    goalsFor,
    goalsAgainst,
  })

  records.set(key, record)
}

function finalizeTournamentRecord(record) {
  record.points = record.wins * 3 + record.draws
  record.goalsForAvg = record.played ? round(record.goalsFor / record.played, 2) : 0
  record.goalsAgainstAvg = record.played ? round(record.goalsAgainst / record.played, 2) : 0
  record.formString = record.matches.map((match) => match.result).join('')
  record.attackScore = clamp(round(46 + record.goalsForAvg * 13 + record.bigWins * 4 - record.failedToScore * 4, 1), 18, 88)
  record.defenseScore = clamp(round(66 - record.goalsAgainstAvg * 12 + record.cleanSheets * 5 - record.heavyLosses * 6, 1), 18, 88)
  record.momentumScore = clamp(round(48 + record.wins * 8 + record.draws * 2 - record.losses * 8 + record.goalDiff * 3, 1), 18, 90)
  record.strengthScore = clamp(
    round(record.attackScore * 0.32 + record.defenseScore * 0.3 + record.momentumScore * 0.38, 1),
    18,
    90,
  )
  record.summary =
    record.played > 0
      ? `本届 ${record.played} 场 ${record.wins}胜${record.draws}平${record.losses}负，进失球 ${record.goalsFor}-${record.goalsAgainst}，杯赛强度 ${record.strengthScore}。`
      : '本届暂无已完赛样本。'
}

function buildTournamentSummary(records) {
  const teams = [...records.values()].sort((left, right) => right.strengthScore - left.strengthScore)

  return {
    startDate: TOURNAMENT_START_DATE,
    trackedTeams: teams.length,
    topTeams: teams.slice(0, 8).map((team) => ({
      name: team.zhName,
      played: team.played,
      record: `${team.wins}-${team.draws}-${team.losses}`,
      goals: `${team.goalsFor}-${team.goalsAgainst}`,
      strengthScore: team.strengthScore,
    })),
  }
}

function buildGroupStandings(events) {
  const groups = new Map()

  for (const event of events) {
    const competition = event.competitions?.[0] ?? {}
    const group = competition.altGameNote ?? ''
    if (event.season?.slug !== 'group-stage' || !group || !isCompletedEvent(event)) continue

    const competitors = competition.competitors ?? []
    const home = competitors.find((item) => item.homeAway === 'home') ?? competitors[0] ?? {}
    const away = competitors.find((item) => item.homeAway === 'away') ?? competitors[1] ?? {}
    const homeScore = readScore(home.score)
    const awayScore = readScore(away.score)
    if (homeScore === null || awayScore === null) continue

    const table = groups.get(group) ?? new Map()
    applyGroupResult(table, home, homeScore, awayScore)
    applyGroupResult(table, away, awayScore, homeScore)
    groups.set(group, table)
  }

  const result = new Map()
  for (const [group, table] of groups.entries()) {
    const teams = [...table.values()].sort(groupStandingSort).map((team, index) => ({
      ...team,
      rank: index + 1,
    }))
    result.set(group, { group, teams })
  }

  return result
}

function applyGroupResult(table, competitor, goalsFor, goalsAgainst) {
  const name = teamName(competitor)
  const key = normalizeTeamKey(name)
  const team =
    table.get(key) ??
    {
      name,
      zhName: teamNames.get(name) ?? name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      rank: 0,
    }
  const result = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D'

  team.played += 1
  team.wins += result === 'W' ? 1 : 0
  team.draws += result === 'D' ? 1 : 0
  team.losses += result === 'L' ? 1 : 0
  team.points += result === 'W' ? 3 : result === 'D' ? 1 : 0
  team.goalsFor += goalsFor
  team.goalsAgainst += goalsAgainst
  team.goalDiff = team.goalsFor - team.goalsAgainst
  table.set(key, team)
}

function groupStandingSort(left, right) {
  return (
    right.points - left.points ||
    right.goalDiff - left.goalDiff ||
    right.goalsFor - left.goalsFor ||
    left.goalsAgainst - right.goalsAgainst ||
    left.zhName.localeCompare(right.zhName, 'zh-CN')
  )
}

function summarizeGroupStandings(groupStandings) {
  return [...groupStandings.values()].map((group) => ({
    group: group.group,
    teams: group.teams.map((team) => ({
      name: team.zhName,
      rank: team.rank,
      record: `${team.wins}-${team.draws}-${team.losses}`,
      points: team.points,
      goals: `${team.goalsFor}-${team.goalsAgainst}`,
    })),
  }))
}

function buildKnockoutPaths(events, tournamentRecords) {
  const roundOf32 = events
    .filter((event) => event.season?.slug === 'round-of-32')
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
  const paths = new Map()

  for (let index = 0; index < roundOf32.length; index += 2) {
    const left = roundOf32[index]
    const right = roundOf32[index + 1]
    if (!left || !right) continue
    const leftTeams = teamsFromEvent(left)
    const rightTeams = teamsFromEvent(right)
    const leftPool = rightTeams.map((team) => teamPoolStrength(team, tournamentRecords))
    const rightPool = leftTeams.map((team) => teamPoolStrength(team, tournamentRecords))

    paths.set(String(left.id), buildKnockoutPath(left, leftPool))
    paths.set(String(right.id), buildKnockoutPath(right, rightPool))
  }

  return paths
}

function buildKnockoutPath(event, opponentPool) {
  const knownPool = opponentPool.filter((item) => !item.placeholder)
  const maxStrength = knownPool.length ? Math.max(...knownPool.map((item) => item.strengthScore)) : 52
  const averageStrength = knownPool.length ? round(knownPool.reduce((sum, item) => sum + item.strengthScore, 0) / knownPool.length, 1) : 52
  const names = opponentPool.map((item) => item.zhName).join(' / ') || '待定'

  return {
    matchId: String(event.id),
    stage: event.season?.slug ?? 'round-of-32',
    nextOpponentPool: opponentPool,
    maxOpponentStrength: round(maxStrength, 1),
    averageOpponentStrength: averageStrength,
    note: `晋级后可能面对 ${names}，对手池最高强度 ${round(maxStrength, 1)}。`,
  }
}

function teamsFromEvent(event) {
  const competitors = event.competitions?.[0]?.competitors ?? []
  return competitors
    .map((competitor) => {
      const name = teamName(competitor)
      if (!name || /Third Place|Winner|TBD|Group/i.test(name)) {
        return { name, zhName: name, placeholder: true }
      }
      return {
        name,
        zhName: teamNames.get(name) ?? name,
        placeholder: false,
      }
    })
    .filter((team) => team.name)
}

function teamPoolStrength(team, tournamentRecords) {
  const record = tournamentRecords.get(normalizeTeamKey(team.name))
  return {
    ...team,
    strengthScore: team.placeholder ? 52 : record?.strengthScore ?? 52,
    record: team.placeholder || !record ? '待定' : `${record.wins}-${record.draws}-${record.losses}`,
    goals: team.placeholder || !record ? '待定' : `${record.goalsFor}-${record.goalsAgainst}`,
  }
}

function summarizeKnockoutPaths(paths) {
  return [...paths.values()].map((path) => ({
    matchId: path.matchId,
    nextOpponentPool: path.nextOpponentPool.map((team) => ({
      name: team.zhName,
      strengthScore: team.strengthScore,
      record: team.record,
      goals: team.goals,
    })),
    maxOpponentStrength: path.maxOpponentStrength,
    averageOpponentStrength: path.averageOpponentStrength,
  }))
}

function tournamentRecordForTeam(records, team) {
  return records.get(normalizeTeamKey(team.name)) ?? records.get(normalizeTeamKey(team.zhName)) ?? defaultTournamentRecord(team)
}

function defaultTournamentRecord(team) {
  return {
    name: team.name,
    zhName: team.zhName,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    cleanSheets: 0,
    failedToScore: 0,
    bigWins: 0,
    heavyLosses: 0,
    points: 0,
    goalsForAvg: 0,
    goalsAgainstAvg: 0,
    formString: '',
    attackScore: 46,
    defenseScore: 50,
    momentumScore: 46,
    strengthScore: 46,
    matches: [],
    summary: '本届暂无已完赛样本。',
  }
}

function worldCupHistoryForTeam(team) {
  const profile =
    worldCupHistoryProfiles.get(team.name) ??
    worldCupHistoryProfiles.get(team.zhName) ??
    worldCupHistoryProfiles.get(teamNames.get(team.name)) ??
    null

  if (!profile) return defaultWorldCupHistory(team)

  return {
    ...profile,
    name: team.name,
    zhName: team.zhName,
    score: clamp(profile.score, 35, 90),
    summary: `${team.zhName} 历届世界杯：${profile.appearances} 次参赛，最佳 ${profile.bestFinish}，近代样本 ${profile.recentBest}，历史底蕴 ${profile.score}/100。`,
  }
}

function defaultWorldCupHistory(team) {
  return {
    name: team.name,
    zhName: team.zhName,
    appearances: 0,
    titles: 0,
    finals: 0,
    semifinals: 0,
    quarterfinals: 0,
    knockoutRunsSince2002: 0,
    bestFinish: '缺少可核验样本',
    recentBest: '缺少近代世界杯淘汰赛样本',
    score: 44,
    summary: `${team.zhName} 历届世界杯样本不足，历史底蕴按 44/100 保守处理。`,
  }
}

function worldCupHistoryTempoAdjustment(homeHistory, awayHistory) {
  if (!homeHistory || !awayHistory) return 0
  const combinedKnockoutRuns = (homeHistory.knockoutRunsSince2002 ?? 0) + (awayHistory.knockoutRunsSince2002 ?? 0)
  const combinedTitles = (homeHistory.titles ?? 0) + (awayHistory.titles ?? 0)
  let adjustment = 0

  if (combinedKnockoutRuns >= 7) adjustment -= 0.03
  if (combinedTitles >= 2) adjustment += 0.02
  if (Math.abs((homeHistory.score ?? 44) - (awayHistory.score ?? 44)) >= 24) adjustment += 0.03

  return clamp(round(adjustment, 2), -0.04, 0.05)
}

function normalizeTeamKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

function buildModelLabRecords(events) {
  return events.map((event) => {
    const competitors = event.competitions?.[0]?.competitors ?? []
    const home = competitors.find((item) => item.homeAway === 'home') ?? competitors[0] ?? {}
    const away = competitors.find((item) => item.homeAway === 'away') ?? competitors[1] ?? {}
    const regulationScore = isCompletedEvent(event) ? regulationScoreForEvent(event) : null

    return {
      id: String(event.id),
      date: event.date,
      stage: event.season?.slug ?? event.competitions?.[0]?.altGameNote ?? 'unknown',
      home: teamName(home),
      away: teamName(away),
      homeGoals: regulationScore?.home ?? null,
      awayGoals: regulationScore?.away ?? null,
    }
  })
}

function completedEventsForReview(events, predictionHistory = null) {
  const lower = new Date(`${TOURNAMENT_START_DATE}T00:00:00Z`).getTime()

  return events
    .filter((event) => {
      const eventTime = new Date(event.date).getTime()
      return Number.isFinite(eventTime) && eventTime >= lower && eventTime < now.getTime() && isCompletedEvent(event)
    })
    .map((event) => {
      const competitors = event.competitions?.[0]?.competitors ?? []
      const home = competitors.find((item) => item.homeAway === 'home') ?? competitors[0] ?? {}
      const away = competitors.find((item) => item.homeAway === 'away') ?? competitors[1] ?? {}
      const regulationScore = regulationScoreForEvent(event)
      const homeScore = regulationScore?.home ?? null
      const awayScore = regulationScore?.away ?? null
      const homeName = teamNames.get(teamName(home)) ?? teamName(home)
      const awayName = teamNames.get(teamName(away)) ?? teamName(away)
      const competition = event.competitions?.[0] ?? {}
      const timestamp = new Date(event.date).getTime()

      if (homeScore === null || awayScore === null) return null

      return {
        id: String(event.id),
        timestamp,
        kickoffChina: formatChinaDateTime(event.date),
        stage: event.season?.slug ?? competition.altGameNote ?? 'unknown',
        home: homeName,
        away: awayName,
        score: `${homeScore}-${awayScore}`,
        scoreBasis: regulationScore?.corrected ? '90分钟含补时（已剔除加时/点球）' : '90分钟含补时',
        totalGoals: homeScore + awayScore,
        result: scoreResult(homeScore, awayScore),
        prediction: buildCompletedPredictionSample(event, home, away, homeScore, awayScore, predictionHistory),
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.timestamp - left.timestamp)
}

function buildModelReview(completedMatches, standardEvaluation = null) {
  const recentCompleted = completedMatches.slice(0, 8)
  const scoredMatches = completedMatches.filter((match) => match.totalGoals >= 0)
  const predictionSamples = completedMatches.filter((match) => match.prediction?.available)
  const favoritesConverted = scoredMatches.filter((match) => match.result !== '平局' && match.totalGoals >= 4).length
  const lowDraws = scoredMatches.filter((match) => match.result === '平局' && match.totalGoals <= 2).length
  const oneGoalWins = scoredMatches.filter((match) => match.result !== '平局' && Math.abs(scoreParts(match.score)[0] - scoreParts(match.score)[1]) === 1).length
  const controlledCleanWins = scoredMatches.filter((match) => {
    if (match.result === '平局') return false
    const [left, right] = scoreParts(match.score)
    const winner = Math.max(left ?? 0, right ?? 0)
    const loser = Math.min(left ?? 0, right ?? 0)
    return loser === 0 && winner >= 2 && match.totalGoals <= 3
  }).length
  const favoriteConcededWins = scoredMatches.filter((match) => {
    if (!match.prediction?.available || match.prediction.predictedResult !== match.result || match.result === '平局') return false
    const [left, right] = scoreParts(match.score)
    return match.prediction.favoriteSide === 'home' ? right > 0 : left > 0
  }).length
  const favoriteCleanSheetUnderweighted = predictionSamples.filter((match) => {
    if (match.prediction.predictedResult !== match.result || match.result === '平局') return false
    const [homeGoals, awayGoals] = scoreParts(match.score)
    const [predictedHomeGoals, predictedAwayGoals] = scoreParts(match.prediction.topScores[0]?.score)
    if ([homeGoals, awayGoals, predictedHomeGoals, predictedAwayGoals].some((value) => value === null)) return false

    const favoriteSide = match.prediction.favoriteSide
    const actualFavoriteGoals = favoriteSide === 'home' ? homeGoals : awayGoals
    const actualUnderdogGoals = favoriteSide === 'home' ? awayGoals : homeGoals
    const predictedUnderdogGoals = favoriteSide === 'home' ? predictedAwayGoals : predictedHomeGoals
    return actualFavoriteGoals >= 2 && actualUnderdogGoals === 0 && predictedUnderdogGoals >= 1
  }).length
  const highGoalMatches = scoredMatches.filter((match) => match.totalGoals >= 4).length
  const drawMatches = scoredMatches.filter((match) => match.result === '平局').length
  const recentThree = completedMatches.slice(0, 3)
  const recentKnockoutNonDraws = recentThree.filter((match) => match.result !== '平局').length
  const recentPredictionSamples = predictionSamples.slice(0, 4)
  const recentPredictedDraws = recentPredictionSamples.filter((match) => match.prediction.predictedResult === '平局')
  const recentDrawOvercalls = recentPredictedDraws.filter((match) => match.result !== '平局')
  const goalAverage =
    scoredMatches.length > 0 ? round(scoredMatches.reduce((sum, match) => sum + match.totalGoals, 0) / scoredMatches.length, 2) : 0
  const resultHits = predictionSamples.filter((match) => match.prediction.predictedResult === match.result).length
  const topScoreHits = predictionSamples.filter((match) => match.prediction.topScoreHit).length
  const top3ScoreHits = predictionSamples.filter((match) => match.prediction.top3ScoreHit).length
  const totalBandHits = predictionSamples.filter((match) => match.prediction.totalBandHit).length
  const favoriteHitRate = predictionSamples.length > 0 ? resultHits / predictionSamples.length : 0
  const topScoreHitRate = predictionSamples.length > 0 ? topScoreHits / predictionSamples.length : 0
  const top3ScoreHitRate = predictionSamples.length > 0 ? top3ScoreHits / predictionSamples.length : 0
  const totalBandHitRate = predictionSamples.length > 0 ? totalBandHits / predictionSamples.length : 0
  const highGoalRate = scoredMatches.length > 0 ? highGoalMatches / scoredMatches.length : 0
  const drawRate = scoredMatches.length > 0 ? drawMatches / scoredMatches.length : 0
  const oneGoalRate = scoredMatches.length > 0 ? oneGoalWins / scoredMatches.length : 0
  const favoriteConcededWinRate = predictionSamples.length > 0 ? favoriteConcededWins / predictionSamples.length : 0
  const reflection = buildPredictionReflection(predictionSamples)
  const reflectionPatterns = new Set(reflection.mistakePatterns.map((item) => item.pattern))
  const trainingAdvice = buildTrainingAdvice({
    sampleSize: scoredMatches.length,
    predictionSamples: predictionSamples.length,
    favoriteHitRate,
    topScoreHitRate,
    top3ScoreHitRate,
    totalBandHitRate,
    highGoalRate,
    drawRate,
    oneGoalRate,
    favoriteConcededWinRate,
    recentKnockoutNonDraws,
  })

  return {
    title: '赛后复盘校准',
    scope: `本届世界杯 ${TOURNAMENT_START_DATE} 至 ${targetDateChina} 已完赛样本`,
    standardEvaluation,
    trainingSet: {
      sampleSize: scoredMatches.length,
      predictionSamples: predictionSamples.length,
      goalAverage,
      drawRate: round(drawRate, 4),
      oneGoalWinRate: round(oneGoalRate, 4),
      highGoalRate: round(highGoalRate, 4),
      lowDraws,
      controlledCleanWins,
      favoritesConverted,
      favoriteConcededWins,
      favoriteCleanSheetUnderweighted,
      recentPredictedDraws: recentPredictedDraws.length,
      recentDrawOvercalls: recentDrawOvercalls.length,
      regulationScoreCorrections: regulationScoreOverrides.size,
      resultAccuracy: round(favoriteHitRate, 4),
      topScoreAccuracy: round(topScoreHitRate, 4),
      top3ScoreAccuracy: round(top3ScoreHitRate, 4),
      totalBandAccuracy: round(totalBandHitRate, 4),
    },
    completedMatches: recentCompleted,
    recentCompleted,
    reflection,
    predictionBacktest: predictionSamples.slice(0, 12).map((match) => ({
      id: match.id,
      kickoffChina: match.kickoffChina,
      matchup: `${match.home} vs ${match.away}`,
      actual: `${match.score} ${match.result}`,
      predictedResult: match.prediction.predictedResult,
      predictedScore: match.prediction.topScores[0]?.score ?? '无',
      top3Scores: match.prediction.topScores.slice(0, 3).map((item) => item.score),
      totalBand: match.prediction.totalBand,
      hit: {
        result: match.prediction.predictedResult === match.result,
        topScore: match.prediction.topScoreHit,
        top3Score: match.prediction.top3ScoreHit,
        totalBand: match.prediction.totalBandHit,
      },
    })),
    lessons: [
      favoritesConverted >= 2
        ? '强队一旦早早打开局面，尾部比分需要上调，不能只停留在 1-0 / 2-0。'
        : '强队大胜样本不多，继续把两球以内胜作为基准，不盲目追大比分。',
      lowDraws >= 1
        ? '低总进球和平局热度仍有效，实力接近且节奏慢的比赛保留 0-0 / 1-1。'
        : '平局没有形成主线样本，低比分平局只做防守层。',
      oneGoalWins >= 2
        ? '一球小胜仍是主流落点，强弱不极端时比分优先一球差。'
        : '一球小胜权重维持，但遇到心理顺风和教练执行稳定的强队，上调穿盘可能。',
      controlledCleanWins >= 2
        ? '最新淘汰赛出现多场强侧零封控场胜，热门队在领先后仍可能把比分带到 2-0 / 3-0，不能过度停在 0-0 / 1-0。'
        : '零封控场胜样本不足，强队大胜仍需赔率和阵容共同确认。',
      favoriteCleanSheetUnderweighted >= 1
        ? `近期有 ${favoriteCleanSheetUnderweighted} 场方向命中但弱队进球被高估；小球盘口占优时，把 2-0 与 3-0 的零封路径排到同档带球胜之前。`
        : '近期未出现明显的弱队进球高估，零封与双方进球路径维持原权重。',
      regulationScoreOverrides.size > 0
        ? `已将 ${regulationScoreOverrides.size} 场加时/点球淘汰赛重建为90分钟含补时比分，赛后标签、本届战绩和近5场不再混入加时进球。`
        : '当前已完赛样本没有需要剔除的加时或点球进球。',
      recentKnockoutNonDraws >= 3
        ? '最近三场淘汰赛90分钟均分出胜负，平局仍要防，但热门或准主场方的控场胜权重上调。'
        : '淘汰赛仍保留加时点球牵引，实力接近场继续防 0-0 / 1-1。',
      recentDrawOvercalls.length >= 2
        ? `最近 ${recentPredictedDraws.length} 次平局主判中有 ${recentDrawOvercalls.length} 次在90分钟分出胜负；本轮平局仍保留，但不再让单一 0-0 / 1-1 压过盘口与模拟共同支持的一球胜。`
        : '近期平局主判没有连续误报，维持原有低比分平局防守权重。',
      ...trainingAdvice,
      ...reflection.modelChanges,
      '新增历届世界杯底蕴层：冠军、四强、八强和近代淘汰赛经验只做低权重加成，用来修正抗压与临场执行，不覆盖当前赔率和近况。',
      '本轮新增球员心态、教练执行、抗压稳定性代理指标；文化占卜继续低权重，不覆盖可验证信息。',
    ],
    calibration: {
      favoriteTailBoost: favoritesConverted >= 2 ? 1 : 0,
      lowDrawRetention: lowDraws >= 1 ? 1 : 0,
      oneGoalBaseline: oneGoalWins >= 2 ? 1 : 0,
      favoriteControlBoost: controlledCleanWins >= 2 ? 1 : 0,
      knockoutDrawFade: recentThree.length >= 3 && recentKnockoutNonDraws >= 3 ? 1 : 0,
      underdogGoalRetention: favoriteConcededWinRate >= 0.18 || (predictionSamples.length > 0 && topScoreHitRate < 0.18) ? 1 : 0,
      highGoalVolatility: highGoalRate >= 0.24 || (predictionSamples.length > 0 && totalBandHitRate < 0.52) ? 1 : 0,
      drawGuard: drawRate >= 0.2 || (predictionSamples.length > 0 && top3ScoreHitRate < 0.42) ? 1 : 0,
      singleScoreCaution: predictionSamples.length > 0 && topScoreHitRate < 0.18 ? 1 : 0,
      agreementArbitration: 1,
      conflictDowngrade: predictionSamples.length > 0 && top3ScoreHitRate < 0.45 ? 1 : 0,
      homeNarrativeDampening: reflectionPatterns.has('主场/东道主叙事不能压过客队硬实力') ? 1 : 0,
      awayFavoriteTailGuard: reflectionPatterns.has('客队高火力尾部需要保留') ? 1 : 0,
      eliteLowScoreGuard: reflectionPatterns.has('强强淘汰赛可能被高估总进球') ? 1 : 0,
      underdogMultiGoalGuard: reflectionPatterns.has('热门赢球时弱队可能进两球') ? 1 : 0,
      zeroGoalTotalGuard: reflectionPatterns.has('低总进球区间必须覆盖0球') ? 1 : 0,
      favoriteCleanSheetReorder: favoriteCleanSheetUnderweighted >= 1 ? 1 : 0,
      lateKnockoutDrawOvercall: recentPredictedDraws.length >= 2 && recentDrawOvercalls.length >= 2 ? 1 : 0,
    },
  }
}

function buildPredictionReflection(predictionSamples) {
  const sampleSize = predictionSamples.length

  if (sampleSize === 0) {
    return {
      headline: '还没有可回放的赛前预测档案，本轮只能用赛果分布做保守校准。',
      sampleSize,
      resultMissCount: 0,
      exactScoreMissCount: 0,
      top3ScoreMissCount: 0,
      totalBandMissCount: 0,
      missRates: {
        result: 0,
        exactScore: 0,
        top3Score: 0,
        totalBand: 0,
      },
      mistakePatterns: [],
      recentMisses: [],
      modelChanges: ['没有预测档案时不输出强结论，只保留赔率、总进球和一球差基线。'],
    }
  }

  const resultMisses = predictionSamples.filter((match) => match.prediction.predictedResult !== match.result)
  const exactScoreMisses = predictionSamples.filter((match) => !match.prediction.topScoreHit)
  const top3ScoreMisses = predictionSamples.filter((match) => !match.prediction.top3ScoreHit)
  const totalBandMisses = predictionSamples.filter((match) => match.prediction.totalBandHit === false)
  const exactMissButResultHit = predictionSamples.filter(
    (match) => !match.prediction.topScoreHit && match.prediction.predictedResult === match.result,
  )
  const predictedDrawActualWin = resultMisses.filter((match) => match.prediction.predictedResult === '平局' && match.result !== '平局')
  const predictedWinActualDraw = resultMisses.filter((match) => match.prediction.predictedResult !== '平局' && match.result === '平局')
  const scoreTooLow = exactScoreMisses.filter((match) => {
    const predictedTotal = scoreTotal(match.prediction.topScores[0]?.score)
    return predictedTotal !== null && predictedTotal < match.totalGoals
  })
  const scoreTooHigh = exactScoreMisses.filter((match) => {
    const predictedTotal = scoreTotal(match.prediction.topScores[0]?.score)
    return predictedTotal !== null && predictedTotal > match.totalGoals
  })
  const homeNarrativeMisses = resultMisses.filter((match) => {
    const [homeGoals, awayGoals] = scoreParts(match.score)
    return (
      match.prediction.predictedResult === '主胜' &&
      match.result === '客胜' &&
      Number.isFinite(homeGoals) &&
      Number.isFinite(awayGoals) &&
      awayGoals - homeGoals >= 2
    )
  })
  const awayHighTempoMisses = resultMisses.filter((match) => {
    const [homeGoals, awayGoals] = scoreParts(match.score)
    return (
      match.result === '客胜' &&
      Number.isFinite(homeGoals) &&
      Number.isFinite(awayGoals) &&
      awayGoals >= 3 &&
      match.totalGoals >= 4
    )
  })
  const eliteLowScoreMisses = predictionSamples.filter((match) => {
    const predictedTotal = scoreTotal(match.prediction.topScores[0]?.score)
    return (
      match.prediction.predictedResult === match.result &&
      match.prediction.totalBandHit === false &&
      predictedTotal !== null &&
      predictedTotal >= 3 &&
      match.totalGoals <= 1
    )
  })
  const underdogMultiGoalMisses = predictionSamples.filter((match) => {
    if (match.prediction.predictedResult !== match.result || match.result === '平局' || match.totalGoals < 5) return false
    const [actualHome, actualAway] = scoreParts(match.score)
    const [predictedHome, predictedAway] = scoreParts(match.prediction.topScores[0]?.score)
    if (![actualHome, actualAway, predictedHome, predictedAway].every(Number.isFinite)) return false
    const actualLoserGoals = Math.min(actualHome, actualAway)
    const predictedLoserGoals = Math.min(predictedHome, predictedAway)
    return actualLoserGoals >= 2 && predictedLoserGoals <= 1
  })
  const zeroGoalBandMisses = predictionSamples.filter(
    (match) => match.totalGoals === 0 && match.prediction.totalBandHit === false,
  )
  const cleanSheetOverrated = exactScoreMisses.filter((match) => {
    const predicted = scoreParts(match.prediction.topScores[0]?.score)
    const actual = scoreParts(match.score)
    if (predicted.length < 2 || actual.length < 2) return false
    return (predicted[0] === 0 || predicted[1] === 0) && actual[0] > 0 && actual[1] > 0
  })

  const mistakePatterns = [
    {
      pattern: '比分首选命中偏低',
      evidence: `首选比分错 ${exactScoreMisses.length}/${sampleSize}，但方向命中后仍错比分 ${exactMissButResultHit.length} 场。`,
      adjustment: '首选比分只做小额核验；输出时必须同时给前三比分、总进球区间和放弃条件。',
    },
    scoreTooLow.length >= scoreTooHigh.length
      ? {
          pattern: '进球尾部容易被低估',
          evidence: `首选比分低估总进球 ${scoreTooLow.length} 场，高估 ${scoreTooHigh.length} 场。`,
          adjustment: '当淘汰赛后段进球概率、热门压制和总进球盘口同时偏高时，上调 3/4/5 球与 2-1、3-1、3-2 权重。',
        }
      : {
          pattern: '进球节奏偶尔被高估',
          evidence: `首选比分高估总进球 ${scoreTooHigh.length} 场，低估 ${scoreTooLow.length} 场。`,
          adjustment: '遇到高湿、强队领先后控场或让球穿盘信号不足时，下调 4+ 球尾部。',
        },
    predictedDrawActualWin.length > predictedWinActualDraw.length
      ? {
          pattern: '平局防守层曾被放得太重',
          evidence: `预测平局但实际分胜负 ${predictedDrawActualWin.length} 场；预测胜负但实际平局 ${predictedWinActualDraw.length} 场。`,
          adjustment: '淘汰赛和强弱差清楚时，平局从主方案降为小额防守，不再抢占首选方向。',
        }
      : {
          pattern: '平局仍需要防守',
          evidence: `预测胜负但实际平局 ${predictedWinActualDraw.length} 场；预测平局但实际分胜负 ${predictedDrawActualWin.length} 场。`,
          adjustment: '实力接近、总进球盘口偏低、前30分钟慢热概率高时，保留 0-0 / 1-1 防守层。',
        },
    {
      pattern: '零封路径不能机械化',
      evidence: `首选零封但实际双方进球 ${cleanSheetOverrated.length} 场。`,
      adjustment: '热门方仍可赢，但弱队一球贡献要保留，优先把 2-0 与 2-1、3-0 与 3-1 成对核验。',
    },
    {
      pattern: '总进球比单点比分更稳定',
      evidence: `总进球区间错 ${totalBandMisses.length}/${sampleSize}，通常优于精确比分首选。`,
      adjustment: '组合购买里让总进球承担节奏判断，比分只承担小额高赔率验证。',
    },
    ...(homeNarrativeMisses.length > 0
      ? [
          {
            pattern: '主场/东道主叙事不能压过客队硬实力',
            evidence: `预测主胜但实际客队两球以上取胜 ${homeNarrativeMisses.length} 场，最新典型是美国 1-4 比利时。`,
            adjustment: '当主队只是环境叙事占优，而客队杯赛攻击力、淘汰赛经验或盘口不弱时，削弱主队加成并上调客队多球胜尾部。',
          },
        ]
      : []),
    ...(awayHighTempoMisses.length > 0
      ? [
          {
            pattern: '客队高火力尾部需要保留',
            evidence: `方向错且实际客胜4+总进球 ${awayHighTempoMisses.length} 场。`,
            adjustment: '客队具备持续进攻与转换效率时，不把 1-2 当唯一客胜路径，保留 1-3 / 1-4 / 2-4 等尾部风险。',
          },
        ]
      : []),
    ...(eliteLowScoreMisses.length > 0
      ? [
          {
            pattern: '强强淘汰赛可能被高估总进球',
            evidence: `方向命中但总进球高估 ${eliteLowScoreMisses.length} 场，最新典型是葡萄牙 0-1 西班牙。`,
            adjustment: '强队互相制约、首发偏稳、淘汰赛常规时间时，下调 3+ 球扩张，增加 0-1 / 1-0 / 1-1 权重。',
          },
        ]
      : []),
    ...(underdogMultiGoalMisses.length > 0
      ? [
          {
            pattern: '热门赢球时弱队可能进两球',
            evidence: `方向命中但实际弱队进2球且总进球5+ ${underdogMultiGoalMisses.length} 场，最新典型是阿根廷 3-2 埃及。`,
            adjustment: '强队胜方向成立时，不把弱队进球上限卡死在1球；总进球均值接近3时增加 3-2 / 4-2 / 2-3 类尾部保护。',
          },
        ]
      : []),
    ...(zeroGoalBandMisses.length > 0
      ? [
          {
            pattern: '低总进球区间必须覆盖0球',
            evidence: `实际0-0但总进球区间未覆盖0球 ${zeroGoalBandMisses.length} 场，最新典型是瑞士 0-0 哥伦比亚。`,
            adjustment: '当平局概率、前30分钟慢热和低xG同时出现时，总进球推荐从 1/2 改为 0/1/2。',
          },
        ]
      : []),
  ]

  return {
    headline: `复盘结论：胜平负方向可参考，但精确比分不能重仓；模型已改为“盘口 + Poisson + 1万次模拟”冲突降级。`,
    sampleSize,
    resultMissCount: resultMisses.length,
    exactScoreMissCount: exactScoreMisses.length,
    top3ScoreMissCount: top3ScoreMisses.length,
    totalBandMissCount: totalBandMisses.length,
    missRates: {
      result: round(resultMisses.length / sampleSize, 4),
      exactScore: round(exactScoreMisses.length / sampleSize, 4),
      top3Score: round(top3ScoreMisses.length / sampleSize, 4),
      totalBand: round(totalBandMisses.length / sampleSize, 4),
    },
    mistakePatterns,
    recentMisses: [...new Map([...resultMisses, ...totalBandMisses, ...top3ScoreMisses].map((match) => [match.id, match])).values()]
      .slice(0, 6)
      .map((match) => ({
        id: match.id,
        kickoffChina: match.kickoffChina,
        matchup: `${match.home} vs ${match.away}`,
        actual: `${match.score} ${match.result}`,
        predictedResult: match.prediction.predictedResult,
        predictedScore: match.prediction.topScores[0]?.score ?? '无',
        totalBand: match.prediction.totalBand,
        missType: [
          match.prediction.predictedResult !== match.result ? '胜平负方向错' : null,
          !match.prediction.topScoreHit ? '首选比分错' : null,
          !match.prediction.top3ScoreHit ? '前三比分未覆盖' : null,
          match.prediction.totalBandHit === false ? '总进球区间错' : null,
        ]
          .filter(Boolean)
          .join(' / '),
      })),
    modelChanges: [
      '复盘后新增三模型一致性实验：盘口方向、Poisson比分方向、1万次蒙特卡洛方向不一致时自动扣分并降低投注等级。',
      '最新半决赛复盘后，首选比分改为55%校准Poisson与45%一万次进程模拟融合，单一0-0/1-1不再凭一个分布直接置顶。',
      '复盘后降低单点比分权重：比分首选不再作为重仓依据，必须与前三比分和总进球区间交叉确认。',
      '复盘后强化弱队一球路径：热门胜出时不机械零封，把 2-1 / 3-1 与 2-0 / 3-0 成对比较。',
      '复盘后把平局从“猜中高赔率”的诱惑改成防守层：只有盘口、总进球和模拟同时支持才升级为主方向。',
      ...(homeNarrativeMisses.length > 0
        ? ['昨日美国 1-4 比利时后新增主场叙事降权：东道主/准主场只作低权重环境因子，不覆盖客队杯赛强度和攻击尾部。']
        : []),
      ...(awayHighTempoMisses.length > 0
        ? ['昨日美国 1-4 比利时后新增客队高火力尾部保护：客胜方向不再只停留在一球小胜，保留多球客胜风险。']
        : []),
      ...(eliteLowScoreMisses.length > 0
        ? ['昨日葡萄牙 0-1 西班牙后新增强强低比分保护：强队淘汰赛若防守与控场信号偏强，下调总进球扩张。']
        : []),
      ...(underdogMultiGoalMisses.length > 0
        ? ['昨日阿根廷 3-2 埃及后新增弱队多球保护：热门胜出不代表对手最多一球，强队开放局要覆盖 5 球尾部。']
        : []),
      ...(zeroGoalBandMisses.length > 0
        ? ['昨日瑞士 0-0 哥伦比亚后新增0球保护：低节奏平局场的总进球区间必须能覆盖 0。']
        : []),
    ],
  }
}

function scoreTotal(score) {
  const parts = scoreParts(score)
  if (parts.length < 2) return null
  return parts[0] + parts[1]
}

async function readPredictionHistory() {
  const empty = {
    version: 1,
    updatedAt: checkedAt,
    count: 0,
    predictions: {},
  }

  try {
    const raw = await readFile(resolve(PREDICTION_HISTORY_PATH), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.predictions) {
      return {
        version: parsed.version ?? 1,
        updatedAt: parsed.updatedAt ?? checkedAt,
        count: Object.keys(parsed.predictions).length,
        predictions: parsed.predictions,
      }
    }
  } catch {
    // Missing history is expected on the first run; seed from git below.
  }

  const seeded = seedPredictionHistoryFromGit()
  return seeded.count > 0 ? seeded : empty
}

function seedPredictionHistoryFromGit() {
  const predictions = {}

  try {
    const commits = execFileSync('git', ['log', '--format=%H', '--', 'public/data/worldcup-brief.json'], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .reverse()

    for (const hash of commits) {
      try {
        const raw = execFileSync('git', ['show', `${hash}:public/data/worldcup-brief.json`], {
          encoding: 'utf8',
          maxBuffer: 24 * 1024 * 1024,
        })
        const brief = JSON.parse(raw)
        for (const match of brief.matches ?? []) {
          const id = String(match.id)
          if (!id || predictions[id]) continue
          predictions[id] = predictionRecordFromMatch(match, brief.generatedAt, hash)
        }
      } catch {
        // Ignore commits without a readable data snapshot.
      }
    }
  } catch {
    // Git history is not always available in CI or downloaded archives.
  }

  return {
    version: 1,
    updatedAt: checkedAt,
    count: Object.keys(predictions).length,
    predictions,
  }
}

function updatePredictionHistory(history, matches) {
  const predictions = { ...(history?.predictions ?? {}) }
  for (const match of matches) {
    const id = String(match.id)
    if (!id) continue
    const existing = predictions[id]
    const existingCreated = existing?.createdAt ? new Date(existing.createdAt).getTime() : Infinity
    const currentCreated = new Date(checkedAt).getTime()
    if (existing && existingCreated <= currentCreated) continue
    predictions[id] = predictionRecordFromMatch(match, checkedAt, 'current-update')
  }

  return {
    version: 1,
    updatedAt: checkedAt,
    count: Object.keys(predictions).length,
    predictions,
  }
}

function predictionRecordFromMatch(match, createdAt, sourceCommit) {
  return {
    matchId: String(match.id),
    createdAt,
    sourceCommit,
    kickoffUtc: match.kickoffUtc,
    kickoffChina: match.kickoffChina,
    home: match.home?.zhName ?? match.home?.name ?? '',
    away: match.away?.zhName ?? match.away?.name ?? '',
    marketDirection: match.professional?.expertAnswer?.marketDirection ?? '',
    recommendedScore: match.professional?.expertAnswer?.recommendedScore ?? '',
    secondaryScores: match.professional?.expertAnswer?.secondaryScores ?? [],
    totalGoals: match.professional?.expertAnswer?.totalGoals ?? '',
    topScores: (match.scoreline?.candidates ?? []).slice(0, 5).map((candidate) => ({
      score: candidate.score,
      result: candidate.result,
      probability: candidate.probability,
    })),
    resultProbabilities: match.scoreline?.resultProbabilities ?? [],
    simulationSummary: match.scoreline?.simulation?.summary ?? '',
  }
}

function buildArchivedPredictionSample(archivedPrediction, homeScore, awayScore) {
  const actualScore = `${homeScore}-${awayScore}`
  const actualTotalGoals = homeScore + awayScore
  const topScores =
    archivedPrediction.topScores?.length > 0
      ? archivedPrediction.topScores.map((item) => ({
          score: item.score,
          result: item.result ?? scoreResultFromScore(item.score),
          probability: item.probability ?? null,
        }))
      : archivedPredictionToScores(archivedPrediction)
  const predictedScore = topScores[0]?.score ?? extractScoreText(archivedPrediction.recommendedScore)
  const predictedResult = scoreResultFromScore(predictedScore) ?? resultFromMarketDirection(archivedPrediction.marketDirection)
  const totalBand = archivedPrediction.totalGoals ?? ''
  const totalBandNumbers = parseTotalBandSelection(totalBand)
  const topScoreList = topScores.length > 0 ? topScores : [{ score: predictedScore, result: predictedResult, probability: null }]

  return {
    available: true,
    provider: 'prediction-history',
    predictedResult,
    favoriteSide: sideFromResult(predictedResult),
    favoriteProbability: archivedPrediction.resultProbabilities?.find((item) => item.side === sideFromResult(predictedResult))?.probability ?? null,
    totalExpectedGoals: null,
    homeExpectedGoals: null,
    awayExpectedGoals: null,
    totalBand,
    totalBandHit: totalBandNumbers.length > 0 ? totalBandNumbers.includes(actualTotalGoals) : null,
    topScores: topScoreList,
    topScoreHit: topScoreList[0]?.score === actualScore,
    top3ScoreHit: topScoreList.slice(0, 3).some((item) => item.score === actualScore),
  }
}

function archivedPredictionToScores(archivedPrediction) {
  const scores = [
    extractScoreText(archivedPrediction.recommendedScore),
    ...(archivedPrediction.secondaryScores ?? []).map(extractScoreText),
  ].filter(Boolean)

  return [...new Set(scores)].map((score) => ({
    score,
    result: scoreResultFromScore(score),
    probability: null,
  }))
}

function extractScoreText(value) {
  const match = String(value ?? '').match(/(\d+)\s*[-:：]\s*(\d+)/)
  return match ? `${Number(match[1])}-${Number(match[2])}` : ''
}

function scoreResultFromScore(score) {
  const [homeGoals, awayGoals] = scoreParts(score)
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null
  return scoreResult(homeGoals, awayGoals)
}

function resultFromMarketDirection(value) {
  const text = String(value ?? '')
  if (text.includes('主胜')) return '主胜'
  if (text.includes('客胜')) return '客胜'
  if (text.includes('平')) return '平局'
  return '平局'
}

function sideFromResult(result) {
  if (result === '主胜') return 'home'
  if (result === '客胜') return 'away'
  return 'draw'
}

function buildCompletedPredictionSample(event, home, away, homeScore, awayScore, predictionHistory = null) {
  const archivedPrediction = predictionHistory?.predictions?.[String(event.id)]
  if (archivedPrediction) {
    return buildArchivedPredictionSample(archivedPrediction, homeScore, awayScore)
  }

  const market = normalizeMarket(event.competitions?.[0]?.odds?.[0], home, away)
  if (!market) {
    return {
      available: false,
      reason: '缺少可回放赔率',
    }
  }

  const resultProbabilities = resultProbabilitiesFromMarket(market)
  const leader = [...resultProbabilities].sort((left, right) => right.probability - left.probability)[0]
  const totalExpectedGoals = estimateTotalGoals(market)
  const goalDiff = calibrateGoalDifference(
    estimateGoalDifference(
      resultProbabilities.find((item) => item.side === 'home')?.probability ?? 0.33,
      resultProbabilities.find((item) => item.side === 'away')?.probability ?? 0.33,
      resultProbabilities.find((item) => item.side === 'draw')?.probability ?? 0.26,
      market,
    ),
    resultProbabilities.find((item) => item.side === 'home')?.probability ?? 0.33,
    resultProbabilities.find((item) => item.side === 'away')?.probability ?? 0.33,
    resultProbabilities.find((item) => item.side === 'draw')?.probability ?? 0.26,
  )
  const homeExpectedGoals = clamp(round((totalExpectedGoals + goalDiff) / 2, 2), 0.18, 4.8)
  const awayExpectedGoals = clamp(round(totalExpectedGoals - homeExpectedGoals, 2), 0.18, 4.8)
  const topScores = buildReplayScoreCandidates(homeExpectedGoals, awayExpectedGoals)
  const actualScore = `${homeScore}-${awayScore}`
  const actualTotalGoals = homeScore + awayScore
  const totalBand = totalGoalsBand(totalExpectedGoals).selection
  const totalBandNumbers = parseTotalBandSelection(totalBand)

  return {
    available: true,
    provider: market.provider,
    predictedResult: resultLabelFromSide(leader?.side),
    favoriteSide: leader?.side ?? 'draw',
    favoriteProbability: leader?.probability ?? 0,
    totalExpectedGoals,
    homeExpectedGoals,
    awayExpectedGoals,
    totalBand,
    totalBandHit: totalBandNumbers.includes(actualTotalGoals),
    topScores,
    topScoreHit: topScores[0]?.score === actualScore,
    top3ScoreHit: topScores.slice(0, 3).some((item) => item.score === actualScore),
  }
}

function buildReplayScoreCandidates(homeExpectedGoals, awayExpectedGoals) {
  const scores = []
  for (let homeGoals = 0; homeGoals <= 6; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 6; awayGoals += 1) {
      const probability = poisson(homeGoals, homeExpectedGoals) * poisson(awayGoals, awayExpectedGoals)
      scores.push({
        score: `${homeGoals}-${awayGoals}`,
        result: scoreResult(homeGoals, awayGoals),
        probability: round(probability, 4),
      })
    }
  }

  return scores.sort((left, right) => right.probability - left.probability).slice(0, 5)
}

function resultLabelFromSide(side) {
  if (side === 'home') return '主胜'
  if (side === 'away') return '客胜'
  return '平局'
}

function parseTotalBandSelection(selection) {
  return String(selection)
    .match(/\d+/g)
    ?.map((value) => Number(value))
    .filter((value) => Number.isFinite(value)) ?? []
}

function buildTrainingAdvice({
  sampleSize,
  predictionSamples,
  favoriteHitRate,
  topScoreHitRate,
  top3ScoreHitRate,
  totalBandHitRate,
  highGoalRate,
  drawRate,
  oneGoalRate,
  favoriteConcededWinRate,
  recentKnockoutNonDraws,
}) {
  if (predictionSamples === 0) {
    return [
      `训练集：本届已完赛 ${sampleSize} 场，但当前环境没有可用的赛前预测档案；本轮只用赛果分布训练进球尾部、平局率和一球差基线，不计算命中率。`,
    ]
  }

  const advice = [
    `训练集：本届已完赛 ${sampleSize} 场，其中 ${predictionSamples} 场有可回放赔率/模型预测；胜平负回放命中 ${formatPct(favoriteHitRate)}，比分首选 ${formatPct(topScoreHitRate)}，比分前三 ${formatPct(top3ScoreHitRate)}，总进球区间 ${formatPct(totalBandHitRate)}。`,
  ]

  if (topScoreHitRate < 0.18) {
    advice.push('比分首选命中偏低，训练后降低单点比分权重，更多采用前三比分和总进球区间交叉验证。')
  }
  if (top3ScoreHitRate < 0.42) {
    advice.push('比分前三覆盖不足，训练后保留平局防守和弱队进一球路径，避免过度零封化。')
  }
  if (totalBandHitRate < 0.52 || highGoalRate >= 0.24) {
    advice.push('总进球波动偏大，训练后上调 4+ 球尾部和后段进球权重，避免模型过度保守。')
  }
  if (drawRate >= 0.2) {
    advice.push('平局样本占比不低，训练后保留 0-0 / 1-1 低比分防守层，尤其用于实力接近与淘汰赛谨慎局。')
  }
  if (oneGoalRate >= 0.34) {
    advice.push('一球差仍是主流结果，训练后继续把 1-0 / 2-1 / 0-1 / 1-2 作为中强度比赛的核心落点。')
  }
  if (favoriteConcededWinRate >= 0.18) {
    advice.push('热门赢球但丢一球的比例需要重视，训练后上调 2-1 / 3-1，轻微下调机械式 2-0 / 3-0。')
  }
  if (recentKnockoutNonDraws >= 3) {
    advice.push('最近淘汰赛连续分胜负，训练后不把平局当主线，但保留小额防守，不重仓追平。')
  }

  return advice
}

function scoreParts(score) {
  return String(score)
    .split('-')
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value))
}

function isCompletedEvent(event) {
  const status = String(event.status?.type?.state ?? event.status?.type?.name ?? event.status?.type?.description ?? event.status?.type?.shortDetail ?? '').toLowerCase()
  return /post|final|ft|full/.test(status)
}

function buildRegulationScoreOverrides(events) {
  const overrides = new Map()

  for (const event of events) {
    if (!isCompletedEvent(event) || !isExtraTimeOrPenaltiesEvent(event)) continue
    const reconstructed = reconstructRegulationScore(event)
    if (reconstructed) overrides.set(String(event.id), reconstructed)
  }

  return overrides
}

function isExtraTimeOrPenaltiesEvent(event) {
  const status = [
    event.status?.type?.name,
    event.status?.type?.description,
    event.status?.type?.detail,
    event.status?.type?.shortDetail,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return Number(event.status?.period ?? 0) > 2 || /aet|after extra time|penalt|shootout/.test(status)
}

function reconstructRegulationScore(event) {
  const competition = event.competitions?.[0] ?? {}
  const competitors = competition.competitors ?? []
  const home = competitors.find((item) => item.homeAway === 'home') ?? competitors[0]
  const away = competitors.find((item) => item.homeAway === 'away') ?? competitors[1]
  const homeId = String(home?.team?.id ?? '')
  const awayId = String(away?.team?.id ?? '')
  const details = competition.details

  if (!home || !away || !Array.isArray(details)) return null

  let homeGoals = 0
  let awayGoals = 0
  let recognizedGoals = 0

  for (const detail of details) {
    if (!detail?.scoringPlay || detail?.shootout || !isRegulationScoringPlay(detail)) continue
    const value = Number(detail.scoreValue ?? 1)
    const teamId = String(detail.team?.id ?? '')
    if (!Number.isFinite(value) || value <= 0) continue

    if (teamId === homeId) homeGoals += value
    else if (teamId === awayId) awayGoals += value
    else continue
    recognizedGoals += value
  }

  const finalHome = readScore(home.score)
  const finalAway = readScore(away.score)
  if (recognizedGoals === 0 && (finalHome !== 0 || finalAway !== 0)) return null

  return { home: homeGoals, away: awayGoals, corrected: true }
}

function isRegulationScoringPlay(detail) {
  const display = String(detail?.clock?.displayValue ?? '').replace(/[’`]/g, "'")
  if (/^(45|90)\s*'?\s*\+\s*\d+/.test(display)) return true

  const minute = Number(display.match(/\d+/)?.[0])
  if (Number.isFinite(minute)) return minute <= 90

  const clockSeconds = Number(detail?.clock?.value)
  return Number.isFinite(clockSeconds) && clockSeconds <= 90 * 60
}

function regulationScoreForEvent(event) {
  const override = regulationScoreOverrides.get(String(event.id))
  if (override) return override

  const competitors = event.competitions?.[0]?.competitors ?? []
  const home = competitors.find((item) => item.homeAway === 'home') ?? competitors[0] ?? {}
  const away = competitors.find((item) => item.homeAway === 'away') ?? competitors[1] ?? {}
  const homeScore = readScore(home.score)
  const awayScore = readScore(away.score)
  if (homeScore === null || awayScore === null) return null

  return { home: homeScore, away: awayScore, corrected: false }
}

function isPreMatchEvent(event) {
  const status = String(
    event.status?.type?.state ?? event.status?.type?.name ?? event.status?.type?.description ?? event.status?.type?.shortDetail ?? '',
  ).toLowerCase()

  if (/pre|scheduled|preview/.test(status)) return true
  if (/in|live|post|final|ft|full|half|extra|pen/.test(status)) return false
  return !isCompletedEvent(event)
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

async function buildMatchContext(
  event,
  competition,
  homeTeam,
  awayTeam,
  homeCompetitor,
  awayCompetitor,
  newsItems,
  tournamentRecords = new Map(),
  groupStandings = new Map(),
  knockoutPaths = new Map(),
) {
  const venueName = competition.venue?.fullName ?? ''
  const venueCity = competition.venue?.address?.city ?? ''
  const [homeRecent, awayRecent, homeInjuries, awayInjuries, weather] = await Promise.all([
    fetchTeamRecentContext(homeTeam, event.date),
    fetchTeamRecentContext(awayTeam, event.date),
    fetchTeamInjuryContext(homeTeam, newsItems, event.date),
    fetchTeamInjuryContext(awayTeam, newsItems, event.date),
    fetchWeatherContext(venueName, venueCity, event.date),
  ])

  const homeContext = {
    ...homeRecent,
    tournament: tournamentRecordForTeam(tournamentRecords, homeTeam),
    history: worldCupHistoryForTeam(homeTeam),
    injuries: homeInjuries,
    playerSignals: extractPlayerSignals(homeCompetitor),
  }
  const awayContext = {
    ...awayRecent,
    tournament: tournamentRecordForTeam(tournamentRecords, awayTeam),
    history: worldCupHistoryForTeam(awayTeam),
    injuries: awayInjuries,
    playerSignals: extractPlayerSignals(awayCompetitor),
  }
  const geography = buildGeographyContext(homeTeam, awayTeam, weather)
  const divination = buildDivinationContext(event, homeTeam, awayTeam, geography, weather)
  const humanFactors = buildHumanFactors(homeTeam, awayTeam, homeContext, awayContext, weather, newsItems)
  const advancement = buildAdvancementContext(event, competition, homeTeam, awayTeam, homeContext, awayContext, groupStandings, knockoutPaths)
  const situational = buildSituationalContext(event, homeTeam, awayTeam, homeContext, awayContext, geography, weather, advancement)
  const adjustment = buildContextAdjustment(homeContext, awayContext, weather, geography, divination, humanFactors, advancement, situational)

  return {
    home: homeContext,
    away: awayContext,
    weather,
    geography,
    divination,
    humanFactors,
    advancement,
    situational,
    adjustment,
    note: '近况、球员、伤病、天气、地理、历届世界杯底蕴、赛程体能、生物钟、主场环境、晋级压力与半区对手强度进入分层模型；古法占卜仅作文化展示，数值权重为0。',
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
      .sort((left, right) => new Date(right.dateUtc).getTime() - new Date(left.dateUtc).getTime())
      .slice(0, 5)
    const formLetters = recentMatches.map((match) => match.result).join('') || team.form || ''
    const wins = recentMatches.filter((match) => match.result === 'W').length
    const draws = recentMatches.filter((match) => match.result === 'D').length
    const sampleSize = recentMatches.length
    const weightedForm = recencyWeightedForm(recentMatches)
    const formScore = weightedForm.formScore

    return {
      formString: formLetters,
      recentMatches,
      sampleSize,
      formScore,
      goalsForAvg: weightedForm.goalsForAvg,
      goalsAgainstAvg: weightedForm.goalsAgainstAvg,
      trendNote:
        sampleSize >= 3
          ? `近 ${sampleSize} 场 ${wins} 胜 ${draws} 平；按 2.5 场半衰期加权后场均 ${weightedForm.goalsForAvg}-${weightedForm.goalsAgainstAvg}。`
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

function recencyWeightedForm(recentMatches) {
  if (!recentMatches.length) {
    return { formScore: 46, goalsForAvg: null, goalsAgainstAvg: null }
  }

  const halfLifeMatches = 2.5
  const weighted = recentMatches.map((match, index) => ({
    match,
    weight: 0.5 ** (index / halfLifeMatches),
  }))
  const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0)
  const resultRate =
    weighted.reduce(
      (sum, item) => sum + item.weight * (item.match.result === 'W' ? 1 : item.match.result === 'D' ? 0.38 : 0),
      0,
    ) / weightSum
  const goalsForAvg = weighted.reduce((sum, item) => sum + item.weight * item.match.goalsFor, 0) / weightSum
  const goalsAgainstAvg = weighted.reduce((sum, item) => sum + item.weight * item.match.goalsAgainst, 0) / weightSum
  const goalDiffAvg = goalsForAvg - goalsAgainstAvg
  const samplePenalty = Math.max(0, 5 - recentMatches.length) * 3
  const formScore = clamp(Math.round(28 + resultRate * 52 + clamp(goalDiffAvg, -2, 2) * 5 - samplePenalty), 18, 88)

  return {
    formScore,
    goalsForAvg: round(goalsForAvg, 2),
    goalsAgainstAvg: round(goalsAgainstAvg, 2),
  }
}

function normalizeRecentMatch(event, team, cutoff) {
  const eventTime = new Date(event.date).getTime()
  if (!Number.isFinite(eventTime) || eventTime >= cutoff) return null

  const competitors = event.competitions?.[0]?.competitors ?? []
  const own = competitors.find((item) => String(item.team?.id) === String(team.id) || item.team?.displayName === team.name)
  const opponent = competitors.find((item) => item !== own)
  const regulationScore = regulationScoreForEvent(event)
  const ownScore = own?.homeAway === 'home' ? regulationScore?.home : regulationScore?.away
  const opponentScore = opponent?.homeAway === 'home' ? regulationScore?.home : regulationScore?.away
  if (!own || !opponent || !Number.isFinite(ownScore) || !Number.isFinite(opponentScore)) return null

  const result = ownScore > opponentScore ? 'W' : ownScore < opponentScore ? 'L' : 'D'
  const homeAway = own.homeAway === 'home' ? '主' : own.homeAway === 'away' ? '客' : '中'
  const league = event.league?.abbreviation ?? event.season?.slug ?? '赛事'

  return {
    date: formatShortDate(event.date),
    dateUtc: event.date,
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

async function fetchTeamInjuryContext(team, newsItems, kickoffUtc) {
  contextStats.injuriesTried += 1
  const url = `${TEAM_INJURY_URL}/${encodeURIComponent(team.id)}/injuries`
  const aliases = teamNewsAliases(team)
  const relatedNews = newsItems
    .filter((item) => {
      const text = `${item.title} ${item.summary}`.toLowerCase()
      return aliases.some((alias) => alias && text.includes(alias))
    })
    .slice(0, 2)
  const verified = verifiedAvailabilityForTeam(team, kickoffUtc)

  try {
    const data = await fetchJson(url)
    contextStats.injuriesOk += 1
    const items = [...extractInjuryItems(data), ...(verified?.items ?? [])].slice(0, 5)
    const itemRisk = items.reduce((sum, item) => sum + (Number.isFinite(item.riskWeight) ? item.riskWeight : 18), 0)
    const riskScore = clamp(Math.max(itemRisk, verified?.riskFloor ?? 0), 0, 78)

    return {
      status: items.length > 0 ? `${items.length} 条伤病/出战信息` : 'ESPN 未列出明确伤病',
      riskScore,
      items,
      relatedNews: [...relatedNews.map((item) => item.title), ...(verified?.headline ? [verified.headline] : [])],
      note:
        verified?.note ??
        (items.length > 0
          ? items.slice(0, 2).map((item) => `${item.player} ${item.status}`).join('；')
          : '公开伤病源未给出明确缺阵；新闻关键词只作提醒，不计入数值伤停分，仍需赛前首发核验。'),
      sourceUrl: verified?.sourceUrl ?? url,
    }
  } catch (error) {
    return {
      status: '伤病接口不可用',
      riskScore: Math.max(20, verified?.riskFloor ?? 0),
      items: verified?.items ?? [],
      relatedNews: [...relatedNews.map((item) => item.title), ...(verified?.headline ? [verified.headline] : [])],
      note: verified?.note ?? `伤病接口失败：${shortError(error)}；保留接口缺失基线，新闻关键词只作提醒。`,
      sourceUrl: verified?.sourceUrl ?? url,
    }
  }
}

function verifiedAvailabilityForTeam(team, kickoffUtc) {
  const verified = verifiedAvailabilityOverrides.get(team.name) ?? verifiedAvailabilityOverrides.get(team.zhName)
  if (!verified) return null
  const kickoffTime = new Date(kickoffUtc).getTime()
  const effectiveThrough = new Date(verified.effectiveThrough).getTime()
  return Number.isFinite(kickoffTime) && kickoffTime <= effectiveThrough ? verified : null
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

function buildDivinationContext(event, homeTeam, awayTeam, geography, weather) {
  const kickoff = new Date(event.date)
  const chinaParts = chinaDateParts(event.date)
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
  const homeTrigramElement = trigramElements[homeIndex]
  const awayTrigramElement = trigramElements[awayIndex]
  const dayElement = fiveElements[positiveModulo(chinaParts.year + chinaParts.month * 2 + chinaParts.day * 3, 5)]
  const hour = hourBranchContext(chinaParts.hour)
  const weatherElement = weatherElementContext(weather)
  const homeNameElement = fiveElements[positiveModulo(stringScore(homeTeam.zhName || homeTeam.name), 5)]
  const awayNameElement = fiveElements[positiveModulo(stringScore(awayTeam.zhName || awayTeam.name), 5)]
  const relationEdge =
    elementDuelEdge(geography.homeElement, geography.awayElement) + elementDuelEdge(homeNameElement, awayNameElement) * 0.35
  const homeFortune = round(
    weightedElementHarmony(dayElement, geography.homeElement, 0.9) +
      weightedElementHarmony(hour.element, geography.homeElement, 0.7) +
      weightedElementHarmony(weatherElement, geography.homeElement, 0.55) +
      weightedElementHarmony(homeTrigramElement, geography.homeElement, 0.7) +
      weightedElementHarmony(dayElement, homeNameElement, 0.35) +
      relationEdge,
    2,
  )
  const awayFortune = round(
    weightedElementHarmony(dayElement, geography.awayElement, 0.9) +
      weightedElementHarmony(hour.element, geography.awayElement, 0.7) +
      weightedElementHarmony(weatherElement, geography.awayElement, 0.55) +
      weightedElementHarmony(awayTrigramElement, geography.awayElement, 0.7) +
      weightedElementHarmony(dayElement, awayNameElement, 0.35) -
      relationEdge,
    2,
  )
  const delta = clamp(round(homeFortune - awayFortune, 2), -4, 4)
  const lean = Math.abs(delta) <= 0.9 ? 'neutral' : delta > 0 ? 'home' : 'away'
  const relationNote = elementRelationNote(geography.homeElement, geography.awayElement, homeTeam.zhName, awayTeam.zhName)

  return {
    method: '梅花易数取数 + 日时五行 + 天气五行 + 方位生克低权重合参',
    homeSymbol: `${trigrams[homeIndex]}(${homeTrigramElement})`,
    awaySymbol: `${trigrams[awayIndex]}(${awayTrigramElement})`,
    dayElement,
    hourBranch: hour.branch,
    hourElement: hour.element,
    weatherElement,
    homeNameElement,
    awayNameElement,
    homeFortune,
    awayFortune,
    relationNote,
    breakdown: [
      `日五行 ${dayElement}，${hour.branch}时取 ${hour.element}，天气取 ${weatherElement}。`,
      `${homeTeam.zhName}：地域 ${geography.homeElement}，队名取 ${homeNameElement}，卦象 ${trigrams[homeIndex]}(${homeTrigramElement})，运势 ${homeFortune}。`,
      `${awayTeam.zhName}：地域 ${geography.awayElement}，队名取 ${awayNameElement}，卦象 ${trigrams[awayIndex]}(${awayTrigramElement})，运势 ${awayFortune}。`,
      relationNote,
    ],
    lean,
    delta,
    weight: '≤4%，只作文化辅助',
    summary:
      lean === 'neutral'
        ? `五行八卦合参差距很小，不改变主模型。日 ${dayElement}、${hour.branch}时 ${hour.element}、天气 ${weatherElement}。`
        : `五行八卦合参略偏${lean === 'home' ? homeTeam.zhName : awayTeam.zhName}，只作为低权重校验；日 ${dayElement}、${hour.branch}时 ${hour.element}、天气 ${weatherElement}。`,
  }
}

function buildHumanFactors(homeTeam, awayTeam, homeContext, awayContext, weather, newsItems) {
  const home = teamHumanProfile(homeTeam, homeContext, awayContext, weather, newsItems)
  const away = teamHumanProfile(awayTeam, awayContext, homeContext, weather, newsItems)
  const homeCombined = round(home.mentality * 0.52 + home.coach * 0.48, 1)
  const awayCombined = round(away.mentality * 0.52 + away.coach * 0.48, 1)
  const edge = round(homeCombined - awayCombined, 1)
  const lean = Math.abs(edge) < 4 ? 'neutral' : edge > 0 ? 'home' : 'away'

  return {
    home,
    away,
    homeCombined,
    awayCombined,
    edge,
    lean,
    summary:
      lean === 'neutral'
        ? `心态/教练代理：双方接近（${homeCombined}-${awayCombined}），不单独改变主方向。`
        : `心态/教练代理：${lean === 'home' ? homeTeam.zhName : awayTeam.zhName} ${homeCombined}-${awayCombined} 占优，提升其一球差和顺风扩大比分路径。`,
  }
}

function buildAdvancementContext(event, competition, homeTeam, awayTeam, homeContext, awayContext, groupStandings, knockoutPaths) {
  const stage = event.season?.slug ?? 'unknown'
  const stageLabel = competition.altGameNote ?? event.season?.type?.name ?? 'FIFA World Cup'

  if (stage === 'third-place' || stage === '3rd-place-match') {
    const matchup = new Set([homeTeam.name, awayTeam.name])
    const motivationNote =
      matchup.has('France') && matchup.has('England')
        ? '法国有德尚国家队告别战与姆巴佩金靴竞争，英格兰有单届胜场和贝林厄姆个人纪录动机。'
        : '双方仍有领奖台和个人荣誉动机。'
    return {
      stage,
      stageLabel: '三四名决赛',
      pressureType: 'placement',
      pressureScore: 64,
      pressureLevel: '中',
      homePressure: 62,
      awayPressure: 64,
      homeNeed: '无晋级压力，但需平衡荣誉、个人奖项与轮换。',
      awayNeed: '无晋级压力，但需平衡荣誉、个人奖项与轮换。',
      bracketOpponentStrength: null,
      nextOpponentPool: [],
      summary: `三四名决赛没有晋级压力，轮换和失利后的心理波动高于普通淘汰赛，节奏通常更开放。${motivationNote}`,
      sourceUrl: 'https://www.foxsports.com/stories/soccer/2026-world-cup-third-place-odds-france-england',
      homeGoalDiffDelta: 0,
      totalGoalsDelta: 0.08,
      riskDelta: 6,
      confidenceDelta: -4,
    }
  }

  if (knockoutStageLabels.has(stage)) {
    const path = knockoutPaths.get(String(event.id))
    const maxOpponentStrength = path?.maxOpponentStrength ?? 52
    const opponentPressure = maxOpponentStrength >= 74 ? 8 : maxOpponentStrength >= 66 ? 5 : 3
    const stagePressureBonus = stage === 'final' ? 5 : stage === 'semifinals' ? 3 : stage === 'quarterfinals' ? 2 : 0
    const pressureScore = clamp(86 + opponentPressure + stagePressureBonus, 84, 96)
    const knockoutStageLabel = knockoutStageLabels.get(stage)
    const opponentText = path?.nextOpponentPool?.length
      ? path.nextOpponentPool.map((team) => `${team.zhName}${team.placeholder ? '' : `(${team.strengthScore})`}`).join(' / ')
      : '待定'

    return {
      stage,
      stageLabel: knockoutStageLabel,
      pressureType: 'knockout',
      pressureScore,
      pressureLevel: pressureScore >= 88 ? '高' : '中',
      homePressure: 90,
      awayPressure: 90,
      homeNeed: '输球出局，开局容错率很低。',
      awayNeed: '输球出局，开局容错率很低。',
      bracketOpponentStrength: round(maxOpponentStrength, 1),
      nextOpponentPool: path?.nextOpponentPool ?? [],
      summary: `${knockoutStageLabel}：输球即出局；晋级后潜在对手 ${opponentText}，对手池最高强度 ${round(maxOpponentStrength, 1)}。模型计入90分钟僵持、加时牵引和后段风险，但不把加时与点球计入赛果。`,
      homeGoalDiffDelta: 0,
      totalGoalsDelta: maxOpponentStrength >= 70 || stage === 'final' ? -0.06 : stage === 'semifinals' || stage === 'quarterfinals' ? -0.05 : -0.03,
      riskDelta: opponentPressure,
      confidenceDelta: -2,
    }
  }

  if (stage === 'group-stage') {
    const group = groupStandings.get(stageLabel)
    const homeStanding = standingForTeam(group, homeTeam)
    const awayStanding = standingForTeam(group, awayTeam)
    const homeProfile = groupPressureProfile(homeStanding, group, homeContext)
    const awayProfile = groupPressureProfile(awayStanding, group, awayContext)
    const pressureScore = Math.max(homeProfile.pressure, awayProfile.pressure)
    const bothMustChase = homeProfile.mode === 'mustWin' && awayProfile.mode === 'mustWin'
    const hasDrawEnough = homeProfile.mode === 'drawEnough' || awayProfile.mode === 'drawEnough'
    const hasRotationRisk = homeProfile.mode === 'protectSeed' || awayProfile.mode === 'protectSeed'
    const pressureEdge = clamp((homeProfile.pressure - awayProfile.pressure) / 100, -1, 1)
    const totalGoalsDelta = clamp(
      round((bothMustChase ? 0.08 : 0) + (pressureScore >= 78 ? 0.03 : 0) - (hasDrawEnough ? 0.04 : 0) - (hasRotationRisk ? 0.03 : 0), 2),
      -0.08,
      0.13,
    )

    return {
      stage,
      stageLabel,
      pressureType: 'group',
      pressureScore,
      pressureLevel: pressureScore >= 78 ? '高' : pressureScore >= 60 ? '中' : '低',
      homePressure: homeProfile.pressure,
      awayPressure: awayProfile.pressure,
      homeNeed: homeProfile.need,
      awayNeed: awayProfile.need,
      bracketOpponentStrength: null,
      nextOpponentPool: [],
      summary: `${stageLabel} 末轮形势：${homeTeam.zhName}${homeProfile.need}；${awayTeam.zhName}${awayProfile.need}。压力差会影响开局谨慎和后段追球，小组赛半区对手仍以最终排名为准。`,
      homeGoalDiffDelta: clamp(round(pressureEdge * 0.07, 2), -0.07, 0.07),
      totalGoalsDelta,
      riskDelta: clamp(Math.round((pressureScore - 52) / 8), 0, 7),
      confidenceDelta: pressureScore >= 82 ? -2 : pressureScore >= 65 ? -1 : 0,
    }
  }

  return {
    stage,
    stageLabel,
    pressureType: 'none',
    pressureScore: 45,
    pressureLevel: '低',
    homePressure: 45,
    awayPressure: 45,
    homeNeed: '暂无明确晋级压力修正。',
    awayNeed: '暂无明确晋级压力修正。',
    bracketOpponentStrength: null,
    nextOpponentPool: [],
    summary: '晋级形势暂未形成强修正，按基础实力、近况和市场赔率处理。',
    homeGoalDiffDelta: 0,
    totalGoalsDelta: 0,
    riskDelta: 0,
    confidenceDelta: 0,
  }
}

function standingForTeam(group, team) {
  if (!group?.teams?.length) return null
  const keys = new Set([normalizeTeamKey(team.name), normalizeTeamKey(team.zhName)])
  return group.teams.find((item) => keys.has(normalizeTeamKey(item.name)) || keys.has(normalizeTeamKey(item.zhName))) ?? null
}

function groupPressureProfile(standing, group, context) {
  const record = context?.tournament
  if (!standing) {
    return {
      pressure: 55,
      mode: 'unknown',
      need: record?.played ? `本届 ${record.points} 分，需赛前核验小组排名。` : '小组排名待核验。',
    }
  }

  const rankText = `现第${standing.rank}，${standing.points}分，净胜球${standing.goalDiff >= 0 ? '+' : ''}${standing.goalDiff}`
  const thirdLinePressure = group?.teams?.length >= 4 && standing.rank === 3
  if (standing.points >= 6) {
    return {
      pressure: 48,
      mode: 'protectSeed',
      need: `${rankText}，基本出线，主要争头名与控制消耗。`,
    }
  }
  if (standing.points === 4) {
    return {
      pressure: thirdLinePressure ? 68 : 62,
      mode: 'drawEnough',
      need: `${rankText}，不败大概率出线，赢球争头名。`,
    }
  }
  if (standing.points === 3) {
    return {
      pressure: 80,
      mode: 'mustWin',
      need: `${rankText}，赢球基本晋级，平局要看净胜球和第三名排序。`,
    }
  }
  if (standing.points === 1) {
    return {
      pressure: 86,
      mode: 'mustWin',
      need: `${rankText}，必须赢球并看其他结果。`,
    }
  }
  return {
    pressure: standing.goalDiff <= -4 ? 70 : 76,
    mode: 'spoiler',
    need: `${rankText}，理论上只剩大胜争第三或荣誉战，节奏可能更开放。`,
  }
}

function buildSituationalContext(event, homeTeam, awayTeam, homeContext, awayContext, geography, weather, advancement) {
  const kickoff = new Date(event.date)
  const kickoffMs = kickoff.getTime()
  const homeProfile = countryProfiles.get(homeTeam.name) ?? countryProfiles.get(homeTeam.zhName)
  const awayProfile = countryProfiles.get(awayTeam.name) ?? countryProfiles.get(awayTeam.zhName)
  const venueOffset = Number.isFinite(weather.longitude) ? clamp(Math.round(weather.longitude / 15), -12, 14) : null
  const localHour = venueOffset === null ? null : positiveModulo(kickoff.getUTCHours() + venueOffset, 24)
  const homeRestDays = restDaysBeforeKickoff(homeContext, kickoffMs)
  const awayRestDays = restDaysBeforeKickoff(awayContext, kickoffMs)
  const homeOffset = profileTimezoneOffset(homeProfile)
  const awayOffset = profileTimezoneOffset(awayProfile)
  const homeBodyShift = venueOffset === null || homeOffset === null ? null : Math.abs(timezoneDeltaHours(venueOffset, homeOffset))
  const awayBodyShift = venueOffset === null || awayOffset === null ? null : Math.abs(timezoneDeltaHours(venueOffset, awayOffset))
  const restEdgeDays = (homeRestDays ?? 4) - (awayRestDays ?? 4)
  const bodyClockEdge = (awayBodyShift ?? 4) - (homeBodyShift ?? 4)
  const hostCountry = venueHostCountry(weather)
  const homeHost = hostCountry !== null && isHostTeam(homeTeam, hostCountry)
  const awayHost = hostCountry !== null && isHostTeam(awayTeam, hostCountry)
  const hostEdge = homeHost ? 1 : awayHost ? -1 : 0
  const strengthGap = Math.abs((homeContext.tournament?.strengthScore ?? 46) - (awayContext.tournament?.strengthScore ?? 46))
  const penaltyRisk =
    advancement?.pressureType === 'knockout'
      ? clamp(Math.round(82 - strengthGap * 1.4 + (localHour !== null && localHour >= 19 ? 4 : 0)), 36, 86)
      : 18
  const shortRestCount = [homeRestDays, awayRestDays].filter((days) => typeof days === 'number' && days < 4).length
  const maxBodyShift = Math.max(homeBodyShift ?? 0, awayBodyShift ?? 0)
  const heatAfternoon =
    localHour !== null &&
    localHour >= 12 &&
    localHour <= 17 &&
    ((weather.temperatureC ?? 22) >= 28 || (weather.humidity ?? 50) >= 76)
  const homeGoalDiffDelta = clamp(round(restEdgeDays * 0.035 + bodyClockEdge * 0.015 + hostEdge * 0.08, 2), -0.16, 0.16)
  const totalGoalsDelta = clamp(
    round((shortRestCount > 0 ? 0.03 : 0) + (penaltyRisk >= 70 ? -0.06 : penaltyRisk >= 58 ? -0.03 : 0) - (heatAfternoon ? 0.04 : 0), 2),
    -0.12,
    0.08,
  )
  const confidenceDelta = clamp(Math.round(Math.abs(restEdgeDays) >= 1.5 || Math.abs(bodyClockEdge) >= 4 || hostEdge !== 0 ? 1 : 0) - (penaltyRisk >= 72 ? 2 : 0), -3, 2)
  const riskDelta = clamp(Math.round(shortRestCount * 2 + (maxBodyShift >= 6 ? 3 : maxBodyShift >= 4 ? 1 : 0) + (penaltyRisk >= 70 ? 4 : penaltyRisk >= 58 ? 2 : 0) + (hostEdge !== 0 ? 1 : 0)), 0, 10)
  const restSummary = `${homeTeam.zhName}休息${formatRestDays(homeRestDays)}，${awayTeam.zhName}休息${formatRestDays(awayRestDays)}`
  const clockSummary =
    localHour === null
      ? '开球当地时段待核验'
      : `当地约${localHour}点开球，身体时钟偏移 ${homeTeam.zhName}${formatShift(homeBodyShift)} / ${awayTeam.zhName}${formatShift(awayBodyShift)}`
  const hostSummary = hostEdge === 0 ? '无明显东道主/准主场加成' : `${homeHost ? homeTeam.zhName : awayTeam.zhName}存在东道主或准主场环境加成`

  return {
    rest: {
      homeDays: homeRestDays,
      awayDays: awayRestDays,
      edgeDays: round(restEdgeDays, 1),
      summary: restSummary,
    },
    bodyClock: {
      localHour,
      homeShiftHours: homeBodyShift,
      awayShiftHours: awayBodyShift,
      edgeHours: round(bodyClockEdge, 1),
      summary: clockSummary,
    },
    host: {
      country: hostCountry,
      homeHost,
      awayHost,
      edge: hostEdge,
      summary: hostSummary,
    },
    knockoutTempo: {
      penaltyRisk,
      extraTimeRisk: advancement?.pressureType === 'knockout' ? clamp(Math.round(penaltyRisk * 0.78), 28, 72) : 12,
      summary:
        advancement?.pressureType === 'knockout'
          ? `淘汰赛拖入加时/点球风险 ${penaltyRisk}/100；该项只作为${REGULATION_SCOPE_SHORT}内谨慎程度因子，不把加时/点球计入赛果。`
          : '非淘汰赛，点球因素不参与90分钟主判断。',
    },
    homeGoalDiffDelta,
    totalGoalsDelta,
    confidenceDelta,
    riskDelta,
    summary: `${restSummary}；${clockSummary}；${hostSummary}；${advancement?.pressureType === 'knockout' ? `加时点球风险${penaltyRisk}/100，仅作90分钟保守因子` : '无点球淘汰压力'}。`,
  }
}

function restDaysBeforeKickoff(teamContext, kickoffMs) {
  const tournamentMatch = [...(teamContext.tournament?.matches ?? [])]
    .filter((match) => match.dateUtc && new Date(match.dateUtc).getTime() < kickoffMs)
    .sort((left, right) => new Date(right.dateUtc).getTime() - new Date(left.dateUtc).getTime())[0]
  const recent = tournamentMatch ?? teamContext.recentMatches?.find((match) => match.dateUtc)
  if (!recent?.dateUtc) return null
  const previousMs = new Date(recent.dateUtc).getTime()
  if (!Number.isFinite(previousMs) || previousMs >= kickoffMs) return null
  return round((kickoffMs - previousMs) / (24 * 60 * 60 * 1000), 1)
}

function profileTimezoneOffset(profile) {
  return Number.isFinite(profile?.lon) ? clamp(Math.round(profile.lon / 15), -12, 14) : null
}

function timezoneDeltaHours(left, right) {
  const raw = left - right
  if (raw > 12) return raw - 24
  if (raw < -12) return raw + 24
  return raw
}

function venueHostCountry(weather) {
  const city = String(weather.city ?? '').toLowerCase()
  const lat = weather.latitude
  const lon = weather.longitude
  if (/british columbia|ontario|quebec|alberta|canada/.test(city) || (Number.isFinite(lat) && lat >= 49.1)) return 'Canada'
  if (/mexico|ciudad|jalisco|nuevo leon|nuevo león/.test(city) || (Number.isFinite(lat) && Number.isFinite(lon) && lat <= 32.5 && lon < -86)) return 'Mexico'
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= 24 && lat <= 49.5 && lon >= -125 && lon <= -66) return 'United States'
  return null
}

function isHostTeam(team, hostCountry) {
  return normalizeTeamKey(team.name) === normalizeTeamKey(hostCountry) || normalizeTeamKey(team.zhName) === normalizeTeamKey(teamNames.get(hostCountry))
}

function formatRestDays(days) {
  return typeof days === 'number' ? `${days}天` : '待核验'
}

function formatShift(hours) {
  return typeof hours === 'number' ? `${hours}小时` : '待核验'
}

function teamHumanProfile(team, ownContext, opponentContext, weather, newsItems) {
  const recent = ownContext.recentMatches ?? []
  const form = ownContext.formString || ''
  const wins = recent.filter((match) => match.result === 'W').length || countFormResult(form, 'W')
  const draws = recent.filter((match) => match.result === 'D').length || countFormResult(form, 'D')
  const losses = recent.filter((match) => match.result === 'L').length || countFormResult(form, 'L')
  const recentTwo = recent.slice(0, 2)
  const recentPulse = recentTwo.reduce((sum, match, index) => sum + formPulse(match.result) * (index === 0 ? 1 : 0.62), 0)
  const goalsFor = ownContext.goalsForAvg ?? 1.15
  const goalsAgainst = ownContext.goalsAgainstAvg ?? 1.15
  const opponentGoalsAgainst = opponentContext.goalsAgainstAvg ?? 1.15
  const tournament = ownContext.tournament ?? defaultTournamentRecord(team)
  const history = ownContext.history ?? defaultWorldCupHistory(team)
  const injuryRisk = ownContext.injuries?.riskScore ?? 18
  const aliases = teamNewsAliases(team)
  const newsPressure = newsItems.slice(0, 8).some((item) => {
    const text = `${item.title} ${item.summary}`.toLowerCase()
    return hasNewsRisk(text) && aliases.some((alias) => alias && text.includes(alias))
  })
  const resultMargins = recent.map((match) => Math.abs(match.goalsFor - match.goalsAgainst))
  const marginVolatility = resultMargins.length ? standardDeviation(resultMargins) : 0.8
  const goalVolatility = recent.length ? standardDeviation(recent.map((match) => match.goalsFor + match.goalsAgainst)) : 1.1
  const unbeatenBonus = Math.max(0, wins + draws - losses) * 2.2
  const attackConfidence = clamp((goalsFor - 1.25) * 10 + (goalsFor - opponentGoalsAgainst) * 5, -12, 16)
  const defensiveTrust = clamp((1.15 - goalsAgainst) * 12, -14, 16)
  const cupMomentum = clamp((tournament.strengthScore - 50) * 0.32 + tournament.goalDiff * 1.8 + tournament.bigWins * 4 - tournament.heavyLosses * 5, -14, 18)
  const cupCoachSignal = clamp((tournament.defenseScore - 50) * 0.24 + (tournament.attackScore - 50) * 0.16, -10, 14)
  const historyComposure = clamp((history.score - 52) * 0.12 + (history.knockoutRunsSince2002 ?? 0) * 0.5 + (history.titles ?? 0) * 1.2, -4, 7)
  const weatherStress = weather.riskLevel === '高' ? 5 : weather.riskLevel === '中' ? 2 : 0
  const mentality = clamp(
    round(
      50 +
        wins * 5.2 +
        draws * 1.5 -
        losses * 4.8 +
        recentPulse +
        unbeatenBonus +
        attackConfidence * 0.55 +
        cupMomentum +
        historyComposure -
        injuryRisk * 0.16 -
        (newsPressure ? 4 : 0),
      1,
    ),
    24,
    88,
  )
  const coach = clamp(
    round(
      50 +
        defensiveTrust * 0.9 +
        clamp(12 - marginVolatility * 4.5, -8, 12) +
        clamp(10 - goalVolatility * 2.8, -8, 10) +
        clamp((goalsFor - goalsAgainst) * 4, -12, 14) +
        cupCoachSignal +
        historyComposure * 0.55 -
        injuryRisk * 0.12 -
        weatherStress,
      1,
    ),
    24,
    88,
  )

  return {
    mentality,
    coach,
    pressure: clamp(round(50 + wins * 4 - losses * 5 + (newsPressure ? 9 : 0) + injuryRisk * 0.18, 1), 20, 88),
    volatility: round(marginVolatility + goalVolatility * 0.45, 2),
    note: `心态 ${mentality}，教练执行 ${coach}；近况 ${wins}胜${draws}平${losses}负，本届 ${tournament.wins}胜${tournament.draws}平${tournament.losses}负，历史底蕴 ${history.score}/100，伤病/新闻压力 ${newsPressure ? '偏高' : '常规'}。`,
  }
}

function formPulse(result) {
  if (result === 'W') return 5
  if (result === 'D') return 1.5
  if (result === 'L') return -4.5
  return 0
}

function standardDeviation(values) {
  if (!values.length) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function humanTempoAdjustment(humanFactors) {
  if (!humanFactors) return 0
  const bestMentality = Math.max(humanFactors.home.mentality, humanFactors.away.mentality)
  const bestCoach = Math.max(humanFactors.home.coach, humanFactors.away.coach)
  const volatility = Math.max(humanFactors.home.volatility, humanFactors.away.volatility)
  let adjustment = 0

  if (bestMentality >= 72 && bestCoach >= 60) adjustment += 0.07
  if (bestMentality >= 80) adjustment += 0.05
  if (volatility >= 2.2) adjustment += 0.04
  if (humanFactors.home.coach >= 68 && humanFactors.away.coach >= 68 && volatility < 1.3) adjustment -= 0.05

  return clamp(round(adjustment, 2), -0.08, 0.16)
}

function tournamentTempoAdjustment(homeTournament, awayTournament) {
  if (!homeTournament || !awayTournament) return 0
  const combinedAttack = (homeTournament.attackScore + awayTournament.attackScore) / 2
  const combinedDefense = (homeTournament.defenseScore + awayTournament.defenseScore) / 2
  const combinedGoals = (homeTournament.goalsForAvg + awayTournament.goalsForAvg) / 2
  let adjustment = 0

  if (combinedAttack >= 68) adjustment += 0.08
  if (combinedGoals >= 2.2) adjustment += 0.06
  if (combinedDefense >= 66 && combinedAttack < 62) adjustment -= 0.06
  if (homeTournament.failedToScore + awayTournament.failedToScore >= 2) adjustment -= 0.04
  if (homeTournament.bigWins + awayTournament.bigWins >= 2) adjustment += 0.05

  return clamp(round(adjustment, 2), -0.1, 0.16)
}

function humanVolatilityRisk(humanFactors) {
  if (!humanFactors) return 0
  const volatility = Math.max(humanFactors.home.volatility, humanFactors.away.volatility)
  const pressure = Math.max(humanFactors.home.pressure, humanFactors.away.pressure)
  return clamp(Math.round((volatility - 1.4) * 2.2 + (pressure > 72 ? 2 : 0)), 0, 6)
}

function buildContextAdjustment(homeContext, awayContext, weather, geography, divination, humanFactors = null, advancement = null, situational = null) {
  const formEdge = homeContext.formScore - awayContext.formScore
  const injuryEdge = awayContext.injuries.riskScore - homeContext.injuries.riskScore
  const travelEdge = clamp((geography.distanceEdgeKm ?? 0) / 4500, -0.9, 0.9)
  const humanEdge = clamp((humanFactors?.edge ?? 0) / 28, -1, 1)
  const tournamentEdge = clamp(((homeContext.tournament?.strengthScore ?? 46) - (awayContext.tournament?.strengthScore ?? 46)) / 32, -1, 1)
  const historyEdge = clamp(((homeContext.history?.score ?? 44) - (awayContext.history?.score ?? 44)) / 34, -1, 1)
  const advancementEdge = clamp(advancement?.homeGoalDiffDelta ?? 0, -0.08, 0.08)
  const situationalEdge = clamp(situational?.homeGoalDiffDelta ?? 0, -0.16, 0.16)
  const weatherRisk = weather.riskLevel === '高' ? 8 : weather.riskLevel === '中' ? 4 : 0
  const formReliability = Math.min(homeContext.sampleSize, awayContext.sampleSize) >= 3 ? 1 : 0.55
  const homeNarrativePenalty =
    activeModelCalibration.homeNarrativeDampening &&
    situational?.host?.edge > 0 &&
    (tournamentEdge < -0.12 || formEdge < -8 || humanEdge < -0.18)
      ? -0.08
      : 0
  const awayQualityCorrection =
    activeModelCalibration.awayFavoriteTailGuard &&
    tournamentEdge < -0.18 &&
    (awayContext.tournament?.attackScore ?? 50) >= 62
      ? -0.07
      : 0
  const eliteLowScoreDrag =
    activeModelCalibration.eliteLowScoreGuard &&
    advancement?.pressureType === 'knockout' &&
    ((homeContext.tournament?.defenseScore ?? 50) + (awayContext.tournament?.defenseScore ?? 50)) / 2 >= 62 &&
    Math.abs(tournamentEdge) <= 0.35
      ? 0.08
      : 0
  const weatherTempoDrag =
    (weather.riskLevel === '高' ? 0.14 : weather.riskLevel === '中' ? 0.06 : 0) +
    ((weather.precipitationProbability ?? 0) >= 35 ? 0.08 : 0) +
    ((weather.humidity ?? 0) >= 80 && weather.riskLevel === '高' ? 0.06 : 0) +
    ((weather.windKph ?? 0) >= 24 ? 0.05 : 0)
  const homeGoalDiffDelta = clamp(
    round(
      formEdge * 0.012 * formReliability +
        injuryEdge * 0.006 +
        travelEdge * 0.08 +
        tournamentEdge * 0.12 +
        historyEdge * 0.03 +
        humanEdge * 0.05 +
        advancementEdge +
        situationalEdge +
        homeNarrativePenalty +
        awayQualityCorrection,
      2,
    ),
    -0.42,
    0.42,
  )
  const totalGoalsDelta = clamp(
    round(
        ((homeContext.goalsForAvg ?? 1.2) + (awayContext.goalsForAvg ?? 1.2) - 2.6) * 0.09 +
        tournamentTempoAdjustment(homeContext.tournament, awayContext.tournament) +
        worldCupHistoryTempoAdjustment(homeContext.history, awayContext.history) * 0.5 +
        humanTempoAdjustment(humanFactors) * 0.35 -
        weatherTempoDrag +
        (activeModelCalibration.awayFavoriteTailGuard && awayQualityCorrection < 0 ? 0.05 : 0) -
        eliteLowScoreDrag +
        (advancement?.totalGoalsDelta ?? 0) +
        (situational?.totalGoalsDelta ?? 0),
      2,
    ),
    -0.38,
    0.32,
  )
  const confidenceDelta = clamp(
    Math.round(
      Math.abs(formEdge) * 0.08 * formReliability +
        Math.abs(humanFactors?.edge ?? 0) * 0.08 -
        weatherRisk * 0.35 -
        Math.max(homeContext.injuries.riskScore, awayContext.injuries.riskScore) * 0.04 +
        Math.abs(historyEdge) * 2 +
        (advancement?.confidenceDelta ?? 0) +
        (situational?.confidenceDelta ?? 0),
    ),
    -8,
    9,
  )
  const riskDelta = clamp(
    Math.round(
      weatherRisk +
        Math.max(homeContext.injuries.riskScore, awayContext.injuries.riskScore) * 0.08 +
        (formReliability < 1 ? 3 : 0) +
        humanVolatilityRisk(humanFactors) +
        (advancement?.riskDelta ?? 0) +
        (situational?.riskDelta ?? 0),
    ),
    0,
    18,
  )

  return {
    homeGoalDiffDelta,
    totalGoalsDelta,
    confidenceDelta,
    riskDelta,
    notes: [
      `近况差修正 ${homeGoalDiffDelta > 0 ? '+' : ''}${homeGoalDiffDelta} 球。`,
      `天气/节奏修正 ${totalGoalsDelta > 0 ? '+' : ''}${totalGoalsDelta} 总进球。`,
      `本届战绩修正：${homeContext.tournament?.summary ?? '主队暂无'}；${awayContext.tournament?.summary ?? '客队暂无'}。`,
      `历届世界杯底蕴：${homeContext.history?.summary ?? '主队暂无'}；${awayContext.history?.summary ?? '客队暂无'}。`,
      advancement?.summary ?? '晋级形势：暂无额外修正。',
      situational?.summary ?? '赛程体能：暂无额外修正。',
      ...(homeNarrativePenalty < 0 ? ['昨日美国 1-4 比利时复盘：主场/东道主叙事降权，客队硬实力优先。'] : []),
      ...(awayQualityCorrection < 0 ? ['昨日美国 1-4 比利时复盘：客队攻击质量进入额外修正，避免漏掉多球客胜尾部。'] : []),
      ...(eliteLowScoreDrag > 0 ? ['昨日葡萄牙 0-1 西班牙复盘：强强淘汰赛下调总进球扩张，保留低比分胜负。'] : []),
      `伤病与天气风险使风险指数 ${riskDelta > 0 ? '+' : ''}${riskDelta}。`,
      humanFactors?.summary ?? '心态/教练代理：数据不足，未单独修正。',
      `古法取象仅展示、不进入数值预测：${divination.summary}`,
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

function buildScorelineAnalysis(market, homeTeam, awayTeam, judgement, newsItems, context = null, probabilityEnsemble = null) {
  if (!market) {
    return {
      model: `等待赔率后生成比分分布（${REGULATION_SCOPE_SHORT}）`,
      scope: REGULATION_SCOPE,
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

  const marketResultProbabilities = resultProbabilitiesFromMarket(market)
  const resultProbabilities = marketResultProbabilities.map((item, index) => ({
    ...item,
    probability: probabilityEnsemble?.blended?.[index] ?? item.probability,
  }))
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
  const strengthProfile = buildStrengthProfile(homeProbability, awayProbability, context)
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

  const candidatePool = allScores
    .filter((item) => item.probability >= 0.018)
    .sort((left, right) => right.probability - left.probability)
    .slice(0, 15)

  const avoid = allScores
    .filter((item) => item.probability < 0.014 && item.fairOdds > 70)
    .sort((left, right) => left.probability - right.probability)
    .slice(0, 3)
    .map((item) => ({
      ...item,
      grade: '回避',
      reason: '概率过低，除非官方赔率极端偏高，否则不适合作为主要比分方向。',
    }))
  const simulation = simulateMatchProgress({
    homeTeam,
    awayTeam,
    homeExpectedGoals,
    awayExpectedGoals,
    resultProbabilities,
    totalExpectedGoals,
    context,
  })
  const simulationScoreBook = new Map(
    (simulation.scoreDistribution ?? simulation.topScores ?? []).map((item) => [item.score, item.probability]),
  )
  const openScoreBook = new Map(
    (probabilityEnsemble?.openPrediction?.topScores ?? []).map((item) => [item.score, item.probability]),
  )
  // A 1X2 validation gate does not authorize exact-score blending.
  const scoreWeights = { poisson: 0.55, simulation: 0.45, openSource: 0 }
  const rankedCandidates = candidatePool
    .map((item) => {
      const simulationProbability = simulationScoreBook.get(item.score) ?? 0
      const openSourceProbability = openScoreBook.get(item.score) ?? 0
      const consensusProbability = round(
        item.probability * scoreWeights.poisson +
          simulationProbability * scoreWeights.simulation +
          openSourceProbability * scoreWeights.openSource,
        4,
      )
      const fairOdds = consensusProbability > 0 ? 1 / consensusProbability : item.fairOdds
      return {
        ...item,
        poissonProbability: item.probability,
        simulationProbability,
        openSourceProbability,
        probability: consensusProbability,
        fairOdds: round(fairOdds, 2),
        suggestedMinOdds: round(fairOdds * uncertainty, 2),
        expectedValueAtSuggestedOdds: round(consensusProbability * fairOdds * uncertainty - 1, 3),
      }
    })
    .sort((left, right) => right.probability - left.probability)
  const marketLeaderSide = [...resultProbabilities].sort((left, right) => right.probability - left.probability)[0]?.side
  const directionAlignedIndex = rankedCandidates.findIndex((item) => sideFromResult(item.result) === marketLeaderSide)
  if (
    directionAlignedIndex > 0 &&
    rankedCandidates[0].probability - rankedCandidates[directionAlignedIndex].probability <= SCORE_CONSENSUS_ALIGNMENT_MARGIN
  ) {
    const [directionAlignedCandidate] = rankedCandidates.splice(directionAlignedIndex, 1)
    rankedCandidates.unshift(directionAlignedCandidate)
  }
  const candidates = rankedCandidates
    .slice(0, 9)
    .map((item, index) => ({
      ...item,
      grade: index === 0 ? '首选核验' : '备选',
    }))
  const modelAgreement = buildModelAgreement({
    marketResultProbabilities,
    resultProbabilities,
    candidates,
    simulation,
    totalExpectedGoals,
    probabilityEnsemble,
  })

  return {
    model: `胜平负去水概率 + 大小球盘口 + 历届世界杯低权重底蕴 + 平局压缩/抗热门校准 + Poisson/1万次模拟比分共识（${REGULATION_SCOPE_SHORT}）`,
    scope: REGULATION_SCOPE,
    homeExpectedGoals,
    awayExpectedGoals,
    totalExpectedGoals,
    strengthProfile,
    resultProbabilities,
    probabilityEnsemble,
    bestPick: candidates[0] ?? null,
    candidates,
    avoid,
    simulation,
    modelAgreement,
    notes: [
      `预测口径：${REGULATION_SCOPE}。`,
      '首选比分采用55%校准Poisson概率与45%一万次比赛进程模拟概率融合，避免单一分布在低比分场过度集中。',
      '比分按55%校准Poisson与45%一万次模拟的融合概率排序；仅当胜平负主方向对应比分距统计众数不超过1个百分点时，才优先方向一致比分。',
      '比分玩法方差很大，候选只适合小额娱乐或赛前核验。',
      `本版把总进球从基础 ${baseTotalExpectedGoals.toFixed(2)} 校准到 ${totalExpectedGoals.toFixed(2)}，并对强弱分明场景的 3+ 进球比分做尾部上调。`,
      simulation.summary,
      modelAgreement.summary,
      probabilityEnsemble
        ? `开源独立模型：${probabilityEnsemble.openPrediction.model}；市场/开源总变差 ${formatPct(probabilityEnsemble.disagreement.totalVariation)}；${probabilityEnsemble.reason}`
        : '开源独立模型暂不可用，主概率不做额外修正。',
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
  const resultDirection = marketLeader
  const directionFairOdds = resultDirection?.probability ? 1 / resultDirection.probability : null
  const directionSuggestedMinOdds = directionFairOdds ? round(directionFairOdds * (1.04 + judgement.risk / 900), 2) : null
  const scoreConcentration = bestScore.probability * 100
  const overheatPenalty = judgement.tier === '避免追高' ? 8 : 0
  const contextConfidence = context?.adjustment?.confidenceDelta ?? 0
  const contextRisk = context?.adjustment?.riskDelta ?? 0
  const modelAgreement = scoreline.modelAgreement ?? null
  const agreementPenalty = modelAgreement?.confidencePenalty ?? 0
  const rankScore = clamp(
    Math.round(
      judgement.confidence * 0.52 +
        (100 - judgement.risk) * 0.24 +
        scoreConcentration * 1.15 -
        overheatPenalty +
        contextConfidence -
        contextRisk * 0.4 -
        agreementPenalty,
    ),
    20,
    91,
  )
  const grade = professionalGrade(rankScore, judgement, modelAgreement)
  const totalBand = totalGoalsBand(scoreline.totalExpectedGoals, scoreline.simulation)
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
      ...(scoreline.simulation
        ? [
            {
              label: '1万次进程模拟',
              score: Math.round((scoreline.simulation.resultDistribution[0]?.probability ?? 0) * 100),
              tone: (scoreline.simulation.resultDistribution[0]?.probability ?? 0) >= 0.62 ? 'good' : 'watch',
              evidence: scoreline.simulation.summary,
            },
          ]
        : []),
      ...(modelAgreement
        ? [
            {
              label: '模型一致性',
              score: Math.max(0, 100 - modelAgreement.conflictScore * 2),
              tone: modelAgreement.riskLevel === '高' ? 'bad' : modelAgreement.riskLevel === '中' ? 'watch' : 'good',
              evidence: modelAgreement.summary,
            },
          ]
        : []),
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
              label: '历届世界杯底蕴',
              score: Math.round((context.home.history.score + context.away.history.score) / 2),
              tone: Math.abs(context.home.history.score - context.away.history.score) >= 18 ? 'good' : 'watch',
              evidence: `${context.home.history.summary} ${context.away.history.summary}`,
            },
            {
              label: '天气/地理',
              score: context.weather.riskLevel === '高' ? 70 : context.weather.riskLevel === '中' ? 52 : 35,
              tone: context.weather.riskLevel === '高' ? 'bad' : context.weather.riskLevel === '中' ? 'watch' : 'good',
              evidence: `${context.weather.summary} ${context.geography.summary}`,
            },
            {
              label: '晋级压力',
              score: context.advancement.pressureScore,
              tone: context.advancement.pressureLevel === '高' ? 'watch' : 'good',
              evidence: context.advancement.summary,
            },
            {
              label: '赛程体能',
              score: Math.max(35, 80 - context.situational.riskDelta * 6),
              tone: context.situational.riskDelta >= 6 ? 'watch' : 'good',
              evidence: context.situational.summary,
            },
            {
              label: '古法占卜（仅展示）',
              score: 0,
              tone: 'watch',
              evidence: `${context.divination.homeSymbol} vs ${context.divination.awaySymbol}；不进入胜平负、比分或总进球概率。`,
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
      ...(modelAgreement?.riskLevel === '高' ? ['模型一致性冲突为高，盘口/Poisson/蒙特卡洛无法互相确认'] : []),
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
  const modelAgreement = scoreline.modelAgreement ?? null
  const confidenceScore = clamp(
    Math.round(
      judgement.confidence * 0.46 +
        (100 - judgement.risk) * 0.24 +
        (scoreline.bestPick?.probability ?? 0) * 180 +
        (grade === '重点核验' ? 8 : grade === '小额分散' ? 3 : grade === '只核验不追高' ? -6 : -14) -
        (newsRisk ? 5 : 0) +
        (context?.adjustment?.confidenceDelta ?? 0) -
        (context?.adjustment?.riskDelta ?? 0) * 0.4 -
        (modelAgreement?.confidencePenalty ?? 0) * 0.35,
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
      scoreline.strengthProfile?.summary ?? '实力护栏：暂无足够近况数据，只按市场概率保守处理。',
      context ? `本届杯赛：${context.home.tournament.summary}；${context.away.tournament.summary}` : '本届杯赛战绩暂未接入。',
      context ? `历届世界杯：${context.home.history.summary}；${context.away.history.summary}` : '历届世界杯底蕴暂未接入。',
      context?.advancement?.summary ?? '晋级形势暂未接入。',
      context?.situational?.summary ?? '赛程体能暂未接入。',
      context?.humanFactors?.summary ?? '心态/教练代理：暂无足够近况数据，未单独修正。',
      `胜平负方向：${expertAnswer.marketDirection}；总进球校验：${expertAnswer.totalGoals}。`,
      modelAgreement?.summary ?? '模型一致性：缺少可用的蒙特卡洛或盘口对照，按常规风险处理。',
      context
        ? `近5场：${context.home.trendNote}；${context.away.trendNote}`
        : '近5场数据暂未接入。',
      context
        ? `天气/地理：${context.weather.summary} ${context.geography.travelEdge}`
        : '天气和地理信息待核验。',
      context
        ? `古法文化展示：${context.divination.summary}（数值权重为0）`
        : '古法校验未参与本次评分。',
      `主要风险：${hotRisk?.label ?? '赔率'}为${hotRisk?.level ?? '中'}，${scoreRisk?.label ?? '比分方差'}为${scoreRisk?.level ?? '中'}。`,
      scenarios[0] ? `基准剧本：${scenarios[0].scorePath}` : '等待更多情景数据。',
    ].slice(0, 9),
    noBuyRules: [
      `中国体彩比分赔率低于 ${scorePlay?.minOdds ?? '建议门槛'} 时不买。`,
      resultPlay ? `胜平负 ${resultPlay.selection} 低于 ${resultPlay.minOdds} 时不买。` : '胜平负赔率不可核验时不买。',
      modelAgreement?.riskLevel === '高' ? '盘口、Poisson 与 1万次模拟方向冲突为高时，本场直接不买。' : null,
      '首发出现核心前锋、门将或中卫明显轮换时不买。',
      '临场 30 分钟内热门方向继续大幅降赔时不追。',
      newsRisk ? '最新新闻存在阵容/纪律风险，必须等首发后再决定。' : '中国体彩未开售、停售或让球口径变化时不买。',
    ].filter(Boolean),
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
      scorePath:
        base.result === '平局'
          ? `常规时间平局，比分落在 ${base.score} 附近。`
          : `${base.result === winnerSide ? favoriteName : '非市场主方向'} ${base.result}，比分落在 ${base.score} 附近。`,
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
  const modelAgreement = scoreline.modelAgreement ?? null

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

  if (modelAgreement) {
    controls.push({
      label: '模型一致性',
      level: modelAgreement.riskLevel,
      detail: `${modelAgreement.summary} 复盘规则：冲突为高时直接降级，冲突为中时不做重仓单点比分。`,
    })
  }

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
        label: '晋级压力',
        level: context.advancement.pressureLevel,
        detail: context.advancement.summary,
      },
      {
        label: '赛程体能',
        level: context.situational.riskDelta >= 7 ? '高' : context.situational.riskDelta >= 4 ? '中' : '低',
        detail: context.situational.summary,
      },
      {
        label: '占卜只作校验',
        level: '低',
        detail: `${context.divination.method}仅作文化展示，数值权重为0；不用于改变胜平负、比分或总进球概率。`,
      },
    )
  }

  return controls
}

function professionalGrade(rankScore, judgement, modelAgreement = null) {
  if (modelAgreement?.riskLevel === '高') return '观望'
  if (judgement.tier === '避免追高') return '只核验不追高'
  if (modelAgreement?.riskLevel === '中' && rankScore >= 68) return '小额分散'
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

function totalGoalsBand(totalExpectedGoals, simulation = null) {
  const simulatedTotals = (simulation?.totalGoals ?? [])
    .filter((item) => item.goals !== '7+' && Number.isFinite(Number(item.goals)))
    .sort((left, right) => right.probability - left.probability)
  if (simulatedTotals.length >= 2) {
    const selected = simulatedTotals.slice(0, 2)
    const zeroGoal = simulatedTotals.find((item) => Number(item.goals) === 0)
    const includeZeroGuard =
      activeModelCalibration.zeroGoalTotalGuard &&
      totalExpectedGoals <= 2.45 &&
      (zeroGoal?.probability ?? 0) >= 0.1 &&
      !selected.some((item) => Number(item.goals) === 0)
    if (includeZeroGuard) selected.push(zeroGoal)
    const nextUnselected = simulatedTotals.find((item) => !selected.some((selectedItem) => selectedItem.goals === item.goals))
    if (selected.reduce((sum, item) => sum + item.probability, 0) < 0.45 && nextUnselected) {
      selected.push(nextUnselected)
    }
    const goals = selected.map((item) => Number(item.goals)).sort((left, right) => left - right)
    const coverage = selected.reduce((sum, item) => sum + item.probability, 0)
    return {
      selection: `总进球 ${goals.join('/')}`,
      confidence: clamp(Math.round(coverage * 100 + 12), 55, 68),
      reason: includeZeroGuard
        ? `按1万次90分钟含补时模拟选择主落点，并在低节奏场保留0球路径，合计覆盖约 ${formatPct(coverage)}。`
        : `按1万次90分钟含补时模拟选择概率最高的${selected.length}个总进球落点，合计覆盖约 ${formatPct(coverage)}。`,
    }
  }
  if (activeModelCalibration.zeroGoalTotalGuard && totalExpectedGoals <= 2.45) {
    return {
      selection: '总进球 0/1/2',
      confidence: 59,
      reason: '昨日0-0复盘后加入0球保护；低节奏、低总进球场不再把0球排除在主区间外。',
    }
  }
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
    if (activeModelCalibration.underdogMultiGoalGuard && totalExpectedGoals >= 3.05) {
      return {
        selection: '总进球 2/3/4/5',
        confidence: 61,
        reason: '昨日3-2复盘后加入5球尾部保护；均值接近3球时，热门胜出但对手进两球的路径不能排除。',
      }
    }
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

function buildStrengthProfile(homeWin, awayWin, context) {
  const homeContext = context?.home ?? {}
  const awayContext = context?.away ?? {}
  const homeMarket = clamp(50 + (homeWin - awayWin) * 82, 12, 88)
  const awayMarket = clamp(50 + (awayWin - homeWin) * 82, 12, 88)
  const homeRecent = recentTeamStrength(homeContext, awayContext)
  const awayRecent = recentTeamStrength(awayContext, homeContext)
  const homeHealth = clamp(68 - (homeContext.injuries?.riskScore ?? 18) * 0.55, 28, 74)
  const awayHealth = clamp(68 - (awayContext.injuries?.riskScore ?? 18) * 0.55, 28, 74)
  const homeHuman = context?.humanFactors?.homeCombined ?? 52
  const awayHuman = context?.humanFactors?.awayCombined ?? 52
  const homeTournament = context?.home?.tournament?.strengthScore ?? 46
  const awayTournament = context?.away?.tournament?.strengthScore ?? 46
  const homeHistory = context?.home?.history?.score ?? 44
  const awayHistory = context?.away?.history?.score ?? 44
  const reliability = Math.min(homeContext.sampleSize ?? 0, awayContext.sampleSize ?? 0) >= 3 ? 1 : 0.72
  const homeStrength = round(
    clamp(
      homeMarket * 0.46 +
        (homeContext.formScore ?? 50) * 0.16 * reliability +
        homeRecent * 0.1 +
        homeTournament * 0.13 +
        homeHistory * 0.07 +
        homeHealth * 0.03 +
        homeHuman * 0.05,
      12,
      92,
    ),
    1,
  )
  const awayStrength = round(
    clamp(
      awayMarket * 0.46 +
        (awayContext.formScore ?? 50) * 0.16 * reliability +
        awayRecent * 0.1 +
        awayTournament * 0.13 +
        awayHistory * 0.07 +
        awayHealth * 0.03 +
        awayHuman * 0.05,
      12,
      92,
    ),
    1,
  )
  const edge = round(homeStrength - awayStrength, 1)
  const gap = Math.abs(edge)
  const historyGap = Math.abs(homeHistory - awayHistory)
  const strongerSide = Math.abs(edge) < 3 ? 'level' : edge > 0 ? 'home' : 'away'
  const strongerResult = strongerSide === 'home' ? scoreResult(1, 0) : strongerSide === 'away' ? scoreResult(0, 1) : scoreResult(0, 0)
  const favoriteProbability = Math.max(homeWin, awayWin)

  return {
    homeStrength,
    awayStrength,
    edge,
    gap,
    strongerSide,
    strongerResult,
    favoriteProbability: round(favoriteProbability, 4),
    isClearGap: (gap >= 16 && favoriteProbability >= 0.54) || gap >= 28,
    isStrongGap: (gap >= 24 && favoriteProbability >= 0.62) || gap >= 36,
    summary:
      strongerSide === 'level'
        ? `实力护栏：综合实力接近（${homeStrength}-${awayStrength}），比分优先保留平局和一球差。${historyGap >= 10 ? ` 历史底蕴 ${homeHistory}-${awayHistory} 只作低权重校验。` : ''}`
        : `实力护栏：${strongerSide === 'home' ? '主队' : '客队'}综合实力 ${homeStrength}-${awayStrength} 领先，冷门比分只进防守层，不抢主推。${historyGap >= 10 ? ` 历史底蕴 ${homeHistory}-${awayHistory} 已计入但不覆盖当前赔率。` : ''}`,
  }
}

function recentTeamStrength(teamContext, opponentContext) {
  const formScore = teamContext.formScore ?? 50
  const goalsFor = teamContext.goalsForAvg ?? 1.2
  const goalsAgainst = teamContext.goalsAgainstAvg ?? 1.2
  const opponentGoalsAgainst = opponentContext.goalsAgainstAvg ?? 1.2
  const attackEdge = clamp((goalsFor - 1.25) * 11 + (goalsFor - opponentGoalsAgainst) * 6, -18, 20)
  const defenseEdge = clamp((1.25 - goalsAgainst) * 10, -14, 18)
  const samplePenalty = (teamContext.sampleSize ?? 0) < 3 ? 4 : 0

  return clamp(round(formScore * 0.56 + (50 + attackEdge + defenseEdge) * 0.44 - samplePenalty, 1), 18, 88)
}

function scoreStrengthCoherenceMultiplier(
  homeGoals,
  awayGoals,
  resultProbabilities,
  context,
  totalExpectedGoals,
  market = null,
) {
  const homeWin = resultProbabilities.find((item) => item.side === 'home')?.probability ?? 0
  const awayWin = resultProbabilities.find((item) => item.side === 'away')?.probability ?? 0
  const draw = resultProbabilities.find((item) => item.side === 'draw')?.probability ?? 0
  const profile = buildStrengthProfile(homeWin, awayWin, context)
  const result = scoreResult(homeGoals, awayGoals)
  const totalGoals = homeGoals + awayGoals
  const favoriteSide = homeWin >= awayWin ? 'home' : 'away'
  const favoriteResult = favoriteSide === 'home' ? scoreResult(1, 0) : scoreResult(0, 1)
  const favoriteGoals = favoriteSide === 'home' ? homeGoals : awayGoals
  const underdogGoals = favoriteSide === 'home' ? awayGoals : homeGoals
  const favoriteMargin = favoriteGoals - underdogGoals
  const favoriteProbability = Math.max(homeWin, awayWin)
  const spreadSignal = market ? favoriteSpreadSignal(market, favoriteSide) : { favoriteCoverProbability: null }
  const strongerResult = profile.strongerSide === 'level' ? favoriteResult : profile.strongerResult
  const strongSideGoals =
    profile.strongerSide === 'home' ? homeGoals : profile.strongerSide === 'away' ? awayGoals : favoriteGoals
  const weakSideGoals =
    profile.strongerSide === 'home' ? awayGoals : profile.strongerSide === 'away' ? homeGoals : underdogGoals
  const strengthMargin = strongSideGoals - weakSideGoals
  const humanEdge = context?.humanFactors?.edge ?? 0
  const humanSide = Math.abs(humanEdge) < 5 ? 'level' : humanEdge > 0 ? 'home' : 'away'
  const humanResult = humanSide === 'home' ? scoreResult(1, 0) : humanSide === 'away' ? scoreResult(0, 1) : scoreResult(0, 0)
  const humanFavorite =
    humanSide === 'home'
      ? context?.humanFactors?.home
      : humanSide === 'away'
        ? context?.humanFactors?.away
        : null
  const homeTournament = context?.home?.tournament ?? null
  const awayTournament = context?.away?.tournament ?? null
  const tournamentEdge = (homeTournament?.strengthScore ?? 46) - (awayTournament?.strengthScore ?? 46)
  const tournamentSide = Math.abs(tournamentEdge) < 7 ? 'level' : tournamentEdge > 0 ? 'home' : 'away'
  const tournamentResult = tournamentSide === 'home' ? scoreResult(1, 0) : tournamentSide === 'away' ? scoreResult(0, 1) : scoreResult(0, 0)
  const tournamentFavorite = tournamentSide === 'home' ? homeTournament : tournamentSide === 'away' ? awayTournament : null
  const advancement = context?.advancement ?? null
  const situational = context?.situational ?? null
  let multiplier = 1

  if (profile.strongerSide === 'level') {
    if (result === scoreResult(0, 0) || Math.abs(homeGoals - awayGoals) <= 1) multiplier += 0.06
    if (Math.abs(homeGoals - awayGoals) >= 3) multiplier -= 0.14
    if (totalGoals >= 5 && totalExpectedGoals < 3.1) multiplier -= 0.1
    if (advancement?.pressureType === 'knockout') {
      if (Math.abs(homeGoals - awayGoals) <= 1 && totalGoals <= 3) multiplier += 0.05
      if (totalGoals >= 5) multiplier -= 0.08
    }
    if (advancement?.pressureType === 'group' && advancement.pressureScore >= 78) {
      if (totalGoals >= 2 && totalGoals <= 4) multiplier += 0.04
      if (advancement.homePressure > advancement.awayPressure + 14 && result === scoreResult(1, 0)) multiplier += 0.04
      if (advancement.awayPressure > advancement.homePressure + 14 && result === scoreResult(0, 1)) multiplier += 0.04
    }
    if (situational?.knockoutTempo?.penaltyRisk >= 68) {
      if (result === scoreResult(0, 0) || result === scoreResult(1, 1)) multiplier += 0.08
      if (totalGoals >= 4) multiplier -= 0.08
    }
    return clamp(round(multiplier, 2), 0.74, 1.14)
  }

  if (profile.isClearGap && result !== strongerResult) {
    multiplier -= result === scoreResult(0, 0) ? 0.1 : 0.2
    if (profile.isStrongGap) multiplier -= result === scoreResult(0, 0) ? 0.08 : 0.14
    if (strengthMargin <= -2) multiplier -= 0.18
  }

  if (result === strongerResult) {
    if (profile.isClearGap && strengthMargin === 1 && favoriteProbability < 0.7) multiplier += 0.11
    if (profile.isClearGap && strengthMargin === 2 && favoriteProbability >= 0.62) multiplier += 0.12
    if (profile.isStrongGap && strengthMargin >= 2 && totalExpectedGoals >= 2.65) multiplier += 0.08
    if (strengthMargin >= 3 && favoriteProbability < 0.74) multiplier -= 0.12
    if (strengthMargin >= 3 && spreadSignal.favoriteCoverProbability !== null && spreadSignal.favoriteCoverProbability < 0.45) {
      multiplier -= 0.14
    }
  }

  if (favoriteProbability >= 0.72 && result === favoriteResult && favoriteMargin >= 1) {
    const favoriteContext = favoriteSide === 'home' ? context?.home : context?.away
    const underdogContext = favoriteSide === 'home' ? context?.away : context?.home
    const underdogAttack = underdogContext?.goalsForAvg ?? 1.1
    const favoriteDefense = favoriteContext?.goalsAgainstAvg ?? 1.1

    if (underdogGoals === 1 && (underdogAttack >= 1.15 || favoriteDefense >= 0.65)) multiplier += 0.08
    if (underdogGoals === 0 && underdogAttack >= 1.45 && totalExpectedGoals >= 3) multiplier -= 0.08
  }

  if (draw >= 0.29 && totalExpectedGoals <= 2.25 && result === scoreResult(0, 0)) multiplier += 0.08
  if (tournamentSide !== 'level') {
    if (result === tournamentResult) multiplier += Math.min(0.12, Math.abs(tournamentEdge) * 0.004)
    if (result !== tournamentResult && result !== scoreResult(0, 0)) multiplier -= Math.min(0.12, Math.abs(tournamentEdge) * 0.0035)
    if (result === tournamentResult && strengthMargin >= 2 && (tournamentFavorite?.bigWins ?? 0) >= 1) multiplier += 0.08
    if (result === tournamentResult && weakSideGoals === 0 && (tournamentFavorite?.attackScore ?? 50) < 52) multiplier -= 0.08
    if (result !== tournamentResult && (tournamentFavorite?.heavyLosses ?? 0) === 0 && strengthMargin <= -2) multiplier -= 0.08
  }
  if (humanSide !== 'level') {
    if (result === humanResult) multiplier += Math.min(0.12, Math.abs(humanEdge) * 0.006)
    if (result !== humanResult && result !== scoreResult(0, 0)) multiplier -= Math.min(0.1, Math.abs(humanEdge) * 0.004)
    if (result === humanResult && strengthMargin >= 2 && (humanFavorite?.mentality ?? 50) >= 72 && (humanFavorite?.coach ?? 50) >= 60) {
      multiplier += 0.08
    }
    if (result === humanResult && strengthMargin >= 3 && (humanFavorite?.pressure ?? 50) >= 76) {
      multiplier -= 0.06
    }
  }
  if (advancement?.pressureType === 'knockout') {
    if (Math.abs(homeGoals - awayGoals) <= 1 && totalGoals <= 3) multiplier += 0.06
    if (totalGoals >= 5) multiplier -= 0.08
    if (advancement.bracketOpponentStrength >= 70 && result === strongerResult && strengthMargin >= 3) multiplier -= 0.06
  }
  if (advancement?.pressureType === 'group' && advancement.pressureScore >= 70) {
    if (advancement.pressureScore >= 78 && totalGoals >= 2 && totalGoals <= 4) multiplier += 0.04
    if (advancement.homePressure > advancement.awayPressure + 14 && result === scoreResult(1, 0)) multiplier += 0.04
    if (advancement.awayPressure > advancement.homePressure + 14 && result === scoreResult(0, 1)) multiplier += 0.04
    if (advancement.homeNeed.includes('基本出线') && homeGoals - awayGoals >= 3) multiplier -= 0.05
    if (advancement.awayNeed.includes('基本出线') && awayGoals - homeGoals >= 3) multiplier -= 0.05
  }
  if (situational) {
    if (situational.knockoutTempo.penaltyRisk >= 68) {
      if (result === scoreResult(0, 0) || result === scoreResult(1, 1)) multiplier += 0.08
      if (Math.abs(homeGoals - awayGoals) <= 1 && totalGoals <= 3) multiplier += 0.04
      if (totalGoals >= 4) multiplier -= 0.08
    }
    if (situational.rest.edgeDays >= 1.5 && result === scoreResult(1, 0)) multiplier += 0.04
    if (situational.rest.edgeDays <= -1.5 && result === scoreResult(0, 1)) multiplier += 0.04
    if (situational.host.edge > 0 && result === scoreResult(1, 0)) multiplier += 0.04
    if (situational.host.edge < 0 && result === scoreResult(0, 1)) multiplier += 0.04
  }

  return clamp(round(multiplier, 2), 0.52, 1.28)
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
  const totalSignal = market ? totalMarketSignal(market) : { line: 2.5, underProbability: 0.5 }
  const stalemateSignal = favoriteStalemateSignal(homeWin, awayWin, draw, context)
  const drawCompression = drawCompressionSignal(homeWin, awayWin, draw, totalExpectedGoals, market)
  const favoriteGoals = favoriteSide === 'home' ? homeGoals : awayGoals
  const underdogGoals = favoriteSide === 'home' ? awayGoals : homeGoals
  const favoriteMargin = favoriteGoals - underdogGoals
  const totalGoals = homeGoals + awayGoals
  const strengthLift = scoreStrengthCoherenceMultiplier(
    homeGoals,
    awayGoals,
    resultProbabilities,
    context,
    totalExpectedGoals,
    market,
  )
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
  if (
    activeModelCalibration.favoriteTailBoost &&
    favoriteProbability >= 0.72 &&
    result === favoriteResult &&
    favoriteMargin >= 2 &&
    totalGoals >= 3
  ) {
    multiplier += 0.08
  }
  if (
    activeModelCalibration.oneGoalBaseline &&
    favoriteProbability < 0.66 &&
    result === favoriteResult &&
    favoriteMargin === 1
  ) {
    multiplier += 0.05
  }
  if (
    activeModelCalibration.lowDrawRetention &&
    result === '平局' &&
    totalGoals <= 2 &&
    draw >= 0.28
  ) {
    multiplier += 0.06
  }
  if (
    activeModelCalibration.favoriteControlBoost &&
    favoriteProbability >= 0.66 &&
    result === favoriteResult &&
    underdogGoals === 0 &&
    favoriteMargin >= 2 &&
    totalGoals <= 3
  ) {
    multiplier += favoriteMargin === 2 ? 0.1 : 0.07
  }
  if (
    activeModelCalibration.favoriteCleanSheetReorder &&
    totalSignal.line <= 2.5 &&
    totalSignal.underProbability >= 0.54 &&
    favoriteProbability >= 0.56 &&
    result === favoriteResult
  ) {
    if (underdogGoals === 0 && favoriteMargin === 2 && totalGoals <= 3) multiplier += 0.07
    if (underdogGoals >= 1 && totalGoals >= 3) multiplier -= 0.04
  }
  if (
    activeModelCalibration.underdogGoalRetention &&
    result === favoriteResult &&
    underdogGoals === 1 &&
    totalGoals >= 2 &&
    totalGoals <= 4
  ) {
    multiplier += 0.06
  }
  if (activeModelCalibration.highGoalVolatility && totalGoals >= 4) {
    multiplier += favoriteProbability >= 0.6 && result === favoriteResult ? 0.06 : 0.04
  }
  if (activeModelCalibration.highGoalVolatility && totalGoals <= 1 && favoriteProbability >= 0.62) {
    multiplier -= 0.03
  }
  if (
    activeModelCalibration.awayFavoriteTailGuard &&
    favoriteSide === 'away' &&
    result === favoriteResult &&
    favoriteGoals >= 3 &&
    totalGoals >= 4
  ) {
    multiplier += 0.09
  }
  if (
    activeModelCalibration.homeNarrativeDampening &&
    favoriteSide === 'home' &&
    result === favoriteResult &&
    context?.situational?.host?.edge > 0 &&
    (context?.away?.tournament?.attackScore ?? 50) >= 62 &&
    favoriteProbability < 0.58
  ) {
    multiplier -= 0.05
  }
  if (activeModelCalibration.eliteLowScoreGuard && context?.advancement?.pressureType === 'knockout') {
    if (result === favoriteResult && totalGoals <= 1) multiplier += 0.05
    if (totalGoals >= 4 && favoriteProbability < 0.7) multiplier -= 0.04
  }
  if (
    activeModelCalibration.underdogMultiGoalGuard &&
    result === favoriteResult &&
    underdogGoals >= 2 &&
    favoriteGoals >= 3 &&
    totalGoals >= 5 &&
    totalExpectedGoals >= 2.85
  ) {
    multiplier += 0.08
  }
  if (activeModelCalibration.drawGuard && result === '平局' && totalGoals <= 2 && draw >= 0.22) {
    multiplier += 0.04
  }
  if (
    activeModelCalibration.lateKnockoutDrawOvercall &&
    context?.advancement?.pressureType === 'knockout' &&
    result === '平局' &&
    totalGoals <= 2 &&
    draw >= 0.3
  ) {
    multiplier -= 0.1
  }
  if (
    activeModelCalibration.knockoutDrawFade &&
    favoriteProbability >= 0.6 &&
    result === '平局' &&
    totalGoals === 0
  ) {
    multiplier -= 0.06
  }

  return clamp(round(multiplier * strengthLift, 2), 0.52, 1.6)
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
  const totalSignal = market ? totalMarketSignal(market) : { line: 2.5, underProbability: 0.5 }
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
  let reviewLift = 1
  if (
    activeModelCalibration.favoriteTailBoost &&
    favoriteProbability >= 0.72 &&
    item.result === favoriteResult &&
    favoriteMargin >= 2 &&
    totalGoals >= 3
  ) {
    reviewLift *= 1.08
  }
  if (
    activeModelCalibration.oneGoalBaseline &&
    favoriteProbability < 0.66 &&
    item.result === favoriteResult &&
    favoriteMargin === 1
  ) {
    reviewLift *= 1.05
  }
  if (activeModelCalibration.lowDrawRetention && item.result === scoreResult(0, 0) && totalGoals <= 2 && drawStrength >= 0.28) {
    reviewLift *= 1.06
  }
  if (
    activeModelCalibration.favoriteControlBoost &&
    favoriteProbability >= 0.66 &&
    item.result === favoriteResult &&
    underdogGoals === 0 &&
    favoriteMargin >= 2 &&
    totalGoals <= 3
  ) {
    reviewLift *= favoriteMargin === 2 ? 1.1 : 1.07
  }
  if (
    activeModelCalibration.favoriteCleanSheetReorder &&
    totalSignal.line <= 2.5 &&
    totalSignal.underProbability >= 0.54 &&
    favoriteProbability >= 0.56 &&
    item.result === favoriteResult
  ) {
    if (underdogGoals === 0 && favoriteMargin === 2 && totalGoals <= 3) reviewLift *= 1.07
    if (underdogGoals >= 1 && totalGoals >= 3) reviewLift *= 0.96
  }
  if (
    activeModelCalibration.underdogGoalRetention &&
    item.result === favoriteResult &&
    underdogGoals === 1 &&
    totalGoals >= 2 &&
    totalGoals <= 4
  ) {
    reviewLift *= 1.06
  }
  if (activeModelCalibration.highGoalVolatility && totalGoals >= 4) {
    reviewLift *= favoriteProbability >= 0.6 && item.result === favoriteResult ? 1.06 : 1.04
  }
  if (activeModelCalibration.highGoalVolatility && totalGoals <= 1 && favoriteProbability >= 0.62) {
    reviewLift *= 0.97
  }
  if (
    activeModelCalibration.awayFavoriteTailGuard &&
    favoriteSide === 'away' &&
    item.result === favoriteResult &&
    favoriteGoals >= 3 &&
    totalGoals >= 4
  ) {
    reviewLift *= 1.09
  }
  if (
    activeModelCalibration.homeNarrativeDampening &&
    favoriteSide === 'home' &&
    item.result === favoriteResult &&
    context?.situational?.host?.edge > 0 &&
    (context?.away?.tournament?.attackScore ?? 50) >= 62 &&
    favoriteProbability < 0.58
  ) {
    reviewLift *= 0.95
  }
  if (activeModelCalibration.eliteLowScoreGuard && context?.advancement?.pressureType === 'knockout') {
    if (item.result === favoriteResult && totalGoals <= 1) reviewLift *= 1.05
    if (totalGoals >= 4 && favoriteProbability < 0.7) reviewLift *= 0.96
  }
  if (
    activeModelCalibration.underdogMultiGoalGuard &&
    item.result === favoriteResult &&
    underdogGoals >= 2 &&
    favoriteGoals >= 3 &&
    totalGoals >= 5 &&
    (totalExpectedGoals ?? totalGoals) >= 2.85
  ) {
    reviewLift *= 1.08
  }
  if (activeModelCalibration.drawGuard && item.result === scoreResult(0, 0) && totalGoals <= 2 && drawStrength >= 0.22) {
    reviewLift *= 1.04
  }
  if (
    activeModelCalibration.lateKnockoutDrawOvercall &&
    context?.advancement?.pressureType === 'knockout' &&
    item.result === scoreResult(0, 0) &&
    totalGoals <= 2 &&
    drawStrength >= 0.3
  ) {
    reviewLift *= 0.84
  }
  if (
    activeModelCalibration.knockoutDrawFade &&
    favoriteProbability >= 0.6 &&
    item.result === scoreResult(0, 0) &&
    totalGoals === 0
  ) {
    reviewLift *= 0.94
  }
  const strengthLift = scoreStrengthCoherenceMultiplier(
    homeGoals,
    awayGoals,
    [
      { side: 'home', probability: homeWinStrength },
      { side: 'draw', probability: drawStrength },
      { side: 'away', probability: awayWinStrength },
    ],
    context,
    totalExpectedGoals ?? totalGoals,
    market,
  )
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
    reviewLift *
    strengthLift *
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

function simulateMatchProgress({
  homeTeam,
  awayTeam,
  homeExpectedGoals,
  awayExpectedGoals,
  resultProbabilities,
  totalExpectedGoals,
  context,
}) {
  const seed = [
    homeTeam.name,
    awayTeam.name,
    homeExpectedGoals.toFixed(2),
    awayExpectedGoals.toFixed(2),
    totalExpectedGoals.toFixed(2),
    resultProbabilities.map((item) => `${item.side}:${item.probability}`).join(','),
  ].join('|')
  const rng = seededRandom(seed)
  const phases = matchPhaseWeights(context, resultProbabilities, totalExpectedGoals)
  const resultCounts = new Map([
    ['主胜', 0],
    ['平局', 0],
    ['客胜', 0],
  ])
  const resultSides = new Map([
    ['主胜', 'home'],
    ['平局', 'draw'],
    ['客胜', 'away'],
  ])
  const scoreCounts = new Map()
  const totalCounts = new Map()
  const halftimeScoreCounts = new Map()
  const halftimeResultCounts = new Map([
    ['主胜', 0],
    ['平局', 0],
    ['客胜', 0],
  ])
  const firstGoalCounts = new Map([
    ['home', 0],
    ['away', 0],
    ['none', 0],
  ])
  const firstGoalPhaseCounts = new Map()

  let lateGoalCount = 0
  let noGoalFirst30Count = 0
  let equalizerCount = 0
  let comebackCount = 0
  let favoriteCoverCount = 0
  const favoriteSide = favoriteSideFromProbabilities(resultProbabilities)

  for (let run = 0; run < MONTE_CARLO_RUNS; run += 1) {
    const match = simulateSingleProgress({
      homeExpectedGoals,
      awayExpectedGoals,
      phases,
      favoriteSide,
      context,
      rng,
    })
    const result = scoreResult(match.homeGoals, match.awayGoals)
    const score = `${match.homeGoals}-${match.awayGoals}`
    const totalGoals = match.homeGoals + match.awayGoals
    const totalKey = totalGoals >= 7 ? '7+' : String(totalGoals)
    const halftimeScore = `${match.halftimeHome}-${match.halftimeAway}`
    const halftimeResult = scoreResult(match.halftimeHome, match.halftimeAway)

    resultCounts.set(result, (resultCounts.get(result) ?? 0) + 1)
    scoreCounts.set(score, (scoreCounts.get(score) ?? 0) + 1)
    totalCounts.set(totalKey, (totalCounts.get(totalKey) ?? 0) + 1)
    halftimeScoreCounts.set(halftimeScore, (halftimeScoreCounts.get(halftimeScore) ?? 0) + 1)
    halftimeResultCounts.set(halftimeResult, (halftimeResultCounts.get(halftimeResult) ?? 0) + 1)
    firstGoalCounts.set(match.firstGoalSide, (firstGoalCounts.get(match.firstGoalSide) ?? 0) + 1)
    if (match.firstGoalPhase) {
      firstGoalPhaseCounts.set(match.firstGoalPhase, (firstGoalPhaseCounts.get(match.firstGoalPhase) ?? 0) + 1)
    }
    if (match.hasLateGoal) lateGoalCount += 1
    if (match.noGoalFirst30) noGoalFirst30Count += 1
    if (match.hasEqualizer) equalizerCount += 1
    if (match.hasComeback) comebackCount += 1
    if (favoriteSide === 'home' && match.homeGoals - match.awayGoals >= 2) favoriteCoverCount += 1
    if (favoriteSide === 'away' && match.awayGoals - match.homeGoals >= 2) favoriteCoverCount += 1
  }

  const resultDistribution = mapCountsToDistribution(resultCounts, MONTE_CARLO_RUNS, {
    sideByLabel: resultSides,
  })
  const scoreDistribution = mapCountsToDistribution(scoreCounts, MONTE_CARLO_RUNS).map((item) => ({
    ...item,
    score: item.label,
  }))
  const topScores = scoreDistribution.slice(0, 8)
  const totalGoals = mapCountsToDistribution(totalCounts, MONTE_CARLO_RUNS)
    .sort((left, right) => {
      const leftNumber = left.label === '7+' ? 7 : Number(left.label)
      const rightNumber = right.label === '7+' ? 7 : Number(right.label)
      return leftNumber - rightNumber
    })
    .map((item) => ({ ...item, goals: item.label }))
  const halftimeScores = mapCountsToDistribution(halftimeScoreCounts, MONTE_CARLO_RUNS)
  const halftimeResults = mapCountsToDistribution(halftimeResultCounts, MONTE_CARLO_RUNS, {
    sideByLabel: resultSides,
  })
  const firstGoalPhase = mapCountsToDistribution(firstGoalPhaseCounts, MONTE_CARLO_RUNS)[0] ?? null
  const topResult = resultDistribution[0]
  const topTotal = [...totalGoals].sort((left, right) => right.probability - left.probability)[0]
  const process = {
    firstGoalHomeProbability: round((firstGoalCounts.get('home') ?? 0) / MONTE_CARLO_RUNS, 4),
    firstGoalAwayProbability: round((firstGoalCounts.get('away') ?? 0) / MONTE_CARLO_RUNS, 4),
    noGoalProbability: round((firstGoalCounts.get('none') ?? 0) / MONTE_CARLO_RUNS, 4),
    firstGoalMostLikelyPhase: firstGoalPhase?.label ?? '无进球',
    lateGoalProbability: round(lateGoalCount / MONTE_CARLO_RUNS, 4),
    noGoalFirst30Probability: round(noGoalFirst30Count / MONTE_CARLO_RUNS, 4),
    equalizerProbability: round(equalizerCount / MONTE_CARLO_RUNS, 4),
    comebackProbability: round(comebackCount / MONTE_CARLO_RUNS, 4),
    favoriteCoverProbability: favoriteSide === 'draw' ? null : round(favoriteCoverCount / MONTE_CARLO_RUNS, 4),
  }

  return {
    model: `10,000-run deterministic Monte Carlo match-process simulation (${REGULATION_SCOPE_SHORT})`,
    scope: REGULATION_SCOPE,
    runs: MONTE_CARLO_RUNS,
    seed,
    resultDistribution,
    scoreDistribution,
    topScores,
    totalGoals,
    halftime: {
      mostCommonScore: halftimeScores[0]?.label ?? '0-0',
      resultDistribution: halftimeResults,
    },
    process,
    summary: buildSimulationSummary({
      result: topResult,
      topScores,
      topTotal,
      process,
    }),
  }
}

function buildModelAgreement({
  marketResultProbabilities,
  resultProbabilities,
  candidates,
  simulation,
  totalExpectedGoals,
  probabilityEnsemble = null,
}) {
  const marketLeader = [...marketResultProbabilities].sort((left, right) => right.probability - left.probability)[0] ?? null
  const marketRunnerUp = [...marketResultProbabilities].sort((left, right) => right.probability - left.probability)[1] ?? null
  const ensembleLeader = [...resultProbabilities].sort((left, right) => right.probability - left.probability)[0] ?? null
  const openSourceOutcomes = marketResultProbabilities.map((item, index) => ({
    ...item,
    probability: probabilityEnsemble?.openSource?.[index] ?? item.probability,
  }))
  const openSourceLeader = [...openSourceOutcomes].sort((left, right) => right.probability - left.probability)[0] ?? null
  const poissonCandidate = [...candidates].sort(
    (left, right) =>
      (right.poissonProbability ?? right.probability ?? 0) - (left.poissonProbability ?? left.probability ?? 0),
  )[0]
  const poissonLeader = poissonCandidate ? sideFromResult(poissonCandidate.result) : null
  const simulationLeader = simulation?.resultDistribution?.[0]?.side ?? null
  const topSimulationScore = simulation?.topScores?.[0]?.score ?? ''
  const topPoissonScore = poissonCandidate?.score ?? ''
  const topThreeScores = candidates.slice(0, 3).map((item) => item.score)
  const directionVotes = [marketLeader?.side, openSourceLeader?.side, poissonLeader, simulationLeader].filter(Boolean)
  const directionAgreement = Math.max(
    ...['home', 'draw', 'away'].map((side) => directionVotes.filter((vote) => vote === side).length),
    0,
  )
  const marketGap = marketLeader && marketRunnerUp ? round(marketLeader.probability - marketRunnerUp.probability, 4) : 0
  const totalBand = totalGoalsBand(totalExpectedGoals, simulation).selection
  const totalBandNumbers = parseTotalBandSelection(totalBand)
  const topSimulationTotal = simulation?.totalGoals
    ? [...simulation.totalGoals].sort((left, right) => right.probability - left.probability)[0]
    : null
  const topSimulationTotalNumber = topSimulationTotal?.goals === '7+' ? 7 : Number(topSimulationTotal?.goals)
  const scoreAgreement =
    topSimulationScore && topSimulationScore === topPoissonScore
      ? 'top1'
      : topSimulationScore && topThreeScores.includes(topSimulationScore)
        ? 'top3'
        : 'conflict'
  const totalAgreement = Number.isFinite(topSimulationTotalNumber) ? totalBandNumbers.includes(topSimulationTotalNumber) : false
  const simulationConfidence = simulation?.resultDistribution?.[0]?.probability ?? 0
  const flags = []

  if (directionAgreement < 2) flags.push('四模型胜平负方向高度冲突')
  if (directionAgreement === 2) flags.push('四模型仅两票一致')
  if (directionAgreement === 3) flags.push('四模型有一票分歧')
  if (probabilityEnsemble?.disagreement?.directionConflict) flags.push('市场与开源独立模型主方向冲突')
  if ((probabilityEnsemble?.disagreement?.totalVariation ?? 0) >= 0.12) flags.push('市场与开源概率差距较大')
  if (scoreAgreement === 'conflict') flags.push('Poisson首选比分与蒙特卡洛最密比分不在同一区间')
  if (scoreAgreement === 'top3') flags.push('比分方向仅前三候选一致')
  if (!totalAgreement) flags.push('总进球区间与蒙特卡洛最密总进球不一致')
  if (marketGap < 0.08) flags.push('盘口去水概率差距过窄')
  if (simulationConfidence < 0.55) flags.push('蒙特卡洛主方向不足55%')
  if ((simulation?.process?.lateGoalProbability ?? 0) >= 0.55) flags.push('后段进球概率高，比分尾部更容易漂移')

  const conflictScore = clamp(
    (directionAgreement === 4 ? 0 : directionAgreement === 3 ? 5 : directionAgreement === 2 ? 10 : 16) +
      (scoreAgreement === 'top1' ? 0 : scoreAgreement === 'top3' ? 4 : 9) +
      (totalAgreement ? 0 : 5) +
      (marketGap < 0.08 ? 6 : 0) +
      (simulationConfidence < 0.55 ? 5 : 0) +
      ((probabilityEnsemble?.disagreement?.totalVariation ?? 0) >= 0.12 ? 5 : 0) +
      ((simulation?.process?.lateGoalProbability ?? 0) >= 0.55 ? 3 : 0),
    0,
    40,
  )
  const riskLevel = conflictScore >= 24 ? '高' : conflictScore >= 14 ? '中' : '低'
  const stakeMultiplier = riskLevel === '高' ? 0.45 : riskLevel === '中' ? 0.7 : 1
  const summary = `模型一致性实验：盘口=${sideLabel(marketLeader?.side)}、开源Elo/DC=${sideLabel(openSourceLeader?.side)}、Poisson=${sideLabel(poissonLeader)}、蒙特卡洛=${sideLabel(simulationLeader)}；决策层=${sideLabel(ensembleLeader?.side)}，冲突分 ${conflictScore}/40（${riskLevel}），${flags.length ? flags.slice(0, 3).join('；') : '四层判断基本一致'}。`

  return {
    model: 'market + open Elo/Dixon-Coles + poisson + 10k monte-carlo agreement experiment',
    marketDirection: marketLeader
      ? {
          side: marketLeader.side,
          label: marketLeader.label,
          probability: marketLeader.probability,
        }
      : null,
    poissonDirection: {
      side: poissonLeader,
      score: topPoissonScore,
      result: poissonCandidate?.result ?? null,
      probability: poissonCandidate?.poissonProbability ?? poissonCandidate?.probability ?? null,
    },
    openSourceDirection: openSourceLeader
      ? {
          side: openSourceLeader.side,
          label: openSourceLeader.label,
          probability: openSourceLeader.probability,
        }
      : null,
    ensembleDirection: ensembleLeader
      ? {
          side: ensembleLeader.side,
          label: ensembleLeader.label,
          probability: ensembleLeader.probability,
        }
      : null,
    simulationDirection: simulation?.resultDistribution?.[0] ?? null,
    probabilityDisagreement: probabilityEnsemble?.disagreement ?? null,
    marketGap,
    directionAgreement,
    scoreAgreement,
    totalAgreement,
    topSimulationScore,
    topSimulationTotal: topSimulationTotal?.goals ?? null,
    conflictScore,
    riskLevel,
    confidencePenalty: conflictScore,
    stakeMultiplier,
    flags,
    summary,
  }
}

function sideLabel(side) {
  if (side === 'home') return '主胜'
  if (side === 'away') return '客胜'
  if (side === 'draw') return '平局'
  return '未知'
}

function simulateSingleProgress({ homeExpectedGoals, awayExpectedGoals, phases, favoriteSide, context, rng }) {
  let homeGoals = 0
  let awayGoals = 0
  let halftimeHome = 0
  let halftimeAway = 0
  let homeTrailed = false
  let awayTrailed = false
  let hasEqualizer = false
  const events = []

  for (const phase of phases) {
    let homeLambda = homeExpectedGoals * phase.weight
    let awayLambda = awayExpectedGoals * phase.weight

    if (phase.start >= 61) {
      if (homeGoals < awayGoals) homeLambda *= 1.12
      if (awayGoals < homeGoals) awayLambda *= 1.12
      if (homeGoals > awayGoals) homeLambda *= 0.97
      if (awayGoals > homeGoals) awayLambda *= 0.97
    }

    if (phase.start >= 76) {
      if (context?.advancement?.pressureType === 'knockout' && homeGoals === awayGoals) {
        homeLambda *= 0.96
        awayLambda *= 0.96
      }
      if (favoriteSide === 'home' && homeGoals <= awayGoals) homeLambda *= 1.08
      if (favoriteSide === 'away' && awayGoals <= homeGoals) awayLambda *= 1.08
    }

    if (context?.weather?.riskLevel === '高' && phase.end <= 45) {
      homeLambda *= 0.96
      awayLambda *= 0.96
    }

    const phaseEvents = []
    const homePhaseGoals = poissonSample(homeLambda, rng)
    const awayPhaseGoals = poissonSample(awayLambda, rng)
    for (let goal = 0; goal < homePhaseGoals; goal += 1) {
      phaseEvents.push({ side: 'home', minute: randomMinuteInPhase(phase, rng), phase: phase.label })
    }
    for (let goal = 0; goal < awayPhaseGoals; goal += 1) {
      phaseEvents.push({ side: 'away', minute: randomMinuteInPhase(phase, rng), phase: phase.label })
    }

    phaseEvents.sort((left, right) => left.minute - right.minute || rng() - 0.5)
    for (const event of phaseEvents) {
      if (homeGoals < awayGoals) homeTrailed = true
      if (awayGoals < homeGoals) awayTrailed = true
      if (event.side === 'home') homeGoals += 1
      if (event.side === 'away') awayGoals += 1
      if (homeGoals === awayGoals && homeGoals + awayGoals > 0) hasEqualizer = true
      events.push(event)
    }

    if (phase.end <= 45) {
      halftimeHome = homeGoals
      halftimeAway = awayGoals
    }
  }

  const firstGoal = events[0]
  const hasLateGoal = events.some((event) => event.minute >= 76)
  const noGoalFirst30 = !events.some((event) => event.minute <= 30)
  const hasComeback = (homeGoals > awayGoals && homeTrailed) || (awayGoals > homeGoals && awayTrailed)

  return {
    homeGoals,
    awayGoals,
    halftimeHome,
    halftimeAway,
    firstGoalSide: firstGoal?.side ?? 'none',
    firstGoalPhase: firstGoal?.phase ?? null,
    hasLateGoal,
    noGoalFirst30,
    hasEqualizer,
    hasComeback,
  }
}

function matchPhaseWeights(context, resultProbabilities, totalExpectedGoals) {
  const phases = [
    { label: '0-15', start: 0, end: 15, weight: 0.13 },
    { label: '16-30', start: 16, end: 30, weight: 0.14 },
    { label: '31-45+', start: 31, end: 45, weight: 0.16 },
    { label: '46-60', start: 46, end: 60, weight: 0.16 },
    { label: '61-75', start: 61, end: 75, weight: 0.18 },
    { label: '76-90+', start: 76, end: 95, weight: 0.23 },
  ]
  const drawProbability = resultProbabilities.find((item) => item.side === 'draw')?.probability ?? 0.26
  const favoriteProbability = Math.max(...resultProbabilities.map((item) => item.probability))

  if (context?.advancement?.pressureType === 'knockout') {
    phases[0].weight -= 0.015
    phases[1].weight -= 0.01
    phases[4].weight += 0.01
    phases[5].weight += 0.015
  }
  if (context?.advancement?.pressureScore >= 76) {
    phases[2].weight += 0.01
    phases[5].weight += 0.015
    phases[0].weight -= 0.01
    phases[1].weight -= 0.015
  }
  if (drawProbability >= 0.29 && totalExpectedGoals <= 2.55) {
    phases[0].weight -= 0.01
    phases[1].weight -= 0.01
    phases[5].weight += 0.02
  }
  if (favoriteProbability >= 0.68) {
    phases[1].weight += 0.01
    phases[2].weight += 0.01
    phases[5].weight -= 0.02
  }
  if (context?.situational?.riskDelta >= 7) {
    phases[4].weight += 0.01
    phases[5].weight += 0.01
    phases[0].weight -= 0.01
    phases[1].weight -= 0.01
  }

  const totalWeight = phases.reduce((sum, phase) => sum + Math.max(phase.weight, 0.04), 0)
  return phases.map((phase) => ({
    ...phase,
    weight: Math.max(phase.weight, 0.04) / totalWeight,
  }))
}

function favoriteSideFromProbabilities(resultProbabilities) {
  return [...resultProbabilities].sort((left, right) => right.probability - left.probability)[0]?.side ?? 'draw'
}

function mapCountsToDistribution(counts, runs, options = {}) {
  const sideByLabel = options.sideByLabel ?? new Map()
  return [...counts.entries()]
    .map(([label, count]) => ({
      label,
      side: sideByLabel.get(label) ?? null,
      probability: round(count / runs, 4),
      count,
    }))
    .sort((left, right) => right.probability - left.probability)
}

function buildSimulationSummary({ result, topScores, topTotal, process }) {
  const scoreText = topScores
    .slice(0, 3)
    .map((item) => `${item.score} ${formatPct(item.probability)}`)
    .join(' / ')
  return `${MONTE_CARLO_RUNS.toLocaleString('zh-CN')}次${REGULATION_SCOPE_SHORT}进程模拟：${result?.label ?? '方向不明'} ${formatPct(result?.probability ?? 0)}；最密比分 ${scoreText || '暂无'}；总进球最集中 ${topTotal?.goals ?? '-'}球 ${formatPct(topTotal?.probability ?? 0)}；76分钟后仍有进球 ${formatPct(process.lateGoalProbability)}，前30分钟无进球 ${formatPct(process.noGoalFirst30Probability)}。`
}

function seededRandom(seedText) {
  let hash = 1779033703 ^ seedText.length
  for (let index = 0; index < seedText.length; index += 1) {
    hash = Math.imul(hash ^ seedText.charCodeAt(index), 3432918353)
    hash = (hash << 13) | (hash >>> 19)
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
    hash ^= hash >>> 16
    return (hash >>> 0) / 4294967296
  }
}

function poissonSample(lambda, rng) {
  if (lambda <= 0) return 0
  const limit = Math.exp(-lambda)
  let product = 1
  let goals = 0
  do {
    goals += 1
    product *= rng()
  } while (product > limit && goals < 12)
  return goals - 1
}

function randomMinuteInPhase(phase, rng) {
  return phase.start + Math.floor(rng() * (phase.end - phase.start + 1))
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

function buildJudgement(market, event, newsItems, context = null, probabilityEnsemble = null) {
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

  const marketOutcomes = market.moneyline.filter((item) => typeof item.normalizedProbability === 'number')
  const outcomes = marketOutcomes.map((item, index) => ({
    ...item,
    normalizedProbability: probabilityEnsemble?.blended?.[index] ?? item.normalizedProbability,
  }))
  const favorite = [...outcomes].sort((left, right) => (right.normalizedProbability ?? 0) - (left.normalizedProbability ?? 0))[0]
  const draw = outcomes.find((item) => item.side === 'draw')
  const favoriteProbability = favorite?.normalizedProbability ?? 0
  const drawProbability = draw?.normalizedProbability ?? 0
  const lineMove = marketOutcomes.find((item) => item.side === favorite?.side)?.movement ?? 0
  const newsHeat = contextNewsRisk(context) ? 12 : 5
  const priceRisk = favoriteProbability > 0.76 ? 78 : favoriteProbability > 0.64 ? 58 : 46
  const drawRisk = drawProbability > 0.27 ? 66 : 42
  const moveRisk = Math.min(85, Math.abs(lineMove) * 7 + 38)
  const scheduleRisk = new Date(event.date).getTime() - now.getTime() < 5 * 60 * 60 * 1000 ? 62 : 48
  const contextRiskDelta = context?.adjustment?.riskDelta ?? 0
  const openModelPenalty = probabilityEnsemble?.disagreement?.confidencePenalty ?? 0
  const risk = clamp(
    Math.round((priceRisk + drawRisk + moveRisk + scheduleRisk + newsHeat) / 5 + contextRiskDelta + openModelPenalty),
    28,
    92,
  )
  const confidence = clamp(
    Math.round(
      48 +
        favoriteProbability * 38 +
        Math.max(lineMove, 0) * 1.2 -
        risk * 0.12 +
        (context?.adjustment?.confidenceDelta ?? 0) -
        openModelPenalty * 0.6,
    ),
    34,
    88,
  )

  let tier = '观望'
  let stake = '只做观察，不主动加码'
  let lean = `倾向 ${favorite?.label ?? '市场热门'}，但需要赔率核验`
  let guidance = '市场分歧和不确定性仍高，优先看赛前阵容、官方竞彩赔率和盘口变化。'
  let avoid = '避免把淘汰赛常规时间的平局风险低估；平局只在盘口、总进球和模拟同时支持时升级。'

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
      ...(probabilityEnsemble
        ? [
            {
              label: '开源模型共识',
              value: Math.round((1 - probabilityEnsemble.disagreement.totalVariation) * 100),
              tone: probabilityEnsemble.disagreement.directionConflict ? 'bad' : probabilityEnsemble.disagreement.totalVariation >= 0.12 ? 'watch' : 'good',
              note: `市场/开源总变差 ${formatPct(probabilityEnsemble.disagreement.totalVariation)}；${probabilityEnsemble.adopted ? '验证后已进入概率集成' : '只用于不确定性惩罚'}`,
            },
          ]
        : []),
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
              label: '赛程体能',
              value: Math.max(30, 82 - context.situational.riskDelta * 6),
              tone: context.situational.riskDelta >= 6 ? 'watch' : 'good',
              note: context.situational.summary,
            },
            {
              label: '古法展示',
              value: 0,
              tone: 'watch',
              note: `${context.divination.method}；文化展示，不进入数值预测。`,
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

function chinaDateParts(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value ?? 0),
    month: Number(parts.find((part) => part.type === 'month')?.value ?? 0),
    day: Number(parts.find((part) => part.type === 'day')?.value ?? 0),
    hour: Number(parts.find((part) => part.type === 'hour')?.value ?? 0),
  }
}

function hourBranchContext(hour) {
  const branches = [
    { branch: '子', element: '水' },
    { branch: '丑', element: '土' },
    { branch: '丑', element: '土' },
    { branch: '寅', element: '木' },
    { branch: '寅', element: '木' },
    { branch: '卯', element: '木' },
    { branch: '卯', element: '木' },
    { branch: '辰', element: '土' },
    { branch: '辰', element: '土' },
    { branch: '巳', element: '火' },
    { branch: '巳', element: '火' },
    { branch: '午', element: '火' },
    { branch: '午', element: '火' },
    { branch: '未', element: '土' },
    { branch: '未', element: '土' },
    { branch: '申', element: '金' },
    { branch: '申', element: '金' },
    { branch: '酉', element: '金' },
    { branch: '酉', element: '金' },
    { branch: '戌', element: '土' },
    { branch: '戌', element: '土' },
    { branch: '亥', element: '水' },
    { branch: '亥', element: '水' },
    { branch: '子', element: '水' },
  ]
  return branches[clamp(Math.trunc(hour), 0, 23)] ?? { branch: '中', element: '土' }
}

function weatherElementContext(weather) {
  const precipitation = weather?.precipitationProbability ?? 0
  const humidity = weather?.humidity ?? 0
  const temperature = weather?.temperatureC ?? 22
  const wind = weather?.windKph ?? 0

  if (precipitation >= 45 || humidity >= 82) return '水'
  if (temperature >= 30) return '火'
  if (wind >= 24) return '木'
  if (humidity <= 38 && precipitation <= 8) return '金'
  return '土'
}

function weightedElementHarmony(sourceElement, targetElement, weight) {
  return elementHarmony(sourceElement, targetElement) * weight
}

function elementDuelEdge(homeElement, awayElement) {
  if (!homeElement || !awayElement || homeElement === '中' || awayElement === '中' || homeElement === awayElement) return 0
  if (generatingElement(homeElement) === awayElement) return -0.25
  if (generatingElement(awayElement) === homeElement) return 0.25
  if (controllingElement(homeElement) === awayElement) return 0.55
  if (controllingElement(awayElement) === homeElement) return -0.55
  return 0
}

function elementRelationNote(homeElement, awayElement, homeName, awayName) {
  if (!homeElement || !awayElement || homeElement === '中' || awayElement === '中') {
    return '双方地域五行资料不完整，只保留日时与卦象校验。'
  }
  if (homeElement === awayElement) return `${homeName} 与 ${awayName} 地域五行同取 ${homeElement}，取象不分高下。`
  if (generatingElement(homeElement) === awayElement) return `${homeName} ${homeElement} 生 ${awayName} ${awayElement}，取象上主队略有“泄气”之象。`
  if (generatingElement(awayElement) === homeElement) return `${awayName} ${awayElement} 生 ${homeName} ${homeElement}，取象上主队略受生扶。`
  if (controllingElement(homeElement) === awayElement) return `${homeName} ${homeElement} 克 ${awayName} ${awayElement}，取象上主队略占克制。`
  if (controllingElement(awayElement) === homeElement) return `${awayName} ${awayElement} 克 ${homeName} ${homeElement}，取象上客队略占克制。`
  return '双方五行关系中性，主要看日时和卦象。'
}

function generatingElement(element) {
  return new Map([
    ['木', '火'],
    ['火', '土'],
    ['土', '金'],
    ['金', '水'],
    ['水', '木'],
  ]).get(element)
}

function controllingElement(element) {
  return new Map([
    ['木', '土'],
    ['土', '水'],
    ['水', '火'],
    ['火', '金'],
    ['金', '木'],
  ]).get(element)
}

function elementHarmony(dayElement, teamElement) {
  if (!dayElement || !teamElement || teamElement === '中') return 0
  if (dayElement === teamElement) return 2
  if (generatingElement(dayElement) === teamElement) return 1
  if (generatingElement(teamElement) === dayElement) return 0.5
  if (controllingElement(dayElement) === teamElement) return -1.5
  if (controllingElement(teamElement) === dayElement) return -0.5
  return 0
}

async function fetchJson(url, init) {
  const response = await fetchWithTimeout(url, init)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json()
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
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

function dateKeysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00+08:00`)
  const end = new Date(`${endDate}T00:00:00+08:00`)
  const keys = []

  for (const date = new Date(start); date.getTime() <= end.getTime(); date.setDate(date.getDate() + 1)) {
    keys.push(formatDateKey(date, 0, ''))
  }

  return keys
}

function uniqueDateKeys(keys) {
  return [...new Set(keys.filter(Boolean))]
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

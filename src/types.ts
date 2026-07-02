export type SourceStatus = 'ok' | 'warn' | 'error' | 'skipped'

export interface SourceHealth {
  id: string
  name: string
  status: SourceStatus
  url: string
  lastCheckedAt: string
  detail: string
}

export interface Team {
  id: string
  name: string
  zhName: string
  abbreviation: string
  logo?: string
  form?: string
  record?: string
}

export interface MarketOutcome {
  label: string
  side: 'home' | 'draw' | 'away' | 'over' | 'under' | 'spreadHome' | 'spreadAway'
  american: string | null
  decimal: number | null
  impliedProbability: number | null
  normalizedProbability?: number | null
  line?: string | null
  movement?: number | null
}

export interface MarketSnapshot {
  provider: string
  details: string
  moneyline: MarketOutcome[]
  total: MarketOutcome[]
  spread: MarketOutcome[]
  updatedAt: string
}

export interface ModelFactor {
  label: string
  value: number
  tone: 'good' | 'watch' | 'bad'
  note: string
}

export interface ModelJudgement {
  confidence: number
  risk: number
  tier: '观望' | '小额娱乐' | '避免追高'
  lean: string
  stake: string
  guidance: string
  avoid: string
  factors: ModelFactor[]
}

export interface RecentMatch {
  date: string
  dateUtc?: string
  opponent: string
  opponentZhName: string
  result: 'W' | 'D' | 'L'
  score: string
  goalsFor: number
  goalsAgainst: number
  homeAway: string
  competition: string
  note: string
}

export interface InjuryItem {
  player: string
  status: string
  detail: string
}

export interface InjuryContext {
  status: string
  riskScore: number
  items: InjuryItem[]
  relatedNews: string[]
  note: string
  sourceUrl: string
}

export interface PlayerSignal {
  label: string
  player: string
  value: string
  position: string
}

export interface TournamentMatchRecord {
  date: string
  dateUtc?: string
  opponent: string
  result: 'W' | 'D' | 'L'
  score: string
  goalsFor: number
  goalsAgainst: number
}

export interface TournamentTeamRecord {
  name: string
  zhName: string
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  cleanSheets: number
  failedToScore: number
  bigWins: number
  heavyLosses: number
  points: number
  goalsForAvg: number
  goalsAgainstAvg: number
  formString: string
  attackScore: number
  defenseScore: number
  momentumScore: number
  strengthScore: number
  matches: TournamentMatchRecord[]
  summary: string
}

export interface TeamContext {
  formString: string
  recentMatches: RecentMatch[]
  sampleSize: number
  formScore: number
  goalsForAvg: number | null
  goalsAgainstAvg: number | null
  trendNote: string
  sourceUrl: string
  tournament: TournamentTeamRecord
  injuries: InjuryContext
  playerSignals: PlayerSignal[]
}

export interface WeatherContext {
  status: string
  venueName: string
  city: string
  latitude?: number
  longitude?: number
  roofLikely: boolean
  temperatureC: number | null
  precipitationProbability: number | null
  windKph: number | null
  humidity: number | null
  riskLevel: '低' | '中' | '高'
  summary: string
}

export interface GeographyContext {
  homeRegion: string
  awayRegion: string
  homeClimate: string
  awayClimate: string
  homeElement: string
  awayElement: string
  homeDistanceKm: number | null
  awayDistanceKm: number | null
  distanceEdgeKm: number
  travelEdge: string
  summary: string
}

export interface DivinationContext {
  method: string
  homeSymbol: string
  awaySymbol: string
  dayElement: string
  hourBranch?: string
  hourElement?: string
  weatherElement?: string
  homeNameElement?: string
  awayNameElement?: string
  homeFortune?: number
  awayFortune?: number
  relationNote?: string
  breakdown?: string[]
  lean: 'home' | 'away' | 'neutral'
  delta: number
  weight: string
  summary: string
}

export interface ContextAdjustment {
  homeGoalDiffDelta: number
  totalGoalsDelta: number
  confidenceDelta: number
  riskDelta: number
  notes: string[]
}

export interface HumanFactorProfile {
  mentality: number
  coach: number
  pressure: number
  volatility: number
  note: string
}

export interface HumanFactorsContext {
  home: HumanFactorProfile
  away: HumanFactorProfile
  homeCombined: number
  awayCombined: number
  edge: number
  lean: 'home' | 'away' | 'neutral'
  summary: string
}

export interface AdvancementOpponent {
  name: string
  zhName: string
  placeholder?: boolean
  strengthScore: number
  record?: string
  goals?: string
}

export interface AdvancementContext {
  stage: string
  stageLabel: string
  pressureType: 'group' | 'knockout' | 'none'
  pressureScore: number
  pressureLevel: '低' | '中' | '高'
  homePressure: number
  awayPressure: number
  homeNeed: string
  awayNeed: string
  bracketOpponentStrength: number | null
  nextOpponentPool: AdvancementOpponent[]
  summary: string
  homeGoalDiffDelta: number
  totalGoalsDelta: number
  riskDelta: number
  confidenceDelta: number
}

export interface SituationalContext {
  rest: {
    homeDays: number | null
    awayDays: number | null
    edgeDays: number
    summary: string
  }
  bodyClock: {
    localHour: number | null
    homeShiftHours: number | null
    awayShiftHours: number | null
    edgeHours: number
    summary: string
  }
  host: {
    country: string | null
    homeHost: boolean
    awayHost: boolean
    edge: number
    summary: string
  }
  knockoutTempo: {
    penaltyRisk: number
    extraTimeRisk: number
    summary: string
  }
  homeGoalDiffDelta: number
  totalGoalsDelta: number
  confidenceDelta: number
  riskDelta: number
  summary: string
}

export interface MatchContext {
  home: TeamContext
  away: TeamContext
  weather: WeatherContext
  geography: GeographyContext
  divination: DivinationContext
  humanFactors: HumanFactorsContext
  advancement: AdvancementContext
  situational: SituationalContext
  adjustment: ContextAdjustment
  note: string
}

export interface ResultProbability {
  label: string
  side: 'home' | 'draw' | 'away'
  probability: number
}

export interface ScorelineCandidate {
  score: string
  result: '主胜' | '平局' | '客胜'
  probability: number
  baseProbability?: number
  tailMultiplier?: number
  fairOdds: number
  suggestedMinOdds: number
  officialOdds: number | null
  expectedValue: number | null
  expectedValueAtSuggestedOdds: number
  grade: '首选核验' | '备选' | '回避'
  reason: string
}

export interface SimulationDistribution {
  label: string
  side: 'home' | 'draw' | 'away' | null
  probability: number
  count: number
  score?: string
  goals?: string
}

export interface MatchProcessSimulation {
  model: string
  runs: number
  seed: string
  resultDistribution: SimulationDistribution[]
  topScores: SimulationDistribution[]
  totalGoals: SimulationDistribution[]
  halftime: {
    mostCommonScore: string
    resultDistribution: SimulationDistribution[]
  }
  process: {
    firstGoalHomeProbability: number
    firstGoalAwayProbability: number
    noGoalProbability: number
    firstGoalMostLikelyPhase: string
    lateGoalProbability: number
    noGoalFirst30Probability: number
    equalizerProbability: number
    comebackProbability: number
    favoriteCoverProbability: number | null
  }
  summary: string
}

export interface ScorelineAnalysis {
  model: string
  homeExpectedGoals: number
  awayExpectedGoals: number
  totalExpectedGoals: number
  resultProbabilities: ResultProbability[]
  bestPick: ScorelineCandidate | null
  candidates: ScorelineCandidate[]
  avoid: ScorelineCandidate[]
  simulation?: MatchProcessSimulation
  notes: string[]
}

export interface ProfessionalSignal {
  label: string
  score: number
  tone: 'good' | 'watch' | 'bad'
  evidence: string
}

export interface ExpertAnswer {
  verdict: string
  recommendedScore: string
  secondaryScores: string[]
  marketDirection: string
  totalGoals: string
  buyCondition: string
  passCondition: string
  stakeCeiling: string
  confidenceBand: string
}

export interface PlayRecommendation {
  playType: '比分' | '胜平负' | '让球胜平负' | '总进球' | '回避'
  selection: string
  priority: '主方案' | '备选' | '防守' | '不建议'
  confidence: number
  budgetShare: string
  minOdds: string
  expectedValueNote: string
  reason: string
  noBetIf: string
}

export interface ScenarioNote {
  title: string
  probability: string
  scorePath: string
  action: string
}

export interface RiskControlNote {
  label: string
  level: '低' | '中' | '高'
  detail: string
}

export interface DeepThinkingPurchase {
  label: string
  selection: string
  allocation: string
  minOdds: string
  action: '买入核验' | '小额防守' | '只看不买' | '放弃'
  rationale: string
}

export interface DeepThinkingPlan {
  label: string
  conclusion: string
  confidenceScore: number
  purchasePlan: DeepThinkingPurchase[]
  reasoningSummary: string[]
  noBuyRules: string[]
  updateSensitivity: string
}

export interface ProfessionalBrief {
  rankScore: number
  grade: '重点核验' | '小额分散' | '只核验不追高' | '观望'
  headline: string
  finalAdvice: string
  stakingPlan: string
  deepThinking: DeepThinkingPlan
  expertAnswer: ExpertAnswer
  primary: PlayRecommendation | null
  plays: PlayRecommendation[]
  scenarios: ScenarioNote[]
  signals: ProfessionalSignal[]
  riskControls: RiskControlNote[]
  checklist: string[]
  downgradeTriggers: string[]
}

export interface SportteryMapping {
  status: '需赛前核验' | '接口可用' | '暂无官方数据'
  officialUrl: string
  markets: string[]
  note: string
}

export interface MatchBrief {
  id: string
  name: string
  group: string
  status: string
  kickoffUtc: string
  kickoffChina: string
  venue: string
  home: Team
  away: Team
  score?: string
  market: MarketSnapshot | null
  context: MatchContext
  judgement: ModelJudgement
  scoreline: ScorelineAnalysis
  professional: ProfessionalBrief
  sporttery: SportteryMapping
}

export interface NewsItem {
  id: string
  title: string
  summary: string
  url: string
  publishedAt: string
  impact: string
}

export interface BankrollRule {
  label: string
  value: string
  note: string
}

export interface WorldCupBrief {
  generatedAt: string
  generatedAtChina: string
  targetDateChina: string
  timezone: string
  summary: {
    headline: string
    note: string
    trackedMatches: number
    healthySources: number
    updateMode: string
  }
  sources: SourceHealth[]
  news: NewsItem[]
  matches: MatchBrief[]
  bankroll: {
    title: string
    disclaimer: string
    rules: BankrollRule[]
  }
}

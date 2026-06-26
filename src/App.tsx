import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent, ReactElement } from 'react'
import {
  Activity,
  Calculator,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  CloudSun,
  Compass,
  Gauge,
  KeyRound,
  ListChecks,
  LineChart,
  LogOut,
  MapPinned,
  RefreshCcw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import type {
  BankrollRule,
  DeepThinkingPurchase,
  MatchBrief,
  MarketOutcome,
  PlayRecommendation,
  ProfessionalSignal,
  RiskControlNote,
  ScorelineCandidate,
  ScenarioNote,
  SourceHealth,
  SourceStatus,
  WorldCupBrief,
} from './types'

type AuthState = 'checking' | 'authenticated' | 'unauthenticated' | 'local' | 'config-error'

function App() {
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [authMessage, setAuthMessage] = useState('')

  useEffect(() => {
    let mounted = true

    fetch('/api/session', {
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!mounted) return
        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.includes('application/json')) {
          setAuthState('local')
          return
        }
        const data = await response.json().catch(() => ({}))
        if (response.ok && data.authenticated) {
          setAuthState('authenticated')
          return
        }
        if (response.status === 503) {
          setAuthMessage(data.message ?? '远程登录环境变量尚未配置。')
          setAuthState('config-error')
          return
        }
        setAuthMessage('')
        setAuthState('unauthenticated')
      })
      .catch(() => {
        if (!mounted) return
        setAuthState('local')
      })

    return () => {
      mounted = false
    }
  }, [])

  const handleLogin = async (accessCode: string) => {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessCode }),
    })
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.message ?? '访问码无效或登录服务不可用。')
    }

    setAuthMessage('')
    setAuthState('authenticated')
  }

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => undefined)
    setAuthState('unauthenticated')
  }

  if (authState === 'checking') {
    return <AuthCheckingShell />
  }

  if (authState === 'unauthenticated' || authState === 'config-error') {
    return (
      <LoginShell
        mode={authState}
        message={authMessage}
        onLogin={handleLogin}
      />
    )
  }

  return (
    <DashboardApp
      authMode={authState === 'local' ? '本地预览' : '远程已登录'}
      onLogout={handleLogout}
    />
  )
}

function DashboardApp({ authMode, onLogout }: { authMode: string; onLogout: () => void }) {
  const [brief, setBrief] = useState<WorldCupBrief | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    fetch('/data/worldcup-brief.json?cache=' + Date.now())
      .then((response) => {
        if (!response.ok) {
          throw new Error('brief unavailable')
        }
        return response.json() as Promise<WorldCupBrief>
      })
      .then((data) => {
        if (!mounted) return
        setBrief(data)
        setSelectedMatchId(data.matches[0]?.id ?? null)
        setLoadState('ready')
      })
      .catch(() => {
        if (!mounted) return
        setLoadState('error')
      })

    return () => {
      mounted = false
    }
  }, [])

  const selectedMatch = useMemo(() => {
    if (!brief) return null
    return brief.matches.find((match) => match.id === selectedMatchId) ?? brief.matches[0] ?? null
  }, [brief, selectedMatchId])

  if (loadState === 'loading') {
    return <LoadingShell />
  }

  if (loadState === 'error' || !brief) {
    return <ErrorShell />
  }

  return (
    <main className="app-shell">
      <AppHeader brief={brief} authMode={authMode} onLogout={onLogout} />

      <div className="dashboard-grid">
        <aside className="source-rail" aria-label="数据源状态">
          <SourceRail sources={brief.sources} />
        </aside>

        <section className="main-stage" aria-label="世界杯体彩分析">
          <TopNav />
          <SummaryStrip brief={brief} />
          <ProfessionalRanking
            matches={brief.matches}
            selectedMatchId={selectedMatch?.id ?? ''}
            onSelect={setSelectedMatchId}
          />
          <MatchTabs
            matches={brief.matches}
            selectedMatchId={selectedMatch?.id ?? ''}
            onSelect={setSelectedMatchId}
          />
          <ScorelineOverview
            matches={brief.matches}
            selectedMatchId={selectedMatch?.id ?? ''}
            onSelect={setSelectedMatchId}
          />
          {selectedMatch ? <MatchWorkspace match={selectedMatch} /> : <EmptyMatchState />}
          <NewsPanel brief={brief} />
        </section>

        <aside className="decision-rail" aria-label="独立判断和风险预算">
          {selectedMatch ? <DecisionPanel match={selectedMatch} /> : null}
          <BankrollPanel rules={brief.bankroll.rules} disclaimer={brief.bankroll.disclaimer} />
        </aside>
      </div>
    </main>
  )
}

function AppHeader({ brief, authMode, onLogout }: { brief: WorldCupBrief; authMode: string; onLogout: () => void }) {
  return (
    <header className="app-header">
      <div className="brand-cluster">
        <div className="brand-row">
          <span className="brand-mark">世</span>
          <div>
            <span className="brand-name">中国体育彩票分析辅助</span>
            <h1>世界杯体彩决策台</h1>
          </div>
        </div>
        <span className="trust-chip">仅供信息分析</span>
        <span className="trust-chip">不保证盈利</span>
      </div>
      <div className="refresh-panel">
        <RefreshCcw size={16} aria-hidden="true" />
        <div>
          <span>最近更新</span>
          <strong>{brief.generatedAtChina}</strong>
        </div>
      </div>
      <div className="auth-panel">
        <KeyRound size={15} aria-hidden="true" />
        <span>{authMode}</span>
        {authMode !== '本地预览' ? (
          <button type="button" onClick={onLogout}>
            <LogOut size={14} aria-hidden="true" />
            退出
          </button>
        ) : null}
      </div>
    </header>
  )
}

function TopNav() {
  return (
    <nav className="top-tabs" aria-label="功能导航">
      {['今日情报', '胜平负', '比分矩阵', '数学期望', '体彩核验', '独立判断'].map((item, index) => (
        <span className={index === 0 ? 'active' : ''} key={item}>
          {item}
        </span>
      ))}
    </nav>
  )
}

function ProfessionalRanking({
  matches,
  selectedMatchId,
  onSelect,
}: {
  matches: MatchBrief[]
  selectedMatchId: string
  onSelect: (id: string) => void
}) {
  const rankedMatches = [...matches].sort((left, right) => right.professional.rankScore - left.professional.rankScore)

  return (
    <section className="professional-ranking" aria-label="今日专业排序">
      <div className="section-heading">
        <div>
          <strong>今日专业排序</strong>
          <span>综合信心、赔率风险、比分集中度和新闻风险</span>
        </div>
        <span>先排序，再核验官方赔率</span>
      </div>
      <div className="ranking-list">
        {rankedMatches.map((match, index) => (
          <button
            type="button"
            className={match.id === selectedMatchId ? 'active' : ''}
            key={match.id}
            onClick={() => onSelect(match.id)}
          >
            <span className="rank-number">{index + 1}</span>
            <div>
              <strong>{match.home.zhName} vs {match.away.zhName}</strong>
              <small>{match.professional.headline}</small>
            </div>
            <span className={'grade-chip ' + gradeClass(match.professional.grade)}>{match.professional.grade}</span>
            <strong>{match.professional.rankScore}</strong>
          </button>
        ))}
      </div>
    </section>
  )
}

function ScorelineOverview({
  matches,
  selectedMatchId,
  onSelect,
}: {
  matches: MatchBrief[]
  selectedMatchId: string
  onSelect: (id: string) => void
}) {
  return (
    <section className="scoreline-overview" aria-label="全部比赛比分首选">
      <div className="section-heading">
        <div>
          <strong>各场比分首选核验</strong>
          <span>按模型概率、赔率门槛和风险惩罚排序</span>
        </div>
        <span>官方比分赔率需赛前核验</span>
      </div>
      <div className="scoreline-strip">
        {matches.map((match) => {
          const pick = match.scoreline.bestPick
          return (
            <button
              type="button"
              className={match.id === selectedMatchId ? 'active' : ''}
              key={match.id}
              onClick={() => onSelect(match.id)}
            >
              <span>{match.home.zhName} vs {match.away.zhName}</span>
              <strong>{pick?.score ?? '待定'}</strong>
              <small>
                {pick ? `${formatProbability(pick.probability)} · 盈亏线 ${pick.fairOdds.toFixed(2)}` : '等待赔率'}
              </small>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function SummaryStrip({ brief }: { brief: WorldCupBrief }) {
  return (
    <section className="summary-strip">
      <div>
        <span className="kpi-label">今日情报</span>
        <strong>{brief.summary.headline}</strong>
        <p>{brief.summary.note}</p>
      </div>
      <MetricCell label="跟踪比赛" value={String(brief.summary.trackedMatches)} icon={<CalendarDays />} />
      <MetricCell label="健康来源" value={String(brief.summary.healthySources)} icon={<ShieldCheck />} />
      <MetricCell label="更新模式" value={brief.summary.updateMode} icon={<Activity />} />
    </section>
  )
}

function MetricCell({ label, value, icon }: { label: string; value: string; icon: ReactElement }) {
  return (
    <div className="metric-cell">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SourceRail({ sources }: { sources: SourceHealth[] }) {
  const statusCounts = sources.reduce<Record<SourceStatus, number>>(
    (counts, source) => ({ ...counts, [source.status]: counts[source.status] + 1 }),
    { ok: 0, warn: 0, error: 0, skipped: 0 },
  )

  return (
    <>
      <div className="rail-title">
        <LineChart size={18} aria-hidden="true" />
        <div>
          <strong>来源健康</strong>
          <span>公开源优先</span>
        </div>
      </div>
      <div className="source-score">
        <span>{statusCounts.ok}</span>
        <p>可用来源</p>
      </div>
      <div className="source-list">
        {sources.map((source) => (
          <a className="source-row" href={source.url} target="_blank" rel="noreferrer" key={source.id}>
            <span className={'status-dot ' + source.status}></span>
            <div>
              <strong>{source.name}</strong>
              <small>{source.detail}</small>
            </div>
          </a>
        ))}
      </div>
      <div className="rail-note">
        <ShieldAlert size={16} aria-hidden="true" />
        <span>海外赔率仅作市场情绪参考；中国体育彩票购买前以官方竞彩页面和实体销售终端为准。</span>
      </div>
    </>
  )
}

function MatchTabs({
  matches,
  selectedMatchId,
  onSelect,
}: {
  matches: MatchBrief[]
  selectedMatchId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="match-tabs" role="tablist" aria-label="比赛列表">
      {matches.map((match) => (
        <button
          type="button"
          key={match.id}
          className={match.id === selectedMatchId ? 'active' : ''}
          onClick={() => onSelect(match.id)}
        >
          <span>{match.home.zhName}</span>
          <strong>vs</strong>
          <span>{match.away.zhName}</span>
          <small>{match.kickoffChina}</small>
        </button>
      ))}
    </div>
  )
}

function MatchWorkspace({ match }: { match: MatchBrief }) {
  const moneylineData =
    match.market?.moneyline.map((item) => ({
      name: item.label,
      probability: Math.round((item.normalizedProbability ?? item.impliedProbability ?? 0) * 100),
    })) ?? []

  return (
    <section className="workspace">
      <div className="match-heading">
        <div className="team-line">
          <TeamBadge team={match.home} />
          <span className="versus">VS</span>
          <TeamBadge team={match.away} />
        </div>
        <div className="match-meta">
          <span>{match.group}</span>
          <span>{match.venue}</span>
          <span>{match.status}</span>
        </div>
      </div>

      <ProfessionalMemo match={match} />
      <ContextIntelPanel match={match} />

      <div className="analysis-grid">
        <section className="analysis-panel probability-panel">
          <PanelTitle icon={<Gauge />} title="赔率共识" detail={match.market?.provider ?? '暂无赔率'} />
          {match.market ? (
            <>
              <div className="chart-frame">
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={moneylineData}>
                    <CartesianGrid vertical={false} stroke="#e3e8e5" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} />
                    <YAxis hide domain={[0, 100]} />
                    <Tooltip cursor={{ fill: 'rgba(20, 94, 72, 0.06)' }} formatter={(value) => [`${value}%`, '去水后概率']} />
                    <Bar dataKey="probability" radius={[6, 6, 0, 0]} fill="#148565" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <OddsTable title="胜平负市场" outcomes={match.market.moneyline} />
            </>
          ) : (
            <EmptyData text="这场比赛暂无可用赔率，请等待下一次数据更新。" />
          )}
        </section>

        <section className="analysis-panel">
          <PanelTitle icon={<Sparkles />} title="独立判断" detail={match.judgement.tier} />
          <div className={'judgement-card ' + tierClass(match.judgement.tier)}>
            <span>{match.judgement.tier}</span>
            <strong>{match.judgement.lean}</strong>
            <p>{match.judgement.guidance}</p>
          </div>
          <div className="factor-list">
            {match.judgement.factors.map((factor) => (
              <div className="factor-row" key={factor.label}>
                <div>
                  <strong>{factor.label}</strong>
                  <small>{factor.note}</small>
                </div>
                <span className={'factor-pill ' + factor.tone}>{factor.value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <ScorelinePanel match={match} />

      <section className="analysis-panel play-map">
        <PanelTitle icon={<CircleDollarSign />} title="中国体育彩票玩法映射" detail={match.sporttery.status} />
        <div className="play-map-content">
          <div>
            <strong>可重点核验</strong>
            <div className="market-tags">
              {match.sporttery.markets.map((market) => (
                <span key={market}>{market}</span>
              ))}
            </div>
          </div>
          <p>{match.sporttery.note}</p>
          <a href={match.sporttery.officialUrl} target="_blank" rel="noreferrer">
            打开中国体彩网核验
          </a>
        </div>
      </section>
    </section>
  )
}

function ProfessionalMemo({ match }: { match: MatchBrief }) {
  return (
    <section className="analysis-panel professional-memo">
      <PanelTitle icon={<Calculator />} title="专业决策备忘录" detail={match.professional.grade} />
      <div className="memo-hero">
        <div>
          <span className={'grade-chip ' + gradeClass(match.professional.grade)}>{match.professional.grade}</span>
          <strong>{match.professional.headline}</strong>
          <p>{match.professional.finalAdvice}</p>
        </div>
        <div className="memo-score">
          <span>{match.professional.rankScore}</span>
          <small>综合分</small>
        </div>
      </div>

      <DeepThinkingPanel match={match} />
      <ExpertAnswerPanel match={match} />

      <div className="playbook-grid">
        {match.professional.plays.map((play) => (
          <PlayCard play={play} key={`${play.playType}-${play.selection}-${play.priority}`} />
        ))}
      </div>

      <div className="scenario-risk-grid">
        <ScenarioPanel scenarios={match.professional.scenarios} />
        <RiskControlPanel riskControls={match.professional.riskControls} />
      </div>

      <div className="memo-grid">
        <section>
          <strong>证据权重</strong>
          <div className="signal-list">
            {match.professional.signals.map((signal) => (
              <SignalRow signal={signal} key={signal.label} />
            ))}
          </div>
        </section>
        <section>
          <strong>赛前核验清单</strong>
          <ul className="check-list">
            {match.professional.checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section>
          <strong>降级/放弃触发器</strong>
          <ul className="check-list danger">
            {match.professional.downgradeTriggers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="staking-note">{match.professional.stakingPlan}</div>
    </section>
  )
}

function ContextIntelPanel({ match }: { match: MatchBrief }) {
  const { context } = match

  return (
    <section className="analysis-panel context-intel-panel">
      <PanelTitle icon={<ScrollText />} title="实况上下文" detail="近5场 / 球员 / 伤病 / 天气 / 地理 / 古法低权重" />
      <div className="context-grid">
        <TeamContextCard team={match.home} context={context.home} />
        <TeamContextCard team={match.away} context={context.away} />
      </div>
      <div className="environment-grid">
        <article>
          <div className="environment-title">
            <CloudSun size={16} aria-hidden="true" />
            <strong>天气与场馆</strong>
            <span className={'risk-badge risk-' + context.weather.riskLevel}>{context.weather.riskLevel}</span>
          </div>
          <p>{context.weather.summary}</p>
          <div className="weather-metrics">
            <MetricPill label="温度" value={context.weather.temperatureC === null ? '待核验' : `${Math.round(context.weather.temperatureC)}°C`} />
            <MetricPill label="降水" value={context.weather.precipitationProbability === null ? '待核验' : `${Math.round(context.weather.precipitationProbability)}%`} />
            <MetricPill label="风速" value={context.weather.windKph === null ? '待核验' : `${Math.round(context.weather.windKph)} km/h`} />
            <MetricPill label="顶棚" value={context.weather.roofLikely ? '可能有' : '按露天'} />
          </div>
        </article>
        <article>
          <div className="environment-title">
            <MapPinned size={16} aria-hidden="true" />
            <strong>地理与适应</strong>
          </div>
          <p>{context.geography.summary}</p>
          <div className="geo-pair">
            <span>{match.home.zhName}: {context.geography.homeDistanceKm === null ? '距离待核验' : `${context.geography.homeDistanceKm.toLocaleString()} km`} · {context.geography.homeClimate}</span>
            <span>{match.away.zhName}: {context.geography.awayDistanceKm === null ? '距离待核验' : `${context.geography.awayDistanceKm.toLocaleString()} km`} · {context.geography.awayClimate}</span>
          </div>
        </article>
        <article>
          <div className="environment-title">
            <Compass size={16} aria-hidden="true" />
            <strong>古法文化校验</strong>
            <span>{context.divination.weight}</span>
          </div>
          <p>{context.divination.summary}</p>
          <div className="divination-symbols">
            <span>{match.home.zhName}: {context.divination.homeSymbol}</span>
            <span>{match.away.zhName}: {context.divination.awaySymbol}</span>
            <span>日时五行: {context.divination.dayElement}</span>
            {context.divination.hourBranch && context.divination.hourElement ? (
              <span>时辰: {context.divination.hourBranch}时 · {context.divination.hourElement}</span>
            ) : null}
            {context.divination.weatherElement ? <span>天气五行: {context.divination.weatherElement}</span> : null}
            {typeof context.divination.homeFortune === 'number' && typeof context.divination.awayFortune === 'number' ? (
              <span>运势分: {match.home.zhName} {context.divination.homeFortune} / {match.away.zhName} {context.divination.awayFortune}</span>
            ) : null}
          </div>
          {context.divination.breakdown && context.divination.breakdown.length > 0 ? (
            <ul className="divination-breakdown">
              {context.divination.breakdown.slice(0, 4).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </article>
      </div>
      <div className="context-note">{context.note}</div>
    </section>
  )
}

function TeamContextCard({ team, context }: { team: MatchBrief['home']; context: MatchBrief['context']['home'] }) {
  return (
    <article className="team-context-card">
      <div className="team-context-head">
        <TeamBadge team={team} />
        <div>
          <span>近况分</span>
          <strong>{context.formScore}</strong>
        </div>
      </div>
      <p>{context.trendNote}</p>
      <div className="recent-match-list">
        {context.recentMatches.length > 0 ? (
          context.recentMatches.map((recent) => (
            <div className="recent-match-row" key={`${team.id}-${recent.date}-${recent.opponent}-${recent.score}`}>
              <span className={'result-dot result-' + recent.result}>{recent.result}</span>
              <strong>{recent.score}</strong>
              <span>{recent.opponentZhName}</span>
              <small>{recent.date} · {recent.homeAway}</small>
            </div>
          ))
        ) : (
          <div className="recent-empty">暂无足够实际比分，先参考 ESPN form：{context.formString || '无'}</div>
        )}
      </div>
      <div className="player-injury-grid">
        <section>
          <strong>球员状态</strong>
          {context.playerSignals.length > 0 ? (
            context.playerSignals.map((signal) => (
              <span key={`${team.id}-${signal.label}-${signal.player}`}>
                {signal.label}: {signal.player} {signal.value}
              </span>
            ))
          ) : (
            <span>暂无球员榜单，等首发补充。</span>
          )}
        </section>
        <section>
          <strong>伤病/首发风险</strong>
          <span>{context.injuries.status}</span>
          <small>{context.injuries.note}</small>
        </section>
      </div>
    </article>
  )
}

function DeepThinkingPanel({ match }: { match: MatchBrief }) {
  const thinking = match.professional.deepThinking

  return (
    <section className="deep-thinking-panel">
      <div className="deep-thinking-hero">
        <div>
          <span>{thinking.label}</span>
          <strong>{thinking.conclusion}</strong>
          <p>{thinking.updateSensitivity}</p>
        </div>
        <div className="deep-thinking-score">
          <span>{thinking.confidenceScore}</span>
          <small>推演分</small>
        </div>
      </div>

      <div className="purchase-plan-grid">
        {thinking.purchasePlan.map((item) => (
          <PurchasePlanCard item={item} key={`${item.label}-${item.selection}`} />
        ))}
      </div>

      <div className="thinking-details-grid">
        <section>
          <strong>判断摘要</strong>
          <ul>
            {thinking.reasoningSummary.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section className="no-buy-section">
          <strong>不买条件</strong>
          <ul>
            {thinking.noBuyRules.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  )
}

function PurchasePlanCard({ item }: { item: DeepThinkingPurchase }) {
  return (
    <article className={'purchase-plan-card action-' + item.action}>
      <div>
        <span>{item.label}</span>
        <strong>{item.action}</strong>
      </div>
      <h4>{item.selection}</h4>
      <dl>
        <div>
          <dt>资金</dt>
          <dd>{item.allocation}</dd>
        </div>
        <div>
          <dt>门槛</dt>
          <dd>{item.minOdds}</dd>
        </div>
      </dl>
      <p>{item.rationale}</p>
    </article>
  )
}

function ExpertAnswerPanel({ match }: { match: MatchBrief }) {
  const answer = match.professional.expertAnswer

  return (
    <section className="expert-answer">
      <div>
        <span>本场专业答案</span>
        <strong>{answer.verdict}</strong>
      </div>
      <div className="answer-grid">
        <AnswerItem label="最适合买的比分" value={answer.recommendedScore} />
        <AnswerItem label="备选比分" value={answer.secondaryScores.length > 0 ? answer.secondaryScores.join(' / ') : '不建议扩展'} />
        <AnswerItem label="胜平负方向" value={answer.marketDirection} />
        <AnswerItem label="总进球校验" value={answer.totalGoals} />
        <AnswerItem label="执行条件" value={answer.buyCondition} wide />
        <AnswerItem label="放弃条件" value={answer.passCondition} wide danger />
        <AnswerItem label="资金上限" value={answer.stakeCeiling} wide />
        <AnswerItem label="信心区间" value={answer.confidenceBand} wide />
      </div>
    </section>
  )
}

function AnswerItem({ label, value, wide, danger }: { label: string; value: string; wide?: boolean; danger?: boolean }) {
  return (
    <div className={(wide ? 'wide ' : '') + (danger ? 'danger' : '')}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function PlayCard({ play }: { play: PlayRecommendation }) {
  return (
    <article className={'play-card ' + priorityClass(play.priority)}>
      <div>
        <span>{play.playType}</span>
        <span>{play.priority}</span>
      </div>
      <strong>{play.selection}</strong>
      <p>{play.reason}</p>
      <dl>
        <div>
          <dt>信心</dt>
          <dd>{play.confidence}</dd>
        </div>
        <div>
          <dt>预算</dt>
          <dd>{play.budgetShare}</dd>
        </div>
        <div>
          <dt>赔率门槛</dt>
          <dd>{play.minOdds}</dd>
        </div>
      </dl>
      <small>{play.expectedValueNote}</small>
      <em>{play.noBetIf}</em>
    </article>
  )
}

function ScenarioPanel({ scenarios }: { scenarios: ScenarioNote[] }) {
  return (
    <section className="scenario-panel">
      <strong>情景推演</strong>
      <div>
        {scenarios.map((scenario) => (
          <article key={scenario.title}>
            <span>{scenario.title}</span>
            <strong>{scenario.probability}</strong>
            <p>{scenario.scorePath}</p>
            <small>{scenario.action}</small>
          </article>
        ))}
      </div>
    </section>
  )
}

function RiskControlPanel({ riskControls }: { riskControls: RiskControlNote[] }) {
  return (
    <section className="risk-control-panel">
      <strong>风险分歧</strong>
      <div>
        {riskControls.map((risk) => (
          <article className={'risk-level-' + risk.level} key={risk.label}>
            <div>
              <span>{risk.label}</span>
              <strong>{risk.level}</strong>
            </div>
            <p>{risk.detail}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function SignalRow({ signal }: { signal: ProfessionalSignal }) {
  return (
    <div className="signal-row">
      <div>
        <strong>{signal.label}</strong>
        <small>{signal.evidence}</small>
      </div>
      <span className={'factor-pill ' + signal.tone}>{signal.score}</span>
    </div>
  )
}

function ScorelinePanel({ match }: { match: MatchBrief }) {
  const bestPick = match.scoreline.bestPick
  const scoreChart = match.scoreline.candidates.slice(0, 5).map((candidate) => ({
    score: candidate.score,
    probability: Math.round(candidate.probability * 1000) / 10,
  }))

  return (
    <section className="analysis-panel scoreline-panel">
      <PanelTitle icon={<Target />} title="比分矩阵与数学期望" detail={match.scoreline.model} />
      {bestPick ? (
        <>
          <div className="scoreline-grid">
            <div className="best-score-card">
              <span>{bestPick.grade}</span>
              <strong>{bestPick.score}</strong>
              <p>{bestPick.reason}</p>
              <div className="score-metrics">
                <MetricPill label="模型概率" value={formatProbability(bestPick.probability)} />
                <MetricPill label="盈亏线" value={bestPick.fairOdds.toFixed(2)} />
                <MetricPill label="建议最低赔率" value={bestPick.suggestedMinOdds.toFixed(2)} />
              </div>
            </div>

            <div className="result-probability-card">
              <div className="result-bars">
                {match.scoreline.resultProbabilities.map((item) => (
                  <div className="result-bar" key={item.side}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{formatPercent(item.probability)}</span>
                    </div>
                    <span style={{ width: `${Math.round(item.probability * 100)}%` }} />
                  </div>
                ))}
              </div>
              <div className="xg-row">
                <span>{match.home.zhName} xG {match.scoreline.homeExpectedGoals.toFixed(2)}</span>
                <span>总进球 {match.scoreline.totalExpectedGoals.toFixed(2)}</span>
                <span>{match.away.zhName} xG {match.scoreline.awayExpectedGoals.toFixed(2)}</span>
              </div>
            </div>

            <div className="score-chart">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={scoreChart}>
                  <CartesianGrid vertical={false} stroke="#e3e8e5" />
                  <XAxis dataKey="score" tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip cursor={{ fill: 'rgba(20, 94, 72, 0.06)' }} formatter={(value) => [`${value}%`, '比分概率']} />
                  <Bar dataKey="probability" radius={[6, 6, 0, 0]} fill="#148565" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <ScorelineTable title="比分候选" candidates={match.scoreline.candidates} />
          <ScorelineTable title="高风险回避" candidates={match.scoreline.avoid} compact />
          <div className="scoreline-notes">
            {match.scoreline.notes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </div>
        </>
      ) : (
        <EmptyData text="暂无比分分布，请等待赔率源恢复后再刷新数据。" />
      )}
    </section>
  )
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ScorelineTable({
  title,
  candidates,
  compact = false,
}: {
  title: string
  candidates: ScorelineCandidate[]
  compact?: boolean
}) {
  if (candidates.length === 0) return null

  return (
    <div className={compact ? 'scoreline-table compact' : 'scoreline-table'}>
      <div className="table-title">{title}</div>
      <div className="score-table-grid header">
        <span>比分</span>
        <span>结果</span>
        <span>概率</span>
        <span>盈亏线</span>
        <span>建议最低赔率</span>
        <span>数学期望</span>
      </div>
      {candidates.map((candidate) => (
        <div className="score-table-grid" key={`${title}-${candidate.score}`}>
          <strong>{candidate.score}</strong>
          <span>{candidate.result}</span>
          <span className="probability-cell">
            {formatProbability(candidate.probability)}
            {candidate.baseProbability ? (
              <small>
                原始 {formatProbability(candidate.baseProbability)}
                {candidate.tailMultiplier ? ` · x${candidate.tailMultiplier.toFixed(2)}` : ''}
              </small>
            ) : null}
          </span>
          <span>{candidate.fairOdds.toFixed(2)}</span>
          <span>{candidate.suggestedMinOdds.toFixed(2)}</span>
          <span>{candidate.expectedValue === null ? `官方待核验，≥${formatSignedPercent(candidate.expectedValueAtSuggestedOdds)}` : formatSignedPercent(candidate.expectedValue)}</span>
        </div>
      ))}
    </div>
  )
}

function TeamBadge({ team }: { team: MatchBrief['home'] }) {
  return (
    <div className="team-badge">
      {team.logo ? <img src={team.logo} alt="" /> : <span>{team.abbreviation}</span>}
      <div>
        <strong>{team.zhName}</strong>
        <small>{team.form ? `近况 ${team.form}` : team.record ?? team.abbreviation}</small>
      </div>
    </div>
  )
}

function PanelTitle({ icon, title, detail }: { icon: ReactElement; title: string; detail: string }) {
  return (
    <div className="panel-title">
      {icon}
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  )
}

function OddsTable({ title, outcomes }: { title: string; outcomes: MarketOutcome[] }) {
  return (
    <div className="odds-table">
      <div className="table-title">{title}</div>
      <div className="table-grid header">
        <span>结果</span>
        <span>美式</span>
        <span>十进制</span>
        <span>概率</span>
      </div>
      {outcomes.map((outcome) => (
        <div className="table-grid" key={`${outcome.side}-${outcome.label}`}>
          <span>{outcome.label}</span>
          <span>{outcome.american ?? '—'}</span>
          <span>{outcome.decimal ? outcome.decimal.toFixed(2) : '—'}</span>
          <span>{formatPercent(outcome.normalizedProbability ?? outcome.impliedProbability)}</span>
        </div>
      ))}
    </div>
  )
}

function DecisionPanel({ match }: { match: MatchBrief }) {
  const riskSeries = [
    { name: '赔率', value: match.judgement.factors[0]?.value ?? 50 },
    { name: '波动', value: match.judgement.factors[1]?.value ?? 50 },
    { name: '赛程', value: match.judgement.factors[2]?.value ?? 50 },
    { name: '新闻', value: match.judgement.factors[3]?.value ?? 50 },
  ]

  return (
    <section className="decision-panel">
      <PanelTitle icon={<CheckCircle2 />} title="本场决策助手" detail="非投注承诺" />
      <div className={'decision-grade ' + gradeClass(match.professional.grade)}>
        <span>{match.professional.grade}</span>
        <strong>{match.professional.rankScore}</strong>
      </div>
      <div className="confidence-ring" style={{ '--confidence': match.judgement.confidence } as CSSProperties}>
        <div>
          <span>{match.judgement.confidence}</span>
          <small>信心指数</small>
        </div>
      </div>
      <div className="decision-copy">
        {match.scoreline.bestPick ? (
          <div className="right-score-pick">
            <Calculator size={15} aria-hidden="true" />
            <span>比分首选</span>
            <strong>{match.scoreline.bestPick.score}</strong>
          </div>
        ) : null}
        <div className="decision-deep">
          <span>深度推演</span>
          <strong>{match.professional.deepThinking.purchasePlan[0]?.selection ?? '等待核验'}</strong>
          <small>{match.professional.deepThinking.purchasePlan[0]?.allocation ?? '保留预算'}</small>
        </div>
        <strong>{match.judgement.stake}</strong>
        <p>{match.judgement.avoid}</p>
      </div>
      <div className="mini-chart">
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={riskSeries}>
            <defs>
              <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#c7323f" stopOpacity={0.22} />
                <stop offset="95%" stopColor="#c7323f" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
            <Tooltip formatter={(value) => [`${value}`, '风险分']} />
            <Area type="monotone" dataKey="value" stroke="#c7323f" fill="url(#riskGradient)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

function BankrollPanel({ rules, disclaimer }: { rules: BankrollRule[]; disclaimer: string }) {
  return (
    <section className="bankroll-panel">
      <PanelTitle icon={<ListChecks />} title="风险预算" detail="先限额后选择" />
      <p className="disclaimer">{disclaimer}</p>
      <div className="rule-list">
        {rules.map((rule) => (
          <div className="rule-row" key={rule.label}>
            <span>{rule.label}</span>
            <strong>{rule.value}</strong>
            <small>{rule.note}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function NewsPanel({ brief }: { brief: WorldCupBrief }) {
  return (
    <section className="news-panel">
      <div className="section-heading">
        <strong>最新消息影响</strong>
        <span>{brief.targetDateChina}</span>
      </div>
      <div className="news-list">
        {brief.news.slice(0, 5).map((item) => (
          <a href={item.url} target="_blank" rel="noreferrer" className="news-row" key={item.id}>
            <span>{item.impact}</span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.summary}</small>
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}

function EmptyData({ text }: { text: string }) {
  return <div className="empty-data">{text}</div>
}

function EmptyMatchState() {
  return <div className="empty-data">暂无比赛，请先运行 npm run update:data。</div>
}

function AuthCheckingShell() {
  return (
    <main className="state-shell auth-state">
      <KeyRound className="spin" size={28} aria-hidden="true" />
      <strong>正在校验远程访问权限</strong>
      <span>本地预览会自动放行；线上部署会要求访问码登录。</span>
    </main>
  )
}

function LoginShell({
  mode,
  message,
  onLogin,
}: {
  mode: 'unauthenticated' | 'config-error'
  message: string
  onLogin: (accessCode: string) => Promise<void>
}) {
  const [accessCode, setAccessCode] = useState('')
  const [error, setError] = useState(message)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await onLogin(accessCode)
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败，请检查访问码。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand-mark">世</span>
          <div>
            <span className="brand-name">私有远程访问</span>
            <h1>世界杯体彩决策台</h1>
          </div>
        </div>
        <p>请输入部署时配置的访问码。登录成功后会使用 HttpOnly 会话 Cookie，适合在手机、外地电脑或平板上查看每日分析。</p>
        {mode === 'config-error' ? (
          <div className="login-warning">
            远程登录尚未完成环境变量配置：{message || '缺少 AUTH_SECRET 或 SITE_ACCESS_CODE_SHA256。'}
          </div>
        ) : null}
        <form onSubmit={handleSubmit}>
          <label htmlFor="access-code">访问码</label>
          <input
            id="access-code"
            autoComplete="current-password"
            autoFocus
            type="password"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            placeholder="输入你的私人访问码"
          />
          <button type="submit" disabled={submitting || accessCode.trim().length === 0}>
            {submitting ? '正在登录...' : '登录查看分析'}
          </button>
        </form>
        {error ? <span className="login-error">{error}</span> : null}
        <small>提醒：这不是投资系统，也不保证盈利。购买前必须核验中国体彩官方赔率和停售时间。</small>
      </section>
    </main>
  )
}

function LoadingShell() {
  return (
    <main className="state-shell">
      <RefreshCcw className="spin" size={28} aria-hidden="true" />
      <strong>正在读取世界杯情报数据</strong>
      <span>如果这是首次运行，请执行 pnpm update:data。</span>
    </main>
  )
}

function ErrorShell() {
  return (
    <main className="state-shell">
      <ShieldAlert size={28} aria-hidden="true" />
      <strong>没有找到每日情报文件</strong>
      <span>运行 pnpm update:data 生成 public/data/worldcup-brief.json。</span>
    </main>
  )
}

function tierClass(tier: MatchBrief['judgement']['tier']) {
  if (tier === '小额娱乐') return 'lean-play'
  if (tier === '避免追高') return 'lean-avoid'
  return 'lean-watch'
}

function gradeClass(grade: MatchBrief['professional']['grade']) {
  if (grade === '重点核验') return 'grade-strong'
  if (grade === '小额分散') return 'grade-play'
  if (grade === '只核验不追高') return 'grade-hot'
  return 'grade-watch'
}

function priorityClass(priority: PlayRecommendation['priority']) {
  if (priority === '主方案') return 'priority-main'
  if (priority === '防守') return 'priority-hedge'
  if (priority === '不建议') return 'priority-avoid'
  return 'priority-alt'
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== 'number') return '—'
  return `${Math.round(value * 100)}%`
}

function formatProbability(value: number | null | undefined) {
  if (typeof value !== 'number') return '—'
  if (value > 0 && value < 0.001) return '<0.1%'
  return `${(value * 100).toFixed(1)}%`
}

function formatSignedPercent(value: number | null | undefined) {
  if (typeof value !== 'number') return '待官方赔率'
  const percent = Math.round(value * 100)
  return `${percent > 0 ? '+' : ''}${percent}%`
}

export default App

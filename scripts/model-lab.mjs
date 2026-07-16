// Open-model laboratory for auditable World Cup probability forecasts.
// The Elo/Dixon-Coles baseline is adapted from Cup26 AI's MIT-licensed model:
// https://github.com/Hicruben/world-cup-2026-prediction-model

import { readFileSync } from 'node:fs'

export const OPEN_MODEL_SOURCE = Object.freeze({
  id: 'cup26-elo-dixon-coles',
  name: 'Cup26 AI Elo + Dixon-Coles',
  url: 'https://github.com/Hicruben/world-cup-2026-prediction-model',
  commit: '184f5021c42192fb6abfac71abf641ff18df11e0',
  license: 'MIT',
})

export const HISTORICAL_MODEL_SOURCE = Object.freeze({
  id: 'openfootball-dynamic-attack-defence',
  name: 'OpenFootball dynamic attack/defence Poisson',
  url: 'https://github.com/openfootball/worldcup.json',
  commit: '5e4bc62f9e711f3ea83d2b150ac3200e7e9c90a0',
  license: 'CC0-1.0',
})

const HISTORICAL_MATCHES = Object.freeze(
  JSON.parse(readFileSync(new URL('./data/world-cup-history.json', import.meta.url), 'utf8')).matches,
)

const BASE_RATINGS = Object.freeze({
  argentina: 1976,
  france: 2009,
  spain: 2010,
  brazil: 1955,
  england: 1993,
  portugal: 1945,
  netherlands: 1894,
  germany: 1926,
  belgium: 1878,
  colombia: 1878,
  uruguay: 1831,
  croatia: 1852,
  morocco: 1874,
  switzerland: 1812,
  usa: 1826,
  mexico: 1834,
  japan: 1825,
  senegal: 1848,
  ecuador: 1829,
  australia: 1772,
  'south-korea': 1760,
  iran: 1747,
  canada: 1740,
  ghana: 1659,
  tunisia: 1680,
  'ivory-coast': 1732,
  'saudi-arabia': 1657,
  qatar: 1592,
  egypt: 1695,
  algeria: 1704,
  scotland: 1663,
  paraguay: 1681,
  'czech-republic': 1651,
  'bosnia-and-herzegovina': 1602,
  'south-africa': 1591,
  'new-zealand': 1591,
  panama: 1615,
  jordan: 1548,
  haiti: 1537,
  norway: 1880,
  sweden: 1752,
  turkey: 1731,
  austria: 1718,
  iraq: 1599,
  uzbekistan: 1633,
  'cape-verde': 1650,
  'dr-congo': 1650,
  curacao: 1548,
})

const TEAM_ALIASES = new Map([
  ['united-states', 'usa'],
  ['u-s-a', 'usa'],
  ['czechia', 'czech-republic'],
  ['turkiye', 'turkey'],
  ['tuerkiye', 'turkey'],
  ['cape-verde-islands', 'cape-verde'],
  ['cabo-verde', 'cape-verde'],
  ['congo-dr', 'dr-congo'],
  ['democratic-republic-of-congo', 'dr-congo'],
  ['korea-republic', 'south-korea'],
  ['bosnia-herzegovina', 'bosnia-and-herzegovina'],
  ['bosnia-and-herzegovina', 'bosnia-and-herzegovina'],
  ['cote-divoire', 'ivory-coast'],
])

const HOST_TEAMS = new Set(['usa', 'mexico', 'canada'])
const DC_RHO = -0.13
const HOME_ADVANTAGE = 75
const WORLD_CUP_K = 55
const MAX_GOALS = 8
const REVERSION_RATE = 0.08
const MIN_ARCHIVED_TRAIN = 20
const BLEND_CANDIDATES = Object.freeze([
  { name: 'market-only', market: 1, open: 0 },
  { name: 'market-80-open-20', market: 0.8, open: 0.2 },
  { name: 'market-65-open-35', market: 0.65, open: 0.35 },
  { name: 'market-50-open-50', market: 0.5, open: 0.5 },
])
const DYNAMIC_MODEL_CANDIDATES = Object.freeze([
  { name: 'dynamic-conservative', updateRate: 0.1, halfLifeYears: 4, meanRate: 0.01 },
  { name: 'dynamic-responsive', updateRate: 0.14, halfLifeYears: 2, meanRate: 0.03 },
])

export function canonicalTeamKey(value) {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return TEAM_ALIASES.get(normalized) ?? normalized
}

export function buildOpenSourceModelLab(records = [], archivedPredictions = {}) {
  const orderedCompleted = records
    .filter(isCompletedRecord)
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
  const canonicalRun = runWalkForward(orderedCompleted, { reversionRate: 0 })
  const meanRevertingRun = runWalkForward(orderedCompleted, { reversionRate: REVERSION_RATE })
  const variantPolicy = evaluateOpenVariantPolicy(canonicalRun, meanRevertingRun)
  const selectedRun = variantPolicy.adopted ? meanRevertingRun : canonicalRun
  const prequentialRun = buildPrequentialRun(canonicalRun, meanRevertingRun)
  const historicalChallenger = buildHistoricalAttackDefenseLab(
    HISTORICAL_MATCHES,
    orderedCompleted,
    canonicalRun,
  )
  const evaluation = buildEvaluation(
    orderedCompleted,
    archivedPredictions,
    canonicalRun,
    meanRevertingRun,
    prequentialRun,
    variantPolicy,
    historicalChallenger.evaluation,
  )

  const predict = (homeName, awayName, options = {}) => {
    const baseline = predictFromState(selectedRun.state, homeName, awayName, options)
    const historical = predictDynamicFromState(
      historicalChallenger.selectedRun.state,
      homeName,
      awayName,
      options,
    )
    return {
      ...baseline,
      variant: variantPolicy.name,
      historicalChallenger: {
        ...historical,
        adopted: historicalChallenger.evaluation.policy.adopted,
        role: historicalChallenger.evaluation.policy.adopted
          ? 'validated total-goal challenger'
          : 'audit-only challenger',
      },
    }
  }

  const combineWithMarket = (marketProbabilities, openPrediction) => {
    const marketVector = probabilityVector(marketProbabilities)
    const openVector = openPrediction?.probabilities ?? [1 / 3, 1 / 3, 1 / 3]
    const policy = evaluation.ensemble.policy
    const blended = blendProbabilities(marketVector, openVector, policy.marketWeight)
    const disagreement = probabilityDisagreement(marketVector, openVector)
    return {
      method: 'validated market/open-model ensemble',
      adopted: policy.adopted,
      reason: policy.reason,
      weights: {
        market: policy.marketWeight,
        openSource: policy.openWeight,
      },
      market: marketVector,
      openSource: openVector,
      blended,
      disagreement,
      openPrediction,
      validation: evaluation.ensemble.validation,
    }
  }

  return {
    source: OPEN_MODEL_SOURCE,
    evaluation,
    predict,
    combineWithMarket,
    predictionForId: (id) => prequentialRun.predictionsById.get(String(id)) ?? null,
  }
}

function buildPrequentialRun(canonicalRun, meanRevertingRun) {
  const predictionsById = new Map()
  const samples = []
  const canonicalPrior = []
  const challengerPrior = []
  let challengerSelections = 0

  for (let index = 0; index < canonicalRun.samples.length; index += 1) {
    const canonicalSample = canonicalRun.samples[index]
    const challengerSample = meanRevertingRun.samples[index]
    const useChallenger =
      canonicalPrior.length >= 30 &&
      challengerClearsGate(scoreProbabilitySamples(canonicalPrior), scoreProbabilitySamples(challengerPrior))
    const selectedSample = useChallenger ? challengerSample : canonicalSample
    const selectedPrediction = (useChallenger ? meanRevertingRun : canonicalRun).predictionsById.get(canonicalSample.id)

    if (useChallenger) challengerSelections += 1
    predictionsById.set(canonicalSample.id, {
      ...selectedPrediction,
      variant: useChallenger ? `mean-reversion-${REVERSION_RATE}` : 'canonical',
    })
    samples.push(selectedSample)
    canonicalPrior.push(canonicalSample)
    challengerPrior.push(challengerSample)
  }

  return {
    predictionsById,
    samples,
    metrics: scoreProbabilitySamples(samples),
    exactScoreMetrics: scoreExactScoreSamples(samples, predictionsById),
    challengerSelections,
  }
}

function runWalkForward(records, { reversionRate }) {
  const state = createRatingState()
  const predictionsById = new Map()
  const samples = []

  for (const record of records) {
    const prediction = predictFromState(state, record.home, record.away, {
      homeHost: record.homeHost,
      awayHost: record.awayHost,
    })
    predictionsById.set(String(record.id), prediction)
    samples.push({
      id: String(record.id),
      date: record.date,
      actual: actualIndex(record.homeGoals, record.awayGoals),
      actualScore: `${Number(record.homeGoals)}-${Number(record.awayGoals)}`,
      actualTotal: Math.min(7, Number(record.homeGoals) + Number(record.awayGoals)),
      probabilities: prediction.probabilities,
      totalProbabilities: prediction.totalGoals,
    })
    updateRatings(state, record, prediction, reversionRate)
  }

  return {
    state,
    predictionsById,
    samples,
    metrics: scoreProbabilitySamples(samples),
    exactScoreMetrics: scoreExactScoreSamples(samples, predictionsById),
  }
}

function createRatingState() {
  return new Map(Object.entries(BASE_RATINGS))
}

function predictFromState(state, homeName, awayName, options = {}) {
  const homeKey = canonicalTeamKey(homeName)
  const awayKey = canonicalTeamKey(awayName)
  const homeRating = ratingFor(state, homeKey)
  const awayRating = ratingFor(state, awayKey)
  const homeHost = options.homeHost ?? HOST_TEAMS.has(homeKey)
  const awayHost = options.awayHost ?? HOST_TEAMS.has(awayKey)
  const homeBonus = homeHost ? HOME_ADVANTAGE : awayHost ? -HOME_ADVANTAGE : 0
  const homeExpectedGoals = expectedGoals(homeRating, awayRating, homeBonus)
  const awayExpectedGoals = expectedGoals(awayRating, homeRating, -homeBonus / 2)
  const grid = dixonColesGrid(homeExpectedGoals, awayExpectedGoals, DC_RHO)

  return {
    model: 'Elo + Dixon-Coles bivariate score grid',
    source: OPEN_MODEL_SOURCE,
    homeKey,
    awayKey,
    homeRating: round(homeRating, 1),
    awayRating: round(awayRating, 1),
    homeExpectedGoals: round(homeExpectedGoals, 3),
    awayExpectedGoals: round(awayExpectedGoals, 3),
    probabilities: [grid.home, grid.draw, grid.away],
    totalGoals: totalGoalProbabilities(grid.scores),
    topScores: grid.scores.slice(0, 8),
  }
}

function updateRatings(state, record, prediction, reversionRate) {
  const homeKey = canonicalTeamKey(record.home)
  const awayKey = canonicalTeamKey(record.away)
  const homeRating = ratingFor(state, homeKey)
  const awayRating = ratingFor(state, awayKey)
  const expected = expectedScore(homeRating, awayRating, hostBonus(record, homeKey, awayKey))
  const observed = record.homeGoals > record.awayGoals ? 1 : record.homeGoals < record.awayGoals ? 0 : 0.5
  const delta = WORLD_CUP_K * goalMarginMultiplier(record.homeGoals - record.awayGoals) * (observed - expected)
  const updatedHome = homeRating + delta
  const updatedAway = awayRating - delta
  state.set(homeKey, meanRevert(updatedHome, baseRating(homeKey), reversionRate))
  state.set(awayKey, meanRevert(updatedAway, baseRating(awayKey), reversionRate))

  return prediction
}

function hostBonus(record, homeKey, awayKey) {
  const homeHost = record.homeHost ?? HOST_TEAMS.has(homeKey)
  const awayHost = record.awayHost ?? HOST_TEAMS.has(awayKey)
  return homeHost ? HOME_ADVANTAGE : awayHost ? -HOME_ADVANTAGE : 0
}

function meanRevert(value, anchor, rate) {
  return value * (1 - rate) + anchor * rate
}

function ratingFor(state, key) {
  if (!state.has(key)) state.set(key, baseRating(key))
  return state.get(key)
}

function baseRating(key) {
  return BASE_RATINGS[key] ?? 1600
}

function expectedScore(ratingA, ratingB, homeBonus = 0) {
  return 1 / (1 + 10 ** ((ratingB - (ratingA + homeBonus)) / 400))
}

function expectedGoals(rating, opponent, homeBonus = 0) {
  return clamp(1.35 + (rating + homeBonus - opponent) / 400, 0.3, 3.5)
}

function dixonColesGrid(homeLambda, awayLambda, rho) {
  const scores = []
  let home = 0
  let draw = 0
  let away = 0
  let total = 0

  for (let homeGoals = 0; homeGoals <= MAX_GOALS; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= MAX_GOALS; awayGoals += 1) {
      const raw = poissonPmf(homeGoals, homeLambda) * poissonPmf(awayGoals, awayLambda)
      const probability = Math.max(0, raw * dixonColesTau(homeGoals, awayGoals, homeLambda, awayLambda, rho))
      total += probability
      if (homeGoals > awayGoals) home += probability
      else if (homeGoals < awayGoals) away += probability
      else draw += probability
      scores.push({ score: `${homeGoals}-${awayGoals}`, probability })
    }
  }

  const mass = total || 1
  const normalizedScores = scores
    .map((item) => ({ ...item, probability: round(item.probability / mass, 6) }))
    .sort((left, right) => right.probability - left.probability)

  return {
    home: home / mass,
    draw: draw / mass,
    away: away / mass,
    scores: normalizedScores,
  }
}

function totalGoalProbabilities(scores) {
  const distribution = Array(8).fill(0)
  for (const item of scores) {
    const [homeGoals, awayGoals] = String(item.score).split('-').map(Number)
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue
    distribution[Math.min(7, homeGoals + awayGoals)] += Number(item.probability) || 0
  }
  return normalizeDistribution(distribution).map((value) => round(value, 6))
}

function dixonColesTau(homeGoals, awayGoals, homeLambda, awayLambda, rho) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - homeLambda * awayLambda * rho
  if (homeGoals === 0 && awayGoals === 1) return 1 + homeLambda * rho
  if (homeGoals === 1 && awayGoals === 0) return 1 + awayLambda * rho
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho
  return 1
}

function poissonPmf(goals, lambda) {
  if (lambda <= 0) return goals === 0 ? 1 : 0
  let probability = Math.exp(-lambda)
  for (let index = 1; index <= goals; index += 1) probability *= lambda / index
  return probability
}

function goalMarginMultiplier(goalDifference) {
  const difference = Math.abs(goalDifference)
  if (difference <= 1) return 1
  if (difference === 2) return 1.5
  return (11 + difference) / 8
}

function buildHistoricalAttackDefenseLab(historicalRecords, currentRecords, canonicalRun) {
  const orderedHistory = historicalRecords
    .filter(isCompletedRecord)
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
  const runs = DYNAMIC_MODEL_CANDIDATES.map((params) => ({
    params,
    run: runDynamicWalkForward(orderedHistory, currentRecords, params),
  }))
  const splitIndex = Math.max(20, Math.floor(currentRecords.length * 0.7))
  const canonicalSelectionDirection = scoreProbabilitySamples(canonicalRun.samples.slice(0, splitIndex))
  const canonicalValidationDirection = scoreProbabilitySamples(canonicalRun.samples.slice(splitIndex))
  const canonicalSelectionTotals = scoreTotalGoalSamples(canonicalRun.samples.slice(0, splitIndex))
  const canonicalValidationTotals = scoreTotalGoalSamples(canonicalRun.samples.slice(splitIndex))
  const reports = runs.map(({ params, run }) => ({
    name: params.name,
    parameters: {
      updateRate: params.updateRate,
      halfLifeYears: params.halfLifeYears,
      meanRate: params.meanRate,
    },
    selection: {
      direction: compactMetrics(scoreProbabilitySamples(run.samples.slice(0, splitIndex))),
      totalGoals: scoreTotalGoalSamples(run.samples.slice(0, splitIndex)),
    },
    validation: {
      direction: compactMetrics(scoreProbabilitySamples(run.samples.slice(splitIndex))),
      totalGoals: scoreTotalGoalSamples(run.samples.slice(splitIndex)),
    },
    full: {
      direction: compactMetrics(run.metrics),
      totalGoals: run.totalGoalMetrics,
      exactScore: run.exactScoreMetrics,
    },
  }))
  const selectedReport = [...reports].sort((left, right) => {
    const rpsDifference = left.selection.totalGoals.rps - right.selection.totalGoals.rps
    return Math.abs(rpsDifference) > 0.0005
      ? rpsDifference
      : left.selection.totalGoals.logLoss - right.selection.totalGoals.logLoss
  })[0]
  const selectedIndex = reports.findIndex((report) => report.name === selectedReport.name)
  const selectedRun = runs[selectedIndex].run
  const totalGate = totalGoalChallengerClearsGate(
    canonicalValidationTotals,
    selectedReport.validation.totalGoals,
  )
  const directionSafe =
    selectedReport.validation.direction.rps <= canonicalValidationDirection.rps + 0.005 &&
    selectedReport.validation.direction.logLoss <= canonicalValidationDirection.logLoss + 0.02
  const enoughSamples = currentRecords.length >= 30 && currentRecords.length - splitIndex >= 8
  const adopted = enoughSamples && totalGate && directionSafe

  return {
    selectedRun,
    evaluation: {
      source: HISTORICAL_MODEL_SOURCE,
      historicalSamples: orderedHistory.length,
      currentSamples: currentRecords.length,
      selectionSize: splitIndex,
      validationSize: currentRecords.length - splitIndex,
      selectedCandidate: selectedReport.name,
      canonical: {
        selection: {
          direction: compactMetrics(canonicalSelectionDirection),
          totalGoals: canonicalSelectionTotals,
        },
        validation: {
          direction: compactMetrics(canonicalValidationDirection),
          totalGoals: canonicalValidationTotals,
        },
      },
      candidates: reports,
      policy: {
        adopted,
        scope: adopted ? 'total-goal distribution' : 'audit only',
        reason: !enoughSamples
          ? 'Not enough chronological current-tournament samples for a protected holdout.'
          : adopted
            ? 'The training-selected challenger improved total-goal RPS, Brier and log-loss on the untouched holdout without materially worsening 1X2.'
            : 'The training-selected challenger did not clear every untouched holdout gate, so it remains an audit-only signal.',
      },
    },
  }
}

function runDynamicWalkForward(historicalRecords, currentRecords, params) {
  const state = createDynamicState(params)
  for (const record of historicalRecords) {
    const prediction = predictDynamicFromState(state, record.home, record.away, { date: record.date })
    updateDynamicState(state, record, prediction)
  }

  const predictionsById = new Map()
  const samples = []
  for (const record of currentRecords) {
    const prediction = predictDynamicFromState(state, record.home, record.away, {
      date: record.date,
      homeHost: record.homeHost,
      awayHost: record.awayHost,
    })
    predictionsById.set(String(record.id), prediction)
    samples.push({
      id: String(record.id),
      date: record.date,
      actual: actualIndex(record.homeGoals, record.awayGoals),
      actualScore: `${Number(record.homeGoals)}-${Number(record.awayGoals)}`,
      actualTotal: Math.min(7, Number(record.homeGoals) + Number(record.awayGoals)),
      probabilities: prediction.probabilities,
      totalProbabilities: prediction.totalGoals,
    })
    updateDynamicState(state, record, prediction)
  }

  return {
    state,
    predictionsById,
    samples,
    metrics: scoreProbabilitySamples(samples),
    totalGoalMetrics: scoreTotalGoalSamples(samples),
    exactScoreMetrics: scoreExactScoreSamples(samples, predictionsById),
  }
}

function createDynamicState(params) {
  return {
    params,
    teams: new Map(),
    meanGoalsPerTeam: 1.35,
    lastDate: null,
  }
}

function predictDynamicFromState(state, homeName, awayName, options = {}) {
  const homeKey = canonicalTeamKey(homeName)
  const awayKey = canonicalTeamKey(awayName)
  const targetTime = safeTimestamp(options.date) ?? state.lastDate ?? Date.now()
  const home = dynamicTeamAt(state, homeKey, targetTime)
  const away = dynamicTeamAt(state, awayKey, targetTime)
  const homeHost = options.homeHost ?? HOST_TEAMS.has(homeKey)
  const awayHost = options.awayHost ?? HOST_TEAMS.has(awayKey)
  const hostLogBonus = homeHost ? 0.12 : awayHost ? -0.12 : 0
  const homeExpectedGoals = clamp(
    state.meanGoalsPerTeam * Math.exp(home.attack - away.defence + hostLogBonus),
    0.2,
    4.5,
  )
  const awayExpectedGoals = clamp(
    state.meanGoalsPerTeam * Math.exp(away.attack - home.defence - hostLogBonus / 2),
    0.2,
    4.5,
  )
  const grid = dixonColesGrid(homeExpectedGoals, awayExpectedGoals, DC_RHO)

  return {
    model: 'time-decayed attack/defence Poisson challenger',
    source: HISTORICAL_MODEL_SOURCE,
    homeExpectedGoals: round(homeExpectedGoals, 3),
    awayExpectedGoals: round(awayExpectedGoals, 3),
    probabilities: [grid.home, grid.draw, grid.away],
    totalGoals: totalGoalProbabilities(grid.scores),
    topScores: grid.scores.slice(0, 8),
  }
}

function updateDynamicState(state, record, prediction) {
  const targetTime = safeTimestamp(record.date) ?? state.lastDate ?? Date.now()
  const homeKey = canonicalTeamKey(record.home)
  const awayKey = canonicalTeamKey(record.away)
  const home = decayDynamicTeam(state, homeKey, targetTime)
  const away = decayDynamicTeam(state, awayKey, targetTime)
  const homeGoals = Math.min(5, Math.max(0, Number(record.homeGoals)))
  const awayGoals = Math.min(5, Math.max(0, Number(record.awayGoals)))
  const homeResidual = clamp(
    (homeGoals - prediction.homeExpectedGoals) / Math.sqrt(prediction.homeExpectedGoals + 0.3),
    -2.5,
    2.5,
  )
  const awayResidual = clamp(
    (awayGoals - prediction.awayExpectedGoals) / Math.sqrt(prediction.awayExpectedGoals + 0.3),
    -2.5,
    2.5,
  )
  const updateRate = state.params.updateRate / 2

  home.attack = clamp(home.attack + updateRate * homeResidual, -1.2, 1.2)
  away.defence = clamp(away.defence - updateRate * homeResidual, -1.2, 1.2)
  away.attack = clamp(away.attack + updateRate * awayResidual, -1.2, 1.2)
  home.defence = clamp(home.defence - updateRate * awayResidual, -1.2, 1.2)
  const observedMean = (homeGoals + awayGoals) / 2
  state.meanGoalsPerTeam = clamp(
    state.meanGoalsPerTeam * (1 - state.params.meanRate) + observedMean * state.params.meanRate,
    0.8,
    2.2,
  )
  state.lastDate = targetTime
}

function dynamicTeamAt(state, key, targetTime) {
  const team = state.teams.get(key)
  if (!team) return { attack: 0, defence: 0 }
  const factor = dynamicDecayFactor(team.updatedAt, targetTime, state.params.halfLifeYears)
  return { attack: team.attack * factor, defence: team.defence * factor }
}

function decayDynamicTeam(state, key, targetTime) {
  const team = state.teams.get(key) ?? { attack: 0, defence: 0, updatedAt: targetTime }
  const factor = dynamicDecayFactor(team.updatedAt, targetTime, state.params.halfLifeYears)
  team.attack *= factor
  team.defence *= factor
  team.updatedAt = targetTime
  state.teams.set(key, team)
  return team
}

function dynamicDecayFactor(previousTime, targetTime, halfLifeYears) {
  if (!Number.isFinite(previousTime) || !Number.isFinite(targetTime) || targetTime <= previousTime) return 1
  const elapsedYears = (targetTime - previousTime) / (365.25 * 24 * 60 * 60 * 1000)
  return 0.5 ** (elapsedYears / halfLifeYears)
}

function safeTimestamp(value) {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function totalGoalChallengerClearsGate(canonical, challenger) {
  return (
    challenger.rps < canonical.rps &&
    challenger.brier < canonical.brier &&
    challenger.logLoss < canonical.logLoss &&
    challenger.mae <= canonical.mae
  )
}

function buildEvaluation(
  records,
  archivedPredictions,
  canonicalRun,
  meanRevertingRun,
  prequentialRun,
  variantPolicy,
  historicalEvaluation,
) {
  const archivedSamples = []
  for (const record of records) {
    const archived = archivedPredictions?.[String(record.id)]
    const openPrediction = prequentialRun.predictionsById.get(String(record.id))
    const market = archivedProbabilityVector(archived)
    if (!market || !openPrediction) continue
    archivedSamples.push({
      id: String(record.id),
      date: record.date,
      actual: actualIndex(record.homeGoals, record.awayGoals),
      market,
      open: openPrediction.probabilities,
    })
  }

  return {
    methodology: 'strict chronological walk-forward; each match is predicted before its result updates ratings',
    properScoring: '1X2 and total-goal RPS, multiclass Brier and log-loss; lower is better except accuracy and coverage',
    openSourceBaseline: {
      canonical: canonicalRun.metrics,
      canonicalExactScore: canonicalRun.exactScoreMetrics,
      canonicalTotalGoals: scoreTotalGoalSamples(canonicalRun.samples),
      meanRevertingShadow: meanRevertingRun.metrics,
      meanRevertingExactScore: meanRevertingRun.exactScoreMetrics,
      meanRevertingTotalGoals: scoreTotalGoalSamples(meanRevertingRun.samples),
      prequentialSelected: prequentialRun.metrics,
      prequentialExactScore: prequentialRun.exactScoreMetrics,
      prequentialTotalGoals: scoreTotalGoalSamples(prequentialRun.samples),
      prequentialChallengerSelections: prequentialRun.challengerSelections,
      variantPolicy,
      reproducedUpstreamBacktest: {
        evaluated: 763,
        accuracy: 0.619,
        brier: 0.52,
        logLoss: 0.886,
        rps: 0.1746,
        ece: 0.023,
        sourceCommit: OPEN_MODEL_SOURCE.commit,
      },
    },
    historicalAttackDefense: historicalEvaluation,
    ensemble: evaluateEnsemblePolicy(archivedSamples),
    featurePolicy: {
      tierA: ['de-vigged market probability', 'open Elo/Dixon-Coles baseline', 'verified lineups and suspensions'],
      tierB: ['time-decayed recent form', 'rest', 'travel', 'weather', 'tournament attack and defence'],
      tierC: ['coach and mentality proxies', 'historical pedigree'],
      displayOnly: ['divination and cultural heuristics'],
      rule: 'lower-tier features cannot override a Tier-A consensus; unsupported factors alter uncertainty only',
    },
  }
}

function evaluateOpenVariantPolicy(canonicalRun, meanRevertingRun) {
  const sampleSize = canonicalRun.samples.length
  if (sampleSize < 30) {
    return {
      adopted: false,
      name: 'canonical',
      selectionSize: sampleSize,
      validationSize: 0,
      canonical: compactMetrics(canonicalRun.metrics),
      challenger: compactMetrics(meanRevertingRun.metrics),
      reason: 'Fewer than 30 chronological samples; keep the reproduced canonical model.',
    }
  }

  const splitIndex = Math.max(20, Math.floor(sampleSize * 0.7))
  const canonicalSelection = scoreProbabilitySamples(canonicalRun.samples.slice(0, splitIndex))
  const challengerSelection = scoreProbabilitySamples(meanRevertingRun.samples.slice(0, splitIndex))
  const canonicalValidation = scoreProbabilitySamples(canonicalRun.samples.slice(splitIndex))
  const challengerValidation = scoreProbabilitySamples(meanRevertingRun.samples.slice(splitIndex))
  const selectionCleared = challengerClearsGate(canonicalSelection, challengerSelection)
  const holdoutConfirmed = challengerClearsGate(canonicalValidation, challengerValidation)
  const adopted = selectionCleared && holdoutConfirmed

  return {
    adopted,
    name: adopted ? `mean-reversion-${REVERSION_RATE}` : 'canonical',
    selectionSize: splitIndex,
    validationSize: sampleSize - splitIndex,
    selection: {
      canonical: compactMetrics(canonicalSelection),
      challenger: compactMetrics(challengerSelection),
    },
    canonical: compactMetrics(canonicalValidation),
    challenger: compactMetrics(challengerValidation),
    holdoutConfirmed,
    reason: adopted
      ? 'Mean reversion cleared the earlier selection window and the untouched holdout confirmed the gain.'
      : selectionCleared
        ? 'Mean reversion cleared the earlier window but failed the untouched holdout; keep the canonical model.'
        : 'Mean reversion did not clear every earlier selection-window gate; keep the canonical model.',
  }
}

function challengerClearsGate(canonical, challenger) {
  return (
    challenger.rps < canonical.rps &&
    challenger.brier < canonical.brier &&
    challenger.logLoss < canonical.logLoss &&
    challenger.accuracy >= canonical.accuracy - 0.03
  )
}

function evaluateEnsemblePolicy(samples) {
  const ordered = [...samples].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
  if (ordered.length < MIN_ARCHIVED_TRAIN + 8) {
    return conservativeMarketPolicy(ordered, 'not enough archived pre-match samples for a holdout blend test')
  }

  const splitIndex = Math.max(MIN_ARCHIVED_TRAIN, Math.floor(ordered.length * 0.7))
  const training = ordered.slice(0, splitIndex)
  const validation = ordered.slice(splitIndex)
  const reports = BLEND_CANDIDATES.map((candidate) => ({
    ...candidate,
    training: compactMetrics(scoreBlend(training, candidate.market)),
    validation: compactMetrics(scoreBlend(validation, candidate.market)),
    full: compactMetrics(scoreBlend(ordered, candidate.market)),
  }))
  const marketReport = reports.find((item) => item.name === 'market-only')
  const selected = [...reports].sort((left, right) => {
    const rpsDifference = left.training.rps - right.training.rps
    return Math.abs(rpsDifference) > 0.0005 ? rpsDifference : left.training.logLoss - right.training.logLoss
  })[0]
  const improvesValidation =
    selected.name !== 'market-only' &&
    selected.validation.rps < marketReport.validation.rps &&
    selected.validation.brier < marketReport.validation.brier &&
    selected.validation.logLoss < marketReport.validation.logLoss &&
    selected.validation.accuracy >= marketReport.validation.accuracy - 0.03

  const adopted = Boolean(improvesValidation)
  const policy = adopted ? selected : marketReport
  return {
    sampleSize: ordered.length,
    trainingSize: training.length,
    validationSize: validation.length,
    candidates: reports,
    policy: {
      adopted,
      name: policy.name,
      marketWeight: policy.market,
      openWeight: policy.open,
      reason: adopted
        ? 'The fixed blend improved RPS, Brier and log-loss on the chronological holdout.'
        : 'No fixed blend cleared every holdout gate, so the open model remains an uncertainty signal only.',
    },
    validation: {
      market: marketReport.validation,
      selected: selected.validation,
      selectedCandidate: selected.name,
      adopted,
    },
  }
}

function conservativeMarketPolicy(samples, reason) {
  const marketMetrics = compactMetrics(
    scoreProbabilitySamples(samples.map((sample) => ({ actual: sample.actual, probabilities: sample.market }))),
  )
  return {
    sampleSize: samples.length,
    trainingSize: 0,
    validationSize: 0,
    candidates: [],
    policy: {
      adopted: false,
      name: 'market-only',
      marketWeight: 1,
      openWeight: 0,
      reason,
    },
    validation: {
      market: marketMetrics,
      selected: marketMetrics,
      selectedCandidate: 'market-only',
      adopted: false,
    },
  }
}

function compactMetrics(metrics) {
  const { calibrationBins: _calibrationBins, ...summary } = metrics
  return summary
}

function scoreBlend(samples, marketWeight) {
  return scoreProbabilitySamples(
    samples.map((sample) => ({
      actual: sample.actual,
      probabilities: blendProbabilities(sample.market, sample.open, marketWeight),
    })),
  )
}

export function scoreExactScoreSamples(samples = [], predictionsById = new Map()) {
  let evaluated = 0
  let top1Hits = 0
  let top3Hits = 0
  let top8Hits = 0

  for (const sample of samples) {
    const prediction =
      predictionsById instanceof Map
        ? predictionsById.get(String(sample.id))
        : predictionsById?.[String(sample.id)]
    const rankedScores = (prediction?.topScores ?? []).map((item) => String(item.score).replace(':', '-'))
    const actualScore = String(sample.actualScore ?? '').replace(':', '-')
    if (!actualScore || !rankedScores.length) continue

    evaluated += 1
    if (rankedScores[0] === actualScore) top1Hits += 1
    if (rankedScores.slice(0, 3).includes(actualScore)) top3Hits += 1
    if (rankedScores.slice(0, 8).includes(actualScore)) top8Hits += 1
  }

  return {
    samples: evaluated,
    top1Accuracy: evaluated ? round(top1Hits / evaluated, 4) : null,
    top3Coverage: evaluated ? round(top3Hits / evaluated, 4) : null,
    top8Coverage: evaluated ? round(top8Hits / evaluated, 4) : null,
  }
}

export function scoreTotalGoalSamples(samples = []) {
  const eligible = samples.filter(
    (sample) =>
      Number.isFinite(Number(sample.actualTotal)) &&
      Array.isArray(sample.totalProbabilities) &&
      sample.totalProbabilities.length === 8,
  )
  if (!eligible.length) return emptyTotalGoalMetrics()

  let brier = 0
  let logLoss = 0
  let rps = 0
  let absoluteError = 0
  let top2Hits = 0
  for (const sample of eligible) {
    const probabilities = normalizeDistribution(sample.totalProbabilities)
    const actual = Math.min(7, Math.max(0, Math.trunc(Number(sample.actualTotal))))
    let predictedCumulative = 0
    let sampleRps = 0
    for (let index = 0; index < probabilities.length; index += 1) {
      const observed = index === actual ? 1 : 0
      brier += (probabilities[index] - observed) ** 2
      if (index < probabilities.length - 1) {
        predictedCumulative += probabilities[index]
        sampleRps += (predictedCumulative - (actual <= index ? 1 : 0)) ** 2
      }
    }
    rps += sampleRps / (probabilities.length - 1)
    logLoss += -Math.log(Math.max(1e-12, probabilities[actual]))
    const expectedTotal = probabilities.reduce((sum, probability, index) => sum + probability * index, 0)
    absoluteError += Math.abs(expectedTotal - actual)
    const topTwo = probabilities
      .map((probability, index) => ({ probability, index }))
      .sort((left, right) => right.probability - left.probability)
      .slice(0, 2)
      .map((item) => item.index)
    if (topTwo.includes(actual)) top2Hits += 1
  }

  const count = eligible.length
  return {
    samples: count,
    rps: round(rps / count, 4),
    brier: round(brier / count, 4),
    logLoss: round(logLoss / count, 4),
    mae: round(absoluteError / count, 4),
    top2Coverage: round(top2Hits / count, 4),
  }
}

export function scoreProbabilitySamples(samples = []) {
  if (!samples.length) return emptyMetrics()
  let hits = 0
  let brier = 0
  let logLoss = 0
  let rps = 0
  const bins = Array.from({ length: 10 }, () => ({ sumProbability: 0, sumObserved: 0, count: 0 }))

  for (const sample of samples) {
    const probabilities = normalizeVector(sample.probabilities)
    const actual = sample.actual
    if (indexOfMax(probabilities) === actual) hits += 1
    for (let index = 0; index < 3; index += 1) {
      const observed = index === actual ? 1 : 0
      brier += (probabilities[index] - observed) ** 2
      const binIndex = Math.min(9, Math.floor(probabilities[index] * 10))
      bins[binIndex].sumProbability += probabilities[index]
      bins[binIndex].sumObserved += observed
      bins[binIndex].count += 1
    }
    logLoss += -Math.log(Math.max(1e-12, probabilities[actual]))
    const homeObserved = actual === 0 ? 1 : 0
    const homeOrDrawObserved = actual <= 1 ? 1 : 0
    rps += 0.5 * ((probabilities[0] - homeObserved) ** 2 + (probabilities[0] + probabilities[1] - homeOrDrawObserved) ** 2)
  }

  const count = samples.length
  const ece =
    bins.reduce((sum, bin) => {
      if (!bin.count) return sum
      return sum + Math.abs(bin.sumProbability / bin.count - bin.sumObserved / bin.count) * bin.count
    }, 0) /
    (3 * count)
  const accuracy = hits / count
  return {
    samples: count,
    accuracy: round(accuracy, 4),
    accuracy95: wilsonInterval(hits, count),
    brier: round(brier / count, 4),
    logLoss: round(logLoss / count, 4),
    rps: round(rps / count, 4),
    ece: round(ece, 4),
    calibrationBins: bins.map((bin, index) => ({
      range: [index / 10, (index + 1) / 10],
      count: bin.count,
      averagePrediction: bin.count ? round(bin.sumProbability / bin.count, 4) : null,
      observedFrequency: bin.count ? round(bin.sumObserved / bin.count, 4) : null,
    })),
  }
}

function emptyMetrics() {
  return {
    samples: 0,
    accuracy: null,
    accuracy95: [null, null],
    brier: null,
    logLoss: null,
    rps: null,
    ece: null,
    calibrationBins: [],
  }
}

function emptyTotalGoalMetrics() {
  return {
    samples: 0,
    rps: null,
    brier: null,
    logLoss: null,
    mae: null,
    top2Coverage: null,
  }
}

function archivedProbabilityVector(archived) {
  const entries = archived?.resultProbabilities
  if (!Array.isArray(entries)) return null
  const bySide = new Map(entries.map((item) => [item.side, Number(item.probability)]))
  if (!['home', 'draw', 'away'].every((side) => Number.isFinite(bySide.get(side)))) return null
  return normalizeVector([bySide.get('home'), bySide.get('draw'), bySide.get('away')])
}

function probabilityVector(probabilities) {
  if (!Array.isArray(probabilities)) return [1 / 3, 1 / 3, 1 / 3]
  if (typeof probabilities[0] === 'number') return normalizeVector(probabilities)
  const bySide = new Map(probabilities.map((item) => [item.side, Number(item.probability)]))
  return normalizeVector([bySide.get('home'), bySide.get('draw'), bySide.get('away')])
}

function blendProbabilities(market, open, marketWeight) {
  const marketVector = normalizeVector(market)
  const openVector = normalizeVector(open)
  return normalizeVector(marketVector.map((value, index) => value * marketWeight + openVector[index] * (1 - marketWeight)))
}

function probabilityDisagreement(left, right) {
  const a = normalizeVector(left)
  const b = normalizeVector(right)
  const midpoint = a.map((value, index) => (value + b[index]) / 2)
  const totalVariation = 0.5 * a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0)
  const jsDivergence = 0.5 * kullbackLeibler(a, midpoint) + 0.5 * kullbackLeibler(b, midpoint)
  const directionConflict = indexOfMax(a) !== indexOfMax(b)
  const confidencePenalty = totalVariation >= 0.18 ? 12 : totalVariation >= 0.12 ? 8 : totalVariation >= 0.07 ? 4 : 1
  return {
    totalVariation: round(totalVariation, 4),
    jsDivergence: round(jsDivergence, 4),
    directionConflict,
    confidencePenalty,
  }
}

function kullbackLeibler(left, right) {
  return left.reduce((sum, value, index) => (value > 0 ? sum + value * Math.log(value / Math.max(1e-12, right[index])) : sum), 0)
}

function normalizeVector(values) {
  const safe = values.map((value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0))
  const total = safe.reduce((sum, value) => sum + value, 0)
  return total > 0 ? safe.map((value) => value / total) : [1 / 3, 1 / 3, 1 / 3]
}

function normalizeDistribution(values) {
  const safe = values.map((value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0))
  const total = safe.reduce((sum, value) => sum + value, 0)
  if (total > 0) return safe.map((value) => value / total)
  return safe.map(() => 1 / Math.max(1, safe.length))
}

function actualIndex(homeGoals, awayGoals) {
  return homeGoals > awayGoals ? 0 : homeGoals < awayGoals ? 2 : 1
}

function isCompletedRecord(record) {
  return (
    record &&
    record.id !== undefined &&
    record.homeGoals !== null &&
    record.homeGoals !== undefined &&
    record.awayGoals !== null &&
    record.awayGoals !== undefined &&
    Number.isFinite(Number(record.homeGoals)) &&
    Number.isFinite(Number(record.awayGoals)) &&
    Number.isFinite(new Date(record.date).getTime())
  )
}

function indexOfMax(values) {
  let bestIndex = 0
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[bestIndex]) bestIndex = index
  }
  return bestIndex
}

function wilsonInterval(hits, total, z = 1.96) {
  if (!total) return [null, null]
  const probability = hits / total
  const denominator = 1 + (z ** 2) / total
  const center = (probability + (z ** 2) / (2 * total)) / denominator
  const margin =
    (z * Math.sqrt((probability * (1 - probability)) / total + (z ** 2) / (4 * total ** 2))) / denominator
  return [round(Math.max(0, center - margin), 4), round(Math.min(1, center + margin), 4)]
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

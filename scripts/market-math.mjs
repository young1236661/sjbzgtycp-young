export function invertPoissonOverLine(probability, line) {
  const targetProbability = clamp(Number(probability) || 0.5, 0.02, 0.98)
  const targetLine = Number.isFinite(Number(line)) ? Number(line) : 2.5
  let bestMean = targetLine
  let bestGap = Infinity

  for (let mean = 0.7; mean <= 6.5; mean += 0.005) {
    const modelProbability = asianTotalNormalizedOverProbability(mean, targetLine)
    const gap = Math.abs(modelProbability - targetProbability)
    if (gap < bestGap) {
      bestGap = gap
      bestMean = mean
    }
  }
  return bestMean
}

export function asianTotalNormalizedOverProbability(mean, line) {
  const components = asianTotalLineComponents(line)
  const overFairImplied = asianTotalFairImpliedProbability(mean, components, 'over')
  const underFairImplied = asianTotalFairImpliedProbability(mean, components, 'under')
  const total = overFairImplied + underFairImplied
  return total > 0 ? overFairImplied / total : 0.5
}

export function asianTotalLineComponents(line) {
  const value = Number.isFinite(Number(line)) ? Number(line) : 2.5
  const floor = Math.floor(value)
  const fraction = Math.round((value - floor) * 100) / 100
  if (Math.abs(fraction - 0.25) < 0.01) return [floor, floor + 0.5]
  if (Math.abs(fraction - 0.75) < 0.01) return [floor + 0.5, floor + 1]
  return [value]
}

export function fitDixonColesExpectedGoals(totalMean, probabilities, options = {}) {
  const total = clamp(Number(totalMean) || 2.5, 0.5, 6.5)
  const target = normalizeVector(probabilities)
  const rhoMin = Number.isFinite(options.rhoMin) ? options.rhoMin : -0.2
  const rhoMax = Number.isFinite(options.rhoMax) ? options.rhoMax : 0.12
  const rhoStep = Number.isFinite(options.rhoStep) ? options.rhoStep : 0.01
  const lambdaStep = Number.isFinite(options.lambdaStep) ? options.lambdaStep : 0.01
  let best = null

  for (let home = 0.08; home <= total - 0.08; home += lambdaStep) {
    const away = total - home
    for (let rho = rhoMin; rho <= rhoMax + 1e-9; rho += rhoStep) {
      const model = dixonColesOutcomeProbabilities(home, away, rho)
      const fitError = model.reduce((sum, probability, index) => sum + (probability - target[index]) ** 2, 0)
      const regularizedError = fitError + 0.0005 * (rho + 0.08) ** 2
      if (!best || regularizedError < best.regularizedError) {
        best = { home, away, rho, probabilities: model, fitError, regularizedError }
      }
    }
  }

  return {
    homeExpectedGoals: round(best.home, 3),
    awayExpectedGoals: round(best.away, 3),
    totalExpectedGoals: round(best.home + best.away, 3),
    rho: round(best.rho, 3),
    probabilities: best.probabilities.map((value) => round(value, 6)),
    fitError: round(best.fitError, 8),
  }
}

export function dixonColesOutcomeProbabilities(homeMean, awayMean, rho = -0.08) {
  let home = 0
  let draw = 0
  let away = 0
  let mass = 0
  for (let homeGoals = 0; homeGoals <= 10; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 10; awayGoals += 1) {
      const base = poissonPmf(homeGoals, homeMean) * poissonPmf(awayGoals, awayMean)
      const probability = Math.max(0, base * dixonColesTau(homeGoals, awayGoals, homeMean, awayMean, rho))
      mass += probability
      if (homeGoals > awayGoals) home += probability
      else if (homeGoals < awayGoals) away += probability
      else draw += probability
    }
  }
  return normalizeVector([home / mass, draw / mass, away / mass])
}

function asianTotalFairImpliedProbability(mean, components, side) {
  let expectedWinFraction = 0
  let expectedLossFraction = 0
  const componentWeight = 1 / components.length

  for (let totalGoals = 0; totalGoals <= 18; totalGoals += 1) {
    const probability = poissonPmf(totalGoals, mean)
    for (const component of components) {
      const comparison = totalGoals === component ? 0 : totalGoals > component ? 1 : -1
      const wins = side === 'over' ? comparison > 0 : comparison < 0
      const loses = side === 'over' ? comparison < 0 : comparison > 0
      if (wins) expectedWinFraction += probability * componentWeight
      if (loses) expectedLossFraction += probability * componentWeight
    }
  }

  const fairDecimal = 1 + expectedLossFraction / Math.max(1e-12, expectedWinFraction)
  return 1 / fairDecimal
}

function poissonPmf(goals, mean) {
  if (mean <= 0) return goals === 0 ? 1 : 0
  let probability = Math.exp(-mean)
  for (let index = 1; index <= goals; index += 1) probability *= mean / index
  return probability
}

function dixonColesTau(homeGoals, awayGoals, homeMean, awayMean, rho) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - homeMean * awayMean * rho
  if (homeGoals === 0 && awayGoals === 1) return 1 + homeMean * rho
  if (homeGoals === 1 && awayGoals === 0) return 1 + awayMean * rho
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho
  return 1
}

function normalizeVector(values) {
  const safe = values.map((value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0))
  const total = safe.reduce((sum, value) => sum + value, 0)
  return total > 0 ? safe.map((value) => value / total) : [1 / 3, 1 / 3, 1 / 3]
}

function round(value, digits) {
  return Number(Number(value).toFixed(digits))
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

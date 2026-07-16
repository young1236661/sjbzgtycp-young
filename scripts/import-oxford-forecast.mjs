import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const SOURCE_URL = 'https://fatih.ai/worldcup2026/fixtures/'
const ABOUT_URL = 'https://fatih.ai/worldcup2026/about/'
const OUTPUT_PATH = new URL('./data/oxford-locked-forecast.json', import.meta.url)
const EXPECTED_FORECAST_SHA256 = '20d947440ab184403299a355db8461d84f5ce312b642690a93101c1a3369d0e6'

const response = await fetch(SOURCE_URL, {
  headers: { 'user-agent': 'WorldCupAdvisor/1.0 (public model audit)' },
})
if (!response.ok) throw new Error(`Oxford forecast request failed with HTTP ${response.status}`)

const html = await response.text()
const cards = [...html.matchAll(/<li class="fxc"[\s\S]*?<\/li>/g)].map((match) => match[0])
const fixtures = cards.map(parseFixtureCard).sort((left, right) => left.matchNumber - right.matchNumber)

if (fixtures.length !== 72) {
  throw new Error(`Expected 72 locked group-stage forecasts, parsed ${fixtures.length}`)
}
if (new Set(fixtures.map((fixture) => fixture.matchNumber)).size !== fixtures.length) {
  throw new Error('Oxford forecast contains duplicate match numbers')
}
const forecastSha256 = sha256(JSON.stringify(fixtures))
if (forecastSha256 !== EXPECTED_FORECAST_SHA256) {
  throw new Error(`Oxford locked forecast changed: expected ${EXPECTED_FORECAST_SHA256}, received ${forecastSha256}`)
}

const payload = {
  version: 1,
  importedAt: new Date().toISOString(),
  source: {
    id: 'oxford-locked-ensemble',
    name: 'Oxford Football Forecasting locked ensemble',
    url: SOURCE_URL,
    aboutUrl: ABOUT_URL,
    lockedAt: '2026-06-09',
    lockedForecastSha256: forecastSha256,
    methodology: 'Elo, Dixon-Coles, Bayesian hierarchical and LightGBM-Poisson log-opinion pool',
    publishedValidation: {
      heldOutMatches: 152,
      ensembleRps: 0.1891,
      deviggedMarketRps: 0.1905,
      claim: 'matches the market; does not significantly beat it',
    },
  },
  import: {
    sourceHtmlSha256: sha256(html),
    fixtureCount: fixtures.length,
  },
  fixtures,
}

await mkdir(new URL('./data/', import.meta.url), { recursive: true })
await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`Imported ${fixtures.length} Oxford forecasts to ${OUTPUT_PATH.pathname}`)

function parseFixtureCard(card) {
  const matchNumber = numberCapture(card, /href="\/worldcup2026\/match\/(\d+)"/)
  const matchup = stringCapture(card, /aria-label="Match forecast: ([^"]+)"/)
  const matchupParts = matchup.split(' v ')
  const stage = stringCapture(card, /<span class="fxc__stage"[^>]*>([^<]+)<\/span>/)
  const dateText = stringCapture(card, /<span class="fxc__date"[^>]*>([^<]+)<\/span>/)
  const timeUtc = stringCapture(card, /<span class="fxc__time"[^>]*>([^<]+) UTC<\/span>/)
  const probabilityLabel = stringCapture(card, /class="gd-wdl__bar"[^>]*aria-label="([^"]+)"/)
  const probabilities = [...probabilityLabel.matchAll(/(?:win|draw)\s+([0-9.]+)%/g)].map((match) => Number(match[1]) / 100)
  const score = stringCapture(card, /ML\s*<b[^>]*>(\d+)[–-](\d+)<\/b>/, (match) => `${match[1]}-${match[2]}`)
  const scoreProbability = numberCapture(card, /class="fxc__scorep"[^>]*>\s*\(([0-9.]+)%\)/) / 100
  const overTwoPointFive = numberCapture(card, /O2\.5\s+([0-9.]+)%/) / 100
  const expectedGoals = stringCapture(card, /xG\s+([0-9.]+)[–-]([0-9.]+)/, (match) => [Number(match[1]), Number(match[2])])

  if (matchupParts.length !== 2 || probabilities.length !== 3) {
    throw new Error(`Could not parse Oxford match ${matchNumber || '?'}`)
  }

  return {
    matchNumber,
    stage,
    dateText,
    timeUtc,
    home: decodeEntities(matchupParts[0]),
    away: decodeEntities(matchupParts[1]),
    probabilities,
    mostLikelyScore: score,
    mostLikelyScoreProbability: scoreProbability,
    overTwoPointFive,
    expectedGoals: {
      home: expectedGoals[0],
      away: expectedGoals[1],
      total: Number((expectedGoals[0] + expectedGoals[1]).toFixed(3)),
    },
  }
}

function stringCapture(value, pattern, transform = (match) => match[1]) {
  const match = String(value).match(pattern)
  if (!match) throw new Error(`Missing required Oxford field for ${pattern}`)
  return transform(match)
}

function numberCapture(value, pattern) {
  const number = Number(stringCapture(value, pattern))
  if (!Number.isFinite(number)) throw new Error(`Invalid Oxford number for ${pattern}`)
  return number
}

function decodeEntities(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

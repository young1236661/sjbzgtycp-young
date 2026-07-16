import { mkdir, writeFile } from 'node:fs/promises'

const SOURCE = Object.freeze({
  name: 'OpenFootball World Cup JSON',
  repository: 'https://github.com/openfootball/worldcup.json',
  commit: '5e4bc62f9e711f3ea83d2b150ac3200e7e9c90a0',
  license: 'CC0-1.0',
})

const EDITIONS = Object.freeze([
  1930, 1934, 1938, 1950, 1954, 1958, 1962, 1966, 1970, 1974, 1978, 1982, 1986, 1990, 1994, 1998,
  2002, 2006, 2010, 2014, 2018, 2022,
])

const OUTPUT_URL = new URL('./data/world-cup-history.json', import.meta.url)

async function main() {
  const editions = await mapWithConcurrency(EDITIONS, 4, fetchEdition)
  const matches = editions.flatMap(({ year, data }) =>
    data.matches.flatMap((match, index) => normalizeMatch(match, year, index)),
  )
  const payload = {
    source: SOURCE,
    scope: 'FIFA World Cup matches through 2022; regulation time plus stoppage time only',
    editions: EDITIONS,
    matches,
  }

  await mkdir(new URL('./data/', import.meta.url), { recursive: true })
  await writeFile(OUTPUT_URL, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`wrote ${matches.length} regulation-time matches to ${OUTPUT_URL.pathname}`)
}

async function fetchEdition(year) {
  const url = `https://raw.githubusercontent.com/openfootball/worldcup.json/${SOURCE.commit}/${year}/worldcup.json`
  const data = await fetchJsonWithRetry(url, year)
  if (!Array.isArray(data.matches)) throw new Error(`OpenFootball ${year} payload has no matches array`)
  return { year, data }
}

async function fetchJsonWithRetry(url, year) {
  let lastError = null
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < 4) await delay(300 * 2 ** (attempt - 1))
    }
  }
  throw new Error(`OpenFootball ${year} fetch failed after retries: ${lastError?.message ?? 'unknown error'}`)
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = Array(items.length)
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        output[index] = await worker(items[index])
      }
    }),
  )
  return output
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function normalizeMatch(match, year, index) {
  const score = match?.score?.ft
  if (!Array.isArray(score) || score.length !== 2 || !score.every(Number.isFinite)) return []
  if (!match.team1 || !match.team2 || !match.date) return []
  const time = /^\d{1,2}:\d{2}$/.test(match.time ?? '') ? match.time.padStart(5, '0') : '12:00'
  const date = new Date(`${match.date}T${time}:00Z`)
  if (!Number.isFinite(date.getTime())) return []

  return [
    {
      id: `openfootball-${year}-${String(index + 1).padStart(3, '0')}`,
      year,
      date: date.toISOString(),
      round: match.round ?? null,
      home: match.team1,
      away: match.team2,
      homeGoals: score[0],
      awayGoals: score[1],
    },
  ]
}

await main()

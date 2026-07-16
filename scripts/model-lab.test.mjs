import assert from 'node:assert/strict'
import {
  buildOpenSourceModelLab,
  canonicalTeamKey,
  scoreExactScoreSamples,
  scoreProbabilitySamples,
  scoreTotalGoalSamples,
} from './model-lab.mjs'

assert.equal(canonicalTeamKey('United States'), 'usa')
assert.equal(canonicalTeamKey('Curaçao'), 'curacao')
assert.equal(canonicalTeamKey('Congo DR'), 'dr-congo')

const lab = buildOpenSourceModelLab([
  {
    id: 'one',
    date: '2026-06-11T12:00:00Z',
    home: 'Spain',
    away: 'Argentina',
    homeGoals: 1,
    awayGoals: 0,
  },
  {
    id: 'two',
    date: '2026-06-12T12:00:00Z',
    home: 'Spain',
    away: 'Argentina',
    homeGoals: 0,
    awayGoals: 1,
  },
])

const neutral = lab.predict('Spain', 'Argentina')
assert.equal(neutral.probabilities.length, 3)
assert.ok(Math.abs(neutral.probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-9)
assert.ok(neutral.topScores.length >= 5)
assert.ok(neutral.topScores.every((item) => item.probability >= 0 && item.probability <= 1))
assert.equal(neutral.totalGoals.length, 8)
assert.ok(Math.abs(neutral.totalGoals.reduce((sum, value) => sum + value, 0) - 1) < 1e-5)
assert.equal(neutral.historicalChallenger.totalGoals.length, 8)
assert.equal(lab.evaluation.openSourceBaseline.prequentialExactScore.samples, 2)
assert.equal(lab.evaluation.openSourceBaseline.prequentialTotalGoals.samples, 2)
assert.equal(lab.evaluation.historicalAttackDefense.historicalSamples, 964)

const stronger = lab.predict('Spain', 'Haiti')
assert.ok(stronger.probabilities[0] > stronger.probabilities[2])

const changedFutureResult = buildOpenSourceModelLab([
  {
    id: 'one',
    date: '2026-06-11T12:00:00Z',
    home: 'Spain',
    away: 'Argentina',
    homeGoals: 1,
    awayGoals: 0,
  },
  {
    id: 'two',
    date: '2026-06-12T12:00:00Z',
    home: 'Spain',
    away: 'Argentina',
    homeGoals: 5,
    awayGoals: 0,
  },
])
assert.deepEqual(
  lab.predictionForId('two').probabilities,
  changedFutureResult.predictionForId('two').probabilities,
  'a match result must not leak into its own pre-match prediction',
)
assert.deepEqual(
  lab.predictionForId('two').topScores,
  changedFutureResult.predictionForId('two').topScores,
  'a match result must not leak into its own exact-score ranking',
)
assert.deepEqual(
  lab.predictionForId('two').totalGoals,
  changedFutureResult.predictionForId('two').totalGoals,
  'a match result must not leak into its own total-goal distribution',
)

const conservativeBlend = lab.combineWithMarket([0.5, 0.3, 0.2], lab.predict('Spain', 'Argentina'))
assert.equal(conservativeBlend.adopted, false)
assert.deepEqual(conservativeBlend.blended, [0.5, 0.3, 0.2])

const uniform = scoreProbabilitySamples([
  { actual: 0, probabilities: [1 / 3, 1 / 3, 1 / 3] },
  { actual: 1, probabilities: [1 / 3, 1 / 3, 1 / 3] },
  { actual: 2, probabilities: [1 / 3, 1 / 3, 1 / 3] },
])
assert.equal(uniform.accuracy, 0.3333)
assert.equal(uniform.brier, 0.6667)
assert.equal(uniform.logLoss, 1.0986)
assert.equal(uniform.rps, 0.2222)

const exactScores = scoreExactScoreSamples(
  [
    { id: 'a', actualScore: '1-0' },
    { id: 'b', actualScore: '0-1' },
  ],
  new Map([
    ['a', { topScores: [{ score: '1-0' }, { score: '0-0' }, { score: '1-1' }] }],
    ['b', { topScores: [{ score: '1-1' }, { score: '0-0' }, { score: '0-1' }] }],
  ]),
)
assert.deepEqual(exactScores, {
  samples: 2,
  top1Accuracy: 0.5,
  top3Coverage: 1,
  top8Coverage: 1,
})

const perfectTotals = scoreTotalGoalSamples([
  { actualTotal: 0, totalProbabilities: [1, 0, 0, 0, 0, 0, 0, 0] },
  { actualTotal: 7, totalProbabilities: [0, 0, 0, 0, 0, 0, 0, 1] },
])
assert.deepEqual(perfectTotals, {
  samples: 2,
  rps: 0,
  brier: 0,
  logLoss: 0,
  mae: 0,
  top2Coverage: 1,
})

console.log('model-lab tests passed')

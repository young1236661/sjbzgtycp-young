# Model Methodology

## Objective

The model estimates regulation-time probabilities: 90 minutes plus stoppage
time, excluding extra time and penalty shootouts. It is a forecasting and
calibration system, not a profit guarantee.

## Evidence hierarchy

1. Tier A: de-vigged market probabilities, an independently implemented
   Elo/Dixon-Coles baseline, and verified lineup/suspension information.
2. Tier B: time-decayed form, rest, travel, weather, and current-tournament
   attack/defence performance.
3. Tier C: coach, mentality, and historical-pedigree proxies. These are
   regularized and primarily increase uncertainty.
4. Display-only: divination and cultural heuristics. They have zero numerical
   weight in the main probability forecast.

Lower-tier evidence cannot override a Tier-A consensus.

## Independent open-source baseline

The independent baseline adapts the MIT-licensed Cup26 AI model at revision
`184f5021c42192fb6abfac71abf641ff18df11e0`:

- calibrated pre-tournament Elo priors;
- chronological Elo updates after each completed match;
- a Dixon-Coles correction for low scores;
- neutral-venue handling, with host advantage only for host nations;
- a complete score grid that produces 1X2 and exact-score probabilities.

Recent five-match form uses exponential decay with a 2.5-match half-life, so
the newest result carries more weight than the fifth-oldest result. A separate
8% mean-reversion challenger is selected only when it improves RPS, Brier, and
log-loss on the earlier 70% selection window without a material accuracy loss;
the final 30% is then reported as an untouched chronological check. Historical
predictions use prequential selection, so the variant used for a match depends
only on matches completed before that kickoff.

The upstream walk-forward backtest was reproduced locally on 763 held-out
international matches: accuracy 61.9%, RPS 0.1746, Brier 0.520, log-loss 0.886,
and ECE 2.3%.

## Ensemble gate

The system tests four fixed probability combinations: market only, 80/20,
65/35, and 50/50 market/open-model weights. It uses a chronological 70/30
split of archived pre-match predictions. A blend is adopted only if it beats
market-only probabilities on holdout RPS, Brier, and log-loss without a
material accuracy loss. Otherwise the open model remains an uncertainty and
disagreement signal and does not move the headline probabilities.

That 1X2 gate does not authorize exact-score blending. The open model's score
grid remains an independent coverage check until a separate chronological
exact-score holdout gate demonstrates an improvement.

## Metrics

- Accuracy: easy to understand, but not sufficient for probability quality.
- Multiclass Brier: squared probability error across home/draw/away.
- Log-loss: strongly penalizes confident wrong forecasts.
- Ranked Probability Score: proper scoring rule for ordered 1X2 outcomes.
- Expected Calibration Error: compares forecast probability bands with
  observed frequencies.
- Wilson 95% interval: shows uncertainty around accuracy estimates.
- Exact-score Top1 accuracy and Top3/Top8 coverage: reports how often the
  realized score appears in the ranked Dixon-Coles score grid. Coverage is
  shown separately because a single exact score is intrinsically high variance.

Every metric is calculated on predictions archived before kickoff. Results are
joined only after the match, preventing future information leakage.

## Design references

- Cup26 AI Elo/Dixon-Coles model:
  https://github.com/Hicruben/world-cup-2026-prediction-model
- Dynamic strength, mean reversion, and tournament-held-out validation:
  https://github.com/zvizdo/fifa-wc-2026-simulation
- Poisson-family football models, time weighting, neutral venues, and proper
  scoring:
  https://penaltyblog.readthedocs.io/en/latest/models/overview.html

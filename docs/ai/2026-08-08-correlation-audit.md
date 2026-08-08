# 2026-08-08 residual-correlation audit

## Why this audit exists

The previous scenario model was football-plausible but not sufficiently empirical. Hand-set game scoring, passing, rushing, pace, team-performance, and chaos weights induced correlations for every player sharing a game or team. That made the simulator structurally elegant, but elegance was being mistaken for evidence.

The failure mode was material: the old factors gave same-team WR-WR, RB-WR, and many opponent pairs large positive dependence even though historical fantasy residuals are usually near zero for those relationships.

## Leakage and validation boundary

- Model-estimation seasons: **2023 and 2024**.
- Shrinkage selection: bidirectional **2023→2024 and 2024→2023 cross-validation**.
- **2025 is not called a pristine holdout.** Its pair structure had already been inspected during the interrupted audit before this implementation was frozen, so it is used only as a consistency check.
- Positions: QB, RB, WR, TE.
- Weekly prediction proxy: recency-weighted mean of up to five prior games from the same player-season.
- A residual is emitted only after at least three prior games and a proxy mean of at least 2 PPR points.
- Player pairs are formed only within the same NFL game and separated into same-team versus opponent buckets.
- Correlations are bucketed by position pair; buckets require at least 40 observations.

This is a residual-dependence test, not a validation of the production projection mean.
## Training rule

Shrinkage was selected from `[0, 25, 50, 100, 200, 400, 800, 1600]` pair pseudo-observations. Each candidate predicts 2024 from 2023 and 2023 from 2024; weighted RMSE across those two directions is the selection metric.

The winning value was **200 pair pseudo-observations**. At that setting, the bidirectional cross-validation errors were:

| Model | CV RMSE | CV MAE |
|---|---:|---:|
| Independence | 0.084 | 0.045 |
| Legacy hand-set factor model | 0.182 | 0.170 |
| Empirical shrunk pair model | **0.044** | **0.030** |

After the rule is selected, 2023-2024 are combined to produce the compact deployed pair table in `src/engine/correlation.js`. The audit recomputes those values and sample supports from source archives and fails if the embedded table drifts.

Representative deployed correlations and the already-inspected 2025 consistency values:

| Relation | Deployed | 2025 consistency | Legacy simulator |
|---|---:|---:|---:|
| Same-team QB-WR | +0.277 | +0.295 | +0.243 |
| Same-team QB-TE | +0.172 | +0.286 | +0.235 |
| Same-team QB-RB | +0.051 | +0.064 | +0.150 |
| Same-team RB-WR | -0.031 | -0.014 | +0.124 |
| Same-team WR-WR | +0.008 | +0.015 | +0.259 |
| Opponent QB-WR | +0.023 | +0.064 | +0.229 |
| Opponent WR-WR | +0.032 | +0.018 | +0.244 |

## 2025 consistency check

Because 2025 had already been inspected, these numbers are useful as a regression/consistency test rather than fresh generalization evidence:

| Model | 2025 RMSE | 2025 MAE |
|---|---:|---:|
| Independence | 0.091 | 0.049 |
| Legacy hand-set factor model | 0.173 | 0.159 |
| Empirical shrunk pair model | **0.036** | **0.026** |

The old model is not merely noisier than the empirical replacement. It performs materially worse than independence in both the 2023↔2024 cross-validation and the 2025 consistency set. That is enough to reject the hand-set shared-factor weights as the production default, without pretending 2025 is unseen evidence.

## Runtime correction

`src/engine/runtime.js` now builds a sparse correlation plan. Every supported non-zero same-game pair receives an independent Gaussian edge factor. The factor sign allows negative correlations; endpoint scaling caps dense shared variance, and the player residual is set so total latent variance remains one.
This representation preserves the useful QB-WR stack relationship without mechanically imposing a large WR-WR relationship. League simulation builds one weekly plan across all fantasy teams, samples each NFL player once per scenario/week, then aggregates those outcomes to fantasy-team totals.

## Admission gate

`npm run audit:correlation` recomputes the 2023↔2024 cross-validation, verifies that the embedded combined-season coefficients and sample supports match their derivation, and fails if the empirical model does not beat both the legacy model and independence on cross-validated RMSE. The known 2025 set is retained as a secondary consistency guard, not as the primary admission claim.

The command is part of `npm run verify`.

## Limits that remain

- The residual model covers QB/RB/WR/TE. K/DST are intentionally independent until a defensible historical calibration is added.
- The rolling prior-game mean is a leakage-safe residual proxy, not the current ESPN-derived production mean forecast.
- Correlation changes can improve portfolio and title risk estimates without improving individual-player mean accuracy.
- Season-to-season scheme, quarterback, and roster changes can alter dependence; a future season that has not been inspected should become the next true holdout.
- Full FFOB-003 still has to validate production-style means, evidence coefficients, lineup regret, waiver/trade utility, and title-probability calibration.

The correct claim after this release is narrower: **SnapCount's skill-position same-game residual dependence is now empirically fitted and cross-validated against the old structure. The overall fantasy model is still not proven best-in-class.**

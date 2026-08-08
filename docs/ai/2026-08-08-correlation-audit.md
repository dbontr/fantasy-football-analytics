# SnapCount scenario-correlation audit — 2026-08-08

## Finding

The production scenario engine was materially over-correlating most fantasy players. Its shared game factors were football-plausible, but the weights were hand-set rather than fitted to historical fantasy residuals. The largest error was treating receivers, running backs, and opposing skill players as if a broad game environment made their weekly fantasy outcomes move together strongly.

Historical residuals support a narrower structure: QB-to-pass-catcher stacks are meaningfully positive, while most other skill-player pairs are close to independent after conditioning on each player's own recent scoring level and volatility.

## Leakage discipline

The audit uses only bundled nflverse regular-season player-week data.

- Fit target: **2023**.
- Validation: **2024**.
- 2025 is shown as a **consistency check**, not a pristine holdout, because it was inspected during the broader model audit before this factor fit was finalized.
- Each target week's residual uses only that player's prior games: recency-weighted prior five PPR scores for the mean and up to six prior games for the scale.
- Residual z-scores are clipped to `[-3, 3]` to keep one extreme outcome from dominating pair correlations.

## Historical pair structure

Representative empirical residual correlations (2023 / 2024 / 2025):

| Pair | Empirical |
|---|---:|
| Same-team QB–WR | 0.273 / 0.280 / 0.319 |
| Same-team QB–TE | 0.271 / 0.199 / 0.311 |
| Same-team QB–RB | 0.116 / 0.080 / 0.086 |
| Same-team RB–WR | -0.033 / -0.029 / -0.002 |
| Same-team WR–WR | 0.012 / 0.031 / 0.041 |
| Opposing QB–WR | -0.002 / 0.099 / 0.092 |
| Opposing WR–WR | 0.016 / 0.080 / 0.029 |

## Correction

The offensive low-rank factor structure is now fitted to the 2023 residual matrix instead of chosen by hand. Kicker and DST factors are unchanged because this player-week audit covers QB/RB/WR/TE only.

The resulting modeled examples are:

- Same-team QB–WR: `0.224`.
- Same-team QB–TE: `0.227`.
- Same-team QB–RB: `0.076`.
- Same-team RB–WR: `0.019`.
- Same-team WR–WR: `0.058`.
- Opposing QB–WR: `0.017`.
- Opposing WR–WR: `0.005`.

Weighted pair-correlation RMSE:

| Year | Legacy | Calibrated |
|---|---:|---:|
| 2023 fit | 0.1767 | 0.0344 |
| 2024 validation | 0.1764 | 0.0538 |
| 2025 consistency | 0.1664 | 0.0549 |

Every offensive position retains idiosyncratic residual variance; shared-factor variance is capped below 0.90.

## Admission rule

`npm run audit:correlation` must pass as part of `npm run verify`. Any future scenario-factor change must materially improve or preserve the 2024 validation error and must retain sensible stack/independence constraints. A football narrative is not enough to justify a correlation coefficient.

This correction improves joint simulations used by lineup portfolios, league/title simulation, and championship-action comparisons. It does not prove that the forecast means themselves are optimal; the full rolling mean/decision tournament remains FFOB-003.

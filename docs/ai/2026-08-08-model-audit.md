# SnapCount model audit — 2026-08-08

## Verdict

SnapCount is a strong browser fantasy-engine implementation, but the analytics have not yet earned a claim of being best-in-class. The main gap is not feature count; it is leakage-safe out-of-sample proof.

### Harsh grade before this correction

| Area | Grade | Reason |
|---|---:|---|
| Browser / simulation engineering | A- | Fast deterministic Web Worker architecture, exact lineup assignment, correlated scenarios, zero backend. |
| Data provenance / missing-data discipline | B+ | Free-source boundaries and explicit missing evidence are strong; bootstrap regeneration is still partly manual. |
| Mean forecast architecture | B | Market anchor plus opportunity, health, xFP, matchup, rookie and context layers are sensible, but many effect sizes are still hand-tuned. |
| Availability / injury model | B+ | Historical status/practice calibration is materially better than a generic injury flag, but needs full walk-forward scoring. |
| Rookie treatment | B+ | Empirical cohorts, draft capital, missing-value discipline and extra uncertainty are strong; effect sizes still need multi-season OOS admission tests. |
| Forecast uncertainty / tails | C- | The form is sophisticated, but the production dispersion layer was mostly heuristic and likely too narrow. Historical realized volatility was computed but not used to calibrate forecast width. |
| Correlation model | B- | Shared game/team/player latent factors are useful and computationally efficient; factor weights are hand-set rather than historically fitted. |
| Draft simulator as a product | A- | Realistic market-driven opponents, custom boards, return probability and live helper are useful. |
| Draft strategy evidence | C | A model-internal projected-roster win rate is not evidence of real historical superiority. Historical ADP/ranking-room replay is still required. |
| Historical validation discipline | D | Unit/invariant/browser tests are strong, but an end-to-end rolling historical tournament has not yet been completed. |
| Overall analytics | **B-** | Advanced and defensible in architecture, not yet proven elite in predictive accuracy. |

The previous product language was ahead of the evidence whenever it implied universal superiority. Until walk-forward validation exists, SnapCount should be described as an advanced decision engine, not as a proven best fantasy model.

## Concrete defect found

`src/engine/intelligence.js` already calculates season-level realized fantasy-point volatility. Production used that mainly to label a player as low/medium/high risk. The forecast distribution itself relied on `projectionStdDev`, fixed position volatility constants, and hand-set epistemic/role/conflict multipliers.

That is a modeling miss: a player-specific, observable uncertainty signal existed but was not entering the uncertainty model.

The committed 2026 bootstrap also looks underdispersed compared with historical player-week outcomes. Median bootstrap `projectionStdDev / weeklyProjection` for fantasy-relevant players was approximately QB 0.259, RB 0.399, WR 0.459, TE 0.474. Historical regular-season player-week coefficient of variation is materially larger for many players, particularly quarterbacks and lower-volume players.

## Leakage-safe proxy audit

A first uncertainty audit used bundled nflverse player-week data only:

- training/calibration seasons: **2023–2024**;
- untouched evaluation season: **2025**;
- positions: QB/RB/WR/TE;
- target week uses only that player's previous games in the same season;
- proxy mean: recency-weighted prior five PPR games;
- empirical volatility: player-season CV, grouped by position and PPG band, median-shrunk toward the position distribution;
- target: 80% predictive interval coverage.

The rolling proxy produced 4,314 2025 examples before the >=2 PPG interval filter. The old fixed position-volatility prior badly under-covered the holdout in this proxy: roughly 47.6% QB, 55.4% RB, 55.4% WR and 61.7% TE versus an 80% target. The 2023–2024-derived empirical volatility prior moved coverage materially toward target in the prototype audit.

This is **not** yet a full validation of the 2026 ESPN-derived production mean projections. It is evidence specifically against the old uncertainty floor and is therefore used only to correct dispersion, not to move forecast means.

## Correction introduced

`src/engine/calibration.js` adds a deliberately conservative uncertainty layer:

1. Position + projected-PPG empirical CV floors are derived from 2023–2024 only.
2. 2025 remains a holdout in `npm run audit:model`.
3. The calibration can only widen an underdispersed player forecast; it never changes projected mean.
4. A player's realized historical CV becomes `uncertainty.volatility_cv` evidence when enough games exist.
5. Player-specific volatility can widen the cohort prior, but cannot narrow below it until that direction proves useful out of sample.
6. Roster-season, league and championship-action simulations receive the same calibrated player uncertainty as direct player forecasts.
7. The service worker caches the calibration module so the correction preserves the offline/browser-only contract.

## Admission rule from now on

No new mean correction, rookie effect, matchup coefficient, news effect, scenario-correlation factor, or draft-policy rule should be promoted because it sounds football-smart. It must beat the current model in a leakage-safe rolling evaluation on an appropriate metric and survive an ablation.

Priority validation work:

1. Build FFOB-003 into a full week-by-week forecast tournament with as-of evidence reconstruction, CRPS/quantile loss, MAE/rank error, interval calibration, lineup regret, and decision utility.
2. Refit or delete hand-tuned evidence weights based on those walk-forward results.
3. **Completed 2026-08-08:** replace hand-set scenario-correlation weights with the leakage-safe residual-pair model documented in `2026-08-08-correlation-audit.md`; keep future seasons as new holdouts rather than retuning to 2025.
4. Run FFOB-005 against historical ESPN-style ADP/ranking rooms and realized season value; stop presenting internal projected-roster advantage as proof of draft superiority.
5. Complete reproducible bootstrap generation so every production input has an explicit source/transform/as-of timestamp.

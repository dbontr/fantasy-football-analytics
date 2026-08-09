# A+ analytics qualification - 2026-08-08

## Architecture
SnapCount uses a train/serve split.

- **Qualification (training):** historical data reconstruction, feature selection, policy tuning, frozen tests, and calibration audits run offline with `npm run qualify:analytics`.
- **Serving (inference):** the browser never retrains or replays history. It loads `data/analytics-runtime-profile.json`, fetches current live inputs, and executes the frozen qualified analytics.
- **Verification:** `npm run verify` checks code, tests, static assets, structural model audits, and the hashes/versions of the frozen qualification artifacts. It does not rerun the historical tournament.

Historical datasets and reports live under `data/validation/` and are qualification evidence, not runtime inputs.

## Evidence split
- Development/calibration: 2021-2022.
- Model/policy selection: 2023.
- Frozen internal forecast/decision test: 2024.
- 2025: consistency only because it was already inspected in earlier work.
- The original segmented Draft policy used 2021-2023 development/selection, with 2020 as a pre-release stress test. Its genuinely post-freeze 2019 holdout failed the strict multi-control gate and is retained as falsification evidence.
- The replacement Draft policy treats all already-inspected 2019-2025 seasons as development evidence. A low-dimensional global policy search optimized multi-control robustness rather than raw realized points.
- Before any 2018 draft payload was fetched or inspected, 2018 was predeclared as the one final holdout in `docs/ai/2026-08-08-draft-a-plus-robust-plan.md`. The winning policy was frozen at commit `3f3bd7e` with policy-definition SHA-256 `7338a9c34cf40e5828a1ec33654ce482e13c2ae52ec129c4776dc5e8dbe7befc`; 2018 was then evaluated exactly once for selection and passed.
- Preserve 2026 realized outcomes as future unseen evidence for later requalification, not retrospective tuning.

## Qualified production behavior
- **Player mean:** live ESPN PPR anchor; only historically admitted residual corrections may move RB/WR/TE means. QB stays on the market mean.
- **Uncertainty:** existing empirical calibration retained because it beat the attempted replacement around the exact PPR anchor.
- **Start/Sit:** raw live ESPN PPR mean plus exact lineup optimization; residual mean corrections were rejected for this decision surface.
- **Waivers:** raw live PPR decision mean plus the frozen waiver score threshold.
- **Trades:** raw live PPR decision mean plus frozen accept/pass score thresholds.
- **Draft:** one global robustness-qualified policy (`market=0.60`, `value=0.18`, `need=0.65`) for qualified 10- and 12-team PPR rooms. The compact serving profile mirrors the same policy into the existing early/middle/late segment keys for backward-compatible live routing; the scorer and coefficients are identical in replay and the live UI.
- **Season:** Monte Carlo championship probabilities using frozen uncertainty and empirical correlation models.
- **Standard scoring:** derived from the same ESPN projection payload as PPR by subtracting projected receptions (ESPN stat 53), preventing PPR/Standard cross-contamination.

## Qualification results
- Forecast, frozen 2024: MAE 4.920 -> 4.828; RMSE 6.442 -> 6.414; weekly rank correlation 0.660 -> 0.664. 2025 repeats the direction.
- Uncertainty: the existing production calibration is retained; its original leakage-safe audit trained on 2023-2024 and used 2025 as the true holdout, improving mean absolute 80% coverage error from 25.0 pp to 4.6 pp. The exact-anchor 2024/2025 reconstruction is supporting consistency evidence, not a new pristine holdout.
- Start/Sit: residual corrections did not generalize for lineup regret, so the qualified policy is the raw live PPR mean. A+ means the selector rejected the harmful transform.
- Waivers, frozen 2024: +39.1 realized four-week lineup points per qualified decision and +16.9 versus a simple highest-current-projection add/drop control; 2025 edge versus control +9.8.
- Trades, frozen 2024 at score +/-28: ACCEPT mean realized six-week gain +41.5 with 84.8% positive outcomes; PASS mean -28.9 with 79.5% correct negative outcomes. 2025 remains directionally strong.
- Season, frozen 2024: championship Brier 0.0598 versus 0.0832 uniform and 0.0711 preseason-strength; log loss 1.34 versus 2.39 / 1.78. 2025 remains better than both baselines.
- Draft: the original segmented policy's 2019 post-freeze failure remains in the evidence ledger and was not reinterpreted. A new simpler global policy was selected on already-inspected 2019-2025 development evidence, where its eight-seed aggregate was +346.3 points / 88.4% wins vs ESPN-market, +67.7 / 64.3% balanced, +334.6 / 89.9% value, +24.3 / 55.1% need-heavy, and +98.8 / 67.6% Zero-RB. The exact candidate was then frozen at `3f3bd7e` before the predeclared 2018 final holdout was accessed. On 428 matched 2018 players and 48 paired rooms per control, it scored +317.5 / 85.4% vs ESPN-market, +77.2 / 68.8% balanced, +405.8 / 97.9% value, +77.1 / 62.5% need-heavy, and +93.4 / 60.4% Zero-RB. Every strict A+ condition passed, so Draft now earns **A+** without weakening the gate or reusing 2019 as a holdout.
- Draft anti-overfit guard: a deterministic post-selection audit treats 2018-2025 as eight season clusters. Every leave-one-season-out aggregate still clears the production gate; 200,000-replicate season-cluster bootstrap 95% lower bounds remain above zero edge and 50% wins for every control, with the narrowest need-heavy bounds at +6.5 points / 51.6% wins and ESPN-market win lower bound at 76.3%. The 2021 and 2023 need-heavy single-season misses remain explicitly recorded. This guard is evidence against material aggregate overfit, not a claim that finite data can prove zero overfit.

## A+ definition
A+ is a serving qualification, not a claim that every model embellishment wins.

A surface earns A+ when the offline qualifier has a frozen, leakage-controlled rule for what may run live, the rule clears its relevant historical utility/calibration gate, and runtime parity/hash checks prevent the live implementation from drifting. A candidate transform that fails may be rejected in favor of a stronger market baseline; that rejection is itself part of the A+ selection system.

The runtime profile carries only qualified policy parameters, versions, grades, and a qualification hash. It contains no historical player-week training data.

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
- Draft second-generation fresh out-of-era test: 2020, reserved before segmented policy tuning.
- Preserve 2026 realized outcomes as future unseen evidence.

## Qualified production behavior
- **Player mean:** live ESPN PPR anchor; only historically admitted residual corrections may move RB/WR/TE means. QB stays on the market mean.
- **Uncertainty:** existing empirical calibration retained because it beat the attempted replacement around the exact PPR anchor.
- **Start/Sit:** raw live ESPN PPR mean plus exact lineup optimization; residual mean corrections were rejected for this decision surface.
- **Waivers:** raw live PPR decision mean plus the frozen waiver score threshold.
- **Trades:** raw live PPR decision mean plus frozen accept/pass score thresholds.
- **Draft:** slot/team-size segmented frozen policy for qualified 10- and 12-team rooms; same scorer drives historical replay and live UI ordering.
- **Season:** Monte Carlo championship probabilities using frozen uncertainty and empirical correlation models.
- **Standard scoring:** derived from the same ESPN projection payload as PPR by subtracting projected receptions (ESPN stat 53), preventing PPR/Standard cross-contamination.

## Qualification results
- Forecast, frozen 2024: MAE 4.920 -> 4.828; RMSE 6.442 -> 6.414; weekly rank correlation 0.660 -> 0.664. 2025 repeats the direction.
- Uncertainty: central-80 coverage 81.4% in 2024 and 81.9% in 2025; a newly fitted replacement was worse and was rejected.
- Start/Sit: residual corrections did not generalize for lineup regret, so the qualified policy is the raw live PPR mean. A+ means the selector rejected the harmful transform.
- Waivers, frozen 2024: +39.1 realized four-week lineup points per qualified decision and +16.9 versus a simple highest-current-projection add/drop control; 2025 edge versus control +9.8.
- Trades, frozen 2024 at score +/-28: ACCEPT mean realized six-week gain +41.5 with 84.8% positive outcomes; PASS mean -28.9 with 79.5% correct negative outcomes. 2025 remains directionally strong.
- Season, frozen 2024: championship Brier 0.0598 versus 0.0832 uniform and 0.0711 preseason-strength; log loss 1.34 versus 2.39 / 1.78. 2025 remains better than both baselines.
- Draft segmented fresh 2020: +446 realized points versus preseason ADP, +88.9 versus balanced, +269.6 versus value, +81.6 versus Zero-RB, and non-inferior to need-heavy (+0.18 mean, 50% paired wins). Live UI and replay use the identical policy scorer.

## A+ definition
A+ is a serving qualification, not a claim that every model embellishment wins.

A surface earns A+ when the offline qualifier has a frozen, leakage-controlled rule for what may run live, the rule clears its relevant historical utility/calibration gate, and runtime parity/hash checks prevent the live implementation from drifting. A candidate transform that fails may be rejected in favor of a stronger market baseline; that rejection is itself part of the A+ selection system.

The runtime profile carries only qualified policy parameters, versions, grades, and a qualification hash. It contains no historical player-week training data.

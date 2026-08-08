# Draft A+ robustness qualification — 2026-08-08

## Goal
Replace the current A-grade Draft policy with a new policy that is materially more robust to roster-construction controls, especially need-heavy and Zero-RB, without weakening the existing A+ gate.

## Evidence discipline
- Previously inspected evidence: 2019-2025. It may be used for development, tuning, cross-validation, and robustness analysis for the new policy.
- Final holdout: **2018**, predeclared in this document before any 2018 projection/ADP/outcome payload is fetched or inspected for this attempt.
- The 2018 holdout will be evaluated exactly once after the candidate policy artifact is frozen and hashed.
- If 2018 fails, Draft remains A and no 2017/2016/etc. holdout search will be performed in this qualification attempt.
- Production remains on `28a564d` until the new policy clears all gates and live/replay parity tests.

## A+ gate
For the final 2018 paired-room holdout, across 10/12-team PPR and early/middle/late slots with common random numbers:
- non-negative mean realized starter-point edge versus ESPN-market, balanced, value, need-heavy, and Zero-RB;
- at least 50% paired wins versus every control;
- positive mean edge and at least 75% paired wins versus ESPN-market.

## Candidate design
Use only as-of draft inputs already available to the live scorer. Search a low-dimensional policy family with market, value, starter-need, and roster-depth/balance terms. Prefer a simpler shared/global policy unless segment-specific parameters materially improve leave-one-season-out robustness.## Final result
- Selected global policy: `market=0.60`, `value=0.18`, `need=0.65`; all other positional/timing constraints unchanged.
- Development evidence: 2019-2025, eight common-random seeds per segment. Aggregate edges/wins: ESPN-market +346.3 / 88.4%; balanced +67.7 / 64.3%; value +334.6 / 89.9%; need-heavy +24.3 / 55.1%; Zero-RB +98.8 / 67.6%.
- Candidate frozen before 2018 inspection at commit `3f3bd7e8885f66480caaf0f5624895e22fc3c7cc`.
- Policy-definition SHA-256: `7338a9c34cf40e5828a1ec33654ce482e13c2ae52ec129c4776dc5e8dbe7befc`.
- Before the freeze, the validation cache contained no 2018 ESPN/FantasyData Draft payload for this attempt.
- Final 2018 holdout: 428 matched players; 10/12 teams × early/middle/late × 8 seeds = 48 paired rooms per control.
- 2018 ESPN-market: +317.54 realized starter points, 85.42% wins.
- 2018 balanced: +77.21, 68.75% wins.
- 2018 value: +405.81, 97.92% wins.
- 2018 need-heavy: +77.11, 62.50% wins.
- 2018 Zero-RB: +93.39, 60.42% wins.
- Strict A+ gate: **PASS**. No older-season holdout search was needed or performed.
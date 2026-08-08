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
Use only as-of draft inputs already available to the live scorer. Search a low-dimensional policy family with market, value, starter-need, and roster-depth/balance terms. Prefer a simpler shared/global policy unless segment-specific parameters materially improve leave-one-season-out robustness.
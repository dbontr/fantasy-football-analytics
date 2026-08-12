# Draft generalization research — 2026-08-12

## Goal
Find a materially stronger Draft successor without changing the qualified serving policy or using 2018 to select/tune the successor.

## Frozen scientific boundary
- Production authority: `origin/main` at `2ef505d`.
- Serving policy stays `market=0.60`, `value=0.18`, `need=0.65` during research.
- The published 2018 benchmark and A+ holdout are consumed evidence; 2018 is excluded from candidate selection.
- Development evidence is limited to 2019–2025 and must retain adverse seasons/cells.
- No 2026 realized outcome may be inspected or used for tuning.

## Candidate family
Test only low-dimensional roster-construction timing that the original policy search did not tune: backup QB round, backup TE round, K round, and D/ST round. Keep position caps and rank/value/need coefficients fixed unless a later preregistered family is evaluated separately.

## Selection rule
Use paired common-random-number rooms. Rank candidates by aggregate multi-control qualification, then season-cell robustness. Require leave-one-season-out stability: a candidate is interesting only if it is selected or near-selected repeatedly and improves aggregate starter points without materially weakening the narrow need-heavy control.

## Promotion rule
Research may freeze a shadow successor and report 2019–2025 cross-validated evidence. It may not replace the serving champion from consumed history. If 2018 is evaluated after the candidate is frozen, that result is descriptive only and must not trigger another iteration. Prospective 2026 remains the real admission evidence.

## Frozen candidate after development screen
The 2019–2025 development screen selected exactly one candidate before any new-seed confirmation or 2018 replay:
- `secondQbRound=11`
- `secondTeRound=10`
- `kickerRound=13`
- `dstRound=14`
- all other serving Draft coefficients/caps unchanged.

## Disjoint-room confirmation
Confirm that exact candidate only; do not search alternatives. Use 8 new deterministic room seeds per 10/12-team × early/middle/late cell with the `structure-confirm-v1` seed namespace, which is disjoint from the search namespace.

Confirmation passes only if aggregate paired starter-point delta versus the champion is positive, at least 5 of 7 seasons are positive, every leave-one-season-out average delta is positive, the candidate still clears all five historical control gates, and ESPN-market win rate remains at least 75%. This confirms simulation/season robustness on consumed development outcomes; it is not a new historical holdout.

The confirmation script and this protocol must be committed before running it. No candidate change is allowed after confirmation. Any later 2018 result is descriptive only and cannot cause another iteration.

## Frozen candidate after development screen
The 2019–2025 development screen selected exactly one candidate before any new-seed confirmation or 2018 replay:
- `secondQbRound=11`
- `secondTeRound=10`
- `kickerRound=13`
- `dstRound=14`
- all other serving Draft coefficients/caps unchanged.

## Disjoint-room confirmation
Confirm that exact candidate only; do not search alternatives. Use 8 new deterministic room seeds per 10/12-team × early/middle/late cell with the `structure-confirm-v1` seed namespace, which is disjoint from the search namespace.

Confirmation passes only if aggregate paired starter-point delta versus the champion is positive, at least 5 of 7 seasons are positive, every leave-one-season-out average delta is positive, the candidate still clears all five historical control gates, and ESPN-market win rate remains at least 75%. This confirms simulation/season robustness on consumed development outcomes; it is not a new historical holdout.

The confirmation script and this protocol must be committed before running it. No candidate change is allowed after confirmation. Any later 2018 result is descriptive only and cannot cause another iteration.

# Future-win objective + opponent-aware decision plan

## Goal
Make SnapCount optimize in-season actions for the probability of winning future scheduled fantasy matchups, using the qualified player distributions rather than inventing a new projection model.

## Scientific constraints
- Do not change the frozen forecast coefficients or the qualified Draft policy on consumed historical evidence.
- Use the existing calibrated uncertainty and empirical same-game correlation model.
- Use common random numbers for action comparisons.
- Separate Monte Carlo uncertainty from model validity; 2026 remains the prospective admission evidence for new decision-policy claims.
- Preserve the existing qualified trade/waiver thresholds as guardrails while the new future-win layer is prospective.

## Phase 1 — real opponents
- Parse compact ESPN fantasy schedule pairings when present and retain a safe fallback when unavailable.
- Start connected-league simulations at the current scoring week instead of resimulating already-recorded games.
- Surface actual upcoming opponent identity wherever possible.

## Phase 2 — future matchup utility
- Add a shared-scenario evaluator for hold/trade/waiver actions.
- Rank actions primarily by expected remaining head-to-head wins / average matchup win probability.
- Apply trades symmetrically to both the user's roster and the counterparty roster.
- Use paired scenario deltas and a deterministic empirical interval to distinguish clear gains from Monte Carlo-close calls.
## Phase 3 — weekly lineup optimization
- Against a known opponent, generate multiple legal lineup candidates from forecast quantiles plus a held-out Monte Carlo candidate-generation slice.
- Evaluate candidates on disjoint paired scenarios and choose the lineup with the highest matchup win probability.
- Fall back to expected-points lineup optimization when no opponent roster is known.

## Phase 4 — product integration
- Direct trades: identify the real owner of received players, show remaining matchup-win delta, expected future wins, and opponent/title effects when available.
- Trade ideas: generate realistic packages against real connected-league opponents and rerank the strongest qualified candidates by future-win utility.
- Waivers: rerank the strongest qualified add/drop candidates by future-win utility when a league context exists.
- Season: display average future matchup win probability and use the real fantasy schedule.
- Draft: retain the frozen A+ policy; do not retroactively rewrite its objective using consumed evidence.

## Verification
- Unit tests for ESPN schedule parsing, symmetric trades, deterministic future-win evaluation, opponent-sensitive action ranking, and opponent-aware lineup selection.
- Full `npm run verify`.
- Fresh detached-checkout verification.
- Fresh local Edge QA, then public Pages QA only after deployment.
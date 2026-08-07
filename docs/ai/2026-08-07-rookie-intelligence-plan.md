# Rookie intelligence + runtime optimization plan

## Objective

Improve 2026 rookie handling without generic hype multipliers, and lower browser CPU/memory costs while preserving the zero-backend / zero-dependency deployment contract.

## Phase 1 — Reproducible rookie artifact
- Add `scripts/build-rookie-model.js`.
- Build `data/rookies-2026.json` from free/keyless structured sources: nflverse players + combine data, nflverse historical rookie outcomes, and ESPN's public structured 2026 draft JSON.
- Store only compact structured metadata/priors; no editorial analysis text.
- Historical cohort priors use 2016–2025 rookie outcomes by position and draft-capital bucket with Bayesian shrinkage.
- Derive position-specific combine athletic percentiles and empirical early/late rookie development ratios.
- Acceptance: deterministic compact artifact with source metadata and strong ESPN-ID/name coverage of bootstrap rookies.

## Phase 2 — Rookie-aware forecasting
- Add `src/engine/rookies.js` for matching, evidence construction, and rookie uncertainty.
- Merge rookie cohort, draft capital, age, combine and live depth-chart evidence through bounded families.
- Increase epistemic/role uncertainty for rookies rather than treating missing NFL history as neutral certainty.
- Let live depth/preseason information reduce uncertainty as evidence arrives.
- Keep mean corrections conservative so current market projections remain the anchor.
- Acceptance: early-pick/high-opportunity rookies differ from late/UDFA developmental profiles; all mean effects are capped and tested.

## Phase 3 — Draft intelligence + hot-path optimization
- Add a modest rookie-tail adjustment to Oracle's draft policy using empirical cohort upside, draft capital and role certainty.
- Do not change CPU opponents into rookie-aware Oracle clones; market rooms remain market-driven.
- Refactor full-room/return-window simulation to reuse drafted sets and per-team position counts instead of rebuilding them every CPU pick.
- Acceptance: same seeded room behavior where expected, deterministic outputs, and lower production benchmark latency.

## Phase 4 — Browser integration
- Load the rookie artifact with the existing bootstrap artifacts and enrich matching players locally.
- Preserve live Sleeper age/college/rookie/depth fields during status enrichment.
- Surface a compact ROOKIE marker and structured rookie context in Player Intelligence/Draft views.
- Skip meaningless prior-NFL-history work for rookies when no historical player rows can exist.
- Acceptance: rookie intelligence remains usable offline; live data only sharpens it.

## Phase 5 — Verification and publication
- Add unit tests for rookie matching/evidence/uncertainty, artifact integrity, and draft behavior.
- Extend static validation and fresh-profile browser QA.
- Benchmark draft simulation and typed-array scenario summaries before/after.
- Review diff, run `npm.cmd run verify`, run executed browser QA at desktop/mobile, then publish only if all gates remain clean.
- Record the release in the project vault and keep historical validation as the next scientific gate for increasing rookie weights.

## Implementation result

All five implementation phases are complete for the release candidate. The deployed artifact contains 74 current rookies and 1,868 historical rookie records at build time. Rookie evidence is bounded and market-anchored; missing values remain missing; live role/preseason evidence primarily reduces uncertainty. Draft opponents remain independent market/value/need policies.

Verification currently includes 46 Node tests, static deployment validation, and fresh-profile Edge QA covering veteran and rookie Player Intelligence, the realistic draft room/benchmark, lineup, waivers, trades, league simulation, and 1440/768/390 layouts with zero console errors or horizontal overflow. Final publication requires the same gates after the release commit and again against the public Pages URL.

Measured production-size improvements versus the previous published release: 500-room return window 168.1 -> 32.9 ms; 100 paired drafts 1.73 -> 0.98 s; correlated 64 x 5,000 scenarios 1.58 -> 0.59 s; correlated 64 x 10,000 3.15 -> 1.10 s.

The next scientific gate remains leakage-safe rolling historical validation. Cohort/evidence weights should not be increased merely because the rookie model is richer; they must earn additional weight out of sample.

# Accuracy + Draft Intelligence Release Plan

Date: 2026-08-07
Branch: `feature/accuracy-draft-sim`

## Goal
Increase decision accuracy and add a genuinely useful interactive draft simulator/live draft helper while preserving the zero-backend GitHub Pages contract and near-zero startup overhead.

## Constraints
- Production remains static browser JavaScript + Web Workers.
- No project-owned GitHub Actions, secrets, paid feeds, or runtime npm dependencies.
- Heavy/new datasets are on-demand and same-origin where practical.
- New signals are bounded, provenance-labeled, and confidence-decayed when they are prior-season/preseason evidence.
- ESPN-specific behavior is a preset/source, not a hard dependency.

## Phase 1 — opportunity quality + preseason/news
- Compact ffopportunity 2025 weekly xFP/FPOE into an on-demand gzip asset.
- Merge recent xFP, FPOE, receiving xFP, rushing xFP into player intelligence/evidence.
- Add optional ESPN public-web preseason boxscore adapter with strict byte/rate bounds and CORS-safe source policy.
- Add a lightweight News Pulse using structured Sleeper status/trending plus ESPN headline metadata only; no copied article bodies.
- Add conservative teammate opportunity redistribution when a material teammate is OUT/IR/PUP/suspended.

## Phase 2 — interactive draft simulator/live helper
- User controls one team and manually drafts players.
- CPU opponents use configurable strategy profiles: ESPN market ADP, balanced market, value/VORP, need-heavy, RB-heavy, WR-heavy, zero-RB, and randomized mixed-room.
- Support importing a custom ranking board (CSV/paste) so Yahoo/NFL/other broker rankings can drive opponents without scraping.
- Show Oracle recommendation, VONA, return chance, market-vs-Oracle disagreement, positional run pressure, roster needs, and pick history.
- Add a simulation benchmark comparing Oracle-controlled user drafts against ordinary market strategy across many rooms.

## Phase 3 — platform/decision semantics
- Add ESPN-oriented waiver mode: waiver priority / free agency instead of showing FAAB dollars when the league does not use FAAB.
- Preserve FAAB mode for leagues that do.
- Add scoring/roster presets while retaining editable team count, draft slot, rounds, and scoring.

## Implementation status

Phases 1-3 are implemented on this release branch. Unit/static verification, fresh-profile browser QA, live preseason/news sync, draft desktop/mobile QA, and production-size draft/xFP benchmarks are required again immediately before publication. The rolling historical validation system remains a separate scientific-validation project rather than being implied by this feature release.

## Verification
- Unit tests for xFP compaction/evidence, preseason parsing, absence redistribution, opponent draft strategies, deterministic room simulation, custom ranking import, and benchmark conservation.
- `npm.cmd run verify` after every phase.
- Fresh-profile browser QA: Player Intelligence, draft room, live helper, lineup, waivers, trades, league, desktop/mobile overflow, console errors.
- Benchmark new worker jobs and reject changes that create noticeable startup cost.

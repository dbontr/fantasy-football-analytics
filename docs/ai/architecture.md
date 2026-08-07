# Browser Engine Architecture

## Goal

Deliver the strongest practical fantasy-football decision engine that can be hosted as static GitHub Pages files and computed entirely on the user's device. Preserve the original Oracle's advanced decision concepts without carrying over its Fastify server, native C++ requirement, or background infrastructure.

## Success criteria

1. No application backend, server database, secrets, or project-owned GitHub Actions workflow.
2. Static root is directly publishable by GitHub Pages.
3. Every analytical workflow remains usable from the browser after the bootstrap assets are cached.
4. Heavy computation is isolated in Web Workers.
5. Data/network policy is machine-enforced and accepts only free/keyless sources.
6. Probability, uncertainty, provenance, and model limitations are surfaced instead of hidden.
7. The original repository remains untouched and available as the behavioral reference.

## Layers

### 1. Static bootstrap

`data/players-lite.json` is the compact player/schedule universe. Coaching and health calibration are separate small model artifacts so team-level priors are not duplicated 700 times.

### 2. Free-source adapters

`src/data/sources.js` owns the runtime allowlist, response byte limits, and adapters for Sleeper, nflverse GitHub releases, and NWS. Network enrichment is optional and never blocks startup.
### 3. Temporal evidence

`src/engine/evidence.js` stores append-only observations with observed/effective/expiry time, source reliability, confidence, freshness decay, conflict resolution, as-of replay, and SHA-256 lineage. IndexedDB persistence is local-only.

### 4. Context and calibration

`src/engine/context.js` derives calibrated availability evidence, bounded coaching effects, and explicitly low-confidence matchup proxies. Context never overrides stronger live/user evidence without passing through the same family caps.

### 5. Player distribution engine

`src/engine/runtime.js` separates active probability from conditional performance. The output includes mixture moments, P10/P25/P50/P75/P90, CVaR10, boom/bust probabilities, and aleatoric/epistemic/role/evidence-conflict uncertainty.

### 6. Correlated scenarios

Game scoring, passing, rushing, pace, team performance, game chaos, and player residual factors are deterministically sampled from a seed. Players in the same NFL game therefore share latent outcomes without requiring a huge covariance matrix.

Player simulations use `Float32Array` and are capped at 192 players × 50,000 scenarios. League simulations stream counters rather than storing all player-week-season tensors.

### 7. Decision layer

`src/engine/core.js` carries the proven deterministic combinatorial logic: exact Hungarian lineup assignment, draft modeling, waiver search, and trade package search. `runtime.js` adds correlated portfolio evaluation, expected regret, CVaR, Pareto frontiers, reversal thresholds, season simulation, and title equity.
### 8. Worker/UI boundary

`engine-worker.js` owns scenario, portfolio, season, league, trade-search, and waiver-search jobs. The UI receives compact summaries instead of raw Monte Carlo tensors except where a paired decision requires them inside the worker.

The static UI has no framework/runtime dependency. That is deliberate: initial transfer, parse cost, and failure surface are lower than a Pyodide/DuckDB/React stack for the current calculations.

## Pages deployment

The production root contains `index.html`, `.nojekyll`, immutable code/data assets, and a service worker. Pages should publish from the `main` branch repository root. The project must not add `.github/workflows`.

`npm run build` is a static contract validator rather than a bundler. It fails if required assets are absent, if the bootstrap is incomplete, if runtime dependencies are introduced, or if a workflow is added.

## Statistical discipline

- Use paired scenario seeds when comparing actions.
- Treat unavailable evidence as uncertainty, not zero effect with false confidence.
- Keep feature-family correction caps to limit double counting.
- Prefer out-of-sample calibration improvements over added model complexity.
- Preserve as-of timestamps for any future historical backtest feed.
- Do not call a proxy "tracking", "line grade", or "market" evidence when it is not one.

## Extension path

ONNX Runtime Web, DuckDB-WASM, or Rust/WASM remain optional future accelerators. They should be introduced only if measured browser workloads require them; they are not baseline dependencies today.

## Player intelligence plane

Historical weekly stats are stored as compressed nflverse CSV archives under `data/history/` and fetched on demand when Player Intelligence or a decision workflow requires recent role evidence. Decompression, selective parsing, indexing, rolling summaries, and player matching execute in the Web Worker. The worker keeps a per-season in-memory index, so subsequent player queries avoid reparsing. Recent target share may enter the forecast only as bounded, confidence-limited evidence. Structured Sleeper status is optional; if unavailable, the UI labels the fallback as bootstrap/model state rather than current news. Outlook text is generated locally from these structured inputs and does not reproduce third-party editorial analysis.

### Decision evidence fan-out

The worker can resolve history profiles for a batch of players after a season is parsed once. The UI caches those summaries by player/season and merges bounded history evidence beneath current coaching, health, matchup, and local ledger evidence. Lineup, waiver, and trade paths use the selected week's evidence-aware forecast mean; season/title simulation receives static history/health/coaching evidence without leaking a single week's matchup context across the schedule. If history loading fails, each workflow falls back to the bounded baseline and labels that fallback.

### Live status refresh

Before lineup, waiver, trade, and league decisions, the browser attempts parallel position-filtered Sleeper player refreshes for relevant offensive positions. Successful responses replace stale bootstrap injury designations with canonical live availability states and preserve practice/depth metadata. Failed requests never block the decision engine: history/baseline evidence remains usable and the UI reports a `live-status fallback` instead of implying freshness.

### Rushing workload share

The weekly-history index derives each player's carry share from total nflverse player carries for the same team, season type, season, and week. Recent three-game carry share is exposed only for RB/QB rushing-role evidence, capped to the existing `role.carry_share` family and confidence-limited before it can move a forecast. This avoids treating raw carries as equivalent across high- and low-volume team environments.

### Prior-season defense matchup model

The history index aggregates each defense's weekly fantasy points allowed to QB/RB/WR/TE, then shrinks team averages toward the league position average with a four-game prior. The resulting grade is deliberately low-confidence because personnel and scheme change across seasons. When available, this evidence replaces the older bootstrap matchup proxy for that player/week; otherwise the transparent proxy remains the fallback. League simulation accepts week-specific evidence so each scheduled opponent can receive its own prior without flattening one matchup across a season.

### Offseason role decay

Recent target/carry shares are treated as stronger evidence when history and target season match. When the latest game logs are from the prior season, their confidence is multiplied by 0.65 before entering the opportunity family. Older history decays further. The observed workload value is preserved; only confidence changes. This prevents December usage from being treated as equally fresh after an offseason with coaching, personnel, injury, and depth-chart changes.
## Accuracy intelligence release (2026-08-07)

### Expected fantasy opportunity

The worker loads a 153 KB same-origin gzip derived from ffverse/ffopportunity only when historical intelligence is needed. It carries weekly expected fantasy points (xFP), component rushing/receiving/passing xFP, actual fantasy points, and FPOE for QB/RB/WR/TE. One-season-old xFP/FPOE is confidence-decayed before entering the existing opportunity/efficiency family caps; the observed value is not altered.

### Preseason + change intelligence

ESPN public keyless NFL web JSON is an optional runtime adapter for preseason boxscores and headline metadata. Preseason evidence is positive-only, aggressively downweighted for established high-ranked players, and capped below normal in-season role evidence. The application stores headline/link/time/player/team metadata only and does not ingest article bodies. Sleeper 24-hour add/drop momentum is a low-confidence change signal, not a projection on its own.
### Absence redistribution

Structured teammate OUT/IR/PUP/suspension states expose vacated target/carry share. Remaining teammates receive a conservative proportional redistribution prior capped at 22% relative role growth with 0.42 confidence and explicit conflict. It is intentionally weaker than actual observed usage after the injury.

### Live game environment

For a requested regular-season week, the browser can load ESPN's public scoreboard once and cache it. Game total and team implied points become bounded market evidence with confidence below 0.5. Weekly Player Lab/lineup/waiver/trade decisions may use this live environment; league simulation uses cached week-specific values only and does not fire seventeen network requests.

### Draft room architecture

src/engine/draft-sim.js precomputes a room context (normalized players, replacement levels, market ranks and asset values) once. CPU opponents then sample deterministic seeded decisions from selectable market/value/need/positional profiles. A custom rank/name board can replace the committed ESPN-derived market ordering for Yahoo/NFL/other-room simulation without scraping. The live helper never fabricates real opponent picks: the user records them and Oracle recalculates from the exact board state. Return-probability simulation uses the same opponent strategy and custom market board as the room.

The paired strategy benchmark reuses one room context and common seeds to compare Oracle's policy against an ordinary baseline over many rooms. Its output is a diagnostic in projected starter-season points, not a claim of realized wins.

## Rookie intelligence plane (2026-08-07)

The offline rookie plane is deliberately a prior-and-uncertainty system rather than a rookie hype multiplier. A manual build script joins the 2026 fantasy universe to nflverse identity/birth/college/combine data, ESPN's public structured draft round/pick/grade/rank fields, and 2016-2025 nflverse rookie outcomes. The deployed artifact contains only the 74 fantasy-relevant current rookies plus compact cohort priors; historical rows remain build-time inputs.

Historical outcomes are stratified by QB/RB/WR/TE and draft-capital bucket. Non-producing rookies, including developmental UDFAs present in nflverse player data, remain in the cohort at zero production instead of being dropped. Drafted buckets shrink toward the drafted-player position baseline; UDFAs shrink toward the full rookie population. This reduces survivorship bias and prevents the much larger UDFA population from dominating early-round priors.

At runtime, rookie cohort PPG, draft capital, structured prospect grade/rank, age, available position-relative combine context, live Sleeper depth chart, preseason usage, and a weak empirical season-development curve enter a dedicated capped evidence family. Missing combine/college/NFL-history data stays missing and increases uncertainty rather than becoming a zero-valued penalty. Market projection remains the anchor. Live depth/preseason evidence can narrow rookie role uncertainty but cannot remove it entirely.

Rookies skip prior-season individual NFL-history fetches because those rows cannot exist. Player Intelligence explicitly renders a rookie profile/no-prior-NFL-history state instead of presenting empty veteran rolling-form tables.

## 2026.4 compute hot paths

Draft rooms maintain a reusable tracker containing drafted IDs and per-team position counts. CPU picks, full drafts, and return-window Monte Carlo update that tracker incrementally instead of repeatedly rebuilding sets/rosters from pick history. Oracle's own policy may apply the capped rookie-tail term; CPU market/value/need profiles do not, preserving the purpose of the comparison room.

The correlated scenario engine now indexes unique NFL games and teams before simulation. On each scenario it generates each game-scoring/passing/rushing/pace/chaos factor and each team-performance factor once, then reuses those values across all players sharing the latent. Availability and residual draws stay player-specific. This preserves the factor model while cutting repeated hash/normal generation. Typed-array summaries and one-pass correlation statistics reduce temporary allocations further.

The browser UI maintains an ID-to-player Map after bootstrap and each live status enrichment, replacing repeated linear scans across the 700-player universe in draft/roster/status operations.

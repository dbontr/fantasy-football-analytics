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

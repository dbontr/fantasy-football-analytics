# Fantasy Football Oracle — Browser Engine

A separate browser-native implementation of the Fantasy Football Oracle designed to run as a static GitHub Pages application with **no application server, no database server, no custom GitHub Actions workflow, no API keys, and zero runtime npm dependencies**.

The original `fantasy-football-oracle` repository remains the feature/behavior reference. This repository preserves its strongest decision logic while moving probabilistic forecasting, correlated Monte Carlo, evidence resolution, roster optimization, and league simulation into the browser.

## Deployment contract

- Static files are served from the repository root.
- `.nojekyll` keeps the Pages artifact as authored.
- Every production calculation runs in JavaScript/Web Workers on the client.
- IndexedDB stores local roster/evidence/calibration state.
- Remote data enrichment is optional; the committed bootstrap is usable offline.
- Runtime network access is restricted to allowlisted free/keyless HTTPS sources.
- `.github/workflows` must remain absent; `npm run build` fails if workflows are added.
- GitHub Actions is disabled in repository settings; branch-based Pages publishes the committed static root with `.nojekyll`.

Production Pages site: <https://dbontr.github.io/fantasy-football-analytics/>

## What is implemented

- 700-player compact 2026 bootstrap with 18-week projections and schedule context.
- Historical opportunity regression signals and role stability.
- Zero-inflated player distributions: availability + active-game performance.
- P10/P25/P50/P75/P90, CVaR10, boom/bust probability, and uncertainty decomposition.
- Bounded health, coaching, role, weather, matchup, line, news, and market evidence families.
- Correlated game/team/player Monte Carlo with deterministic paired scenarios.
- Exact lineup assignment across normal, FLEX, and SUPERFLEX slots.
- Draft VONA, replacement value, return probability, run pressure, and opponent-aware picks.
- Waiver add/drop search with bounded FAAB ranges.
- Bilateral trade package search through 2-for-2 combinations.
- Full fantasy-league regular season, seeds, playoff byes, brackets, and title probability.
- Robust action ranking with CVaR, expected regret, probability-best, Pareto frontiers, and reversal thresholds.
- Temporal evidence ledger with effective/expiry timestamps, freshness decay, conflict resolution, as-of replay, and a SHA-256 chain.
- Historical nflverse health calibration and 32-team coaching priors.
- On-demand actual 2023-2025 nflverse weekly game logs with rolling PPR, opportunity, target-share, derived team carry-share, volatility, trend, and position-specific defense-allowed priors.
- Evidence-backed Oracle Outlook generated locally from forecasts, game logs, and available structured Sleeper injury/practice/depth data; no copied editorial blurbs.
- Shared history-aware decision evidence now feeds lineup optimization, waiver add/drop search, bilateral trades, and league/title simulation.
- Decision workflows automatically attempt position-filtered Sleeper health/status refreshes; active reports clear stale bootstrap injury labels and any network failure is surfaced as a live-status fallback.
- Lightweight matchup context derived from the free bootstrap universe and clearly marked as a proxy.
- Online exponentiated-loss ensemble reweighting stored locally.
- Sleeper league import/status enrichment, generic nflverse release asset loading, and NWS forecast adapters.
- Offline service-worker cache and responsive decision-room UI.

## Architecture

```text
static bootstrap + optional free sources
               |
               v
       temporal evidence
               |
      context + calibration
               |
     player distributions
               |
   correlated scenario engine  <---- Web Worker
               |
  exact roster decision logic
               |
 season / playoff / title equity
               |
        browser-only UI
```

Heavy scenario work is moved off the UI thread. Player samples use `Float32Array`; league simulations stream standings/title counters instead of retaining entire season tensors. The scenario engine caps one player scenario run at 192 players × 50,000 simulations.
## Data provenance

The bootstrap is intentionally explicit about provenance instead of pretending every field comes from one feed:

- `data/players-lite.json`: compacted from the prior Oracle's 2026 public ESPN fantasy player/schedule snapshot, merged with nflverse-derived opportunity profiles. ESPN is **not** a live runtime adapter in this repo.
- `data/health-calibration-2026.json`: historical nflverse official injury/practice reports joined to nflverse weekly player outcomes with leakage controls recorded in the artifact metadata.
- `data/history/stats_player_week_2023.csv.gz` through `2025.csv.gz`: compressed nflverse weekly player statistics, loaded on demand and never included in initial-page precache.
- `data/coaches-2026.json`: 32-team Bayesian-shrunk Oracle coaching priors; staff provenance/methodology and verification date are recorded in the artifact metadata.
- Live runtime allowlist: Sleeper public read-only API, nflverse GitHub releases, and NOAA/NWS.

The runtime source policy rejects arbitrary origins, credential-bearing URLs, and secret-like query parameters. No paid fallback exists.

## Local development

Requires Node 20+ only for tests/dev serving; the deployed application itself has no Node requirement.

```powershell
npm.cmd run verify
npm.cmd run serve
```

Open `http://127.0.0.1:4173/` (or set `PORT` if that port is occupied).

For the reproducible Edge integration QA, start Edge with a DevTools port and run `node scripts/browser-qa.js`. The script exercises player Monte Carlo, player intelligence, history-aware lineup/waiver/trade decisions, league simulation, desktop/mobile overflow, and browser console errors.

## GitHub Pages

This repository is designed for branch-based Pages publishing from the repository root. Updating the site is intentionally manual: edit locally, run `npm.cmd run verify`, commit, and push. No project-owned Actions workflow is required.
## Deliberate limits

This project does not fabricate precision when free evidence is unavailable. Route participation/TPRR, detailed red-zone role, offensive-line grades, true tracking data, and betting-market residuals are treated as optional future evidence families unless a defensible free/keyless source is available.

The browser simulator is a lightweight statistical approximation, not a literal NFL play-by-play physics engine. Its value comes from calibrated distributions, correlated scenarios, exact fantasy decision logic, paired comparisons, and transparent uncertainty. New model complexity should be accepted only when it improves rolling historical validation.

See `docs/ai/architecture.md`, `docs/ai/feature-parity.md`, and `docs/ai/performance.md` for implementation boundaries, migration decisions, and measured runtime performance.

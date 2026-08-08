# SnapCount Fantasy Football

SnapCount is a user-first fantasy football decision app for people who want a clear answer without needing to understand fantasy analytics. The interface focuses on the jobs users actually have: **draft well, set the right lineup, judge trades, find waiver pickups, and understand a player**. The advanced forecasting and simulation stack stays under the hood.

The application is still fully browser-native: static GitHub Pages, **no application server, no database server, no custom GitHub Actions workflow, no API keys, and zero runtime npm dependencies**. The original `fantasy-football-oracle` repository remains the feature/behavior reference.

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

## User experience

The product intentionally hides research terminology by default. The seven user-facing areas are **Home, Draft, Start / Sit, Trades, Waivers, Players, and Season**. Home is league-first: an ESPN Fantasy league link or ID can populate the user's roster and league context through an anonymous read when available or an explicit browser-session fallback for private leagues, then SnapCount presents direct shortcuts for the week's lineup, waivers, trades, and season outlook. Draft includes the SnapCount Big Board, mock draft, and manual live-draft helper; Trades includes a direct give/get analyzer; detailed distributions, model diagnostics, and custom what-if controls are kept behind optional disclosures when they are useful.

The visual system is a high-contrast sports-editorial theme: warm cream canvas, midnight structure, cobalt actions, orange highlights, hard scorecard borders, and an ESPN-red provider badge only where ESPN is involved. SnapCount never asks for ESPN passwords, SWID/`espn_s2` values, or cookie values. Anonymous ESPN access is attempted first; for a private league the user can explicitly opt into a direct browser-session request. In that mode the browser sends its existing ESPN session straight to ESPN, while SnapCount cannot read or persist the cookie itself.

## What is implemented

- 700-player compact 2026 bootstrap with 18-week projections and schedule context.
- Historical opportunity regression signals and role stability.
- Zero-inflated player distributions: availability + active-game performance.
- P10/P25/P50/P75/P90, CVaR10, boom/bust probability, and uncertainty decomposition.
- Bounded health, coaching, role, weather, matchup, line, news, and market evidence families.
- Correlated game/team/player Monte Carlo with deterministic paired scenarios and per-scenario shared-factor caching so game/team latents are generated once and reused across players.
- Exact lineup assignment across normal, FLEX, and SUPERFLEX slots.
- ESPN Fantasy league sync: URL/ID parsing, anonymous-first access, explicit direct browser-session fallback for private leagues, team selection, roster/record/current-week import, local persistence, one-click refresh/disconnect, and automatic Start / Sit + Season population. SnapCount never accepts raw ESPN credential values.
- Interactive draft simulator + live draft helper: the user controls one team while CPU opponents use configurable market/value/need/positional strategies.
- Draft VONA, replacement value, strategy-aware return probability, run pressure, market disagreement, custom external ranking-board import, and paired SnapCount-vs-market strategy benchmarks.
- Waiver add/drop search with ESPN-style waiver-priority/free-agency recommendations by default and bounded FAAB ranges only when FAAB mode is selected.
- Bilateral trade package search through 2-for-2 combinations.
- Full fantasy-league regular season, seeds, playoff byes, brackets, and title probability.
- Robust action ranking with CVaR, expected regret, probability-best, Pareto frontiers, and reversal thresholds.
- Temporal evidence ledger with effective/expiry timestamps, freshness decay, conflict resolution, as-of replay, and a SHA-256 chain.
- Historical nflverse health calibration and 32-team coaching priors.
- On-demand actual 2023-2025 nflverse weekly game logs with rolling PPR, opportunity, target-share, derived team carry-share, volatility, trend, and position-specific defense-allowed priors.
- On-demand ffopportunity expected-fantasy-points (xFP) and FPOE evidence, confidence-decayed across the offseason.
- Rookie-specific 2026 intelligence for 74 fantasy-relevant rookies: 2016-2025 draft-capital cohorts, age, structured draft grade/rank, position-relative combine context, live depth chart, preseason usage, week-progressive development priors, and explicitly wider uncertainty when NFL evidence is sparse.
- Rookie cohorts include non-producing developmental/UDFAs rather than conditioning on players who logged stats; drafted buckets shrink toward a drafted-player baseline to reduce survivorship and population-mix bias.
- SnapCount draft recommendations can use a small capped rookie-upside/tail term, while simulated market opponents remain driven by the selected market/value/need strategy rather than the SnapCount rookie model.
- Optional live 2026 preseason boxscore usage, ESPN headline metadata, Sleeper add/drop momentum, and current game scoring-environment priors; all enter forecasts through bounded evidence families.
- Conservative teammate-absence redistribution estimates vacated target/carry opportunity without treating it as guaranteed usage.
- Evidence-backed player outlook generated locally from forecasts, game logs, and available structured Sleeper injury/practice/depth data; no copied editorial blurbs or article bodies.
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

- `data/players-lite.json`: compacted from the prior reference engine's 2026 public ESPN fantasy player/schedule snapshot, merged with nflverse-derived opportunity profiles. It remains the offline baseline even when live adapters are unavailable.
- `data/health-calibration-2026.json`: historical nflverse official injury/practice reports joined to nflverse weekly player outcomes with leakage controls recorded in the artifact metadata.
- `data/history/stats_player_week_2023.csv.gz` through `2025.csv.gz`: compressed nflverse weekly player statistics, loaded on demand and never included in initial-page precache.
- `data/coaches-2026.json`: 32-team Bayesian-shrunk coaching priors; staff provenance/methodology and verification date are recorded in the artifact metadata.
- `data/intelligence/xfp_weekly_2025.csv.gz`: 153 KB compact ffopportunity expected-fantasy-points artifact (CC BY-SA 4.0), loaded only with player/decision intelligence.
- `data/rookies-2026.json`: ~47 KB offline rookie artifact covering 74 players. It is reproducibly built from nflverse player/combine/stat data plus ESPN's public structured 2026 draft metadata; the build uses 1,868 historical rookie records and ships only compact priors/current-player metadata.
- Live runtime allowlist: Sleeper public read-only API, nflverse GitHub releases, ESPN public keyless NFL web JSON, ESPN Fantasy league reads, and NOAA/NWS. ESPN terms apply to ESPN-sourced metadata.

The runtime source policy rejects arbitrary origins, credential-bearing URLs, and secret-like query parameters. No paid fallback exists. ESPN Fantasy is the sole adapter allowed to opt into `credentials: include`, and only after the user chooses the browser-session fallback. Those credentials are managed by the browser and sent directly to ESPN; SnapCount never receives or stores their values.

## Local development

Requires Node 20+ only for tests/dev serving; the deployed application itself has no Node requirement.

```powershell
npm.cmd run verify
npm.cmd run refresh:rookies   # manual reproducible rookie-artifact refresh
npm.cmd run serve
```

Open `http://127.0.0.1:4173/` (or set `PORT` if that port is occupied).

For the reproducible Edge integration QA, start Edge with a DevTools port and run `node scripts/browser-qa.js`. The script uses a deterministic mocked private ESPN league to exercise anonymous rejection, the explicit browser-session fallback, team selection, roster/week population and the connected home state, then covers player Monte Carlo, veteran xFP/history intelligence, a no-prior-NFL-history rookie path, preseason/news sync, realistic draft-room simulation + strategy benchmark, ESPN-style waivers, lineup/trades/league simulation, and desktop/tablet/phone layouts while checking browser console errors and overflow.

## GitHub Pages

This repository is designed for branch-based Pages publishing from the repository root. Updating the site is intentionally manual: edit locally, run `npm.cmd run verify`, commit, and push. No project-owned Actions workflow is required.
## Deliberate limits

This project does not fabricate precision when free evidence is unavailable. Route participation/TPRR, detailed red-zone role, offensive-line grades, true tracking data, premium prop feeds, and private-platform activity are treated as optional future evidence families unless a defensible free/keyless source is available. Public game totals/spreads are used only as a low-confidence fantasy scoring-environment prior, not as betting advice.

The browser simulator is a lightweight statistical approximation, not a literal NFL play-by-play physics engine. Its value comes from calibrated distributions, correlated scenarios, exact fantasy decision logic, paired comparisons, and transparent uncertainty. New model complexity should be accepted only when it improves rolling historical validation.

See `docs/ai/architecture.md`, `docs/ai/feature-parity.md`, and `docs/ai/performance.md` for implementation boundaries, migration decisions, and measured runtime performance.

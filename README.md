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

The interface uses a major-sports-site fantasy-desk layout rather than a boutique app shell. A two-row masthead keeps league/team/week context visible across every tool. Home is a real editorial dashboard: a main weekly-decision feed, connected-league command strip and ESPN module on the left, with Quick Tools and league context in a sticky right rail. On phones that collapses into one feed and the connected actions become a visible 2x2 grid. Technical runtime/data details are intentionally moved behind a disclosure. The visual system remains cool light gray, white editorial modules, near-black navigation and strong sports-red actions without copying ESPN's logo or exact interface. SnapCount never asks for ESPN passwords, SWID/`espn_s2` values, or cookie values. Anonymous ESPN access is attempted first; for a private league the user can explicitly opt into a direct browser-session request. In that mode the browser sends its existing ESPN session straight to ESPN, while SnapCount cannot read or persist the cookie itself.

## What is implemented

- 700-player compact 2026 bootstrap with 18-week projections and schedule context.
- Historical opportunity regression signals and role stability.
- Zero-inflated player distributions: availability + active-game performance.
- P10/P25/P50/P75/P90, CVaR10, boom/bust probability, and uncertainty decomposition.
- Bounded health, coaching, role, weather, matchup, line, news, and market evidence families.
- Empirically calibrated same-game Monte Carlo: QB/RB/WR/TE residual correlations are fitted on 2023-2024 player-week history, with shrinkage selected by bidirectional 2023↔2024 cross-validation; 2025 is retained only as a consistency check because its pair structure had already been inspected during the audit.
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
- Preseason/camp intelligence separates actual preseason boxscore opportunity, team-position opportunity share, reporter-observed first-team reps when explicitly stated, role changes, performance reports, availability, live ESPN ADP/ownership metadata, and Sleeper add/drop momentum. Camp text is classified conservatively and remains advisory-only; it cannot change the frozen projection mean or qualified Draft ranking until prospective validation admits an effect.
- Conservative teammate-absence redistribution estimates vacated target/carry opportunity without treating it as guaranteed usage.
- Evidence-backed player outlook generated locally from forecasts, game logs, and available structured Sleeper injury/practice/depth data; no copied editorial blurbs or article bodies.
- Shared history-aware decision evidence now feeds lineup optimization, waiver add/drop search, bilateral trades, and league/title simulation.
- Decision workflows automatically attempt position-filtered Sleeper health/status refreshes; active reports clear stale bootstrap injury labels and any network failure is surfaced as a live-status fallback.
- Lightweight matchup context derived from the free bootstrap universe and clearly marked as a proxy.
- Online exponentiated-loss ensemble reweighting stored locally.
- Sleeper league import/status enrichment, generic nflverse release asset loading, and NWS forecast adapters.
- Offline service-worker cache and responsive decision-room UI.

## Architecture

SnapCount separates analytics **qualification** from live **serving**, analogous to training a model once and then running inference many times. Historical reconstruction, feature/policy selection, calibration checks, and frozen tests run only in the offline qualification command. That command writes a compact `data/analytics-runtime-profile.json`. Normal browser sessions load that frozen profile and current live inputs; they do not refit coefficients, tune thresholds, or replay history.

```text
offline historical sources
        |
        v
qualify:analytics (training / frozen tests)
        |
        v
analytics-runtime-profile.json
        |
        +-------------------------------+
                                        v
                         live ESPN + free current inputs
                                        |
                                        v
                              temporal evidence
                                        |
                             frozen qualified policy
                                        |
                           player distributions / decisions
                                        |
                       correlated scenario engine <--- Worker
                                        |
                              browser-only UI
```

`npm run verify` checks code/tests/static assets plus the hashes and versions of the already-qualified profile. Full `qualify:analytics` is currently locked before doing any rebuild: the existing 2024/2025 forecast evaluation evidence is consumed and the exact pre-fit forecast input snapshot was not preserved, so a successor must be frozen with an exact input hash and then judged on genuinely prospective 2026 evidence before serving coefficients can change.

The current `snapcount-runtime-profile-2026.5` records **A+ for every decision/accuracy serving surface, including Draft, and A for training provenance**. The provenance downgrade is deliberate: the frozen coefficients match the stored qualification report, but that report predates the final committed historical artifact and cannot be recreated exactly from it. The original segmented Draft policy remains historical falsification evidence: its genuinely post-freeze 2019 replay failed against need-heavy and Zero-RB. SnapCount then treated 2019-2025 as inspected development evidence, selected a simpler global robustness-first policy (`market=0.60`, `value=0.18`, `need=0.65`), froze that exact policy at commit `3f3bd7e` before accessing a predeclared 2018 final holdout, and evaluated 2018 once. The frozen candidate cleared every strict control gate on 48 paired rooms per control: +317.5 realized starter points / 85.4% wins vs ESPN-market, +77.2 / 68.8% vs balanced, +405.8 / 97.9% vs value, +77.1 / 62.5% vs need-heavy, and +93.4 / 60.4% vs Zero-RB. A deterministic post-selection robustness guard now also evaluates 2018-2025 at the **season** level: every one-season jackknife still clears the production gate, and 200,000-replicate season-cluster bootstrap lower bounds remain positive for every control (the narrowest is need-heavy at +6.5 points / 51.6% wins; ESPN-market win lower bound 76.3%). The two real single-season need-heavy misses in 2021 and 2023 remain recorded rather than hidden. This is strong evidence against material aggregate overfit, not a claim that finite historical data can prove zero overfit. The serving profile hashes this audit together with the candidate, development artifact, and 2018 holdout before accepting Draft A+.

Heavy scenario work is moved off the UI thread. Player samples use `Float32Array`; league simulations stream standings/title counters instead of retaining entire season tensors. The scenario engine caps one player scenario run at 192 players × 50,000 simulations.
## Data provenance

The bootstrap is intentionally explicit about provenance instead of pretending every field comes from one feed:

- `data/players-lite.json`: committed 2026 ESPN PPR fallback refreshed from league-default 3, merged with nflverse-derived opportunity/snap-share priors. The same ESPN payload carries a derived Standard projection family (`PPR - projected receptions`) so Standard drafts do not reuse PPR point values.
- `data/analytics-runtime-profile.json`: compact frozen serving artifact generated only after offline qualification. It contains admitted policy parameters/versions/grades and a qualification hash, not historical player-week training data.
- `data/validation/`: offline-only qualification snapshots and audit reports. These files are not loaded or precached by the deployed app.
- `data/health-calibration-2026.json`: historical nflverse official injury/practice reports joined to nflverse weekly player outcomes with leakage controls recorded in the artifact metadata.
- `data/history/stats_player_week_2023.csv.gz` through `2025.csv.gz`: compressed nflverse weekly player statistics, loaded on demand and never included in initial-page precache.
- `data/coaches-2026.json`: 32-team Bayesian-shrunk coaching priors; staff provenance/methodology and verification date are recorded in the artifact metadata.
- `data/intelligence/xfp_weekly_2025.csv.gz`: 153 KB compact ffopportunity expected-fantasy-points artifact (CC BY-SA 4.0), loaded only with player/decision intelligence.
- `data/rookies-2026.json`: ~47 KB offline rookie artifact covering 74 players. It is reproducibly built from nflverse player/combine/stat data plus ESPN's public structured 2026 draft metadata; the build uses 1,868 historical rookie records and ships only compact priors/current-player metadata.
- `data/camp-2026.json`: compact current training-camp signal artifact derived offline from ESPN public camp reports. Raw article bodies are not persisted; only player attribution, role/performance/availability classifications, explicit reported first-team snap counts when extractable, confidence/conflict, and source hashes remain. Every row is `advisory-only`.
- `data/forward/`: append-only prospective 2026 input freezes. Snapshots preserve the live ESPN PPR baseline and market metadata, camp signals, public-news classifications, Sleeper movement, and preseason usage before future regular-season outcomes are attached.
- Live runtime allowlist: Sleeper public read-only API, nflverse GitHub releases, ESPN public keyless NFL web JSON, ESPN Fantasy league reads, and NOAA/NWS. ESPN terms apply to ESPN-sourced metadata.

The runtime source policy rejects arbitrary origins, credential-bearing URLs, and secret-like query parameters. No paid fallback exists. ESPN Fantasy is the sole adapter allowed to opt into `credentials: include`, and only after the user chooses the browser-session fallback. Those credentials are managed by the browser and sent directly to ESPN; SnapCount never receives or stores their values.

## Local development

Requires Node 20+ only for tests/dev serving; the deployed application itself has no Node requirement.

```powershell
npm.cmd run verify              # fast release/runtime integrity; no historical retraining
npm.cmd run qualify:analytics   # intentionally locked until a prospective 2026 successor cycle exists
npm.cmd run audit:forecast      # verify frozen forecast provenance guard
npm.cmd run audit:forecast:refit # research-only legacy refit; must not silently replace serving coefficients
npm.cmd run refresh:ppr         # refresh committed PPR + derived Standard fallback
npm.cmd run refresh:rookies     # manual reproducible rookie-artifact refresh
npm.cmd run refresh:camp        # refresh compact advisory camp intelligence
npm.cmd run capture:forward     # append a prospective 2026 input snapshot
npm.cmd run serve
```

Open `http://127.0.0.1:4173/` (or set `PORT` if that port is occupied).

For the reproducible Edge integration QA, start Edge with a DevTools port and run `node scripts/browser-qa.js`. The script uses a deterministic mocked private ESPN league to exercise anonymous rejection, the explicit browser-session fallback, team selection, roster/week population and the connected home state, then covers player Monte Carlo, veteran xFP/history intelligence, a no-prior-NFL-history rookie path, preseason/news sync, realistic draft-room simulation + strategy benchmark, ESPN-style waivers, lineup/trades/league simulation, and desktop/tablet/phone layouts while checking browser console errors and overflow.

## GitHub Pages

This repository is designed for branch-based Pages publishing from the repository root. Updating the site is intentionally manual: edit locally, run `npm.cmd run verify`, commit, and push. No project-owned Actions workflow is required.
## Deliberate limits

This project does not fabricate precision when free evidence is unavailable. Route participation/TPRR, detailed red-zone role, offensive-line grades, true tracking data, premium prop feeds, and private-platform activity are treated as optional future evidence families unless a defensible free/keyless source is available. Public game totals/spreads are used only as a low-confidence fantasy scoring-environment prior, not as betting advice.

The browser simulator is a lightweight statistical approximation, not a literal NFL play-by-play physics engine. Its value comes from calibrated distributions, empirically constrained correlated scenarios, exact fantasy decision logic, paired comparisons, and transparent uncertainty. The fitted residual-correlation layer currently covers QB/RB/WR/TE only; K/DST residual dependence stays independent rather than receiving invented precision. New model complexity should be accepted only when it improves rolling historical validation.

See `docs/ai/architecture.md`, `docs/ai/feature-parity.md`, and `docs/ai/performance.md` for implementation boundaries, migration decisions, and measured runtime performance.

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

SnapCount is public-first and uses a **single persistent sidebar** for the whole product. There is no separate global icon rail. League Sync is docked at the bottom of the sidebar, where it stays out of the way until needed. Before sync, the navigation contains only the basic public tools. After an ESPN league and team are connected, the same navigation upgrades in place: Mock Draft becomes Draft Assistant, Trade Analyzer opens league impact by default, and My Team, Start / Sit, Trade Ideas, Waiver Wire, and Season Outlook appear in their natural sections instead of being appended as a second locked menu. The connected league ID/team selection and personal player outlooks persist locally on the device.

Trade analysis is explicitly split instead of silently changing behavior after sync. **Basic Trade Value** always performs a league-independent worth-to-worth package comparison over the full player pool. **Advanced Trade Lab** requires League Sync, constrains players to real rosters, models roster fit and transaction state, and can simulate future head-to-head wins and league equity. Team A can be the user or another manager, so a trade between two other teams can be modeled from the user's perspective to show changes to future matchups and season equity.

My Outlooks lets a user record a bounded personal view — Super high, Positive, Somewhat positive, Neutral, Somewhat negative, Negative, or Unknown. **Unknown is distinct from Neutral**: Unknown means no opinion has been expressed, while Neutral is an explicit reviewed choice. Outlooks are persisted locally and use a timing-aware preference window: a positive opinion is dormant when a player is still well ahead of his market range, then ramps in as the draft approaches him. Even Super high is capped below a full-round move and cannot bypass the qualified policy's roster/position eligibility gates. Negative outlooks work symmetrically in reverse.

Mock Draft remains a public tool with a default 12-team PPR setup, a persistent team-by-team room board, and strategy-aware recommendations. My League Draft Center offers Live Draft Assistant or a league-prefilled launch into the same Mock Draft simulator. The Home page now exposes a descriptive big-platform historical benchmark on the frozen 2018 holdout using ESPN ADP plus archived Yahoo, CBS Sports, NFL.com, and FantasyPros ECR draft boards. All rows use the same paired draft rooms and realized outcomes; only the user-side board changes. Source dates are shown because the archived platform boards were not all captured on the same day, and the chart remains retrospective evidence rather than a future-performance guarantee.

The UI uses one dark-navy sidebar, a lightweight utility header, and a single shared component system across every workflow: 12px controls, 18px cards, 22px major panels, a light-blue atmospheric canvas, soft-blue control surfaces, small yellow accents, restrained shadows, and progressive disclosure. My Team no longer duplicates tool navigation, and Trade Ideas is a standalone league-only page rather than a Home/My Team shortcut. Browser QA audits every major page for legacy sharp card surfaces and retired theme colors, alongside desktop/tablet/mobile overflow checks. Technical/model controls remain secondary. Play-caller identity and offensive tendency metadata are retained explicitly in coaching context, and Player Analysis now exposes the tracked passing ecosystem; direct unvalidated mean effects remain disabled until they earn their own prospective validation gate.

## What is implemented

- 700-player compact 2026 bootstrap with 18-week projections and schedule context.
- Historical opportunity regression signals and role stability.
- Zero-inflated player distributions: availability + active-game performance.
- P10/P25/P50/P75/P90, CVaR10, boom/bust probability, and uncertainty decomposition.
- Bounded health, coaching, role, weather, matchup, line, news, and market evidence families; coaching context explicitly retains the named offensive play caller, coordinator, scheme, and tendencies without granting an unvalidated direct mean effect.
- Passing interaction context tracks the primary QB, target-share/snap-share pecking order, top-target concentration, teammate absences, and QB replacement alongside the existing QB/receiver same-game correlation model. The directed QB-to-specific-receiver pair effect is tracked as context rather than granted an unvalidated mean adjustment.
- K and D/ST are full ranking/draft positions with projections, market price, replacement value, weather/environment context, and late-round roster policy. A committed 2023–2025 nflverse play-by-play profile now measures team/head-coach fourth-down go/FG/punt rates, kickable-drive and red-zone stall outcomes, kicker makes/attempts by distance including 50–59 and 60+, and D/ST sacks/QB hits/takeaways paired with opponent protection/turnover vulnerability. Those new interaction families are retained as context-only until a separate walk-forward admission audit proves they improve forecasts; special-teams personnel continuity remains unmeasured.
- Empirically calibrated same-game Monte Carlo: QB/RB/WR/TE residual correlations are fitted on 2023-2024 player-week history, with shrinkage selected by bidirectional 2023↔2024 cross-validation; 2025 is retained only as a consistency check because its pair structure had already been inspected during the audit.
- Exact lineup assignment across normal, FLEX, and SUPERFLEX slots.
- ESPN-backed My League profiles: ESPN connection + team selection is the required entry gate. Supported team count, PPR/Half-PPR/Standard scoring, lineup slots, roster, schedule, and league state are imported first; manual scoring/slot controls remain available afterward as explicit overrides. Unsupported IDP or known custom offensive scoring is flagged instead of silently approximated.
- ESPN Fantasy league sync: URL/ID parsing, anonymous-first access, explicit direct browser-session fallback for private leagues, team selection, roster/record/current-week/schedule import, supported league-rule autofill, local persistence, one-click refresh/disconnect, and automatic Start / Sit + Season population. SnapCount never accepts raw ESPN credential values.
- Public Mock Draft + My League Draft Center: the public simulator defaults to 12-team PPR, works without ESPN, shows a complete team-by-team room board, and animates CPU selections between user turns. My League offers a separate Live Draft Assistant that records the actual room from any platform, never invents opponent picks, and reruns the qualified strategy after every pick using roster construction, market/value, VONA/wait cost, return probability, and observed positional runs. Its Mock Draft action routes to the normal simulator with the connected ESPN format prefilled. PPR 10/12-team standard-lineup Draft remains the A+-qualified scope; Half-PPR, Standard, Superflex, 2QB, other team counts, and custom slot structures are usable transfer-policy modes until separately qualified.
- Draft VONA, replacement value, strategy-aware return probability, run pressure, market disagreement, custom external ranking-board import, a persistent bounded My Outlooks overlay, and paired SnapCount-vs-market/site historical benchmarks.
- Waiver add/drop search with waiver-priority/free-agency recommendations by default and bounded FAAB ranges only when FAAB mode is selected. Because My League requires ESPN first, every recognized rostered player across the connected ESPN league is excluded from the available-player pool.
- Basic Trade Value supports arbitrarily large public packages and remains league-independent even after sync. Advanced Trade Lab uses real connected rosters and future-win/league-equity simulation, including trades between two other managers evaluated from the user's perspective. Automated trade-idea search remains connected-league-only and bounded to 1-for-1 and 2-for-2 candidates for tractable opponent search.
- Full fantasy-league regular season, seeds, playoff byes, brackets, and title probability.
- Robust action ranking with CVaR, expected regret, probability-best, Pareto frontiers, and reversal thresholds.
- Temporal evidence ledger with effective/expiry timestamps, freshness decay, conflict resolution, as-of replay, and a SHA-256 chain.
- Historical nflverse health calibration and 32-team coaching priors.
- On-demand actual 2023-2025 nflverse weekly game logs with rolling PPR, opportunity, target-share, derived team carry-share, volatility, trend, and position-specific defense-allowed priors.
- On-demand ffopportunity expected-fantasy-points (xFP) and FPOE evidence, confidence-decayed across the offseason.
- Rookie-specific 2026 intelligence for 74 fantasy-relevant rookies: 2016-2025 draft-capital cohorts, age, structured draft grade/rank, position-relative combine context, live depth chart, preseason usage, week-progressive development priors, and explicitly wider uncertainty when NFL evidence is sparse.
- Rookie cohorts include non-producing developmental/UDFAs rather than conditioning on players who logged stats; drafted buckets shrink toward a drafted-player baseline to reduce survivorship and population-mix bias.
- SnapCount draft recommendations can use a small capped rookie-upside/tail term, while simulated market opponents remain driven by the selected market/value/need strategy rather than the SnapCount rookie model.
- Structured preseason information alpha separates actual preseason opportunity, first-team/starter-unit role evidence, coach/play-caller workload intent, independent structural-report consensus, availability trajectory, and market reaction. Player-specific sensitivity makes uncertain rookies/role battles more responsive than established stars, generic camp hype has no standalone effect, and already-priced market moves are shrunk. The resulting role probabilities feed uncertainty and the shadow Draft challenger only; they cannot change the frozen projection mean or qualified Draft ranking until timestamp-correct prospective/walk-forward validation admits an effect.
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

`npm run verify` checks code/tests/static assets plus the hashes and versions of the already-qualified profile, the frozen forecast season-robustness audit, the prospective successor lock, and the frozen future-win retrospective audit. Full `qualify:analytics` is currently locked before doing any rebuild: the existing 2024/2025 forecast evaluation evidence is consumed and the exact pre-fit forecast input snapshot was not preserved, so a successor must be frozen with an exact input hash and then judged on genuinely prospective 2026 evidence before serving coefficients can change.

The current `snapcount-runtime-profile-2026.8` records **A+ for every historically qualified decision/accuracy serving surface, frozen-forecast robustness, successor provenance, and runtime parity, with A retained for the legacy forecast training lineage**. In-season decisions now add a separately labeled `prospective-overlay` whose primary utility is expected future scheduled head-to-head wins; playoff/title probability is secondary and the qualified trade/waiver/Start-Sit policies remain safety guardrails. The provenance downgrade is deliberate: the frozen coefficients match the stored qualification report, but that report predates the final committed historical artifact and cannot be recreated exactly from it. The original segmented Draft policy remains historical falsification evidence: its genuinely post-freeze 2019 replay failed against need-heavy and Zero-RB. SnapCount then treated 2019-2025 as inspected development evidence, selected a simpler global robustness-first policy (`market=0.60`, `value=0.18`, `need=0.65`), froze that exact policy at commit `3f3bd7e` before accessing a predeclared 2018 final holdout, and evaluated 2018 once. The frozen candidate cleared every strict control gate on 48 paired rooms per control: +317.5 realized starter points / 85.4% wins vs ESPN-market, +77.2 / 68.8% vs balanced, +405.8 / 97.9% vs value, +77.1 / 62.5% vs need-heavy, and +93.4 / 60.4% vs Zero-RB. A deterministic post-selection robustness guard now also evaluates 2018-2025 at the **season** level: every one-season jackknife still clears the production gate, and 200,000-replicate season-cluster bootstrap lower bounds remain positive for every control (the narrowest is need-heavy at +6.5 points / 51.6% wins; ESPN-market win lower bound 76.3%). The two real single-season need-heavy misses in 2021 and 2023 remain recorded rather than hidden. This is strong evidence against material aggregate overfit, not a claim that finite historical data can prove zero overfit. The serving profile hashes this audit together with the candidate, development artifact, and 2018 holdout before accepting Draft A+.

The future-win overlay uses real connected-league matchups when a schedule/roster adapter supplies them, changes both sides of a trade, rejects opponent-aware simulation when recognized starter coverage is below 88%, and uses common-random-number scenario comparisons. Core manual tools do not depend on ESPN; opponent-aware future-win logic only activates when enough actual league state is available. Its pre-result implementation/audit protocol was frozen at `392628129bf57a45c2c350c2d6075e7ceb0c28dd`. A no-tuning retrospective 2025 diagnostic produced 140 decisions, **0 lineup switches**, and 70→70 realized H2H credits, so it is recorded as neutral non-inferiority rather than proof of incremental edge. Untouched 2026 outcomes remain the prospective test. Draft policy and frozen forecast coefficients were not changed.

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
- `data/camp-2026.json`: compact current structural-role artifact derived offline from ESPN public camp/news/search results. Raw article bodies are not persisted; only player attribution, coach/play-caller usage intent, role/performance/availability classifications, first-team/starter-unit facts when explicitly stated, confidence/conflict, and compact source identifiers remain. Every row is advisory-only.
- `data/preseason-alpha-2026.json`: compact structured preseason-alpha artifact combining role state, starter-unit usage, source-weighted coach intent, structural-report consensus, injury trajectory, player sensitivity, and frozen market reaction. It is explicitly `uncertainty-and-shadow-only` and cannot alter the qualified mean or Draft order.
- `data/forward/`: append-only prospective 2026 input freezes. Snapshots preserve the live ESPN PPR baseline and market metadata, structural role signals, preseason-alpha state, public-news classifications, Sleeper movement, and preseason usage before future regular-season outcomes are attached.
- Live runtime allowlist: Sleeper public read-only API, nflverse GitHub releases, ESPN public keyless NFL web JSON, ESPN Fantasy league reads, and NOAA/NWS. ESPN terms apply to ESPN-sourced metadata.

The runtime source policy rejects arbitrary origins, credential-bearing URLs, and secret-like query parameters. No paid fallback exists. ESPN Fantasy is the sole adapter allowed to opt into `credentials: include`, and only after the user chooses the browser-session fallback. Those credentials are managed by the browser and sent directly to ESPN; SnapCount never receives or stores their values.

## Local development

Requires Node 20+ only for tests/dev serving; the deployed application itself has no Node requirement.

```powershell
npm.cmd run verify              # fast release/runtime integrity; no historical retraining
npm.cmd run qualify:analytics   # intentionally locked until a prospective 2026 successor cycle exists
npm.cmd run audit:forecast      # verify frozen forecast provenance guard
npm.cmd run verify:future-win   # verify frozen neutral 2025 future-win diagnostic
npm.cmd run audit:forecast:refit # research-only legacy refit; must not silently replace serving coefficients
npm.cmd run refresh:ppr         # refresh committed PPR + derived Standard fallback
npm.cmd run refresh:rookies     # manual reproducible rookie-artifact refresh
npm.cmd run refresh:camp        # refresh compact structural role / usage intelligence
npm.cmd run refresh:preseason-alpha # rebuild structured preseason-alpha artifact
npm.cmd run refresh:draft-week  # PPR + role/news + preseason alpha + prospective freeze
npm.cmd run capture:forward     # append a prospective 2026 input snapshot
npm.cmd run serve
```

Open `http://127.0.0.1:4173/` (or set `PORT` if that port is occupied).

For the reproducible Edge integration QA, start Edge with a DevTools port and run `node scripts/browser-qa.js`. The script uses a deterministic mocked private ESPN league to exercise anonymous rejection, the explicit browser-session fallback, team selection, roster/week population and the connected home state, then covers player Monte Carlo, veteran xFP/history intelligence, a no-prior-NFL-history rookie path, preseason/news sync, realistic draft-room simulation + strategy benchmark, ESPN-style waivers, lineup/trades/league simulation, and desktop/tablet/phone layouts while checking browser console errors and overflow.

## GitHub Pages

This repository is designed for branch-based Pages publishing from the repository root. Updating the site is intentionally manual: edit locally, run `npm.cmd run verify`, commit, and push. No project-owned Actions workflow is required.
## Deliberate limits

This project does not fabricate precision when free evidence is unavailable. Arbitrary custom scoring that cannot be reconstructed from the shipped projection families is detected rather than silently treated as standard PPR; exact live lineup-lock state is also not yet modeled across every platform. Route participation/TPRR, detailed red-zone role, offensive-line grades, true tracking data, premium prop feeds, and private-platform activity are treated as optional future evidence families unless a defensible free/keyless source is available. Public game totals/spreads are used only as a low-confidence fantasy scoring-environment prior, not as betting advice.

The browser simulator is a lightweight statistical approximation, not a literal NFL play-by-play physics engine. Its value comes from calibrated distributions, empirically constrained correlated scenarios, exact fantasy decision logic, paired comparisons, and transparent uncertainty. The fitted residual-correlation layer currently covers QB/RB/WR/TE only; K/DST residual dependence stays independent rather than receiving invented precision. New model complexity should be accepted only when it improves rolling historical validation.

See `docs/ai/architecture.md`, `docs/ai/feature-parity.md`, and `docs/ai/performance.md` for implementation boundaries, migration decisions, and measured runtime performance.

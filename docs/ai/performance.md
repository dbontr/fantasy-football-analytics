# Browser Engine Performance

Measured 2026-08-07 on Jupiter (Windows x64, Node.js 24.18.1) using the same JavaScript engine shipped to GitHub Pages and the committed 700-player dataset.

These are warm-process medians unless noted. Browser Web Worker execution adds messaging overhead, but the dominant simulation/search work is the same code path.

| Workload | Median |
|---|---:|
| Forecast all 700 players | 3.94 ms |
| Exact weekly lineup, 15-player roster | 0.07 ms |
| Draft window Monte Carlo, 15,000 paths | 222 ms |
| Waiver search, 180-player pool | 20.5 ms |
| Deep trades through 2-for-2, up to 900 evaluations | 1.28 s |
| Correlated scenarios, 64 players x 5,000 | 0.59 s |
| Correlated scenarios, 64 players x 10,000 | 1.10 s |
| Full 10-team league/title simulation, 1,000 seasons | 7.16 s |
| Full 10-team league/title simulation, 2,500 seasons | 17.53 s |

## Interpretation

Routine decisions are effectively immediate. Draft Monte Carlo stays comfortably sub-second, waiver analysis is tens of milliseconds, and the deliberately deep trade search is around one second.

Correlated scenario and full-season simulation scale approximately with the number of scenarios. Those jobs run in `engine-worker.js`, so they do not block UI interaction. The full championship simulation is the heaviest path because it repeatedly samples weekly lineups, fantasy matchups, standings, seeds, and playoff brackets.

For interactive use, 500-1,500 league simulations are the practical range; deeper runs trade latency for lower Monte Carlo noise. Player-level simulations are much cheaper than full-league simulations.

## Player intelligence load

Measured against the real 2025 nflverse weekly player release on Jupiter. The compressed archive is 1,258,615 bytes. A direct source audit measured 846.6 ms for network + gzip decode and 78.3 ms to parse 19,399 compact weekly rows. The production Pages path prefers the bundled same-origin gzip, so historical analysis does not depend on cross-origin availability. Parsed seasons are cached inside the Web Worker for the session.

## Defense and workload indexing

Measured on the bundled 2025 nflverse weekly archive (19,399 rows) after adding team-relative carry share and position-specific defense-allowed profiles. Across seven warm Node runs on Jupiter, median CSV parse time was 83.7 ms and median index/aggregation time was 23.0 ms, for 106.7 ms combined. The worker builds this index once per loaded season and reuses it for subsequent player, lineup, waiver, trade, and league decisions.

The defense index contains 32 defenses x 4 offensive positions (128 profiles). Each profile is shrunk toward the league position average with a four-game prior and capped at low prior-season confidence before entering forecasts.
## Accuracy + draft intelligence benchmark

Measured 2026-08-07 on Saturn (Windows x64, Node.js 24) using the production 700-player bootstrap, 12 teams, 16 rounds, PPR, draft slot 6. The draft workloads execute in the Web Worker in production.

| New workload | Median / measured time |
|---|---:|
| Draft room context construction, 700 players | 7.7 ms |
| Strategy-aware return window, 500 room simulations | 32.9 ms |
| Paired Oracle-vs-market benchmark, 100 rooms | 0.98 s |
| xFP gzip decode, 153,474-byte artifact | 2.5 ms |
| xFP parse, 5,598 weekly rows | 11.4 ms |
| xFP player index | 3.7 ms |

The benchmark path was explicitly optimized before UI integration. An early prototype recomputed normalization/replacement levels on every CPU pick and took about 8.2 seconds for only twelve small paired rooms. Precomputing one immutable room context first reduced the equivalent unit workload to about 141 ms. The 2026.2 room tracker now also reuses drafted-player sets and per-team position counts across CPU picks, bringing the production 500-path return window to 32.9 ms and the 100-room paired benchmark to about 0.98 seconds off the UI thread.

The currently displayed Oracle-vs-market edge is a model-internal strategy diagnostic. It should not be interpreted as validated real-world superiority until the rolling as-of historical draft/backtest harness is complete.

## Rookie + scenario optimization benchmark

Measured 2026-08-07 on Saturn with the full 700-player bootstrap and 74-rookie artifact. Warm-process medians:

| Workload | Previous published | Current | Change |
|---|---:|---:|---:|
| Draft context, 700 players | 8.4 ms | 7.7 ms | ~8% faster |
| Return window, 500 rooms | 168.1 ms | 32.9 ms | ~80% faster |
| Paired full drafts, 100 rooms | 1.73 s | 0.98 s | ~43% faster |
| Correlated scenarios, 64 x 5,000 | 1.58 s | 0.59 s | ~63% faster |
| Correlated scenarios, 64 x 10,000 | 3.15 s | 1.10 s | ~65% faster |

The draft speedup comes from a reusable room tracker instead of reconstructing drafted sets and roster counts on every CPU pick. The scenario speedup comes from generating shared NFL game/team latent factors once per scenario and reusing them for every player in that game/team. Player residual and availability draws remain player-specific and deterministic. Sample summaries sort typed arrays directly and avoid intermediate JavaScript arrays.

The rookie artifact is approximately 47 KB and covers 74 current fantasy-relevant rookies using 1,868 historical rookie records at build time. Historical raw rows are not shipped to the browser.

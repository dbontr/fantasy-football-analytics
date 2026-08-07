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
| Correlated scenarios, 64 players x 5,000 | 1.58 s |
| Correlated scenarios, 64 players x 10,000 | 3.15 s |
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

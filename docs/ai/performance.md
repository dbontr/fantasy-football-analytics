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

# Feature Parity and Deliberate Deviations

Reference implementation: `dbontr/fantasy-football-oracle` v5.2. The reference repository is not modified by this project.

| Capability | Browser engine | Notes |
|---|---|---|
| Exact lineup optimization | Preserved | Hungarian assignment from proven browser core |
| Draft simulation / VONA / return probability | Preserved | Pure JS combinatorial core |
| Waiver add/drop optimization | Preserved | Worker-executed search + browser FAAB range |
| Bilateral trade generation | Preserved | Through 2-for-2, worker-executed |
| Player probability distributions | Rebuilt | Zero-inflated availability + active performance |
| Correlated Monte Carlo | Rebuilt | Game/team/player latent factors, paired seeds |
| Robust decision policy | Rebuilt | CVaR, regret, probability-best, Pareto, reversal |
| Fantasy season simulation | Rebuilt | Weekly lineups, matchups, all-play, median game |
| Championship optimization | Rebuilt | Seeds, byes, playoff bracket, title probability |
| Temporal evidence ledger | Rebuilt | Browser-local SHA-256 lineage and as-of replay |
| Coaching priors | Preserved compactly | 32-team static model artifact |
| Health/recovery calibration | Preserved compactly | nflverse historical availability calibration |
| Context intelligence | Lightweight replacement | Transparent matchup proxy + schedule/game context |
| Source policy | Preserved/stricter | Runtime allowlist has no credential path |
| Local persistence | Replaced | IndexedDB instead of server storage |
| Native C++ simulator | Removed | Deterministic JS factor model is Pages-compatible |
| Fastify/API server | Removed | No backend |
| Automated ingestion jobs | Removed | Manual refresh by design; no Actions |
## Features intentionally not fabricated

The original ideal blueprint identifies route participation, targets per route, red-zone role, play-level xFP, offensive-line context, detailed coverage/pass-rush context, longitudinal recovery, and market disagreement as high-value evidence. The browser engine has evidence-family hooks for these ideas but does not manufacture values when a compliant source is absent.

A future addition qualifies only when all of the following hold:

1. The source is free/keyless under the project's source policy.
2. The browser can retrieve or consume the data without a secret-bearing proxy.
3. Historical as-of values can be reconstructed well enough to validate the feature without leakage.
4. The feature improves rolling out-of-sample metrics or decision regret after calibration.
5. Transfer/compute cost is acceptable for a static client.

## Browser-specific improvements over the reference

- No server/native deployment failure modes.
- Deterministic paired Monte Carlo is available directly in the decision UI.
- Offline bootstrap and local persistence are first-class behavior.
- Source policy is enforced before every runtime fetch.
- Evidence integrity uses built-in Web Crypto with no dependency.
- Browser QA checks real Worker workflows at desktop and phone widths.
- The static validator prevents accidental introduction of workflow/dependency/backend assumptions.

## 2026-08-07 player-intelligence upgrade

- Added actual 2023-2025 weekly player game logs from nflverse.
- Added rolling last-3/last-5/season form, opportunity, target-share, consistency, and trend summaries.
- Added optional position-filtered Sleeper status refresh for injury, practice, depth chart, and update freshness fields.
- Added locally generated Oracle Outlook with explicit provenance and a no-fabrication health rule.
- Historical archives are same-origin compressed assets and are loaded on demand rather than added to the initial application payload.

### Decision-intelligence propagation

- Lineup optimization now loads recent history for the active roster before forecasting starters.
- Waiver search enriches the roster plus the top 180 baseline weekly candidates before the worker evaluates add/drop pairs.
- Trade search enriches both rosters while leaving season asset/fairness values anchored to the longer-horizon model.
- League/title simulation receives per-player static history, health, coaching, and ledger evidence across every simulated week.
- Browser QA now executes lineup, waiver, trade, and league paths and requires each to report history-aware execution.

### Automatic health freshness

- Lineup, waiver, trade, and league runs now request only the relevant Sleeper positions when live status has not already been synced.
- Sleeper `Active` explicitly clears stale bootstrap injury designations; reserve/PUP/suspension states are normalized to the runtime availability vocabulary.
- Partial or failed live refreshes are non-fatal and visibly labeled as `live-status fallback`.

### Rushing workload intelligence

- Derived team-relative weekly carry share from the bundled nflverse player logs.
- Added rolling carry share to Player Intelligence for RB/QB.
- Added bounded `role.carry_share` evidence so recent rushing workload changes flow through every history-aware decision path.

### Defense matchup intelligence

- Added position-specific defense fantasy-points-allowed priors from bundled nflverse weekly stats.
- Added empirical-Bayes shrinkage toward league position averages and capped prior-season confidence.
- Added team-code normalization for common ESPN/nflverse aliases such as LAR/LA and WSH/WAS.
- Week-specific defense priors now feed Player Lab, lineup, waiver, trade, and championship simulation; the old matchup proxy remains only as fallback.

### Offseason calibration

- Prior-season target-share and carry-share evidence is confidence-decayed before 2026 decisions.
- Current-season history retains full bounded confidence; one-season-old history receives a 0.65 multiplier and older history a 0.45 multiplier.
- The model keeps observed usage values intact and changes only evidence confidence.

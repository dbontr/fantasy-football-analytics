# 2026 prospective evidence

This folder preserves point-in-time SnapCount inputs before future regular-season outcomes are known.

- `*_inputs.json` files are append-only evidence freezes.
- `manifest.json` records SHA-256 hashes and whether realized outcomes have been attached.
- Snapshots include the live ESPN PPR baseline, compact camp signals, public news metadata/classification, Sleeper add/drop momentum, and observed preseason boxscore usage.
- They intentionally contain no future regular-season realized labels when captured.
- Never rewrite an old snapshot after seeing outcomes. Create a new snapshot instead.
- A future model successor must be frozen before its prospective evaluation and must not use these future outcomes for feature selection before that evaluation is recorded.
- New snapshots also include a `decisionPolicyBinding` with per-file and combined SHA-256 hashes for the exact serving profile, Draft policy, future-win runtime, Draft engines, preseason-alpha engine, correlation, and calibration code. This binds future scoring to the decision system that existed before the outcomes.

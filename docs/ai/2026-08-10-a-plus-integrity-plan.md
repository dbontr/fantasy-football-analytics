# A+ integrity / anti-overfit pass — 2026-08-10

## Goal
Strengthen SnapCount to the highest defensible qualification standard without retuning any serving coefficient or hiding adverse evidence.

## Frozen authority
- Production baseline: `daa597cd74a43629b0d36583465271a6c684997b`.
- Forecast serving coefficients stay byte-for-byte unchanged.
- Draft policy stays byte-for-byte unchanged.
- 2024/2025 forecast outcomes are consumed; 2018-2025 Draft evidence is consumed.
- 2026 outcomes remain prospective and cannot be inspected for tuning.

## Work
1. Attempt exact forecast-training provenance recovery from Git/cache artifacts. Promote provenance only if the original fit can be reproduced exactly.
2. Add a deterministic frozen-model robustness audit across 2020-2025: season-level deltas, leave-one-season-out checks, cluster bootstrap, and explicit adverse cells. No fitting is allowed in this audit.
3. Freeze a reproducible forecast successor candidate from an exact input SHA and fixed predeclared structure. Candidate remains non-serving until prospective 2026 evidence exists.
4. Gate verification on the new robustness/provenance artifacts, run a fresh detached checkout, and exercise browser behavior.

## A+ rule
A+ is not achieved by renaming a grade. Current serving/decision integrity may be A+ only where evidence clears the predeclared gate. The legacy training-lineage grade remains A unless exact original input reconstruction succeeds; a prospective successor is the only honest replacement if recovery fails.

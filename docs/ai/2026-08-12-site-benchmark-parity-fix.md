# Site benchmark runtime-parity fix — 2026-08-12

## Problem
The published 2018 platform benchmark says it measures the frozen qualified SnapCount Draft policy, but its common room context first converts historical raw ADP values into a sequential imported board (`1, 2, 3, ...`). The qualified historical evaluator does not do that: with no imported board, `boardRank` uses the player's native raw ADP value. Standard live Draft behavior likewise uses native market values unless the user explicitly imports a board.

Because the policy's market term is numeric (`-rank * market`), replacing raw ADP with ordinal rank changes the qualified scorer's input scale. It also changes the synthetic CPU room. This is benchmark/runtime protocol drift, not a football-model coefficient issue.

## Frozen correction before replay
- Keep the frozen qualified policy unchanged.
- Keep the same 2018 player pool, platform snapshots, 48 room seeds, scoring, league sizes, slots, CPU strategy, and realized weekly optimal-starter outcome.
- Build the common SnapCount/CPU context with no imported board so it uses native historical ADP.
- Apply each archived platform board only to that platform's user-side pick logic.
- Record the market scale explicitly in the output artifact.
- Adopt the corrected result whether the SnapCount headline moves up or down.

## Integrity boundary
This correction is not a new qualification gate and cannot promote the rejected structural challenger. It changes no serving Draft coefficient and is justified from code-path parity before the corrected 2018 replay is observed.

## Result
The preregistered corrected replay produced **2,317.31** SnapCount realized starter points versus **2,115.03** for ESPN ADP across the same 48 paired rooms. The prior published SnapCount figure was 2,270.70, so the runtime-parity correction changes the descriptive headline by **+46.61 points**. ESPN beat SnapCount in 7/48 rooms (14.58%).

`npm.cmd run verify` passed after the correction: 155/155 tests plus all static, model, forecast, correlation, football-context, preseason-alpha, Draft-overfit, future-win, and analytics qualification gates. The serving Draft policy/engine are unchanged from `origin/main`; the qualified analytics SHA-256 remains `4a659586d578668f019c94ce10b5aa8de9b5877e38d12697c0159c8fdeac9ba2`.

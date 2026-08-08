# Context transport audit — 2026-08-08

## Verdict

The missing layer was not simply "new team" or "new coach." It was context transport: deciding which parts of a player's historical role remain portable when the surrounding offense changes, and which new facts should move the forecast immediately.

This pass admits one new mean effect: a confirmed change away from the established starting QB for WR/TE projections. It also removes the unvalidated direct coaching mean scalar. Team/coaching changes remain observable context, but they do not receive an invented universal bonus or penalty.

The governing rule is now: **context may move the mean only after a leakage-safe historical gate; otherwise preserve it as metadata or uncertainty.**

## Production changes

1. `context.qb_replacement_delta` reacts when the baseline QB is unavailable and an available replacement is identified.
2. WR and TE penalties are embedded from an as-of historical audit, not hand-selected.
3. `coaching.mean_delta` is removed. Staff/scheme data remains as `coaching.staff_context` and cannot change the mean.
4. Prior-team role history is explicitly tagged `context.team_transport` instead of silently looking like current-team evidence.
5. Prior-team target/carry and xFP/FPOE evidence retains `transported`, `historyTeams`, and `currentTeam` provenance.
6. No blanket "new team" penalty was added because exploratory checks did not justify one robustly.
7. `npm run audit:context` is part of the verification contract and fails if the embedded QB effect or support drifts.

## QB-context admission test

The historical label is constructed without future-season QB identity. For each week, the incumbent is the team's cumulative passing-attempt leader **before that week**. The observed game QB is the current-week passing-attempt leader, with a minimum of 12 attempts. WR/TE forecasts use only the player's prior games.

Admission is bidirectional 2023<->2024 cross-validation. The already-inspected 2025 season is a consistency check only.

| Position | Embedded penalty | 2023–24 support | Shrinkage | CV RMSE | CV MAE | 2025 RMSE | 2025 MAE |
|---|---:|---:|---:|---:|---:|---:|---:|
| WR | -4.6% | 546 | 800 | 7.321 -> 7.309 | 5.598 -> 5.558 | 6.627 -> 6.571 | 5.128 -> 5.029 |
| TE | -9.4% | 255 | 25 | 5.849 -> 5.797 | 4.560 -> 4.423 | 7.148 -> 7.124 | 5.415 -> 5.236 |

The gains are modest. That is a reason to keep the correction modest, not a reason to amplify it. The current gate does **not** prove that every backup QB hurts every pass catcher by the same amount; it establishes a conservative position-level prior until a richer QB-quality model beats it.

## Team and coaching changes

A player's team change is not itself a universally negative event. New opportunity, quarterback quality, target competition, offensive volume, line quality, and red-zone environment can move in opposite directions. A single "new team" scalar would collapse those mechanisms and can double-count information already present in the current 2026 market/bootstrap projection.

The same problem applied to coaching. The prior production code converted subjective staff ratings into a direct mean effect. That looked football-aware but had not earned its coefficient historically. This pass removes that mean effect. Coach identity, scheme label, continuity, and new-staff status are retained for explanation and future modeling only.

Historical nflverse games data can reconstruct head-coach identity, so a future coaching model should be trained from staff changes and measurable offensive behavior rather than narrative grades.

## Remaining interaction gaps

These are the highest-value gaps between the current B+ system and an A/A+ context model:

1. **QB quality, not just QB identity.** Model starter-to-replacement deltas using passing efficiency, pressure response, time to throw proxies, scramble rate, target depth, checkdown tendency, and expected team scoring. The current admitted effect only handles a confirmed incumbent loss for WR/TE.
2. **RB receiving interaction with QB changes.** Backup/rookie QBs may alter RB target rates in a different direction from WR/TE output. This needs its own historical gate rather than inheriting the WR penalty.
3. **Incoming teammate competition.** The current absence redistribution handles lost teammates, but a newly added WR/RB/TE can reduce role share. Add signed competition transport based on target/carry demand and depth-chart position.
4. **Multiple simultaneous absences.** QB + OL + receiver injuries are not independent. Redistribution and availability effects should be tested jointly so stacked injuries do not double-count or miss compounding risk.
5. **Offensive-line context.** Runtime supports pass/run blocking evidence, but no production source currently feeds those features. OL continuity and injuries should affect QB pressure risk and rushing efficiency only after an as-of historical validation.
6. **Coach/play-caller behavior.** Reconstruct HC/OC/play caller changes and measurable neutral pass rate, pace, personnel, motion/play-action proxies, and red-zone tendencies. Fit hierarchical position effects with partial pooling; do not revive subjective staff scalars.
7. **Route-level opportunity.** Targets alone miss route participation, targets per route run, first-read share, end-zone targets, and slot/wide deployment. These are likely higher-value role signals than adding more narrative adjustments.
8. **Live weather ingestion.** Wind exists as a what-if/evidence feature, not an automatic production feed. Weather should be sourced as-of kickoff and validated by position before it changes means.
9. **News interpretation.** ESPN news is surfaced to the user, while `news.role_delta` is currently Sleeper add/drop momentum. A future structured-news layer should convert confirmed depth-chart, snap, role, and injury facts into typed evidence rather than sentiment.
10. **Preseason downside.** Current preseason usage evidence is positive-only. A player losing first-team work should be representable once negative preseason signals are shown to generalize out of sample.
11. **As-of historical state.** Exact old Sleeper statuses, depth charts, market snapshots, and news states are not yet archived. Full decision backtests therefore cannot recreate every historical information set exactly.
12. **Transition uncertainty.** Team/QB/coach transitions should alter epistemic/role uncertainty separately from the mean. The current QB adjustment moves the mean but does not yet have a transition-specific dispersion calibration.
13. **Dynamic season state.** Season simulation samples outcomes from current forecasts, but does not yet evolve persistent future QB injuries, depth-chart changes, or role transitions as latent season states.
14. **Decision-layer proof.** Start/sit regret, waiver value, trade utility, draft-room replay, playoff probability calibration, CRPS, and quantile loss remain required before claiming elite end-to-end decision quality.

## Revised harsh grade

| Area | Grade after this pass | Remaining problem |
|---|---:|---|
| Browser / simulation engineering | A- | Strong implementation; engineering is not predictive proof. |
| Data / provenance discipline | B+ | Bootstrap generation and historical as-of snapshots are incomplete. |
| Mean player projections | B / B+ | QB context is now admitted and coaching scalar removed, but many other evidence weights remain hand-set. |
| Injury / availability | B+ | Strong structure; full walk-forward decision validation remains. |
| Rookie model | B+ | Useful priors, still needs broader component ablations. |
| Forecast uncertainty | A- | Holdout-calibrated proxy dispersion; still not the exact production-mean tournament. |
| Scenario correlation | B+ / A- | Empirically fitted and cross-validated; K/DST and richer state dependence remain. |
| Context transport | **B+** | QB loss and provenance are materially better; team/coach/OL/competition interactions are not yet fully empirical. |
| Draft simulator implementation | A- | Mechanically strong. |
| Evidence draft strategy wins | C | Historical contemporaneous draft-room replay still missing. |
| Full historical validation | C+ | Three statistical layers now have gates, but the whole decision engine does not. |
| **Overall analytics** | **B+** | More defensible, but A/A+ requires a complete as-of walk-forward tournament and admitted interaction effects. |

## Verification

The verification contract now includes syntax/static checks, 68 unit/invariant tests, the uncertainty audit, correlation audit, and context audit. The full browser QA also passed on a fresh Edge profile across desktop/tablet/mobile with zero logged browser errors and no horizontal overflow.

The next modeling priority remains the full as-of walk-forward tournament. The correct path to A+ is not to add more football-sounding coefficients; it is to make QB quality, teammate competition, coaching/play-caller behavior, OL state, and transition uncertainty survive the same admission discipline that removed the old correlation and coaching mistakes.

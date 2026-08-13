# Season-win decision plan — 2026-08-12

## Goal
Make the connected-league product answer the highest-value question directly: **what is the best next legal move to maximize expected remaining head-to-head wins?**

## Scientific boundary
- Do not change frozen forecast coefficients, Draft coefficients, waiver minimum score, or trade accept/pass thresholds.
- Reuse the qualified raw ESPN decision mean for Start/Sit, waivers, and trades.
- Preserve transaction legality, current-week locks/final scores, real opponent rosters, and the real fantasy schedule.
- Compare actions with common-random-number future-win simulation.
- Recommend a changed action only when its paired 95% Monte Carlo interval has a positive lower bound; otherwise recommend HOLD.
- Treat this as decision orchestration, not proof of a new predictive model. Prospective 2026 outcomes remain the admission evidence for any stronger claim.
## Implementation
1. Centralize future-win robustness classification in the engine and expose a robust preferred action separately from the raw expected-value winner.
2. Apply the same robust gate to waiver and trade-idea recommendations; positive-but-uncertain simulations become non-recommendations rather than hidden "wins."
3. Add a connected-league **Win Plan** that searches:
   - the current opponent-aware lineup;
   - historically qualified/legal waiver add-drops;
   - historically qualified/legal trades against actual league rosters.
4. Put those heterogeneous actions on a common expected-win-delta scale and show the best robust next move, plus alternatives and HOLD when nothing clears the gate.
5. Extend forward snapshots with exact serving-policy and decision-engine hashes so prospective 2026 evaluation binds predictions to code, not just input data.

## Verification
- Pure unit tests for robust action classification and HOLD behavior.
- Existing future-win, lineup, waiver/trade policy tests remain green.
- Static build and full `npm run verify`.
- Browser QA for connected Win Plan, responsive layout, and zero console errors before merge.

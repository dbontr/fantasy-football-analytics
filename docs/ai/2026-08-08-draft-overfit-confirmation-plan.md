# Draft overfit falsification / 2017 confirmation

## Purpose
Strengthen or falsify the already-frozen production Draft policy without changing its coefficients, weakening its A+ gate, or searching successive historical seasons until one passes.

## Frozen policy
- Production release before this audit: `e851424a4a6c74728ce06962506a1edb0dc86668`.
- Policy-definition SHA-256: `7338a9c34cf40e5828a1ec33654ce482e13c2ae52ec129c4776dc5e8dbe7befc`.
- Qualified scope: 10/12-team PPR; `market=0.60`, `value=0.18`, `need=0.65`; all other roster/timing constraints unchanged.
- 2019-2025 are already-inspected development evidence. 2018 is already-consumed final-holdout evidence.

## New pre-registration
- At the time this plan was written, the repository contained no 2017 Draft validation artifact and `.cache/validation` contained no 2017 ESPN/FantasyData Draft cache.
- **2017 is the only new historical season that will be accessed in this confirmation attempt.**
- If 2017 fails, confidence is downgraded and this attempt stops. There will be no 2016/2015/etc. search for a passing result.
- The production policy is not retuned from the 2017 result, pass or fail.
- The evaluator and this plan must be committed before the first 2017 fetch.

## Test design
- Same five controls: ESPN-market, balanced, value, need-heavy, Zero-RB.
- Six room segments: 10/12 teams x early/middle/late slots.
- 32 common-random-number seeds per segment = 192 paired rooms per control.
- Realized score remains exact weekly optimized starter points across the historical season.

## Predeclared gates
The existing A+ point-estimate gate must still pass:
- mean edge >= 0 against every control;
- paired win rate >= 50% against every control;
- ESPN-market paired win rate >= 75%.

A stricter anti-overfit confirmation gate is added for this audit:
- deterministic 20,000-replicate **cluster bootstrap**, resampling the 32 common seed indices while retaining all six room segments within each sampled seed;
- 95% percentile lower bound for mean edge must be > 0 against every control;
- 95% percentile lower bound for paired win rate must be > 50% against every control;
- ESPN-market 95% win-rate lower bound must be > 75%.

This bootstrap measures room/slot robustness inside one season; it is not equivalent to having many independent NFL seasons. Passing therefore means strong evidence against the observed overfit failure mode, not proof that overfitting is mathematically impossible.

## Interpretation contract
- Pass: retain the frozen policy and strengthen the Draft claim to "two independent post-freeze historical seasons plus multi-year development, with the newest confirmation clearing a stricter uncertainty-aware gate."
- Fail: retain the result, do not tune to it, and describe the current Draft A+ as not independently confirmed by the stricter gate.
- In either case, 2017 becomes consumed evidence and cannot be used to tune a later Draft policy.
- Genuine forward 2026 evidence remains the most important next confirmation.

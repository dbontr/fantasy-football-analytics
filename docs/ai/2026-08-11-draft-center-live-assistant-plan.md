# Draft Center + Live Draft Assistant plan

Date: 2026-08-11

## Product contract
- My League Draft Center is a choice screen, not an automatic mock-draft workspace.
- **Live Draft Assistant** is the draft-night path. It records only real picks supplied by the user and never fabricates live-room selections.
- **Mock draft** routes into the normal public Mock Draft with the connected league format prefilled.
- Public Mock Draft remains fully usable without ESPN.

## Strategy contract
- Do not change frozen Draft coefficients or qualification claims.
- Surface the existing qualified recommendation components: market price, value/VONA, roster need, positional scarcity/run pressure, risk, and return probability.
- In live mode, observed recent picks supplement simulated run pressure so the explanation reflects what the actual room is doing.
- Recommendation buttons are actionable only when the user's team is actually on the clock.

## Room visibility
- Mock CPU picks appear sequentially instead of jumping invisibly to the next user turn.
- A persistent team-by-team board shows every pick, roster composition, the user team, and the current team on the clock.
- Live mode uses the same board as an exact mirror of the real picks entered by the user.

## Release gates
- Preserve `snapcount-runtime-profile-2026.8` and the existing qualification SHA.
- `npm run verify` must remain green with 119 tests, zero runtime dependencies, and zero workflows.
- Storage-cleared browser QA must cover public Mock Draft, league-prefilled mock, Live Draft Assistant, full-room board, strategy refresh, and 1440/768/390 responsive layouts.
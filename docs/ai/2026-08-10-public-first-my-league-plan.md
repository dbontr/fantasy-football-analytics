# Public-first + My League product plan

Date: 2026-08-10

## Product model
- SnapCount is useful before a user configures any league: rankings, player analysis, projections, and a standalone trade-value check are public-first.
- The global navigation stays concise: Home, Rankings, Players, Trade Analyzer, My League.
- My League is the gateway to personalized Draft, Start / Sit, Waivers, Season, and league-aware trade context.
- ESPN remains optional autofill. A user can unlock My League with standard 12-team PPR defaults or custom manual rules without connecting an account.

## UX changes
- Remove the long league-rules string from the visible masthead.
- Add a dedicated Rankings surface and a public top-player preview on Home.
- Move the existing league setup dashboard behind My League and collapse detailed settings/imports.
- Hide league-specific tool shortcuts until My League is enabled.
- Keep Trade Analyzer global; when no roster exists, run a clearly labeled standalone package/value comparison. When league state exists, preserve roster-fit, opponent, schedule, transaction, and future-win analysis.

## Release guards
- No serving forecast, Draft, calibration, future-win, or qualification coefficient changes.
- Preserve platform-neutral import and optional ESPN paths.
- Add browser QA for concise masthead, 5-item public navigation, public rankings, standalone trade analysis, My League unlock, and league-specific mock drafting.
- Run full repository verification, fresh-profile browser QA, detached-commit verification, then public Pages verification before release.
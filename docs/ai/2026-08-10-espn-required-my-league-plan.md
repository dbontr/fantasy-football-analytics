# ESPN-required My League release plan

## Goal
Make the public SnapCount tools remain available without configuration, while requiring a completed ESPN Fantasy league + team connection before any My League personalized workflow can open.

## Product contract
- Home, Rankings, Players, and standalone Trade Analyzer remain public and unrestricted.
- My League itself remains visible so a user can connect ESPN.
- Draft, Start / Sit, Waivers, Season Outlook, league-aware trades, and league settings remain locked until ESPN has loaded and the user has selected a team.
- Supported ESPN league rules populate the league profile after connection; manual controls are post-connection overrides, not an alternate unlock path.
- Disconnecting ESPN immediately relocks My League.
- Legacy locally saved manual/import state must not bypass the ESPN prerequisite after reload.

## Non-goals
- No forecast, Draft, trade, waiver, calibration, correlation, or future-win coefficient changes.
- No change to the standalone public Trade Analyzer.
- No collection of ESPN passwords or raw cookie values; the existing anonymous-first / browser-session fallback remains unchanged.

## Release gate
- Full `npm run verify` must pass with the frozen analytics qualification hash unchanged.
- Fresh-state browser QA must prove locked, connected, and re-locked states plus normal public tools and responsive layouts.
- Deploy only as a fast-forward of a verified exact commit.

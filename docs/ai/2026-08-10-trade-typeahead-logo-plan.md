# Trade typeahead + SC football mark plan

## Goal
- Replace the current SnapCount wordmark with the approved white `S + football + C` mark.
- Replace trade search + select controls with direct player typeahead fields.
- Allow arbitrarily large direct trade packages by adding a blank slot whenever a side is full.
- Keep Trade Analyzer public; add league-partner ownership constraints only when real league rosters are loaded.

## Product behavior
- Public trade mode: both sides search the full player pool, excluding already-selected players.
- Start with two typeahead rows per side. Selecting all visible rows appends another blank row on that side.
- Suggestions appear immediately below the active field while typing and can be clicked directly.
- My League mode: show a trade-partner selector. `I GIVE` searches only the user's roster and `I GET` searches only the selected partner's roster.
- Changing partner clears receive-side selections so stale players cannot survive a counterparty change.
- Direct analysis consumes every selected player on both sides; existing qualified trade/future-win logic remains unchanged.

## Verification
- Add browser QA for live typeahead suggestions, dynamic third/fourth slots, public big-trade analysis, partner roster restriction, and connected trade analysis.
- Run `npm run check`, targeted browser QA, full `npm run verify`, detached-checkout verification, then production QA before deployment.
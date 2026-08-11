# Public Mock Draft + My League menu plan

## Goal
Make the public product cleaner without weakening the ESPN-gated My League contract or changing qualified analytics.

## Product changes
- Remove automated trade ideas from the base Trade Analyzer; keep them only inside connected My League.
- Add Mock Draft as a public top-level tool that works with no ESPN connection.
- Preserve a separate My League Draft context that applies the connected ESPN format.
- Replace the standalone My League tab with a dropdown for league home, Draft Center, Start / Sit, trade ideas, Waivers, and Season Outlook.
- Simplify Draft around one Start/Restart action, recommendations, and the user roster; move Big Board, room history, custom rankings, and strategy benchmark behind disclosures.

## Reliability contract
- Starting a mock always advances CPU teams to the user pick.
- After the user drafts a player, CPU teams automatically advance to the next user pick.
- Public Mock Draft never needs ESPN and survives ESPN disconnect/relock.
- My League Draft remains locked until ESPN league + team selection.

## Scientific boundary
No forecast, uncertainty, correlation, context, Draft policy, waiver, trade threshold, or future-win coefficient changes are allowed in this release.

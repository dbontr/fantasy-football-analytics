# ESPN sync + product polish plan

## Goal
Make Oracle feel like a polished consumer fantasy assistant whose first useful state is the user's real league, while preserving the static GitHub Pages / no-secrets architecture.

## ESPN connection contract
- Accept an ESPN league URL or numeric league ID plus season.
- Attempt ESPN's fantasy league endpoint anonymously with `credentials: omit` first.
- Never request, read, paste, or store ESPN cookie values, `espn_s2`, SWID, passwords, tokens, or other raw credentials.
- If ESPN returns 401/403, offer an explicit **Try my ESPN sign-in** fallback. That request uses `credentials: include` directly from the user's browser to ESPN; the JavaScript application cannot read the HttpOnly cookie value.
- Browser-session credentials are allowlisted only for the ESPN Fantasy adapter; all other runtime sources continue to forbid them.
- Public and browser-session-readable leagues can sync roster, teams, records, current week, and playoff-team count.
- If ESPN rejects the browser session or browser privacy controls block cross-site session cookies, explain that clearly and keep the rest of Oracle usable manually.
- Match ESPN roster entries to the local player universe by ESPN player ID first and normalized name second.
- Persist only non-secret connection metadata, the selected access mode, and a compact last-known snapshot in IndexedDB.

## Product behavior
- Home gets a prominent Connect ESPN / connected-league card.
- After league fetch, user chooses "My team"; Oracle immediately fills Start/Sit roster and Season league data.
- Connected state shows league name, team, record, recognized roster count, and last refresh.
- Refresh and disconnect actions remain one click.
- Season keeps Sleeper import as a secondary path rather than the main setup.

## Design direction
**Concept:** a clean weekly game-plan desk: connected league first, then the five decisions that matter.

- Color: warm off-white canvas, white surfaces, deep evergreen primary, navy text, muted slate, restrained amber for upside/warnings, ESPN connection badge in a small red accent.
- Typography: system sans; tighter display headlines, highly readable body copy, small uppercase utility labels only where they help scanning.
- Layout: sticky compact header; two-column home hero with league connection as the right-hand anchor; connected-league summary becomes a horizontal command strip; tool pages keep focused single-job layouts.
- Signature: subtle football-field yard-line ticks inside the league card, not a generic gradient hero.
- Motion: restrained hover/press transitions only; respect reduced motion.
- Mobile: all navigation visible, connect form stacked, team summary compact, 44px+ targets, no horizontal overflow.

## Verification
- Add source-policy/parser unit tests for ESPN URL parsing, endpoint allowlist, response normalization, roster matching, and private-league error messaging.
- Extend browser QA with a deterministic mocked ESPN league response so sync can be verified without depending on a live third-party league.
- Run `npm.cmd run verify`.
- Run fresh Edge QA at 1440 / 768 / 390 and visually inspect screenshots.
- After merge/push, run public Pages QA and confirm service-worker cache revision, zero workflows, and no console errors.
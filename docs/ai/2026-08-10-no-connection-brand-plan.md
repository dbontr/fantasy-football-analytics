# No-connection product + brand refresh

## Goal
Make SnapCount unmistakably usable without ESPN or any account connection, while replacing the current header mark with a cleaner full brand lockup.

## Behavior
- Draft and Mock Draft must work from a pristine browser state with no league connection.
- Player, Start / Sit, Trades, Waivers, and demo Season flows must remain usable without ESPN.
- ESPN remains an optional autofill adapter, never a prerequisite or primary CTA.
- Manual/default league rules remain available immediately; imports can add opponent/schedule/legal-state fidelity.

## UI
- Make **Start a mock draft** the first Home CTA.
- Replace connection-centric empty-state language with manual/universal language.
- Rename Season's ESPN-specific management button to neutral league-data language.
- Use a full SnapCount header lockup; keep a simplified standalone mark for favicon/PWA use.

## Verification
- Add disconnected-first browser QA before any import/ESPN setup.
- Preserve existing import, ESPN, connected-league, responsive, and analytics verification.
- Do not change frozen forecast/Draft coefficients or qualification artifacts.
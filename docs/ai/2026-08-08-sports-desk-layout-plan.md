# Sports Desk Layout Redesign

## Goal
Make SnapCount feel structurally like a fantasy section inside a major sports site, not a themed analytics app. Preserve all seven beginner-facing tasks and the existing model/data behavior.

## Layout contract
- Two-row masthead: brand/context row plus tool navigation row.
- Persistent league/team/week context in the masthead after ESPN sync.
- Home uses a desktop main-feed + sticky right-rail composition.
- Main feed contains the weekly headline, connected-league command strip, and ESPN connection module.
- Right rail contains Quick Tools plus current league context.
- Technical runtime/data details move behind a disclosure instead of occupying the primary homepage.
- On phones the page becomes a single feed; connected-league actions render as a visible 2x2 grid.

## Visual hierarchy
- Keep the cool-gray/white/near-black/sports-red system from the prior sports-desk pass.
- Use flatter editorial modules and compact table/data treatments.
- Internal tool pages keep their existing workflows but use the persistent masthead and tighter page headers.

## Verification
- Preserve 52/52 engine/data tests and the zero-dependency/zero-workflow static contract.
- Browser QA must assert the new masthead, two-column desktop Home, sticky right rail, ESPN hydration, and responsive no-overflow behavior at 1440/768/390.
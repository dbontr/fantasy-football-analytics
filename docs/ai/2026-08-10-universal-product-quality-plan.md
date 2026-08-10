# Universal product quality pass

## Goal
Make SnapCount a first-class fantasy assistant for any user/platform, with ESPN as optional convenience rather than a requirement, and fix correctness gaps before adding more predictive complexity.

## Hard requirements
- Replace the `SC` tile with a real SnapCount visual mark and matching favicon.
- Make Mock Draft a complete guided flow: start/reset, CPU advance, user pick, automatic CPU advance to the next user pick, clear completion/error states.
- Keep every core tool usable without ESPN; add a platform-agnostic league profile for team count, scoring preset, and lineup slots.
- When ESPN is connected, import recognized league roster settings into that same profile instead of hard-coding `core.DEFAULT_SETTINGS`.
- Connected waivers must exclude players rostered by every team, not only the user's roster.
- Connected opponent-aware simulation must fall back when roster/settings coverage is not reliable.

## Stronger product direction
SnapCount should model the user's actual decision environment: league rules -> legal players/actions -> calibrated distributions -> opponent/schedule -> future-win utility. Connection adapters populate that model; they do not define the product.

## Verification
Add tests for ESPN slot parsing, manual settings propagation, league-wide waiver ownership, and mock-draft auto-advance. Run full verify, fresh detached-checkout verify, and fresh local/public Edge QA at 1440/768/390 before deployment.
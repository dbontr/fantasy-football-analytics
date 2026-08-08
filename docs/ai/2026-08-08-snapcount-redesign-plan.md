# SnapCount brand + visual redesign

## Goal
Replace the Oracle consumer brand and green visual language with a distinctive fantasy-sports identity while preserving every working ESPN and decision flow.

## Product name
Working name: **SnapCount**. User-facing copy must not call the product Oracle. Internal legacy JavaScript namespaces may remain unchanged where renaming them would add risk without affecting the product surface.

## Design direction
**Concept:** sports editorial meets draft-night scorecard — decisive, high-contrast, fast to scan, and clearly about fantasy football rather than a generic SaaS dashboard.

- Canvas: warm cream `#F3F0E8`.
- Ink/structure: midnight `#11182A` and navy `#17264B`.
- Primary action: cobalt `#2458E8`.
- Accent: orange `#FF6B35`.
- ESPN-only accent: ESPN red.
- Success states use cobalt/navy, never green.
## Layout + signature
- Dark compact header with a bold SC monogram and cream wordmark.
- Hero copy: `See the move before your league does.`
- ESPN connection becomes a dark scoreboard panel with orange edge detail.
- Connected league actions become a navy command bar rather than soft cards.
- Task cards use hard 2px borders, small radii, offset shadows, oversized play numbers, and alternating cobalt/orange emphasis.
- Data modules keep readable light surfaces but lose the generic rounded-card softness.
- Typography stays dependency-free: system sans for body/display, monospace only for compact data labels.

## Behavior and accessibility
- Preserve all seven tools, ESPN anonymous + browser-session sync, keyboard focus, 44px controls, reduced-motion behavior, and responsive layouts.
- No functional model changes.
- Verify no visible `Oracle` branding in rendered copy and no green computed theme colors.
- QA at 1440 / 768 / 390 px with screenshot review and zero horizontal overflow.

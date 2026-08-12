# Draft Decision Mix

SnapCount keeps the historically qualified draft policy as the anchor and applies a bounded live decision layer only to close calls.

The live mix measures seven families: counterfactual projected starter value, manager-specific probability a player survives to the user's next pick, disagreement between SnapCount and ESPN market rank, season availability, QB/format scarcity, portfolio/correlation fit, and measured football context.

No new football-context family is promoted into the serving projection mean by this feature. The combined decision movement is capped at 0.35 league rounds (2.5 to 5 picks depending on league size), then the user's personal board is applied separately. The 2026 season remains the prospective validation target for deciding whether any candidate family deserves permanent promotion.

## Personal view

My Outlooks now asks where the user would draft a player relative to ESPN: slightly (about a sixth of a round), moderately (about a third of a round), higher/lower (about three quarters of a round), or much higher/lower (about one-and-a-quarter rounds). The stored keys remain backward compatible.

The user's target is compared with SnapCount's existing rank first. Only the residual disagreement can move My Board or Draft recommendations, so a bearish or bullish signal already captured by SnapCount is not counted twice. Pass remains a separate hard preference, not an extreme negative rating.

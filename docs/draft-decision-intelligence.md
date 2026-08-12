# Draft Decision Intelligence

SnapCount keeps the historically qualified draft policy as the serving champion. The newer decision intelligence is a shadow challenger: it is measured and explained, but it cannot reorder the qualified board until it clears validation.

The shadow challenger measures seven families: counterfactual projected starter value, manager-specific probability a player survives to the user's next pick, disagreement between SnapCount and ESPN market rank, season availability, QB/format scarcity, portfolio/correlation fit, and measured football context.

The candidate movement remains capped at 0.35 league rounds (2.5 to 5 picks depending on league size), but the applied model movement is currently zero. The original qualified return probability is also preserved; the manager-specific return estimate is stored only as shadow evidence.

An initial 2019 paired-room ablation rejected the additive bundle for live reordering: the current counterfactual/VONA bundle and ESPN-residual reinforcement were materially adverse, while several other families did not change picks at their standalone scale. The frozen 2,271-point 2018 site benchmark therefore remains the honest serving score rather than being post-hoc retuned.

No new football-context family is promoted into the serving projection mean by this feature. 2026 remains the prospective validation target for any permanent promotion.

## Personal view

My Outlooks asks where the user would draft a player relative to ESPN: slightly (about a sixth of a round), moderately (about a third of a round), higher/lower (about three quarters of a round), or much higher/lower (about one-and-a-quarter rounds). The stored keys remain backward compatible.

Personal preference is separate from model qualification. The user's target is compared with SnapCount's existing rank first, and only the residual disagreement can move My Board or personalized Draft recommendations. Pass remains a separate hard preference, not an extreme negative rating.

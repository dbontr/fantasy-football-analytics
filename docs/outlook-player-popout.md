# My Outlooks player analysis popout

Clicking or keyboard-activating a player in **My Outlooks** opens an in-place analysis dialog instead of navigating to Player Analysis.

The dialog deliberately reuses the existing Player Analysis controls and renderers so projection, uncertainty, role, health, matchup, and recent-game context cannot drift into a second implementation.

## Projection metrics

The popout shows the selected week's existing SnapCount projection and adds **AVG PROJECTED PPG**.

Projected average PPG is the mean of positive projected weekly PPR values across playable weeks, excluding the player's bye. If weekly projections are unavailable, it falls back to the committed weekly projection baseline, then projected season points divided by 17.

## Interaction

- Click the player name/avatar cell in My Outlooks.
- The current page and URL do not change.
- Change **Week** in the dialog to recalculate the selected-week analysis.
- Close with the × button, Escape, or the dialog backdrop.
- Player cells are keyboard accessible with Enter or Space.

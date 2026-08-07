# nflverse weekly player history

These compressed files are unmodified weekly player-stat CSV exports from the public `nflverse/nflverse-data` `stats_player` GitHub release:

- `stats_player_week_2023.csv.gz`
- `stats_player_week_2024.csv.gz`
- `stats_player_week_2025.csv.gz`

Source: nflverse-data GitHub Releases, tag `stats_player`.
License: CC-BY-4.0 unless the upstream release states otherwise.

They are committed so the GitHub Pages application can load game history from the same origin without a proxy, API key, backend, or cross-origin dependency. They are not part of the service-worker install precache; the browser requests a season only when Player Intelligence is used and then normal runtime caching may retain it.

Do not hand-edit these archives. Future seasons should be refreshed manually from the same qualified upstream source and verified before commit.

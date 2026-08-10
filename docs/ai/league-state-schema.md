# SnapCount League State Import

## Purpose

SnapCount uses one platform-neutral league-state object for imported leagues. ESPN is an adapter into this schema; JSON/CSV imports let Yahoo, Sleeper, NFL, CBS, and custom-league users supply the same state without an account connection.

The import is local-only. It is parsed in the browser and persisted in IndexedDB. It is not uploaded to a SnapCount backend.

## JSON shape

```json
{
  "version": "snapcount-league-state-2026.1",
  "name": "My League",
  "season": 2026,
  "currentWeek": 1,
  "userTeamId": "1",
  "settings": {
    "scoring": "ppr",
    "lineupLockType": "INDIVIDUAL_GAME",
    "slots": { "QB": 1, "RB": 2, "WR": 2, "TE": 1, "FLEX": 1, "SUPERFLEX": 0, "DST": 1, "K": 1, "BN": 6 }
  },
  "teams": [],
  "fantasySchedule": { "1": [["1", "2"]] }
}
```

## Team and live-lineup state

Each team may provide `teamId`, `name`, record fields, transaction usage, and either `roster`, `rosterIds`, or `rosterEntries`. `rosterEntries` is the full-fidelity form:

```json
{
  "playerId": "4429795",
  "playerName": "Jahmyr Gibbs",
  "lineupSlot": "RB",
  "locked": true,
  "currentPoints": 18.4,
  "final": false,
  "kickoff": "2026-09-10T00:20:00Z"
}
```

Player matching uses SnapCount player ID first and a unique normalized-name fallback second. A recognized player cannot appear on multiple imported teams.

For the active scoring week, a starter whose game is locked stays in that exact starter slot. A locked bench/IR player cannot be inserted. When `locked` is omitted, SnapCount derives an individual-game lock from the imported or bundled kickoff time. Whole-lineup lock types are also supported.

`currentPoints` is informational while a game is live. If `final` is explicitly `true`, that score becomes deterministic in current-week simulation instead of being projected again. SnapCount does not infer a final result when the import/adapter cannot prove it.

## Transaction state

League-level transaction fields are optional:

```json
{
  "transactions": {
    "faabBudget": 100,
    "acquisitionLimit": 7,
    "tradeDeadline": "2026-11-20T00:00:00Z",
    "rosterLimit": 16,
    "irSlots": 2,
    "waiverType": "FAAB",
    "complete": true
  }
}
```

Team-level usage can provide `faabSpent`, `faabRemaining`, `waiverPriority`, `acquisitions`, and `irUsed`.

SnapCount rejects actions that violate known FAAB, acquisition, deadline, roster, or IR constraints. A post-kickoff drop is blocked only when `lockDroppedPlayersAfterKickoff` is true or a recognized `rosterLockType` proves that rule; lineup locks alone do not make a trade illegal. Waiver priority is displayed as acquisition context rather than treated as a guarantee that a claim will clear. If `complete` is not true, SnapCount labels the result as conditional because an unimported platform restriction may still exist.

## Exact custom scoring

Set `settings.scoring` to `custom`, add `customScoring`, and provide projected stat lines for the players used by the affected tool. Linear scoring rules are exact transforms of the supplied projected components.

```json
{
  "settings": {
    "scoring": "custom",
    "customScoring": {
      "rules": { "passingYards": 0.04, "passingTds": 6, "rushingYards": 0.1, "rushingTds": 6 },
      "positionRules": { "TE": { "receptions": 1.5 } },
      "bonuses": [{ "stat": "passing300", "points": 3, "probabilityStat": "passing300Probability", "threshold": 300 }]
    }
  },
  "playerProjections": {
    "123": {
      "projectionStats": { "passingYards": 4200, "passingTds": 32, "passing300Probability": 0.35 },
      "weeklyProjectionStats": [{ "passingYards": 250, "passingTds": 2, "passing300Probability": 0.25 }]
    }
  }
}
```

Bonuses require an explicit projected probability or expected count. SnapCount does not derive a threshold-hit probability from a mean stat projection. Missing required stat components cause the affected workflow to stop with an explicit error rather than falling back to PPR.

Draft custom scoring is a transfer-policy mode, not part of the qualified 10/12-team PPR Draft scope. A custom-scoring draft requires projected stat components for the full player pool that the room evaluates.

## CSV format

CSV uses one header and row types in `row_type` (or `type`):

- `league`: league name/week/user team/scoring/slot counts. Specify every lineup slot, including zero-valued slots, when exact structure matters. `custom_scoring_json` may contain the scoring object above.
- `roster`: `team_id`, `team_name`, `player_id` or `player_name`, `lineup_slot`, `locked`, `current_points`, `final`, and `kickoff`.
- `schedule`: `week`, `home_team_id`, `away_team_id`.
- `transaction`: `faab_budget`, `acquisition_limit`, `trade_deadline`, `roster_limit`, `ir_slots`, `waiver_type`, `roster_lock_type`, `lock_dropped_players_after_kickoff`, and `complete`.
- `projection`: `player_id`/`player_name`, `projection_stats_json`, and `weekly_projection_stats_json`.

Embedded stat objects are JSON strings inside CSV cells and therefore must be quoted using normal CSV escaping.

## Fail-closed boundaries

The importer does not pretend partial state is complete. Unsupported locked lineup slots block current-lineup optimization; duplicate ownership is rejected; unknown players are counted; unavailable custom scoring components block exact scoring; and missing transaction fields are reported as unknown rather than guessed.

The generic schema unlocks opponent-aware future-win decisions when recognized rosters plus H2H schedule data are present. Direct platform adapters remain convenience layers over this schema, not separate decision models.

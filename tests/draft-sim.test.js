"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/engine/core.js");
const draft = require("../src/engine/draft-sim.js");

function players(count = 180) {
  const positions = ["RB", "WR", "WR", "RB", "QB", "TE", "WR", "RB", "DST", "K"];
  return Array.from({ length: count }, (_, index) => {
    const position = positions[index % positions.length];
    const rank = index + 1;
    const weekly = Math.max(2, 22 - rank * 0.075 + (position === "QB" ? 1 : 0));
    return {
      id: `p${rank}`, name: `Player ${rank}`, position, team: `T${index % 32}`,
      projectedPoints: weekly * 17, weeklyProjection: weekly, weeklyProjections: Array(18).fill(weekly),
      floorProjection: weekly * 0.6, ceilingProjection: weekly * 1.55, projectionStdDev: weekly * 0.4,
      reliability: 0.75, injuryStatus: "ACTIVE", injuryRisk: 0.08, adp: rank, pprRank: rank,
      standardRank: rank, superflexRank: position === "QB" ? Math.max(1, rank - 20) : rank + 8,
    };
  });
}

test("custom ranking board accepts CSV and overrides market order", () => {
  const board = draft.parseRankingBoard("rank,name\n1,Player 20\n2,Player 4\n");
  const rows = players(30);
  assert.equal(draft.boardRank(rows[19], core.DEFAULT_SETTINGS, board), 1);
  assert.equal(draft.boardRank(rows[3], core.DEFAULT_SETTINGS, board), 2);
});

test("CPU draft room advance is deterministic for a seed", () => {
  const settings = core.cloneSettings({ teams: 10, rounds: 8, draftPosition: 5 });
  const state = core.createDraftState(settings);
  const first = draft.advanceToUser({ players: players(), state, settings, userTeamId: 5, strategy: "mixed", seed: "room" });
  const second = draft.advanceToUser({ players: players(), state, settings, userTeamId: 5, strategy: "mixed", seed: "room" });
  assert.deepEqual(first.state.picks, second.state.picks);
  assert.equal(first.summary.isUserPick, true);
  assert.equal(first.cpuPicks, 4);
});

test("full draft produces a complete user roster and season summary", () => {
  const settings = core.cloneSettings({ teams: 8, rounds: 8, draftPosition: 3 });
  const result = draft.simulateDraft({ players: players(), settings, userTeamId: 3, userStrategy: "oracle", opponentStrategy: "mixed", seed: "full" });
  assert.equal(result.completed, settings.teams * settings.rounds);
  assert.equal(result.userRoster.length, settings.rounds);
  assert.ok(result.summary.expectedSeasonStarterPoints > 0);
});

test("paired strategy benchmark is deterministic and finite", () => {
  const settings = core.cloneSettings({ teams: 8, rounds: 8, draftPosition: 4 });
  const options = { players: players(), settings, userTeamId: 4, opponentStrategy: "mixed", baselineStrategy: "espn-market", simulations: 12, seed: "bench" };
  const first = draft.benchmarkStrategies(options);
  const second = draft.benchmarkStrategies(options);
  assert.deepEqual(first, second);
  assert.equal(first.simulations, 12);
  assert.ok(Number.isFinite(first.meanSeasonEdge));
  assert.ok(first.oracleWinRate >= 0 && first.oracleWinRate <= 1);
});

test("return-chance simulation honors the selected custom market board", () => {
  const rows = players(100);
  const settings = core.cloneSettings({ teams: 10, rounds: 8, draftPosition: 5 });
  const state = core.createDraftState(settings);
  const board = draft.parseRankingBoard("rank,name\n1,Player 14\n2,Player 1\n3,Player 2\n4,Player 3\n");
  const custom = draft.simulatePickWindow({ players: rows, state, settings, targetTeamId: 5, strategy: "espn-market", board, simulations: 120, seed: "window" });
  const normal = draft.simulatePickWindow({ players: rows, state, settings, targetTeamId: 5, strategy: "espn-market", simulations: 120, seed: "window" });
  assert.ok(custom.availabilityById.p14 < normal.availabilityById.p14);
  assert.ok(custom.availabilityById.p14 >= 0 && custom.availabilityById.p14 <= 1);
});

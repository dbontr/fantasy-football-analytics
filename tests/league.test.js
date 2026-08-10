const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/engine/core.js");
const league = require("../src/engine/league.js");

test("manual league profile normalizes platform-neutral settings", () => {
  const profile = league.normalizeProfile({
    source: "manual",
    teams: 10,
    scoring: "half-ppr",
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPERFLEX: 0, DST: 0, K: 0, BN: 7 },
  });
  assert.equal(profile.source, "manual");
  assert.equal(profile.settings.teams, 10);
  assert.equal(profile.settings.scoring, "half-ppr");
  assert.equal(profile.settings.slots.WR, 3);
  assert.equal(profile.supported, true);
});

test("half-PPR projection is halfway between PPR and Standard families", () => {
  const player = {
    id: "wr", name: "Receiver", position: "WR", team: "DET",
    projectedPoints: 220, weeklyProjection: 20, weeklyProjections: Array(18).fill(20),
    standardProjectedPoints: 180, standardWeeklyProjection: 16, standardWeeklyProjections: Array(18).fill(16),
    floorProjection: 10, ceilingProjection: 30, projectionStdDev: 7,
  };
  const projected = league.playerForScoring(player, core.cloneSettings({ scoring: "half-ppr" }));
  assert.equal(projected.projectedPoints, 200);
  assert.equal(projected.weeklyProjection, 18);
  assert.equal(projected.weeklyProjections[0], 18);
});
test("connected free-agent pool excludes every rostered league player", () => {
  const players = ["a", "b", "c", "d"].map((id) => ({ id, name: id, position: "WR", team: "DET" }));
  const teams = [
    { teamId: "1", roster: [players[0], players[1]] },
    { teamId: "2", roster: [players[2]] },
  ];
  assert.deepEqual([...league.rosteredPlayerIds(teams)].sort(), ["a", "b", "c"]);
  assert.deepEqual(league.availablePlayers(players, teams, ["a"]).map((row) => row.id), ["d"]);
});

test("manual free-agent pool falls back to excluding the user's roster only", () => {
  const players = ["a", "b", "c"].map((id) => ({ id, name: id, position: "WR", team: "DET" }));
  assert.deepEqual(league.availablePlayers(players, null, ["a"]).map((row) => row.id), ["b", "c"]);
});
test("Draft A+ scope is explicit and does not silently extend to custom formats", () => {
  assert.equal(league.isQualifiedPprDraftScope(core.cloneSettings({ teams: 12, scoring: "ppr" })), true);
  assert.equal(league.isQualifiedPprDraftScope(core.cloneSettings({ teams: 12, scoring: "half-ppr" })), false);
  assert.equal(league.isQualifiedPprDraftScope(core.cloneSettings({ teams: 12, scoring: "ppr", slots: { SUPERFLEX: 1 } })), false);
  assert.equal(league.isQualifiedPprDraftScope(core.cloneSettings({ teams: 14, scoring: "ppr" })), false);
});
test("scoring adaptation is idempotent when a player passes through multiple decision layers", () => {
  const player = {
    id: "rb", name: "Back", position: "RB", team: "DET",
    projectedPoints: 210, weeklyProjection: 20, weeklyProjections: Array(18).fill(20),
    standardProjectedPoints: 170, standardWeeklyProjection: 16, standardWeeklyProjections: Array(18).fill(16),
  };
  const settings = core.cloneSettings({ scoring: "half-ppr" });
  const once = league.playerForScoring(player, settings);
  const twice = league.playerForScoring(once, settings);
  assert.equal(once.weeklyProjection, 18);
  assert.equal(twice.weeklyProjection, 18);
});
test("connected availability also respects the current local roster if it changed after sync", () => {
  const players = ["a", "b", "c", "d"].map((id) => ({ id, name: id, position: "WR", team: "DET" }));
  const teams = [{ teamId: "1", roster: [players[0]] }, { teamId: "2", roster: [players[1]] }];
  assert.deepEqual(league.availablePlayers(players, teams, ["c"]).map((row) => row.id), ["d"]);
});

test("lineup optimizer preserves locked starters and locked bench players", () => {
  const settings = core.cloneSettings({ slots: { QB: 0, RB: 2, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, DST: 0, K: 0, BN: 2 } });
  const low = { id: "low", name: "Locked low", position: "RB", team: "DET", weeklyProjection: 5 };
  const high = { id: "high", name: "High", position: "RB", team: "GB", weeklyProjection: 20 };
  const better = { id: "better", name: "Better", position: "RB", team: "MIN", weeklyProjection: 30 };
  const lineup = core.optimizeLineup([low, high, better], settings, "weeklyProjection", {
    lockedAssignments: [{ playerId: "low", slot: "RB" }],
    lockedBenchPlayerIds: ["better"],
  });
  assert.deepEqual(lineup.starters.map((row) => row.player?.id), ["low", "high"]);
  assert.equal(lineup.starters[0].locked, true);
  assert.ok(lineup.bench.some((player) => player.id === "better"));
});

test("live lineup state locks current slots after kickoff", () => {
  const players = [
    { id: "a", name: "A", position: "RB", team: "DET" },
    { id: "b", name: "B", position: "RB", team: "GB" },
  ];
  const schedule = {
    DET: { weeks: [{ date: 1000 }] },
    GB: { weeks: [{ date: 5000 }] },
  };
  const state = league.lineupConstraintsForTeam({ rosterEntries: [
    { playerId: "a", lineupSlot: "RB", currentPoints: 8.5 },
    { playerId: "b", lineupSlot: "BN", currentPoints: 99 },
  ] }, players, schedule, 1, { now: 2000, lineupLockType: "INDIVIDUAL_GAME" });
  assert.deepEqual(state.lockedAssignments, [{ playerId: "a", slot: "RB" }]);
  assert.deepEqual(state.lockedBenchPlayerIds, []);
  assert.equal(state.knownPoints, 8.5);
  assert.equal(state.complete, true);
});

test("platform-neutral JSON import normalizes rosters, schedule, and transaction state", () => {
  const players = [
    { id: "p1", name: "Alpha Runner", position: "RB", team: "DET" },
    { id: "p2", name: "Beta Receiver", position: "WR", team: "GB" },
  ];
  const imported = league.parseLeagueImport(JSON.stringify({
    name: "Any Platform League", currentWeek: 4, userTeamId: "10",
    settings: { scoring: "ppr", slots: { QB: 0, RB: 1, WR: 1, TE: 0, FLEX: 0, SUPERFLEX: 0, DST: 0, K: 0, BN: 2 } },
    transactions: { faabBudget: 100, acquisitionLimit: 5, tradeDeadline: "2026-11-20T00:00:00Z", rosterLimit: 4 },
    teams: [
      { teamId: "10", name: "Us", rosterEntries: [{ playerId: "p1", lineupSlot: "RB" }], transactions: { faabSpent: 25, acquisitions: 2 } },
      { teamId: "20", name: "Them", roster: [{ playerName: "Beta Receiver", lineupSlot: "WR" }] },
    ],
    fantasySchedule: { 4: [["10", "20"]] },
  }), players);
  assert.equal(imported.name, "Any Platform League");
  assert.deepEqual(imported.teams[0].rosterIds, ["p1"]);
  assert.deepEqual(imported.teams[1].rosterIds, ["p2"]);
  assert.deepEqual(imported.fantasySchedule[4], [["10", "20"]]);
  assert.equal(league.transactionStateForTeam(imported, "10").faabRemaining, 75);
});

test("transaction feasibility blocks impossible bids, limits, deadlines, and locked players", () => {
  const leagueState = {
    transactions: { faabBudget: 100, acquisitionLimit: 3, tradeDeadline: 1000, rosterLimit: 2, irSlots: 1, lockDroppedPlayersAfterKickoff: true },
    teams: [{ teamId: "1", transactions: { faabSpent: 80, acquisitions: 3, irUsed: 1 } }],
  };
  assert.equal(league.transactionFeasibility({ league: leagueState, teamId: "1", type: "waiver", bid: 30 }).allowed, false);
  assert.match(league.transactionFeasibility({ league: leagueState, teamId: "1", type: "waiver", bid: 30 }).reasons.join(" "), /acquisition limit|FAAB/);
  assert.equal(league.transactionFeasibility({ league: leagueState, teamId: "1", type: "trade", now: 2000 }).allowed, false);
  assert.equal(league.transactionFeasibility({ league: leagueState, teamId: "1", type: "trade", now: 500, involvedPlayerIds: ["x"], lockedPlayerIds: ["x"] }).allowed, true);
  assert.equal(league.transactionFeasibility({ league: leagueState, teamId: "1", type: "waiver", involvedPlayerIds: ["x"], lockedPlayerIds: ["x"] }).allowed, false);
});

test("custom scoring is exact from projected stat lines and fails closed on missing components", () => {
  const scoring = {
    rules: { passingYards: 0.04, passingTds: 6 },
    positionRules: { TE: { receptions: 1.5 } },
    bonuses: [{ stat: "passing300", points: 3, probabilityStat: "passing300Probability", threshold: 300 }],
  };
  assert.equal(league.scoreStatLine({ passingYards: 300, passingTds: 2, passing300Probability: 0.4 }, scoring, "QB"), 25.2);
  assert.equal(league.scoreStatLine({ passingYards: 0, passingTds: 0, passing300Probability: 0, receptions: 6 }, scoring, "TE"), 9);
  assert.throws(() => league.scoreStatLine({ passingYards: 300 }, scoring, "QB"), /missing projected stat components/i);
});

test("custom scoring player projection uses supplied season and weekly stat lines", () => {
  const player = {
    id: "qb", name: "Quarterback", position: "QB", team: "DET",
    projectedPoints: 300, weeklyProjection: 18, weeklyProjections: Array(18).fill(18),
    floorProjection: 10, ceilingProjection: 30, projectionStdDev: 6,
    projectionStats: { passingYards: 4000, passingTds: 30 },
    weeklyProjectionStats: Array(18).fill(null).map(() => ({ passingYards: 250, passingTds: 2 })),
  };
  const settings = core.cloneSettings({ scoring: "custom" });
  settings.customScoring = { rules: { passingYards: 0.04, passingTds: 6 } };
  const scored = league.playerForScoring(player, settings);
  assert.equal(scored.projectedPoints, 340);
  assert.equal(scored.weeklyProjection, 22);
  assert.equal(scored.weeklyProjections[0], 22);
  assert.throws(() => league.playerForScoring({ ...player, projectionStats: null }, settings), /missing projected stat components/i);
});

test("platform-neutral CSV import accepts roster, schedule, and transaction rows", () => {
  const players = [
    { id: "p1", name: "Alpha Runner", position: "RB", team: "DET" },
    { id: "p2", name: "Beta Receiver", position: "WR", team: "GB" },
  ];
  const csv = [
    "row_type,league_name,current_week,user_team_id,scoring,slot_qb,slot_rb,slot_wr,slot_te,slot_flex,slot_superflex,slot_dst,slot_k,slot_bn,team_id,team_name,player_id,player_name,lineup_slot,week,home_team_id,away_team_id,faab_budget,acquisition_limit,roster_limit",
    "league,CSV League,2,1,ppr,0,1,1,0,0,0,0,0,2,,,,,,,,,,,",
    "roster,,,,,,,,,,,,,,1,Us,p1,Alpha Runner,RB,,,,,,",
    "roster,,,,,,,,,,,,,,2,Them,p2,Beta Receiver,WR,,,,,,",
    "schedule,,,,,,,,,,,,,,,,,,,2,1,2,,,",
    "transaction,,,,,,,,,,,,,,,,,,,,,,100,5,4",
  ].join("\n");
  const imported = league.parseLeagueImport(csv, players);
  assert.equal(imported.name, "CSV League");
  assert.deepEqual(imported.fantasySchedule[2], [["1", "2"]]);
  assert.equal(imported.transactions.faabBudget, 100);
  assert.equal(imported.transactions.acquisitionLimit, 5);
});

test("unknown transaction usage stays unknown instead of assuming zero spend", () => {
  const leagueState = {
    transactions: { faabBudget: 100, acquisitionLimit: 1 },
    teams: [{ teamId: "1", transactions: {} }],
  };
  const state = league.transactionStateForTeam(leagueState, "1");
  assert.equal(state.usage.faabSpent, null);
  assert.equal(state.usage.acquisitions, null);
  assert.equal(state.faabRemaining, null);
  assert.equal(league.transactionFeasibility({ league: leagueState, teamId: "1", type: "waiver" }).allowed, true);
});

test("transaction feasibility enforces known roster and IR capacity without inventing omitted IR rules", () => {
  const leagueState = {
    transactions: { rosterLimit: 2, irSlots: 1 },
    teams: [{ teamId: "1", transactions: { irUsed: 1 } }],
  };
  assert.equal(league.transactionFeasibility({ league: leagueState, teamId: "1", type: "trade", rosterCountAfter: 3 }).allowed, false);
  assert.equal(league.transactionFeasibility({ league: leagueState, teamId: "1", type: "waiver", irCountAfter: 2 }).allowed, false);
  const imported = league.normalizeLeagueState({
    teams: [{ teamId: "1", roster: [] }, { teamId: "2", roster: [] }],
    settings: { scoring: "ppr", slots: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, DST: 0, K: 0, BN: 1 } },
  }, []);
  assert.equal(imported.transactions.irSlots, null);
});
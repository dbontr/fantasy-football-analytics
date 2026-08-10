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
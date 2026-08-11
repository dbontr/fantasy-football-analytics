"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/engine/core.js");

function row(id, name, position, weekly) {
  return { id, name, position, team: "T1", projectedPoints: weekly * 17, weeklyProjection: weekly, weeklyProjections: Array(18).fill(weekly), floorProjection: weekly * 0.6, ceilingProjection: weekly * 1.5, projectionStdDev: weekly * 0.4, reliability: 0.75, injuryStatus: "ACTIVE", injuryRisk: 0.08 };
}

test("qualified waiver minimum score can suppress marginal claims", () => {
  const roster = [row("qb", "QB", "QB", 18), row("rb1", "RB1", "RB", 10), row("rb2", "RB2", "RB", 9), row("wr1", "WR1", "WR", 10), row("wr2", "WR2", "WR", 9), row("te", "TE", "TE", 7), row("bn", "Bench", "WR", 4)];
  const freeAgents = [row("fa", "Breakout", "WR", 13)];
  const low = core.waiverRecommendations(roster, freeAgents, core.DEFAULT_SETTINGS, 5, 4, { minimumScore: 0.25 });
  assert.ok(low.length > 0);
  const high = core.waiverRecommendations(roster, freeAgents, core.DEFAULT_SETTINGS, 5, 4, { minimumScore: low[0].score + 1 });
  assert.equal(high.length, 0);
});

test("direct trade analysis consumes every player in a larger package", () => {
  const settings = { teams: 10, slots: { QB: 0, RB: 1, WR: 1, TE: 0, FLEX: 0, SUPERFLEX: 0, DST: 0, K: 0, BN: 4 } };
  const give = [row("g1", "Give RB", "RB", 12), row("g2", "Give WR One", "WR", 11), row("g3", "Give WR Two", "WR", 9)];
  const keep = row("keep", "Keep RB", "RB", 8);
  const receive = [row("r1", "Receive RB", "RB", 14), row("r2", "Receive WR", "WR", 13)];
  const analysis = core.analyzeTrade({ roster: [...give, keep], give, receive, players: [...give, keep, ...receive], settings, week: 1 });
  assert.deepEqual(analysis.afterRoster.map((player) => player.id).sort(), ["keep", "r1", "r2"]);
  assert.ok(Number.isFinite(analysis.giveValue) && Number.isFinite(analysis.receiveValue));
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../src/engine/runtime.js");

function makePlayer(id, position, team, mean, extra = {}) {
  return {
    id: String(id),
    name: `Player ${id}`,
    position,
    team,
    projectedPoints: mean * 17,
    weeklyProjection: mean,
    weeklyProjections: Array(18).fill(mean),
    floorProjection: mean * 0.55,
    ceilingProjection: mean * 1.6,
    projectionStdDev: mean * 0.4,
    reliability: 0.8,
    injuryStatus: "ACTIVE",
    injuryRisk: 0.08,
    active: true,
    opportunity: {
      modelEdge: 0.03,
      usageTrend: 0.02,
      volumeStability: 0.8,
      reliability: 0.78,
      targetShare: position === "WR" ? 0.23 : 0.1,
      carryShare: position === "RB" ? 0.52 : 0.05,
    },
    ...extra,
  };
}

const player = makePlayer("wr1", "WR", "DET", 16);

test("forecast produces ordered zero-inflated distribution", () => {
  const forecast = engine.forecastPlayer(player, { week: 1 });
  assert.ok(forecast.distribution.p10 <= forecast.distribution.p50);
  assert.ok(forecast.distribution.p50 <= forecast.distribution.p90);
  assert.ok(forecast.availability.probability > 0.9);
  assert.ok(forecast.distribution.mean > 0);
});

test("bye week forecast is zero", () => {
  const forecast = engine.forecastPlayer({ ...player, byeWeek: 4 }, { week: 4 });
  assert.equal(forecast.distribution.mean, 0);
  assert.equal(forecast.availability.probability, 0);
});

test("scenario simulation is deterministic for a seed", () => {
  const forecasts = [
    engine.forecastPlayer(makePlayer("qb", "QB", "DET", 20), { week: 1 }),
    engine.forecastPlayer(makePlayer("wr", "WR", "DET", 15), { week: 1 }),
  ];
  const options = { week: 1, scenarios: 500, seed: "fixed", correlationPairs: [["qb", "wr"]] };
  const first = engine.simulateForecasts(forecasts, options);
  const second = engine.simulateForecasts(forecasts, options);
  assert.equal(first.playerSummaries.qb.mean, second.playerSummaries.qb.mean);
  assert.equal(first.correlations[0].correlation, second.correlations[0].correlation);
});

test("robust ranking prefers consistently stronger action", () => {
  const result = engine.rankPairedActions([
    { id: "a", samples: [10, 11, 12, 11, 10] },
    { id: "b", samples: [13, 14, 15, 14, 13] },
  ]);
  assert.equal(result.preferredActionId, "b");
  assert.ok(result.paretoFrontier.includes("b"));
});

test("league simulation awards exactly one championship per scenario", () => {
  const positions = ["QB", "RB", "RB", "WR", "WR", "TE", "DST", "K"];
  const teams = Array.from({ length: 4 }, (_, teamIndex) => ({
    teamId: String(teamIndex + 1),
    name: `Team ${teamIndex + 1}`,
    roster: positions.map((position, playerIndex) => makePlayer(
      `${teamIndex + 1}-${playerIndex}`,
      position,
      ["DET", "GB", "MIN", "CHI"][teamIndex],
      8 + playerIndex + teamIndex * 0.3,
    )),
  }));
  const result = engine.simulateLeague({
    teams,
    startWeek: 1,
    regularSeasonEnd: 2,
    championshipWeek: 4,
    playoffTeams: 4,
    simulations: 300,
    seed: "league-test",
  });
  const total = result.teams.reduce((sum, row) => sum + row.championshipProbability, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.equal(result.teams.length, 4);
});

test("online ensemble weights penalize higher loss", () => {
  const result = engine.updateEnsembleWeights({ modelA: 0.5, modelB: 0.5 }, { modelA: 2, modelB: 0.5 });
  assert.ok(result.modelB > result.modelA);
  assert.ok(Math.abs(result.modelA + result.modelB - 1) < 1e-12);
});

test("position-specific matchup prior moves forecasts in the expected direction", () => {
  const neutral = engine.forecastPlayer(player, { week: 1 });
  const favorable = engine.forecastPlayer(player, { week: 1, evidence: { "matchup.position_grade": { available: true, value: 1, confidence: 0.4, conflict: 0 } } });
  const difficult = engine.forecastPlayer(player, { week: 1, evidence: { "matchup.position_grade": { available: true, value: -1, confidence: 0.4, conflict: 0 } } });
  assert.ok(favorable.distribution.mean > neutral.distribution.mean);
  assert.ok(difficult.distribution.mean < neutral.distribution.mean);
  assert.ok(favorable.drivers.some((row) => row.feature === "matchup.position_grade"));
});


test("xFP, redistribution, and preseason evidence remain bounded forecast drivers", () => {
  const base = engine.forecastPlayer(player, { week: 1 });
  const enhanced = engine.forecastPlayer(player, { week: 1, evidence: {
    "opportunity.xfp": { available: true, value: 22, confidence: 0.32 },
    "efficiency.fpoe": { available: true, value: 4, confidence: 0.22 },
    "role.redistribution_delta": { available: true, value: 0.2, confidence: 0.42 },
    "preseason.usage_boost": { available: true, value: 0.2, confidence: 0.2 },
  } });
  assert.ok(enhanced.distribution.mean > base.distribution.mean);
  assert.ok(enhanced.drivers.some((row) => row.feature === "opportunity.xfp"));
  assert.ok(enhanced.drivers.some((row) => row.feature === "preseason.usage_boost"));
  assert.ok(enhanced.distribution.mean < base.distribution.mean * 1.7);
});

test("live scoring environment nudges offensive projections without dominating them", () => {
  const base = engine.forecastPlayer(player, { week: 1 });
  const high = engine.forecastPlayer(player, { week: 1, evidence: {
    "market.game_total": { available: true, value: 52, confidence: 0.42 },
    "market.team_implied_points": { available: true, value: 29, confidence: 0.46 },
  } });
  assert.ok(high.distribution.mean > base.distribution.mean);
  assert.ok(high.drivers.some((row) => row.feature === "market.team_implied_points"));
  assert.ok(high.distribution.mean < base.distribution.mean * 1.25);
});

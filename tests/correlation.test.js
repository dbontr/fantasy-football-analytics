"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/engine/correlation.js");
const engine = require("../src/engine/runtime.js");

function player(id, position, team, mean = 15) {
  return {
    id,
    name: id,
    position,
    team,
    projectedPoints: mean * 17,
    weeklyProjection: mean,
    weeklyProjections: Array(18).fill(mean),
    projectionStdDev: mean * 0.5,
    reliability: 0.9,
    injuryStatus: "ACTIVE",
    active: true,
    opportunity: { volumeStability: 0.9, reliability: 0.9 },
  };
}

function forecast(id, position, team, mean) {
  return engine.forecastPlayer(player(id, position, team, mean), { week: 1 });
}

const schedule = {
  DET: { weeks: [{ opponent: "GB" }] },
  GB: { weeks: [{ opponent: "DET" }] },
};
test("empirical correlation model is fitted without treating inspected 2025 as a pristine holdout", () => {
  assert.deepEqual(model.TRAINING_SEASONS, [2023, 2024]);
  assert.equal(model.CONSISTENCY_SEASON, 2025);
  assert.equal(model.SHRINKAGE_PAIRS, 200);
  assert.equal(model.targetCorrelation("QB", "WR", true), 0.277);
  assert.equal(model.targetCorrelation("WR", "WR", true), 0.008);
  assert.equal(model.targetCorrelation("QB", "WR", false), 0.023);
});

test("pair-factor plan preserves unit marginal variance", () => {
  const forecasts = [
    forecast("qb", "QB", "DET", 20),
    forecast("wr1", "WR", "DET", 16),
    forecast("wr2", "WR", "DET", 13),
    forecast("te", "TE", "DET", 11),
    forecast("rb", "RB", "DET", 14),
    forecast("opp-qb", "QB", "GB", 19),
  ];
  const plan = engine.buildCorrelationPlan(forecasts, schedule, 1);
  for (let index = 0; index < plan.entries.length; index += 1) {
    let variance = plan.entries[index].residualWeight ** 2;
    for (const edge of plan.edges) {
      if (edge.leftIndex === index) variance += edge.leftWeight ** 2;
      if (edge.rightIndex === index) variance += edge.rightWeight ** 2;
    }
    assert.ok(Math.abs(variance - 1) < 1e-10);
  }
});
test("same-team QB-WR residual correlation tracks the fitted target", () => {
  const forecasts = [forecast("qb", "QB", "DET", 20), forecast("wr", "WR", "DET", 16)];
  const result = engine.simulateForecasts(forecasts, {
    week: 1,
    schedule,
    scenarios: 12000,
    seed: "empirical-qb-wr",
    correlationPairs: [["qb", "wr"]],
  });
  assert.equal(result.correlationVersion, model.VERSION);
  assert.ok(Math.abs(result.correlations[0].correlation - 0.277) < 0.04);
});

test("receiver competition is no longer given a large fake positive correlation", () => {
  const forecasts = [
    forecast("wr1", "WR", "DET", 16),
    forecast("wr2", "WR", "DET", 13),
    forecast("rb", "RB", "DET", 15),
  ];
  const result = engine.simulateForecasts(forecasts, {
    week: 1,
    schedule,
    scenarios: 12000,
    seed: "empirical-competition",
    correlationPairs: [["wr1", "wr2"], ["rb", "wr1"]],
  });
  assert.ok(Math.abs(result.correlations[0].correlation) < 0.06);
  assert.ok(result.correlations[1].correlation < 0.02);
});
test("opposing skill players use small fitted game correlations instead of the legacy blanket factor", () => {
  const forecasts = [forecast("det-qb", "QB", "DET", 20), forecast("gb-wr", "WR", "GB", 15)];
  const result = engine.simulateForecasts(forecasts, {
    week: 1,
    schedule,
    scenarios: 12000,
    seed: "empirical-opponents",
    correlationPairs: [["det-qb", "gb-wr"]],
  });
  assert.ok(Math.abs(result.correlations[0].correlation - 0.023) < 0.04);
  assert.ok(result.correlations[0].correlation < 0.09);
});

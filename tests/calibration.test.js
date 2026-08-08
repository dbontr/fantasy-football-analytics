"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const calibration = require("../src/engine/calibration.js");

function player(overrides = {}) {
  return {
    id: "p1",
    name: "Test Player",
    position: "QB",
    weeklyProjection: 20,
    projectedPoints: 340,
    projectionStdDev: 4,
    ...overrides,
  };
}

test("empirical volatility is trained without the 2025 holdout", () => {
  assert.deepEqual(calibration.TRAINING_SEASONS, [2023, 2024]);
  assert.equal(calibration.HOLDOUT_SEASON, 2025);
  assert.equal(Number(calibration.empiricalCv("QB", 20).toFixed(3)), 0.415);
  assert.equal(Number(calibration.empiricalCv("WR", 12).toFixed(3)), 0.616);
});

test("calibration widens underdispersed players without changing their mean", () => {
  const original = player();
  const adjusted = calibration.calibratePlayer(original, {});
  assert.equal(adjusted.weeklyProjection, original.weeklyProjection);
  assert.equal(adjusted.projectedPoints, original.projectedPoints);
  assert.ok(adjusted.projectionStdDev > original.projectionStdDev);
  assert.equal(Number((adjusted.projectionStdDev / adjusted.weeklyProjection).toFixed(3)), 0.415);
});

test("calibration never narrows an already wider forecast", () => {
  const original = player({ projectionStdDev: 12 });
  assert.equal(calibration.calibratePlayer(original, {}), original);
});

test("realized historical volatility becomes bounded uncertainty evidence", () => {
  const evidence = calibration.historicalVolatilityEvidence({
    season: { games: 12, ppr: 10, volatility: 7 },
  }, { historySeason: 2025, targetSeason: 2026 });
  assert.ok(evidence);
  assert.equal(Number(evidence.value.toFixed(2)), 0.70);
  assert.ok(evidence.confidence > 0.4 && evidence.confidence < 0.5);
  assert.equal(calibration.historicalVolatilityEvidence({ season: { games: 3, ppr: 10, volatility: 7 } }), null);
});

test("player-specific volatility may widen but cannot defeat the cohort floor", () => {
  const stable = calibration.calibratePlayer(player(), {
    "uncertainty.volatility_cv": { available: true, value: 0.2, confidence: 1 },
  });
  const volatile = calibration.calibratePlayer(player(), {
    "uncertainty.volatility_cv": { available: true, value: 0.9, confidence: 1 },
  });
  assert.equal(Number((stable.projectionStdDev / 20).toFixed(3)), 0.415);
  assert.ok(volatile.projectionStdDev > stable.projectionStdDev);
});

test("install patches history and direct forecasts idempotently", () => {
  const intelligence = {
    historyEvidence() { return { "role.target_share": { value: 0.2 } }; },
  };
  const engine = {
    forecastPlayer(p) { return { player: p, distribution: { mean: p.weeklyProjection } }; },
    forecastPlayers(players) { return players.map((p) => this.forecastPlayer(p)); },
    simulateRosterSeason(options) { return options; },
    simulateLeague(options) { return options; },
    evaluateChampionshipActions(options) { return options; },
  };
  assert.equal(calibration.install(engine, intelligence), true);
  assert.equal(calibration.install(engine, intelligence), true);
  const history = intelligence.historyEvidence({ season: { games: 8, ppr: 12, volatility: 8 } }, player(), { historySeason: 2025, targetSeason: 2026 });
  assert.ok(history["uncertainty.volatility_cv"]);
  const forecast = engine.forecastPlayer(player(), {});
  assert.ok(forecast.player.projectionStdDev > 8.29);
});

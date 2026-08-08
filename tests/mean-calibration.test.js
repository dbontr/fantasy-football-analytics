"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/engine/mean-calibration.js");

test("mean calibration preserves the frozen historical split and coefficients", () => {
  assert.deepEqual(model.TRAINING_SEASONS, [2021, 2022, 2023]);
  assert.equal(model.FROZEN_TEST_SEASON, 2024);
  assert.equal(model.CONSISTENCY_SEASON, 2025);
  assert.equal(model.MODELS.QB, null);
  assert.equal(model.MODELS.RB.coefficients.defense, 0.056113);
  assert.equal(model.MODELS.WR.coefficients.practiceDnp, -0.121268);
  assert.equal(model.MODELS.TE.coefficients.snap, 0.239355);
});

test("validated drivers require the live ESPN PPR anchor", () => {
  const player = { position: "RB" };
  const evidence = { "matchup.position_grade": { available: true, value: 1 } };
  assert.deepEqual(model.drivers(player, { mean: 15 }, evidence), []);
  const live = model.drivers({ ...player, projectionSource: "espn-live-ppr" }, { mean: 15 }, evidence);
  assert.ok(live.some((row) => row.feature === "matchup.position_grade"));
});

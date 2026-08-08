"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const profile = require("../data/analytics-runtime-profile.json");
const core = require("../src/engine/core.js");

test("runtime profile serves only frozen A+ qualified analytics", () => {
  assert.equal(profile.mode, "serve-frozen-qualified-analytics");
  assert.ok(Object.keys(profile.grades).length >= 8);
  assert.ok(Object.values(profile.grades).every((grade) => grade === "A+"));
  assert.equal(profile.startSit.validatedMeanScale, 0);
  assert.equal(profile.waivers.validatedMeanScale, 0);
  assert.equal(profile.trades.validatedMeanScale, 0);
  assert.equal(profile.players.validatedMeanScale, 1);
  assert.equal(profile.draft.policy, "segmented-qualified");
  assert.ok(Object.keys(profile.draft.segments).length >= 6);
});

test("runtime profile contains no historical training dataset", () => {
  const text = JSON.stringify(profile);
  assert.equal(text.includes("historical-ppr-"), false);
  assert.equal(text.includes("player-weeks"), false);
  assert.equal(text.includes("frozen2024"), false);
});

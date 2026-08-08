"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const profile = require("../data/analytics-runtime-profile.json");
const robustDraft = require("../data/validation/draft-robust-policy.json");
const core = require("../src/engine/core.js");

test("runtime profile serves all A+ frozen qualified analytics", () => {
  assert.equal(profile.mode, "serve-frozen-qualified-analytics");
  assert.ok(Object.keys(profile.grades).length >= 8);
  for (const grade of Object.values(profile.grades)) assert.equal(grade, "A+");
  assert.equal(profile.startSit.validatedMeanScale, 0);
  assert.equal(profile.waivers.validatedMeanScale, 0);
  assert.equal(profile.trades.validatedMeanScale, 0);
  assert.equal(profile.players.validatedMeanScale, 1);
  assert.equal(profile.draft.policy, "segmented-qualified");
  assert.ok(Object.keys(profile.draft.segments).length >= 6);
  assert.equal(profile.draft.postFreezeHoldoutSeason, 2018);
  assert.equal(profile.draft.policyDefinitionSha256, robustDraft.policyDefinitionSha256);
  for (const policy of Object.values(profile.draft.segments)) assert.deepEqual(policy, robustDraft.policy);
  assert.deepEqual(profile.draft.fallbackPolicy, robustDraft.policy);
});

test("runtime profile contains no historical training dataset", () => {
  const text = JSON.stringify(profile);
  assert.equal(text.includes("historical-ppr-"), false);
  assert.equal(text.includes("player-weeks"), false);
  assert.equal(text.includes("frozen2024"), false);
});

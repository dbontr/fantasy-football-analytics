"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const profile = require("../data/analytics-runtime-profile.json");
const robustDraft = require("../data/validation/draft-robust-policy.json");
const draftOverfit = require("../data/validation/draft-overfit-audit.json");
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
  assert.equal(draftOverfit.gates.robustnessPass, true);
  assert.equal(profile.draft.robustnessAuditVersion, draftOverfit.version);
  assert.deepEqual(profile.draft.robustnessEvidenceYears, draftOverfit.evidenceYears);
  for (const policy of Object.values(profile.draft.segments)) assert.deepEqual(policy, robustDraft.policy);
  assert.deepEqual(profile.draft.fallbackPolicy, robustDraft.policy);
});

test("runtime profile contains no historical training dataset", () => {
  const text = JSON.stringify(profile);
  assert.equal(text.includes("historical-ppr-"), false);
  assert.equal(text.includes("player-weeks"), false);
  assert.equal(text.includes("frozen2024"), false);
});

test("Draft anti-overfit guard keeps adverse seasons visible and clears aggregate uncertainty gates", () => {
  assert.deepEqual(
    draftOverfit.individualFailures.map((row) => [row.year, row.control]),
    [[2021, "need-heavy"], [2023, "need-heavy"]],
  );
  for (const row of Object.values(draftOverfit.controls)) {
    assert.ok(row.seasonBootstrap.edge95[0] > 0);
    assert.ok(row.seasonBootstrap.winRate95[0] > 0.5);
    assert.ok(row.jackknifeMinimum.edge >= 0);
    assert.ok(row.jackknifeMinimum.winRate >= 0.5);
  }
  assert.ok(draftOverfit.controls["espn-market"].seasonBootstrap.winRate95[0] > 0.75);
  assert.equal(draftOverfit.finalistNeighborhood.productionFullRank, 1);
  assert.equal(draftOverfit.finalistNeighborhood.productionTop3LeaveOneDevelopmentSeasonOut, 7);
});

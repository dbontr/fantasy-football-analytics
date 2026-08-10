"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const profile = require("../data/analytics-runtime-profile.json");
const robustDraft = require("../data/validation/draft-robust-policy.json");
const draftOverfit = require("../data/validation/draft-overfit-audit.json");
const forecastOverfit = require("../data/validation/forecast-overfit-audit.json");
const forecastSuccessor = require("../data/validation/forecast-successor-candidate.json");
const core = require("../src/engine/core.js");

test("runtime profile serves A+ decision analytics with explicitly downgraded forecast provenance", () => {
  assert.equal(profile.mode, "serve-frozen-qualified-analytics");
  assert.ok(Object.keys(profile.grades).length >= 8);
  for (const [surface, grade] of Object.entries(profile.grades)) assert.equal(grade, surface === "provenance" ? "A" : "A+");
  assert.equal(profile.players.trainingProvenance.exactOriginalFitReproducible, false);
  assert.equal(profile.players.trainingProvenance.servingCoefficientsMatchStoredReport, true);
  assert.equal(profile.players.robustnessAuditVersion, forecastOverfit.version);
  assert.deepEqual(profile.players.robustnessEvidenceYears, forecastOverfit.evidenceYears);
  assert.equal(profile.players.prospectiveSuccessor.modelSha256, forecastSuccessor.candidateModelSha256);
  assert.equal(profile.players.prospectiveSuccessor.mayServeNow, false);
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

test("forecast anti-overfit guard preserves abstention and clears season robustness gates", () => {
  assert.equal(forecastOverfit.gates.robustnessPass, true);
  assert.ok(forecastOverfit.seasonClusterBootstrap.maeImprovement95[0] > 0);
  assert.ok(forecastOverfit.seasonClusterBootstrap.rmseImprovement95[0] > 0);
  for (const season of forecastOverfit.evidenceYears) {
    assert.ok(forecastOverfit.seasons[season].delta.maeImprovement > 0);
    assert.ok(forecastOverfit.seasons[season].delta.rmseImprovement > 0);
    assert.ok(forecastOverfit.seasons[season].delta.rankImprovement >= 0);
  }
  assert.deepEqual(new Set(forecastOverfit.nonImprovingPositionSeasonCells.map((row) => row.position)), new Set(["QB"]));
  assert.equal(forecastOverfit.nonImprovingPositionSeasonCells.length, 6);
  assert.equal(forecastOverfit.negativePositionSeasonCells.length, 0);
  assert.equal(forecastSuccessor.status, "prospective-only-not-serving");
  assert.equal(forecastSuccessor.restrictions.mayUse2024Or2025ForAdmission, false);
  assert.equal(forecastSuccessor.preRegisteredAdmission.evaluationSeason, 2026);
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

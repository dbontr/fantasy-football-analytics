"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const artifact = require("../data/rookies-2026.json");
const rookies = require("../src/engine/rookies.js");
const engine = require("../src/engine/runtime.js");

test("rookie artifact has current fantasy coverage and historical cohort support", () => {
  assert.ok(artifact.players.length >= 60);
  assert.ok(artifact.meta.historicalRookieCount >= 1500);
  const love = artifact.players.find((row) => row.name === "Jeremiyah Love");
  assert.equal(love.draft.overall, 3);
  assert.equal(love.draft.bucket, "top12");
  assert.ok(love.prior.sampleSize > 0);
  assert.ok(love.prior.p90 > love.prior.p50);
});

test("rookie enrichment attaches identity and bounded structured evidence", () => {
  const local = [{ id: "4870808", name: "Jeremiyah Love", position: "RB", team: "ARI", weeklyProjection: 12.5, projectedPoints: 212.5 }];
  const player = rookies.enrichPlayers(local, artifact)[0];
  assert.equal(player.rookie.draft.overall, 3);
  assert.equal(player.yearsExperience, 0);
  const evidence = rookies.evidence(player, { week: 12 });
  assert.ok(evidence["rookie.cohort_ppg"]);
  assert.ok(evidence["rookie.draft_capital"].value <= 1);
  assert.ok(Math.abs(evidence["rookie.development_delta"].value) < 0.3);
});

function baseRookie(overrides = {}) {
  const source = artifact.players.find((row) => row.name === "Carnell Tate");
  return {
    id: source.id, name: source.name, position: source.position, team: source.team,
    projectedPoints: 136, weeklyProjection: 8, weeklyProjections: Array(18).fill(8),
    floorProjection: 4, ceilingProjection: 14, projectionStdDev: 3.8,
    reliability: 0.705, injuryStatus: "ACTIVE", injuryRisk: 0.08, active: true,
    opportunity: {}, rookie: source, age: source.age,
    ...overrides,
  };
}

test("rookies carry more role uncertainty until live role evidence arrives", () => {
  const uncertain = baseRookie();
  const confirmed = baseRookie({ sleeper: { depthChartOrder: 1 } });
  const uncertainEvidence = rookies.evidence(uncertain, { week: 1 });
  const confirmedEvidence = {
    ...rookies.evidence(confirmed, { week: 1 }),
    "preseason.usage_boost": { available: true, value: 0.18, confidence: 0.2, conflict: 0.1 },
  };
  const first = engine.forecastPlayer(uncertain, { week: 1, evidence: uncertainEvidence });
  const second = engine.forecastPlayer(confirmed, { week: 1, evidence: confirmedEvidence });
  assert.ok(first.uncertainty.role > second.uncertainty.role);
  assert.ok(first.activeDistribution.standardDeviation > 0);
});

test("rookie mean corrections remain conservative around the market projection", () => {
  const player = baseRookie({ sleeper: { depthChartOrder: 1 } });
  const forecast = engine.forecastPlayer(player, { week: 10, evidence: rookies.evidence(player, { week: 10 }) });
  assert.ok(forecast.drivers.some((row) => row.family === "rookie"));
  assert.ok(forecast.distribution.mean > 6.4);
  assert.ok(forecast.distribution.mean < 9.6);
});

test("missing combine data stays missing instead of becoming a false zero-percentile penalty", () => {
  const source = artifact.players.find((row) => row.name === "Jeremiyah Love");
  assert.equal(source.combine.percentile, null);
  const player = rookies.enrichPlayers([{ id: source.id, name: source.name, position: source.position, team: source.team }], artifact)[0];
  const evidence = rookies.evidence(player, { week: 1 });
  assert.equal(evidence["rookie.athletic_percentile"], undefined);
  assert.equal(rookies.summary(player).athleticPercentile, null);
});

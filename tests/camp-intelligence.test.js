"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const live = require("../src/engine/live-intelligence.js");
const engine = require("../src/engine/runtime.js");
const artifact = require("../data/camp-2026.json");

function player(id = "123", position = "WR") {
  return {
    id, name: "Camp Player", position, team: "DET", weeklyProjection: 15,
    weeklyProjections: Array(18).fill(15), projectedPoints: 255,
    floorProjection: 8, ceilingProjection: 24, projectionStdDev: 6,
    reliability: 0.8, injuryStatus: "ACTIVE", injuryRisk: 0.08, active: true,
    opportunity: { targetShare: 0.2, carryShare: 0.05, reliability: 0.75 },
  };
}

test("camp classifier separates performance warnings from role demotion", () => {
  const result = live.classifyCampText("Training camp practice included a couple of drops, but he remained with the starters.");
  assert.equal(result.active, true);
  assert.ok(result.performanceScore < 0);
  assert.equal(result.roleScore, 0);
  assert.ok(result.matches.some((row) => row.key === "performance.negative"));
});
test("first-team role evidence outranks generic camp hype", () => {
  const role = live.classifyCampText("Training camp: he worked with the first-team offense throughout practice.");
  const hype = live.classifyCampText("Training camp: he looked impressive in practice.");
  assert.ok(role.roleScore > 0);
  assert.ok(role.score > hype.score);
});

test("camp evidence is advisory and cannot move the forecast mean", () => {
  const target = player();
  const base = engine.forecastPlayer(target, { week: 1 });
  const withCamp = engine.forecastPlayer(target, { week: 1, evidence: {
    "camp.signal": { available: true, value: -1, confidence: 1, conflict: 0, modelEffect: "advisory-only" },
  } });
  assert.equal(withCamp.distribution.mean, base.distribution.mean);
  assert.equal(withCamp.drivers.some((row) => row.feature === "camp.signal"), false);
});

test("committed camp artifact stores compact advisory signals, not article bodies", () => {
  assert.equal(artifact.meta.version, "camp-intelligence-2026.1");
  assert.ok(artifact.players.length >= 10);
  assert.ok(artifact.players.every((row) => row.modelEffect === "advisory-only"));
  const text = JSON.stringify(artifact);
  assert.equal(text.includes("<p"), false);
  assert.equal(text.includes("rawText"), false);
});

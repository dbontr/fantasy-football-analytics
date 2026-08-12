"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const live = require("../src/engine/live-intelligence.js");
const engine = require("../src/engine/runtime.js");
const artifact = require("../data/camp-2026.json");
const refresh = require("../scripts/refresh-camp-intelligence.js");

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

test("direct play-caller usage intent recognizes the Achane-style signal", () => {
  const result = live.classifyUsageIntentText("As the play caller, DeVon can really do everything and it opens up a lot of doors for the offense.", { sourceRole: "play-caller", directQuote: true });
  assert.equal(result.active, true);
  assert.equal(result.roleIntent, "expand");
  assert.ok(result.usageScore > 0.5);
  assert.ok(result.confidence >= 0.8);
});

test("usage intent detects workload hyperbole without treating it as literal volume", () => {
  const result = live.classifyUsageIntentText("After he touches the ball 40-45 times, we may have to carry him back to the locker room.", { sourceRole: "head-coach", directQuote: true });
  assert.equal(result.active, true);
  assert.equal(result.hyperbole, true);
  assert.equal(result.literalVolume, false);
  assert.ok(result.usageScore > 0.5 && result.usageScore <= 0.82);
});
test("historical touch totals do not become future coach intent", () => {
  const result = live.classifyUsageIntentText("He finished last season with 296 touches and 1,300 yards.", { sourceRole: "reporter", directQuote: false });
  assert.equal(result.active, false);
  assert.equal(result.usageScore, 0);
});
test("Achane-style ESPN story becomes high-authority role intent, not literal touches", () => {
  const target = { id: "4429160", name: "De'Von Achane", team: "MIA", position: "RB" };
  const article = { id: "49582399", headline: "Jeff Hafley discusses De'Von Achane workload", published: "2026-08-11T14:27:25Z" };
  const detail = { ...article, description: "Jeff Hafley said Achane could receive a very heavy workload and might touch the ball more than 40 times in some games.", story: "" };
  const observation = refresh.usageObservation(target, article, detail);
  assert.ok(observation);
  assert.equal(observation.usageSourceRole, "head-coach");
  assert.ok(observation.usageScore > 0.5);
  assert.equal(observation.usageHyperbole, true);
  assert.equal(observation.literalVolume, false);
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
  assert.equal(artifact.meta.version, "camp-intelligence-2026.2");
  assert.ok(artifact.players.length >= 10);
  assert.ok(artifact.players.every((row) => row.modelEffect === "advisory-only"));
  assert.ok(Number(artifact.meta.searchedPlayers || 0) >= 20);
  assert.ok(artifact.players.some((row) => Array.isArray(row.usageSourceRoles)));
  const text = JSON.stringify(artifact);
  assert.equal(text.includes("<p"), false);
  assert.equal(text.includes("rawText"), false);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const context = require("../src/engine/context.js");

test("health model prefers calibrated status/practice group", () => {
  const calibration = { availability: { groups: {
    "status:questionable": { samples: 200, rate: 0.62 },
    "status-practice:questionable|limited": { samples: 150, rate: 0.7 },
  } } };
  const evidence = context.healthEvidence({ position: "WR", injuryStatus: "QUESTIONABLE", sleeper: { practiceParticipation: "Limited Participation" } }, calibration);
  assert.equal(evidence["health.active_probability"].value, 0.7);
  assert.equal(evidence["health.active_probability"].group, "status-practice:questionable|limited");
});

test("coaching profile is context-only until its mean effect earns validation", () => {
  const evidence = context.coachingEvidence({ position: "WR" }, {
    confidence: 0.8,
    newStaff: true,
    headCoach: "Example Coach",
    schemeLabel: "spread",
  });
  assert.equal(evidence["coaching.mean_delta"], undefined);
  assert.equal(evidence["coaching.staff_context"].newStaff, true);
  assert.match(evidence["coaching.staff_context"].source, /direct mean effect disabled/i);
});


test("teammate absence creates bounded role redistribution for remaining skill players", () => {
  const players = [
    { id: "wr1", name: "WR One", team: "DET", position: "WR", injuryStatus: "ACTIVE", active: true, opportunity: { targetShare: 0.24 } },
    { id: "wr2", name: "WR Two", team: "DET", position: "WR", injuryStatus: "OUT", active: false, opportunity: { targetShare: 0.28 } },
    { id: "te", name: "TE", team: "DET", position: "TE", injuryStatus: "ACTIVE", active: true, opportunity: { targetShare: 0.16 } },
  ];
  const evidence = context.absenceRedistributionEvidence(players[0], players);
  assert.ok(evidence["role.redistribution_delta"].value > 0);
  assert.ok(evidence["role.redistribution_delta"].value <= 0.22);
  assert.deepEqual(evidence["role.redistribution_delta"].absent, ["WR Two"]);
});

test("confirmed incumbent QB loss creates calibrated WR and TE context", () => {
  const players = [
    { id: "qb1", name: "Starter", team: "DET", position: "QB", weeklyProjection: 20, injuryStatus: "OUT", active: false },
    { id: "qb2", name: "Backup", team: "DET", position: "QB", weeklyProjection: 12, injuryStatus: "ACTIVE", active: true, sleeper: { depthChartOrder: 2 } },
    { id: "wr", name: "Receiver", team: "DET", position: "WR", weeklyProjection: 15, injuryStatus: "ACTIVE", active: true },
    { id: "te", name: "Tight End", team: "DET", position: "TE", weeklyProjection: 10, injuryStatus: "ACTIVE", active: true },
  ];
  const wr = context.quarterbackContextEvidence(players[2], players, 1)["context.qb_replacement_delta"];
  const te = context.quarterbackContextEvidence(players[3], players, 1)["context.qb_replacement_delta"];
  assert.equal(wr.incumbent, "Starter");
  assert.equal(wr.replacement, "Backup");
  assert.ok(Math.abs(wr.value + context.QB_CONTEXT_CALIBRATION.WR.penalty) < 1e-12);
  assert.ok(Math.abs(te.value + context.QB_CONTEXT_CALIBRATION.TE.penalty) < 1e-12);
  assert.ok(Math.abs(te.value) > Math.abs(wr.value));
});

test("healthy incumbent QB does not create replacement context", () => {
  const players = [
    { id: "qb1", name: "Starter", team: "DET", position: "QB", weeklyProjection: 20, injuryStatus: "ACTIVE", active: true },
    { id: "qb2", name: "Backup", team: "DET", position: "QB", weeklyProjection: 12, injuryStatus: "ACTIVE", active: true },
    { id: "wr", name: "Receiver", team: "DET", position: "WR", weeklyProjection: 15, injuryStatus: "ACTIVE", active: true },
  ];
  assert.deepEqual(context.quarterbackContextEvidence(players[2], players, 1), {});
});

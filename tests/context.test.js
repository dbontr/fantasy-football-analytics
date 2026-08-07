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

test("coaching prior stays bounded", () => {
  const evidence = context.coachingEvidence({ position: "WR" }, {
    confidence: 0.8,
    newStaff: false,
    offense: { design: 1 },
    leadership: { roleClarity: 1, continuity: 1 },
    development: { WR: 1 },
  });
  assert.ok(evidence["coaching.mean_delta"].value <= 0.025);
  assert.ok(evidence["coaching.mean_delta"].value >= -0.025);
});

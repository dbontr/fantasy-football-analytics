"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../src/engine/runtime.js");

function implied(leftPosition, rightPosition, sameTeam) {
  const left = engine.factorWeights(leftPosition);
  const right = engine.factorWeights(rightPosition);
  let value = 0;
  for (const factor of ["scoring", "passing", "rushing", "pace", "chaos"]) {
    value += Number(left[factor] || 0) * Number(right[factor] || 0);
  }
  if (sameTeam) value += Number(left.team || 0) * Number(right.team || 0);
  return value;
}

test("offensive correlation factors preserve a real QB-pass catcher stack", () => {
  assert.ok(implied("QB", "WR", true) > 0.18);
  assert.ok(implied("QB", "TE", true) > 0.18);
});

test("offensive correlation factors do not broadly correlate teammate skill players", () => {
  assert.ok(implied("RB", "WR", true) < 0.06);
  assert.ok(implied("WR", "WR", true) < 0.10);
});

test("offensive correlation factors keep unrelated opponent receivers nearly independent", () => {
  assert.ok(implied("WR", "WR", false) < 0.05);
});

test("shared offensive factor variance leaves idiosyncratic residual variance", () => {
  for (const position of ["QB", "RB", "WR", "TE"]) {
    const weights = engine.factorWeights(position);
    const shared = ["scoring", "passing", "rushing", "pace", "team", "chaos"]
      .reduce((sum, factor) => sum + Number(weights[factor] || 0) ** 2, 0);
    assert.ok(shared < 0.90, `${position} shared variance must stay below 0.90`);
  }
});

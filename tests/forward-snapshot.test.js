"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "capture-forward-snapshot.js"), "utf8");

test("forward snapshot binds future evaluation to exact serving decision files", () => {
  assert.match(source, /decisionPolicyBinding: decisionPolicyBinding\(\)/);
  for (const relative of [
    "data/analytics-runtime-profile.json",
    "data/validation/draft-robust-policy.json",
    "src/engine/runtime.js",
    "src/engine/draft-sim.js",
    "src/engine/draft-intelligence.js",
    "src/engine/preseason-alpha.js",
  ]) assert.match(source, new RegExp(relative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /combinedSha256/);
  assert.equal((source.match(/function compactPreseasonAlpha\(row\)/g) || []).length, 1);
});

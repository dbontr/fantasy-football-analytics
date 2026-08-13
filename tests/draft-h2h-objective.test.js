"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const report = require("../data/validation/draft-h2h-objective-audit.json");

test("Draft H2H audit stays diagnostic and preserves adverse evidence", () => {
  assert.equal(report.version, "draft-h2h-objective-audit-2026.1");
  assert.equal(report.usedForSelection, false);
  assert.equal(report.servingPolicyChanged, false);
  assert.equal(report.consumedHistoricalEvidence, true);
  assert.deepEqual(report.years, [2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  assert.ok(report.aggregate["espn-market"].meanWinDelta > 0);
  assert.ok(report.aggregate.value.meanWinDelta > 0);
  assert.ok(report.aggregate["need-heavy"].meanWinDelta > 0);
  assert.ok(report.aggregate["need-heavy"].pairedWinRate < 0.5);
  assert.ok(report.seasons[2023]["need-heavy"].meanWinDelta < 0);
});

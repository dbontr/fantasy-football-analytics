"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const report = require("../data/validation/site-benchmark-2018.json");

test("published site benchmark is a labeled frozen-holdout comparison", () => {
  assert.equal(report.season, 2018);
  assert.match(report.methodology, /paired/i);
  assert.match(report.disclaimer, /not a qualification gate/i);
  const names = new Set(report.rows.map((row) => row.name));
  for (const name of ["SnapCount", "FantasyData ADP", "Fantasy Football Calculator", "MyFantasyLeague ADP", "3-site consensus"]) assert.ok(names.has(name));
  assert.ok(report.rows.every((row) => row.drafts === 48 && Number.isFinite(row.meanRealizedStarterPoints)));
  assert.ok(report.sourceCoverage["Fantasy Football Calculator"] > 100);
  assert.ok(report.sourceCoverage["MyFantasyLeague ADP"] > 200);
});

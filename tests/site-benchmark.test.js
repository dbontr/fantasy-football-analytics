"use strict";
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const report = require("../data/validation/site-benchmark-2018.json");

test("published benchmark uses recognizable historical platform boards", () => {
  assert.equal(report.season, 2018);
  assert.match(report.methodology, /paired/i);
  assert.match(report.disclaimer, /not a qualification gate/i);
  assert.equal(report.marketScale?.snapCountAndCpu, "native raw historical ADP");
  assert.equal(report.marketScale?.platformUser, "source-specific imported ordinal board");
  const names = new Set(report.rows.map((row) => row.name));
  for (const name of ["SnapCount", "ESPN ADP", "Yahoo ADP", "CBS Sports ADP", "NFL.com ADP", "FantasyPros ECR"]) assert.ok(names.has(name));
  for (const oldName of ["3-site consensus", "FantasyData ADP", "Fantasy Football Calculator", "MyFantasyLeague ADP"]) assert.equal(names.has(oldName), false);
  assert.ok(report.rows.every((row) => row.drafts === 48 && Number.isFinite(row.meanRealizedStarterPoints) && row.sourceNote));
  assert.equal(report.rows[0].name, "SnapCount");
  assert.match(report.rows.find((row) => row.name === "SnapCount").sourceNote, /shadow challenger excluded/i);
  assert.ok(report.sourceCoverage["ESPN ADP"] > 300);
  assert.ok(report.sourceCoverage["Yahoo ADP"] > 150);
  assert.ok(report.sourceCoverage["CBS Sports ADP"] > 150);
  assert.ok(report.sourceCoverage["NFL.com ADP"] > 200);
  assert.ok(report.sourceCoverage["FantasyPros ECR"] > 250);
});

test("benchmark common room preserves qualified native ADP scale", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "site-benchmark.js"), "utf8");
  assert.match(source, /createRoomContext\(pool, settings\);/);
  assert.doesNotMatch(source, /\bbaseBoard\b/);
  assert.doesNotMatch(source, /\bmarketScores\b/);
});

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const popout = require("../src/outlook-player-popout.js");

test("projectedAveragePpg averages playable weekly projections and excludes the bye", () => {
  const weeklyProjections = Array.from({ length: 18 }, (_, index) => index === 6 ? 0 : 10 + index);
  const player = { byeWeek: 7, weeklyProjections, weeklyProjection: 99 };
  const expected = weeklyProjections.filter((value, index) => index !== 6 && value > 0)
    .reduce((sum, value) => sum + value, 0) / 17;
  assert.equal(popout.projectedAveragePpg(player), expected);
});

test("projectedAveragePpg falls back to the season weekly baseline", () => {
  assert.equal(popout.projectedAveragePpg({ weeklyProjection: 14.25 }), 14.25);
});

test("projectedAveragePpg falls back to projected season points over 17 games", () => {
  assert.equal(popout.projectedAveragePpg({ projectedPoints: 255 }), 15);
});

test("projectedAveragePpg returns null when no usable projection exists", () => {
  assert.equal(popout.projectedAveragePpg({ weeklyProjections: [0, 0, 0] }), null);
});

test("player popout stays wired to the existing Player Analysis surface and cache", () => {
  const root = path.resolve(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "src", "outlook-player-popout.js"), "utf8");
  const store = fs.readFileSync(path.join(root, "src", "storage", "browser-store.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  for (const token of ["player-analysis-popout", "data-player-analysis-popout", "AVG PROJECTED PPG", 'getElementById("run-player")', 'getElementById("load-intelligence")', 'getElementById("player-result")', 'getElementById("player-intelligence")']) {
    assert.ok(source.includes(token), `missing ${token}`);
  }
  assert.ok(store.includes("./src/outlook-player-popout.js"));
  assert.ok(worker.includes("./src/outlook-player-popout.js"));
  assert.ok(worker.includes("snapcount-browser-v1.35.0-draft-intelligence"));
});

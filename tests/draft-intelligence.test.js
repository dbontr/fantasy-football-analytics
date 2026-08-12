"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/engine/core.js");
const intelligence = require("../src/engine/draft-intelligence.js");

function settings(overrides = {}) {
  return core.cloneSettings({
    teams: 12,
    rounds: 16,
    draftPosition: 1,
    scoring: "ppr",
    qbFormat: "one-qb",
    slots: { ...core.DEFAULT_SETTINGS.slots, BN: 7 },
    ...overrides,
  });
}

function player(id, position, adp, points = 250, team = "BUF", extra = {}) {
  return {
    id: String(id), name: `Player ${id}`, position, team, adp, pprRank: adp,
    projectedPoints: points, weeklyProjection: points / 17,
    weeklyProjections: Array.from({ length: 18 }, () => points / 17),
    reliability: 0.74, injuryRisk: 0.12, ...extra,
  };
}

test("manager-specific survival falls when intervening teams need the position", () => {
  const target = player("rb-target", "RB", 18, 285);
  const fillers = Array.from({ length: 84 }, (_, index) => player(`f${index}`, "RB", 100 + index, 120));
  const players = [target, ...fillers];
  const needy = { picks: [], rosters: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [String(index + 1), []])) };
  const full = { picks: [], rosters: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [String(index + 1), fillers.slice(index * 7, index * 7 + 7).map((row) => row.id)])) };
  const needySurvival = intelligence.managerSpecificSurvival(target, { players, state: needy, settings: settings(), teamId: 1 }).survival;
  const fullSurvival = intelligence.managerSpecificSurvival(target, { players, state: full, settings: settings(), teamId: 1 }).survival;
  assert.ok(needySurvival < fullSurvival, `${needySurvival} should be below ${fullSurvival}`);
});

test("QB format scarcity activates in superflex but not one-QB", () => {
  const qb = player("qb", "QB", 20, 330, "BUF", { tierCliff: 10 });
  const oneQb = intelligence.formatScarcity(qb, settings({ qbFormat: "one-qb" }), []);
  const superflex = intelligence.formatScarcity(qb, settings({ qbFormat: "superflex", slots: { ...core.DEFAULT_SETTINGS.slots, SUPERFLEX: 1, BN: 7 } }), []);
  assert.equal(oneQb, 0);
  assert.ok(superflex > 1);
});

test("ESPN residual signal rewards players SnapCount ranks materially higher", () => {
  const row = player("edge", "WR", 30, 260);
  const signal = intelligence.marketResidualSignal({ ...row, marketRank: 30 }, { edge: 12 }, settings());
  assert.ok(signal.edge > 0);
  assert.ok(signal.signal > 0);
});

test("portfolio signal recognizes a QB-pass catcher stack without letting it dominate", () => {
  const qb = player("qb-stack", "QB", 40, 300, "DET");
  const wr = player("wr-stack", "WR", 25, 280, "DET");
  const result = intelligence.portfolioSignal(wr, [qb]);
  assert.ok(result.signal > 0);
  assert.ok(result.signal <= 0.8);
});

test("availability signal penalizes high injury risk", () => {
  const safe = intelligence.availabilitySignal(player("safe", "RB", 20, 280, "SF", { injuryRisk: 0.08, reliability: 0.85 }));
  const risky = intelligence.availabilitySignal(player("risky", "RB", 20, 280, "SF", { injuryRisk: 0.72, reliability: 0.55 }));
  assert.ok(safe.signal > risky.signal);
  assert.ok(safe.projectedGames > risky.projectedGames);
});

test("decision mix exposes every signal family and caps rank movement", () => {
  const players = [
    player("1", "RB", 10, 320, "DET"), player("2", "WR", 12, 305, "LAR"),
    player("3", "QB", 18, 360, "BUF"), player("4", "TE", 24, 250, "LV"),
    player("5", "RB", 28, 270, "ATL"), player("6", "WR", 35, 255, "MIN"),
  ];
  const rows = players.map((row, index) => ({ ...row, marketRank: row.adp, returnChance: 0.65 - index * 0.06, vona: 8 - index, tierCliff: 4 }));
  const state = { picks: [], rosters: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [String(index + 1), []])) };
  const result = intelligence.applyDecisionMix(rows, {
    players, state, settings: settings(), teamId: 1,
    snapRankById: { "1": 2, "2": 1, "3": 4, "4": 5, "5": 3, "6": 6 },
    footballContextById: { "1": { correction: 1.2, topDriver: "team volume" } },
  });
  assert.equal(result.length, rows.length);
  for (const row of result) {
    assert.ok(Math.abs(row.decisionShift) <= row.decisionMixCap + 1e-9);
    assert.deepEqual(new Set(row.decisionComponents.map((component) => component.key)), new Set(["counterfactual", "room-hazard", "espn-residual", "availability", "format", "portfolio", "football-context"]));
    assert.equal(row.decisionMixStatus, "bounded-experimental-decision-overlay");
  }
});

test("Draft Decision Mix stays wired after the qualified base and before personal views", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.resolve(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  assert.ok(app.includes("applyPlayerOutlookOverlay(applyDraftDecisionMix(initialQualified, settings, false)"));
  assert.ok(app.includes("applyPlayerOutlookOverlay(applyDraftDecisionMix(refinedQualified, settings, true)"));
  assert.ok(app.includes("A+ QUALIFIED BASE · LIVE DECISION MIX"));
  assert.ok(html.includes("./src/engine/draft-intelligence.js"));
  assert.ok(html.includes("./draft-intelligence.css"));
  assert.ok(worker.includes("snapcount-browser-v1.35.0-draft-intelligence"));
  assert.ok(worker.includes("./src/engine/draft-intelligence.js"));
  assert.ok(worker.includes("./draft-intelligence.css"));
});

test("My Outlooks presents round-relative personal targets instead of abstract sentiment labels", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const app = fs.readFileSync(path.resolve(__dirname, "..", "src", "app.js"), "utf8");
  for (const label of ["Much higher · ~1¼ rounds", "Moderately higher · ~½ round", "Slightly higher · ~¼ round", "Same as market", "Much lower · ~1¼ rounds"]) {
    assert.ok(app.includes(label), `missing ${label}`);
  }
  assert.ok(app.includes("residualPicks"));
  assert.ok(app.includes("alreadyReflected"));
});

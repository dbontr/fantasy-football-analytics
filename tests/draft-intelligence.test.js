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

test("shadow decision mix exposes every signal family without changing the qualified order", () => {
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
  assert.deepEqual(result.map((row) => row.id), rows.map((row) => row.id));
  for (const [index, row] of result.entries()) {
    assert.ok(Math.abs(row.decisionShift) <= row.decisionMixCap + 1e-9);
    assert.equal(row.appliedDecisionShift, 0);
    assert.equal(row.decisionRank, index + 1);
    assert.ok(Number.isFinite(row.shadowDecisionRank));
    assert.equal(row.returnChance, rows[index].returnChance);
    assert.ok(Number.isFinite(row.shadowReturnChance));
    assert.deepEqual(new Set(row.decisionComponents.map((component) => component.key)), new Set(["counterfactual", "room-hazard", "espn-residual", "availability", "format", "portfolio", "football-context"]));
    assert.equal(row.decisionMixStatus, "shadow-only-pending-validation");
  }
});

test("Draft Decision Mix loads from the browser store and patches qualified recommendations", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.resolve(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "src", "engine", "draft-intelligence.js"), "utf8");
  const store = fs.readFileSync(path.join(root, "src", "storage", "browser-store.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  const audit = JSON.parse(fs.readFileSync(path.join(root, "data", "validation", "draft-decision-mix-audit.json"), "utf8"));
  assert.ok(source.includes("patchedQualify"));
  assert.ok(source.includes("shadow-only-pending-validation"));
  assert.ok(source.includes("shadow challenger"));
  assert.ok(store.includes("./src/engine/draft-intelligence.js"));
  assert.ok(store.includes("./draft-intelligence.css"));
  assert.ok(worker.includes("snapcount-browser-v1.36.0-shadow-draft-intelligence"));
  assert.ok(worker.includes("./src/engine/draft-intelligence.js"));
  assert.ok(worker.includes("./draft-intelligence.css"));
  assert.ok(worker.includes("./data/validation/draft-decision-mix-audit.json"));
  assert.ok(source.includes("frozen qualified base; shadow draft intelligence"));
  assert.equal(audit.gates.historicalScreenPass, false);
  assert.equal(audit.gates.activeReorderingAllowed, false);
  assert.ok(audit.components.counterfactualCurrentBundle.meanEdge < 0);
  assert.ok(audit.components.espnResidualReinforcement.meanEdge < 0);
});

test("My Outlooks exposes ESPN-relative draft targets instead of abstract sentiment labels", () => {
  assert.equal(intelligence.PERSONAL_VIEW_LABELS["very-positive"], "Much higher · ~1¼ rounds");
  assert.equal(intelligence.PERSONAL_VIEW_LABELS.positive, "Higher · ~¾ round");
  assert.equal(intelligence.PERSONAL_VIEW_LABELS["somewhat-positive"], "Moderately higher · ~⅓ round");
  assert.equal(intelligence.PERSONAL_VIEW_LABELS["slightly-positive"], "Slightly higher · ~⅙ round");
  assert.equal(intelligence.PERSONAL_VIEW_LABELS.neutral, "Same as ESPN");
  assert.equal(intelligence.PERSONAL_VIEW_LABELS["very-negative"], "Much lower · ~1¼ rounds");
});

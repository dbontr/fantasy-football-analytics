"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const football = require("../src/engine/football-context.js");
const engine = require("../src/engine/runtime.js");

function player(position = "QB") {
  return {
    id: position, name: position, position, team: "BUF", projectionSource: "espn-live-ppr",
    weeklyProjection: 16, weeklyProjections: Array(18).fill(16), projectedPoints: 272, reliability: 0.72,
    opportunity: { targetShare: position === "WR" ? 0.24 : 0.1, carryShare: position === "RB" ? 0.55 : position === "QB" ? 0.12 : 0, snapShare: 0.78, volumeStability: 0.7, reliability: 0.7 },
  };
}

test("football context exposes system, line, and scheduled defense evidence", () => {
  const artifact = { teams: { BUF: { weighted: { playsPerGame: 68, neutralPassRate: 0.63, passRate: 0.62, topTwoTargetConcentration: 0.55, topTwoRushConcentration: 0.7, pressureRate: 0.14, sackRate: 0.05, rushSuccessRate: 0.47 } } }, defenses: { KC: { weighted: { pressureRate: 0.23, sackRate: 0.07, passSuccessRate: 0.39, rushSuccessRate: 0.37, redZoneTdRate: 0.17 } } }, current: {} };
  const evidence = football.contextEvidence(player("QB"), artifact, { BUF: { weeks: [{ opponent: "KC" }] } }, 1);
  assert.ok(evidence["system.team_volume"]);
  assert.ok(evidence["line.pass_protection_proxy"]);
  assert.equal(evidence["matchup.pressure_grade"].opponent, "KC");
});
test("camp role state changes uncertainty without changing the serving mean", () => {
  const target = player("WR");
  const base = engine.forecastPlayer(target, { week: 1, evidence: {} });
  const evidence = football.campRoleEvidence({ available: true, roleScore: -0.8, performanceScore: 0, availabilityRisk: 0.1, confidence: 0.55, conflict: 0.05 });
  const contextual = engine.forecastPlayer(target, { week: 1, evidence });
  assert.equal(contextual.distribution.mean, base.distribution.mean);
  assert.ok(contextual.uncertainty.role > base.uncertainty.role);
});

test("QB shadow successor separates passing and rushing context and stays capped", () => {
  const row = (value) => ({ available: true, value, confidence: 0.8, conflict: 0.05, source: "test" });
  const target = player("QB");
  const evidence = { "system.team_volume": row(0.8), "system.pass_rate": row(0.6), "system.playcaller_pass": row(0.5), "system.qb_run": row(0.7), "matchup.pressure_grade": row(0.5), "matchup.rush_front_grade": row(0.5), "line.pass_protection_proxy": row(0.4), "line.run_block_proxy": row(0.4) };
  const forecast = engine.forecastPlayer(target, { week: 1, evidence });
  assert.ok(Math.abs(forecast.distribution.mean - 16) < 1e-9);
  assert.ok(forecast.shadowSuccessor.byComponent.passing !== undefined);
  assert.ok(forecast.shadowSuccessor.byComponent.rushing !== undefined);
  assert.ok(Math.abs(forecast.shadowSuccessor.correction) <= 16 * 0.18 + 1e-9);
});

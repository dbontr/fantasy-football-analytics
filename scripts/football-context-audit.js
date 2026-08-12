"use strict";

const fs = require("node:fs");
const path = require("node:path");
const engine = require("../src/engine/runtime.js");
const football = require("../src/engine/football-context.js");

const root = path.resolve(__dirname, "..");
const contextFile = path.join(root, "data", "football-context-2026.json");
const outputFile = path.join(root, "data", "validation", "football-context-audit.json");
const POSITIONS = ["QB", "RB", "WR", "TE"];

function canonical(value) { return JSON.stringify(value); }
function player(position) {
  return {
    id: `audit-${position}`, name: `Audit ${position}`, position, team: "BUF",
    projectionSource: "espn-live-ppr", weeklyProjection: 16, weeklyProjections: Array(18).fill(16),
    projectedPoints: 272, reliability: 0.72, opportunity: { targetShare: position === "WR" ? 0.24 : position === "TE" ? 0.18 : 0.1, carryShare: position === "RB" ? 0.55 : position === "QB" ? 0.12 : 0, snapShare: 0.78, volumeStability: 0.7, reliability: 0.7 },
  };
}
function syntheticEvidence() {
  const row = (value, confidence = 0.8) => ({ available: true, value, confidence, conflict: 0.05, source: "audit fixture" });
  return {
    "system.team_volume": row(0.7), "system.pass_rate": row(0.5), "system.playcaller_pace": row(0.35), "system.playcaller_pass": row(0.4),
    "system.play_action": row(0.25), "system.motion": row(0.2), "system.target_concentration": row(0.4), "system.rush_concentration": row(0.45),
    "system.rb_committee": row(0.3), "system.te_usage": row(0.5), "system.qb_run": row(0.55), "system.red_zone": row(0.35),
    "line.pass_protection_proxy": row(0.35), "line.run_block_proxy": row(0.3), "matchup.pressure_grade": row(0.4), "matchup.pass_efficiency_grade": row(0.3),
    "matchup.rush_front_grade": row(0.4), "matchup.red_zone_grade": row(0.25),
  };
}
function build(frozenAt) {
  const artifact = JSON.parse(fs.readFileSync(contextFile, "utf8"));
  if (artifact.meta?.version !== "snapcount-football-context-2026.1") throw new Error("Football-context artifact version drift");
  if (Object.keys(artifact.teams || {}).length !== 32 || Object.keys(artifact.defenses || {}).length !== 32) throw new Error("Football-context team coverage is incomplete");
  const schedule = { BUF: { weeks: [{ opponent: "KC" }] } };
  const positionChecks = {};
  for (const position of POSITIONS) {
    const target = player(position);
    const measured = football.contextEvidence(target, artifact, schedule, 1);
    const evidence = { ...measured, ...syntheticEvidence() };
    const base = engine.forecastPlayer(target, { week: 1, evidence: {} });
    const contextual = engine.forecastPlayer(target, { week: 1, evidence });
    if (Math.abs(contextual.distribution.mean - base.distribution.mean) > 1e-9) throw new Error(`${position} shadow context changed the serving mean`);
    if (!contextual.shadowSuccessor || contextual.shadowSuccessor.status !== "shadow-only") throw new Error(`${position} shadow successor missing`);
    if (Math.abs(contextual.shadowSuccessor.correction) > base.baseline.mean * 0.180001) throw new Error(`${position} shadow correction exceeded family cap`);
    positionChecks[position] = {
      measuredEvidence: Object.keys(measured).sort(),
      shadowDriverCount: contextual.shadowSuccessor.drivers.length,
      shadowCorrection: Number(contextual.shadowSuccessor.correction.toFixed(6)),
      servingMeanDelta: Number((contextual.distribution.mean - base.distribution.mean).toFixed(9)),
      components: contextual.shadowSuccessor.byComponent,
    };
  }
  const camp = football.campRoleEvidence({ available: true, roleScore: -0.8, performanceScore: -0.2, availabilityRisk: 0.15, confidence: 0.5, conflict: 0.05 });
  const campPlayer = player("WR");
  const campBase = engine.forecastPlayer(campPlayer, { week: 1, evidence: {} });
  const campForecast = engine.forecastPlayer(campPlayer, { week: 1, evidence: camp });
  if (Math.abs(campForecast.distribution.mean - campBase.distribution.mean) > 1e-9) throw new Error("Camp role state moved the serving mean");
  if (!(campForecast.uncertainty.role > campBase.uncertainty.role)) throw new Error("Negative camp role state did not increase role uncertainty");
  const report = {
    version: "football-context-audit-2026.1",
    frozenAt,
    status: "prospective-only-not-serving",
    artifactVersion: artifact.meta.version,
    coverage: { offenses: Object.keys(artifact.teams).length, defenses: Object.keys(artifact.defenses).length, coachHistories: Object.keys(artifact.coaches || {}).length },
    families: {
      teamVolumeToPlayerShare: "shadow-only",
      opponentPressureEfficiency: "shadow-only",
      offensiveLineVsFront: "shadow-only",
      playcallerSystem: "shadow-only",
      qbPassingRushingComponents: "shadow-only",
      teRoleSystem: "shadow-only",
      campRoleState: "uncertainty-only",
      decisionScheduleHorizon: "separately audited by surface",
    },
    positionChecks,
    campCheck: { servingMeanDelta: Number((campForecast.distribution.mean - campBase.distribution.mean).toFixed(9)), roleUncertaintyBefore: campBase.uncertainty.role, roleUncertaintyAfter: campForecast.uncertainty.role },
    preRegisteredAdmission: {
      evaluationSeason: 2026,
      baseline: "same point-in-time ESPN PPR projection used by the frozen SnapCount model",
      noRetuneAfterOutcomeInspection: true,
      gates: {
        overallMaeImprovement: "> 0",
        overallRmseImprovement: "> 0",
        weeklyRankNonInferiority: ">= 0",
        pairedWeekBootstrapMaeLower95: "> 0",
        effectDirectionStability: "same sign in at least 4 of 5 rolling seasonal folds",
        ablationRequirement: "each promoted family must improve the full successor when removed/added",
      },
      restrictions: {
        productionMeanChangedNow: false,
        mayUse2026ForTuning: false,
        mayPromoteIndividualFamilyWithoutAblation: false,
      },
    },
  };
  return report;
}

function main() {
  if (process.argv.includes("--verify")) {
    const committed = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    const rebuilt = build(committed.frozenAt);
    if (canonical(committed) !== canonical(rebuilt)) throw new Error("Football-context successor audit drift");
    console.log(`Football context successor verified: ${committed.status}`);
    return;
  }  const report = build(new Date().toISOString());
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${outputFile}`);
  console.log(`Status: ${report.status}`);
}

if (require.main === module) main();
module.exports = { build };

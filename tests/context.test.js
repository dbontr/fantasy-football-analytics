"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const context = require("../src/engine/context.js");

test("health model prefers calibrated status/practice group", () => {
  const calibration = { availability: { groups: {
    "status:questionable": { samples: 200, rate: 0.62 },
    "status-practice:questionable|limited": { samples: 150, rate: 0.7 },
  } } };
  const evidence = context.healthEvidence({ position: "WR", injuryStatus: "QUESTIONABLE", sleeper: { practiceParticipation: "Limited Participation" } }, calibration);
  assert.equal(evidence["health.active_probability"].value, 0.7);
  assert.equal(evidence["health.active_probability"].group, "status-practice:questionable|limited");
});

test("coaching profile is context-only until its mean effect earns validation", () => {
  const evidence = context.coachingEvidence({ position: "WR" }, {
    confidence: 0.8,
    newStaff: true,
    headCoach: "Example Coach",
    offensiveCoordinator: "Example OC",
    offensivePlayCaller: "Example Caller",
    schemeLabel: "spread",
  });
  assert.equal(evidence["coaching.mean_delta"], undefined);
  assert.equal(evidence["coaching.staff_context"].newStaff, true);
  assert.equal(evidence["coaching.staff_context"].playCaller, "Example Caller");
  assert.equal(evidence["coaching.playcaller_context"].playCaller, "Example Caller");
  assert.equal(evidence["coaching.playcaller_context"].value, 0);
  assert.match(evidence["coaching.staff_context"].source, /direct mean effect disabled/i);
});


test("teammate absence creates bounded role redistribution for remaining skill players", () => {
  const players = [
    { id: "wr1", name: "WR One", team: "DET", position: "WR", injuryStatus: "ACTIVE", active: true, opportunity: { targetShare: 0.24 } },
    { id: "wr2", name: "WR Two", team: "DET", position: "WR", injuryStatus: "OUT", active: false, opportunity: { targetShare: 0.28 } },
    { id: "te", name: "TE", team: "DET", position: "TE", injuryStatus: "ACTIVE", active: true, opportunity: { targetShare: 0.16 } },
  ];
  const evidence = context.absenceRedistributionEvidence(players[0], players);
  assert.ok(evidence["role.redistribution_delta"].value > 0);
  assert.ok(evidence["role.redistribution_delta"].value <= 0.22);
  assert.deepEqual(evidence["role.redistribution_delta"].absent, ["WR Two"]);
});

test("confirmed incumbent QB loss creates calibrated WR and TE context", () => {
  const players = [
    { id: "qb1", name: "Starter", team: "DET", position: "QB", weeklyProjection: 20, injuryStatus: "OUT", active: false },
    { id: "qb2", name: "Backup", team: "DET", position: "QB", weeklyProjection: 12, injuryStatus: "ACTIVE", active: true, sleeper: { depthChartOrder: 2 } },
    { id: "wr", name: "Receiver", team: "DET", position: "WR", weeklyProjection: 15, injuryStatus: "ACTIVE", active: true },
    { id: "te", name: "Tight End", team: "DET", position: "TE", weeklyProjection: 10, injuryStatus: "ACTIVE", active: true },
  ];
  const wr = context.quarterbackContextEvidence(players[2], players, 1)["context.qb_replacement_delta"];
  const te = context.quarterbackContextEvidence(players[3], players, 1)["context.qb_replacement_delta"];
  assert.equal(wr.incumbent, "Starter");
  assert.equal(wr.replacement, "Backup");
  assert.ok(Math.abs(wr.value + context.QB_CONTEXT_CALIBRATION.WR.penalty) < 1e-12);
  assert.ok(Math.abs(te.value + context.QB_CONTEXT_CALIBRATION.TE.penalty) < 1e-12);
  assert.ok(Math.abs(te.value) > Math.abs(wr.value));
});

test("healthy incumbent QB does not create replacement context", () => {
  const players = [
    { id: "qb1", name: "Starter", team: "DET", position: "QB", weeklyProjection: 20, injuryStatus: "ACTIVE", active: true },
    { id: "qb2", name: "Backup", team: "DET", position: "QB", weeklyProjection: 12, injuryStatus: "ACTIVE", active: true },
    { id: "wr", name: "Receiver", team: "DET", position: "WR", weeklyProjection: 15, injuryStatus: "ACTIVE", active: true },
  ];
  assert.deepEqual(context.quarterbackContextEvidence(players[2], players, 1), {});
});
test("baseline snap share becomes explicit role evidence", () => {
  const evidence = context.baselineRoleEvidence({ opportunity: { snapShare: 0.82 } });
  assert.equal(evidence["role.snap_share"].value, 0.82);
  assert.match(evidence["role.snap_share"].source, /nflverse/i);
});

test("live PPR anchor suppresses legacy QB replacement mean evidence", () => {
  const players = [
    { id: "wr", team: "DET", position: "WR", projectionSource: "espn-live-ppr" },
    { id: "qb1", name: "Starter", team: "DET", position: "QB", injuryStatus: "OUT", active: false, weeklyProjection: 22 },
    { id: "qb2", name: "Backup", team: "DET", position: "QB", injuryStatus: "ACTIVE", active: true, weeklyProjection: 14 },
  ];
  assert.deepEqual(context.quarterbackContextEvidence(players[0], players, 1), {});
});

test("target ecosystem tracks the QB and pass-catcher pecking order without a scoring effect", () => {
  const players = [
    { id:"q", name:"QB One", team:"AAA", position:"QB", weeklyProjection:20, opportunity:{} },
    { id:"w1", name:"Alpha WR", team:"AAA", position:"WR", weeklyProjection:16, opportunity:{ targetShare:.28, snapShare:.88 } },
    { id:"w2", name:"Beta WR", team:"AAA", position:"WR", weeklyProjection:12, opportunity:{ targetShare:.20, snapShare:.79 } },
    { id:"t", name:"Gamma TE", team:"AAA", position:"TE", weeklyProjection:9, opportunity:{ targetShare:.14, snapShare:.76 } },
  ];
  const evidence = context.targetEcosystemEvidence(players[1], players, 1)["interaction.target_ecosystem"];
  assert.equal(evidence.quarterback.name, "QB One");
  assert.equal(evidence.playerTargetShare, .28);
  assert.equal(evidence.passCatchers[0].name, "Alpha WR");
  assert.equal(evidence.scoringEffect, "context-only");
  assert.ok(evidence.topTwoTargetConcentration > .7);
});

test("interaction coverage registry keeps measured, context-only, and remaining gaps explicit", () => {
  const coverage = require("../data/model-interaction-coverage.json");
  assert.equal(coverage.families.qb_target_ecosystem.status, "context-only");
  assert.equal(coverage.families.kicker_projection_market_weather.status, "admitted");
  assert.equal(coverage.families.dst_projection_market_environment.status, "admitted");
  assert.equal(coverage.families.fourth_down_aggressiveness.status, "context-only");
  assert.equal(coverage.families.kicker_distance_distribution.status, "context-only");
  assert.equal(coverage.families.kickable_drive_and_red_zone_stall_rate.status, "context-only");
  assert.equal(coverage.families.dst_pressure_sack_takeaway_interactions.status, "context-only");
  assert.equal(coverage.families.special_teams_personnel_continuity.status, "not-yet-measured");
});

test("special-teams play-by-play artifact measures fourth-down, long-kick and D/ST interaction context", () => {
  const special = require("../data/special-teams-2026.json");
  assert.equal(special.meta.seasons.join(","), "2023,2024,2025");
  assert.equal(Object.keys(special.teams).length, 32);
  assert.ok(special.teams.DAL.weighted.fourthDownGoRate > 0);
  assert.ok(special.teams.DAL.weighted.fg50AttemptsPerGame > 0);
  assert.ok(special.defenses.DAL.weighted.sacksPerGame > 0);
  assert.ok(special.defenses.DAL.weighted.takeawaysPerGame > 0);
  const aubrey = Object.values(special.kickers).find((entry) => Object.values(entry.seasons || {}).some((row) => String(row.name).includes("Aubrey")));
  assert.ok(aubrey?.seasons?.["2025"]?.byDistance?.["50-59"]?.attempts > 0);
});

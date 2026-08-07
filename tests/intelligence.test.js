"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const intel = require("../src/engine/intelligence.js");

const headers = [
  "player_id", "player_display_name", "position", "season", "week", "season_type", "game_id", "team", "opponent_team",
  "attempts", "passing_yards", "passing_tds", "passing_interceptions", "carries", "rushing_yards", "rushing_tds",
  "receptions", "targets", "receiving_yards", "receiving_tds", "receiving_air_yards", "receiving_yards_after_catch",
  "target_share", "air_yards_share", "wopr", "fantasy_points", "fantasy_points_ppr",
];

function row(week, ppr, opportunities, targetShare = 0.2) {
  const targets = Math.min(opportunities, 8);
  const carries = opportunities - targets;
  const values = {
    player_id: "00-TEST", player_display_name: "Test Player", position: "RB", season: 2025, week,
    season_type: "REG", game_id: `2025_${week}_A_B`, team: "A", opponent_team: "B", attempts: 0,
    passing_yards: 0, passing_tds: 0, passing_interceptions: 0, carries, rushing_yards: carries * 4,
    rushing_tds: 0, receptions: 5, targets, receiving_yards: 40, receiving_tds: 0,
    receiving_air_yards: 25, receiving_yards_after_catch: 20, target_share: targetShare,
    air_yards_share: 0.1, wopr: 0.3, fantasy_points: ppr - 5, fantasy_points_ppr: ppr,
  };
  return headers.map((name) => values[name] ?? "").join(",");
}

test("parses compact weekly stats and matches normalized player name", () => {
  const csv = [headers.join(","), row(1, 10, 12), row(2, 14, 14)].join("\n");
  const rows = intel.parseWeeklyStatsCsv(csv);
  assert.equal(rows.length, 2);
  const index = intel.indexWeeklyRows(rows);
  const found = intel.findPlayerRows(index, { name: "Test Player Jr.", position: "RB", team: "A" }, { seasonType: "REG" });
  assert.equal(found.length, 2);
  assert.equal(found[1].fantasyPpr, 14);
});

test("six-game history detects improving opportunity and fantasy trend", () => {
  const csv = [headers.join(","),
    row(1, 8, 9, 0.10), row(2, 9, 10, 0.11), row(3, 10, 11, 0.12),
    row(4, 17, 17, 0.20), row(5, 18, 18, 0.22), row(6, 19, 19, 0.24),
  ].join("\n");
  const rows = intel.parseWeeklyStatsCsv(csv);
  const summary = intel.summarizeHistory(rows);
  assert.equal(summary.games, 6);
  assert.equal(summary.trend.direction, "up");
  assert.ok(summary.trend.opportunityDelta > 7);
  assert.ok(summary.last3.targetShare > 0.2);
});

test("outlook uses supplied health evidence and does not invent notes", () => {
  const summary = intel.summarizeHistory(intel.parseWeeklyStatsCsv([headers.join(","), row(1, 12, 13), row(2, 13, 14), row(3, 14, 15)].join("\n")));
  const forecast = { week: 7, distribution: { mean: 15.2, p90: 24.8 }, availability: { probability: 0.82 }, baseline: { reliability: 0.76 } };
  const healthy = intel.generateOutlook({ name: "Test Player", position: "RB", injuryStatus: "ACTIVE" }, forecast, summary);
  assert.equal(healthy.health.notes, null);
  assert.ok(!healthy.bullets.some((line) => /injury|practice/i.test(line)));
  const injured = intel.generateOutlook({
    name: "Test Player", position: "RB", injuryStatus: "QUESTIONABLE",
    sleeper: { injuryBodyPart: "hamstring", injuryNotes: "limited late in week", practiceParticipation: "Limited" },
  }, forecast, summary);
  assert.equal(injured.risk, "MEDIUM");
  assert.ok(injured.bullets.some((line) => line.includes("hamstring")));
});

test("history evidence is bounded and only emitted with sufficient target-share history", () => {
  const short = intel.summarizeHistory(intel.parseWeeklyStatsCsv([headers.join(","), row(1, 10, 10)].join("\n")));
  assert.deepEqual(intel.historyEvidence(short, { position: "RB" }), {});
  const enough = intel.summarizeHistory(intel.parseWeeklyStatsCsv([headers.join(","), row(1, 10, 10, 0.2), row(2, 12, 12, 0.22), row(3, 14, 14, 0.24)].join("\n")));
  const evidence = intel.historyEvidence(enough, { position: "RB" });
  assert.ok(evidence["role.target_share"].value <= 0.65);
  assert.ok(evidence["role.target_share"].confidence <= 0.72);
});


test("derived team carry share becomes bounded rushing-role evidence", () => {
  const teammate = (week) => {
    const values = row(week, 8, 12, 0.1).split(",");
    values[0] = "00-MATE";
    values[1] = "Teammate";
    return values.join(",");
  };
  const csv = [headers.join(","),
    row(1, 14, 20, 0.2), teammate(1),
    row(2, 15, 20, 0.21), teammate(2),
    row(3, 16, 20, 0.22), teammate(3),
  ].join("\n");
  const rows = intel.parseWeeklyStatsCsv(csv);
  const index = intel.indexWeeklyRows(rows);
  const primary = intel.findPlayerRows(index, { name: "Test Player", position: "RB", team: "A" }, { seasonType: "REG" });
  const summary = intel.summarizeHistory(primary);
  assert.equal(Number(summary.last3.carryShare.toFixed(2)), 0.75);
  const evidence = intel.historyEvidence(summary, { position: "RB" });
  assert.equal(Number(evidence["role.carry_share"].value.toFixed(2)), 0.75);
  assert.ok(evidence["role.carry_share"].confidence <= 0.74);
});

test("defense profiles shrink position fantasy points allowed toward league average", () => {
  const versus = (week, ppr, team, opponent, name) => {
    const values = row(week, ppr, 12, 0.15).split(",");
    values[0] = `${team}-${week}`; values[1] = name; values[2] = "RB"; values[7] = team; values[8] = opponent; values[26] = String(ppr);
    return values.join(",");
  };
  const csv = [headers.join(","), versus(1, 28, "A", "B", "Runner A1"), versus(1, 8, "C", "D", "Runner C1"), versus(2, 26, "A", "B", "Runner A2"), versus(2, 10, "C", "D", "Runner C2"), versus(3, 30, "A", "B", "Runner A3"), versus(3, 9, "C", "D", "Runner C3")].join("\n");
  const index = intel.indexWeeklyRows(intel.parseWeeklyStatsCsv(csv));
  assert.ok(index.defenseProfiles.B.RB.grade > 0); assert.ok(index.defenseProfiles.D.RB.grade < 0);
  const evidence = intel.defenseMatchupEvidence(index.defenseProfiles, { position: "RB" }, "B");
  assert.ok(evidence["matchup.position_grade"].value > 0); assert.ok(evidence["matchup.position_grade"].confidence <= 0.5);
});

test("prior-season role evidence is confidence-decayed across the offseason", () => {
  const csv = [headers.join(","), row(1, 12, 14, 0.20), row(2, 13, 15, 0.22), row(3, 14, 16, 0.24)].join("\n");
  const rows = intel.parseWeeklyStatsCsv(csv);
  const index = intel.indexWeeklyRows(rows);
  const summary = intel.summarizeHistory(intel.findPlayerRows(index, { name: "Test Player", position: "RB", team: "A" }, { seasonType: "REG" }));
  const sameSeason = intel.historyEvidence(summary, { position: "RB" }, { historySeason: 2025, targetSeason: 2025 });
  const nextSeason = intel.historyEvidence(summary, { position: "RB" }, { historySeason: 2025, targetSeason: 2026 });
  assert.ok(nextSeason["role.target_share"].confidence < sameSeason["role.target_share"].confidence);
  assert.ok(nextSeason["role.carry_share"].confidence < sameSeason["role.carry_share"].confidence);
  assert.match(nextSeason["role.target_share"].source, /prior-season/);
});


test("expected fantasy opportunity creates bounded xFP and FPOE evidence", () => {
  const headers = ["season","posteam","week","player_id","full_name","position","pass_attempt","rec_attempt","rush_attempt","rec_air_yards","pass_fantasy_points_exp","rec_fantasy_points_exp","rush_fantasy_points_exp","pass_fantasy_points","rec_fantasy_points","rush_fantasy_points","total_fantasy_points","total_fantasy_points_exp","total_fantasy_points_diff","rec_attempt_team","rush_attempt_team","rec_air_yards_team"];
  const rows = [1,2,3,4,5].map((week) => [2025,"DET",week,"p1","Test Runner","RB",0,4,15,20,0,5,9,0,6,10,16,14,2,30,28,150].join(","));
  const parsed = intel.parseXfpWeeklyCsv([headers.join(","), ...rows].join("\n"));
  const index = intel.indexXfpRows(parsed);
  const history = intel.findXfpRows(index, { name: "Test Runner", position: "RB", team: "DET" });
  const summary = intel.summarizeXfp(history);
  const evidence = intel.xfpEvidence(summary, { position: "RB" }, { confidenceMultiplier: 0.65 });
  assert.equal(summary.last3.xfp, 14);
  assert.ok(evidence["opportunity.xfp"].confidence <= 0.325);
  assert.equal(evidence["efficiency.fpoe"].value, 2);
});

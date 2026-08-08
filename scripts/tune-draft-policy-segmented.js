"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const core = require("../src/engine/core.js");
const draft = require("../src/engine/draft-sim.js");

const root = path.resolve(__dirname, "..");
const artifact = path.join(root, "data", "validation", "historical-ppr-2020-2025.json.gz");
const CONTROLS = ["espn-market", "balanced", "value", "need-heavy", "zero-rb"];

function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function historicalPlayer(row) {
  const adp = row.adp == null ? null : Number(row.adp);
  const projection = finite(row.seasonProjection) > 0 ? finite(row.seasonProjection) : Math.max(1, finite(row.previousPoints));
  return { id: String(row.id), name: row.name, position: row.position, team: row.team,
    projectedPoints: projection, weeklyProjection: projection / 17, weeklyProjections: Array(18).fill(projection / 17), previousPoints: finite(row.previousPoints),
    adp: Number.isFinite(adp) && adp > 0 ? adp : null, pprRank: adp, standardRank: adp, superflexRank: adp, injuryRisk: 0, reliability: 0.7,
    actualWeekly: (row.actualWeekly || []).map((value) => finite(value)) };
}

function realized(roster, settings) {
  const rows = roster.map((player) => ({ ...player, projectedPoints: player.actualWeekly.reduce((sum, value) => sum + value, 0), weeklyProjection: 0, weeklyProjections: player.actualWeekly }));
  let total = 0;
  for (let week = 1; week <= 17; week += 1) total += core.optimizeWeeklyLineup(rows, settings, week).total;
  return total;
}
function candidates() {
  const rows = [];
  for (const market of [0.55, 0.65, 0.75, 0.85, 0.95]) {
    for (const value of [0.06, 0.10, 0.14, 0.18, 0.24]) {
      for (const need of [0.35, 0.55, 0.75, 0.95, 1.15]) {
        rows.push({ ...draft.DEFAULT_ORACLE_POLICY, market, value, need, rookie: 0 });
      }
    }
  }
  return rows;
}
function slotValue(teams, bucket) {
  if (bucket === "early") return 1;
  if (bucket === "middle") return Math.ceil(teams / 2);
  return teams;
}
function segmentKey(teams, bucket) { return `${teams}-${bucket}`; }
function draftScore(pool, season, teams, slot, seedIndex, policy) {
  const settings = core.cloneSettings({ teams, rounds: 16, scoring: "ppr", draftPosition: slot });
  const result = draft.simulateDraft({ players: pool, settings, userTeamId: slot, userStrategy: "oracle", oraclePolicy: policy, opponentStrategy: "mixed", seed: `seg:${season}:${teams}:${slot}:${seedIndex}` });
  return realized(result.userRoster, settings);
}

function selectSegment(data, teams, bucket) {
  const slot = slotValue(teams, bucket);
  const pools = Object.fromEntries([2021, 2022, 2023].map((season) => [season,
    (data.drafts[String(season)] || []).map(historicalPlayer).filter((player) => player.adp !== null && player.projectedPoints > 0),
  ]));
  const ranked = [];
  for (const policy of candidates()) {
    const seasonMeans = {};
    for (const season of [2021, 2022, 2023]) {
      seasonMeans[season] = mean([0, 1].map((seed) => draftScore(pools[season], season, teams, slot, seed, policy)));
    }
    const dev = (seasonMeans[2021] + seasonMeans[2022]) / 2;
    const worstDev = Math.min(seasonMeans[2021], seasonMeans[2022]);
    const score = dev * 0.55 + seasonMeans[2023] * 0.35 + worstDev * 0.10;
    ranked.push({ policy, seasonMeans, score });
  }
  ranked.sort((left, right) => right.score - left.score);
  return { teams, bucket, slot, selected: ranked[0], top: ranked.slice(0, 5) };
}
function evaluateMeta(data, policies, season, seeds = 6) {
  const edges = Object.fromEntries(CONTROLS.map((control) => [control, []]));
  const raw = [];
  const pool = (data.drafts[String(season)] || []).map(historicalPlayer).filter((player) => player.adp !== null && player.projectedPoints > 0);
  for (const teams of [10, 12]) for (const bucket of ["early", "middle", "late"]) {
    const slot = slotValue(teams, bucket), policy = policies[segmentKey(teams, bucket)].policy;
    const settings = core.cloneSettings({ teams, rounds: 16, scoring: "ppr", draftPosition: slot });
    for (let seed = 0; seed < seeds; seed += 1) {
      const common = { players: pool, settings, userTeamId: slot, opponentStrategy: "mixed", seed: `meta:${season}:${teams}:${slot}:${seed}` };
      const result = draft.simulateDraft({ ...common, userStrategy: "oracle", oraclePolicy: policy });
      const score = realized(result.userRoster, settings);
      raw.push(score);
      for (const control of CONTROLS) {
        const baseline = draft.simulateDraft({ ...common, userStrategy: control });
        edges[control].push(score - realized(baseline.userRoster, settings));
      }
    }
  }
  return { meanRealized: mean(raw), controls: Object.fromEntries(CONTROLS.map((control) => [control, {
    n: edges[control].length, edge: mean(edges[control]), winRate: edges[control].filter((value) => value > 0).length / Math.max(1, edges[control].length),
  }])) };
}

function main() {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(artifact)).toString("utf8"));
  const segments = {};
  for (const teams of [10, 12]) for (const bucket of ["early", "middle", "late"]) {
    const result = selectSegment(data, teams, bucket);
    segments[segmentKey(teams, bucket)] = result.selected;
    console.log(segmentKey(teams, bucket), result.selected.policy, result.selected.seasonMeans);
  }
  const policies = Object.fromEntries(Object.entries(segments).map(([key, row]) => [key, { policy: row.policy }]));
  const fresh2020 = evaluateMeta(data, policies, 2020, 8);
  const consistency2024 = evaluateMeta(data, policies, 2024, 6);
  const consistency2025 = evaluateMeta(data, policies, 2025, 6);
  const freshPass = CONTROLS.every((control) => fresh2020.controls[control].edge >= 0 && fresh2020.controls[control].winRate >= 0.5)
    && fresh2020.controls["espn-market"].edge > 0 && fresh2020.controls["espn-market"].winRate >= 0.75;
  const report = { version: "draft-segmented-policy-2026.1", generatedAt: new Date().toISOString(), training: [2021, 2022], selection: 2023, freshTest: 2020, segments, fresh2020, consistency2024, consistency2025, admitted: freshPass };
  console.log("fresh2020", fresh2020, "admitted", freshPass);
  fs.writeFileSync(path.join(root, "data", "validation", "draft-segmented-policy.json"), JSON.stringify(report, null, 2));
  if (!freshPass) process.exitCode = 2;
}

main();

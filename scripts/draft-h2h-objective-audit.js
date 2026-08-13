"use strict";
process.env.SNAPCOUNT_DRAFT_SEASON = "2019";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const core = require("../src/engine/core.js");
const draft = require("../src/engine/draft-sim.js");
const hist2019 = require("./draft-robust-historical.js");
const root = path.resolve(__dirname, "..");
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const CONTROLS = ["espn-market", "balanced", "value", "need-heavy", "zero-rb"];
const SEGMENTS = [[10,"early",1],[10,"middle",5],[10,"late",10],[12,"early",1],[12,"middle",6],[12,"late",12]];
const SEEDS = 8;
const REGULAR_SEASON_WEEKS = 14;
const policy = JSON.parse(fs.readFileSync(path.join(root, "data", "validation", "draft-robust-policy.json"), "utf8")).policy;
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function stdev(values) { if (values.length < 2) return 0; const m = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1)); }
function player(row) {
  const adp = Number(row.adp);
  const projection = finite(row.seasonProjection) > 0 ? finite(row.seasonProjection) : Math.max(1, finite(row.previousPoints));
  return { id:String(row.id), name:row.name, position:row.position, team:row.team,
    projectedPoints:projection, weeklyProjection:projection/17, weeklyProjections:Array(18).fill(projection/17),
    previousPoints:finite(row.previousPoints), adp:Number.isFinite(adp)&&adp>0?adp:null,
    pprRank:adp, standardRank:adp, superflexRank:adp, injuryRisk:0, reliability:.7,
    actualWeekly:(row.actualWeekly||[]).map((value)=>finite(value)) };
}
function settingsFor(teams, slot) { return core.cloneSettings({ teams, rounds:16, scoring:"ppr", draftPosition:slot }); }
function seedKey(year, teams, slot, seed) { return `draft-h2h-objective:${year}:${teams}:${slot}:${seed}`; }
function rosterPlayers(ids, index) { return (ids || []).map((id) => index.get(String(id))).filter(Boolean); }
function weeklyRealized(roster, settings, week) {
  const rows = roster.map((p) => ({ ...p, projectedPoints:finite(p.actualWeekly?.[week - 1]), weeklyProjection:0, weeklyProjections:p.actualWeekly }));
  return core.optimizeWeeklyLineup(rows, settings, week).total;
}
function h2hWins(result, pool, settings, userTeamId) {
  const index = new Map(pool.map((p) => [String(p.id), p]));
  const teamIds = Object.keys(result.state.rosters || {}).map(String).sort((a,b)=>Number(a)-Number(b));
  const opponents = teamIds.filter((id) => id !== String(userTeamId));
  const rosters = Object.fromEntries(teamIds.map((id) => [id, rosterPlayers(result.state.rosters[id], index)]));
  let wins = 0;
  const weekly = [];
  for (let week = 1; week <= REGULAR_SEASON_WEEKS; week += 1) {
    const opponentId = opponents[(week - 1) % opponents.length];
    const userScore = weeklyRealized(rosters[String(userTeamId)], settings, week);
    const opponentScore = weeklyRealized(rosters[opponentId], settings, week);
    const credit = userScore > opponentScore ? 1 : userScore < opponentScore ? 0 : 0.5;
    wins += credit;
    weekly.push({ week, opponentId, userScore, opponentScore, credit });
  }
  return { wins, weekly };
}
function summarizePaired(rows) {
  const deltas = rows.map((row) => row.snapWins - row.controlWins);
  return {
    drafts: rows.length,
    snapMeanWins: mean(rows.map((row) => row.snapWins)),
    controlMeanWins: mean(rows.map((row) => row.controlWins)),
    meanWinDelta: mean(deltas),
    pairedWinRate: deltas.filter((value) => value > 0).length / Math.max(1, deltas.length),
    pairedNonLossRate: deltas.filter((value) => value >= 0).length / Math.max(1, deltas.length),
    deltaStdDev: stdev(deltas),
  };
}
function compact(summary) {
  return {
    drafts: summary.drafts,
    snapMeanWins: +summary.snapMeanWins.toFixed(3),
    controlMeanWins: +summary.controlMeanWins.toFixed(3),
    meanWinDelta: +summary.meanWinDelta.toFixed(3),
    pairedWinRate: +summary.pairedWinRate.toFixed(3),
    pairedNonLossRate: +summary.pairedNonLossRate.toFixed(3),
    deltaStdDev: +summary.deltaStdDev.toFixed(3),
  };
}
async function buildPools() {
  const archive = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "data", "validation", "historical-ppr-2020-2025.json.gz"))).toString("utf8"));
  const built2019 = await hist2019.buildPool();
  const pools = { 2019: built2019.pool };
  for (const year of YEARS.filter((value) => value !== 2019)) pools[year] = (archive.drafts[String(year)] || []).map(player).filter((p) => p.adp !== null && p.projectedPoints > 0);
  return pools;
}
async function main() {
  const pools = await buildPools();
  const paired = Object.fromEntries(CONTROLS.map((control) => [control, []]));
  const byYear = Object.fromEntries(YEARS.map((year) => [year, Object.fromEntries(CONTROLS.map((control) => [control, []]))]));
  for (const year of YEARS) for (const [teams, bucket, slot] of SEGMENTS) {
    const settings = settingsFor(teams, slot);
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const common = { players:pools[year], settings, userTeamId:slot, opponentStrategy:"mixed", seed:seedKey(year, teams, slot, seed) };
      const snapDraft = draft.simulateDraft({ ...common, userStrategy:"oracle", oraclePolicy:policy });
      const snapWins = h2hWins(snapDraft, pools[year], settings, slot).wins;
      for (const control of CONTROLS) {
        const controlDraft = draft.simulateDraft({ ...common, userStrategy:control });
        const controlWins = h2hWins(controlDraft, pools[year], settings, slot).wins;
        const row = { year, teams, bucket, slot, seed, snapWins, controlWins };
        paired[control].push(row);
        byYear[year][control].push(row);
      }
    }
  }
  const aggregate = Object.fromEntries(CONTROLS.map((control) => [control, compact(summarizePaired(paired[control]))]));
  const seasons = Object.fromEntries(YEARS.map((year) => [year, Object.fromEntries(CONTROLS.map((control) => [control, compact(summarizePaired(byYear[year][control]))]))]));
  const positiveSeasons = Object.fromEntries(CONTROLS.map((control) => [control, YEARS.filter((year) => seasons[year][control].meanWinDelta > 0).length]));
  const report = {
    version: "draft-h2h-objective-audit-2026.1",
    generatedAt: new Date().toISOString(),
    purpose: "diagnostic-only check that the frozen qualified Draft policy aligns with realized regular-season head-to-head wins",
    years: YEARS,
    controls: CONTROLS,
    regularSeasonWeeks: REGULAR_SEASON_WEEKS,
    seedsPerSegment: SEEDS,
    segments: SEGMENTS,
    policy,
    aggregate,
    seasons,
    positiveSeasons,
    usedForSelection: false,
    servingPolicyChanged: false,
    consumedHistoricalEvidence: true,
    interpretation: "This audit does not qualify or tune a Draft policy. It only checks whether the already-frozen policy's roster-point advantage is directionally aligned with realized head-to-head wins on consumed historical seasons.",
  };
  fs.writeFileSync(path.join(root, "data", "validation", "draft-h2h-objective-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ aggregate, positiveSeasons }, null, 2));
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

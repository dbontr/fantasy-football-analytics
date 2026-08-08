"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const core = require("../src/engine/core.js");
const draft = require("../src/engine/draft-sim.js");

const root = path.resolve(__dirname, "..");
const artifact = path.join(root, "data", "validation", "historical-ppr-2020-2025.json.gz");
const WEEKS = [2, 4, 6, 8, 10, 12, 14];
const THRESHOLDS = [0.25, 2, 4, 6, 8, 10, 12, 16, 20, 28, 36];

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function player(row) {
  const adp = row.adp == null ? null : Number(row.adp);
  const projection = finite(row.seasonProjection) > 0 ? finite(row.seasonProjection) : Math.max(1, finite(row.previousPoints));
  return {
    id: String(row.id), name: row.name, position: row.position, team: row.team,
    projectedPoints: projection, weeklyProjection: projection / 17,
    weeklyProjections: (row.weekly || []).map((value) => Number.isFinite(value) ? value : null),
    previousPoints: finite(row.previousPoints), adp: Number.isFinite(adp) && adp > 0 ? adp : null,
    pprRank: adp, standardRank: adp, superflexRank: adp, injuryRisk: 0, reliability: 0.7,
    actualWeekly: (row.actualWeekly || []).map((value) => finite(value)),
  };
}

function realizedPoints(roster, settings, startWeek, horizon = 4) {
  const realized = roster.map((row) => ({ ...row, weeklyProjections: row.actualWeekly, weeklyProjection: 0 }));
  let total = 0;
  for (let week = startWeek; week <= Math.min(17, startWeek + horizon - 1); week += 1) {
    total += core.optimizeWeeklyLineup(realized, settings, week).total;
  }
  return total;
}
function sampleRows(data, season, seeds = 2) {
  const pool = (data.drafts[String(season)] || []).map(player).filter((row) => row.adp !== null && row.projectedPoints > 0);
  const byId = new Map(pool.map((row) => [row.id, row]));
  const samples = [];
  for (const teams of [10, 12]) {
    const base = core.cloneSettings({ teams, rounds: 16, scoring: "ppr", draftPosition: 1 });
    const slots = [1, Math.ceil(teams / 2), teams];
    for (const slot of slots) for (let seedIndex = 0; seedIndex < seeds; seedIndex += 1) {
      const settings = { ...base, draftPosition: slot };
      const result = draft.simulateDraft({ players: pool, settings, userTeamId: slot, userStrategy: "espn-market", opponentStrategy: "mixed", seed: `waiver:${season}:${teams}:${slot}:${seedIndex}` });
      const drafted = new Set(result.state.picks.map((pick) => String(pick.playerId)));
      const roster = (result.state.rosters[String(slot)] || []).map((id) => byId.get(String(id))).filter(Boolean);
      const freeAgents = pool.filter((row) => !drafted.has(row.id));
      for (const week of WEEKS) {
        const suggestion = core.waiverRecommendations(roster, freeAgents, settings, 1, week, { minimumScore: 0 })[0] || null;
        if (!suggestion) continue;
        const before = realizedPoints(roster, settings, week);
        const afterRoster = [...roster.filter((row) => row.id !== suggestion.drop.id), suggestion.add];
        const after = realizedPoints(afterRoster, settings, week);
        const weekProjection = (row) => finite(row.weeklyProjections?.[week - 1]);
        const naiveAdd = [...freeAgents].sort((left, right) => weekProjection(right) - weekProjection(left))[0];
        const naiveDrop = [...roster].sort((left, right) => weekProjection(left) - weekProjection(right))[0];
        const naiveRoster = naiveAdd && naiveDrop ? [...roster.filter((row) => row.id !== naiveDrop.id), naiveAdd] : roster;
        const naive = realizedPoints(naiveRoster, settings, week);
        samples.push({ season, teams, slot, seedIndex, week, score: suggestion.score, gain: after - before, naiveGain: naive - before, edgeVsNaive: after - naive, add: suggestion.add.name, drop: suggestion.drop.name });
      }
    }
  }
  return samples;
}

function scoreThreshold(samples, threshold) {
  const claims = samples.filter((row) => row.score > threshold);
  return {
    threshold,
    opportunities: samples.length,
    claims: claims.length,
    claimRate: claims.length / Math.max(1, samples.length),
    meanGainPerOpportunity: mean(samples.map((row) => row.score > threshold ? row.gain : 0)),
    meanGainPerClaim: mean(claims.map((row) => row.gain)),
    meanNaiveGain: mean(samples.map((row) => row.naiveGain)),
    meanEdgeVsNaive: mean(samples.map((row) => row.score > threshold ? row.gain - row.naiveGain : -row.naiveGain)),
    positiveClaimRate: claims.filter((row) => row.gain > 0).length / Math.max(1, claims.length),
    beatNaiveRate: samples.filter((row) => (row.score > threshold ? row.gain : 0) > row.naiveGain).length / Math.max(1, samples.length),
  };
}
function chooseThreshold(samples, selectionSamples) {
  const rows = THRESHOLDS.map((threshold) => ({
    threshold,
    development: scoreThreshold(samples, threshold),
    selection: scoreThreshold(selectionSamples, threshold),
  }));
  rows.sort((left, right) => {
    const leftStable = left.development.meanGainPerOpportunity > 0 && left.selection.meanGainPerOpportunity >= 0 && left.development.meanEdgeVsNaive > 0 && left.selection.meanEdgeVsNaive >= 0 && left.selection.claims >= 4;
    const rightStable = right.development.meanGainPerOpportunity > 0 && right.selection.meanGainPerOpportunity >= 0 && right.development.meanEdgeVsNaive > 0 && right.selection.meanEdgeVsNaive >= 0 && right.selection.claims >= 4;
    if (leftStable !== rightStable) return Number(rightStable) - Number(leftStable);
    const leftScore = left.development.meanEdgeVsNaive + left.selection.meanEdgeVsNaive + 0.25 * (left.development.meanGainPerOpportunity + left.selection.meanGainPerOpportunity) + 0.1 * left.selection.beatNaiveRate;
    const rightScore = right.development.meanEdgeVsNaive + right.selection.meanEdgeVsNaive + 0.25 * (right.development.meanGainPerOpportunity + right.selection.meanGainPerOpportunity) + 0.1 * right.selection.beatNaiveRate;
    return rightScore - leftScore;
  });
  return rows;
}

function main() {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(artifact)).toString("utf8"));
  const bySeason = {};
  for (const season of [2021, 2022, 2023, 2024, 2025]) {
    bySeason[season] = sampleRows(data, season, season >= 2024 ? 4 : 2);
    console.log(`waiver ${season}: ${bySeason[season].length} decision samples`);
  }
  const development = [...bySeason[2021], ...bySeason[2022]];
  const ranked = chooseThreshold(development, bySeason[2023]);
  const selected = ranked[0];
  const frozen2024 = scoreThreshold(bySeason[2024], selected.threshold);
  const consistency2025 = scoreThreshold(bySeason[2025], selected.threshold);
  const admitted = frozen2024.meanGainPerOpportunity > 0 && frozen2024.meanGainPerClaim > 0 && frozen2024.meanEdgeVsNaive > 0 && consistency2025.meanGainPerOpportunity >= 0 && consistency2025.meanEdgeVsNaive >= 0;
  const report = { version: "waiver-history-audit-2026.1", generatedAt: new Date().toISOString(), split: { development: [2021, 2022], selection: 2023, frozenTest: 2024, consistencyOnly: 2025 }, selectedThreshold: selected.threshold, selected, frozen2024, consistency2025, admitted, candidates: ranked };
  console.log("selected", selected.threshold, "2024", frozen2024, "2025", consistency2025, "admitted", admitted);
  fs.writeFileSync(path.join(root, "data", "validation", "waiver-audit-report.json"), JSON.stringify(report, null, 2));
  if (!admitted) process.exitCode = 2;
}

main();

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const core = require("../src/engine/core.js");
const draft = require("../src/engine/draft-sim.js");

const root = path.resolve(__dirname, "..");
const artifact = path.join(root, "data", "validation", "historical-ppr-2020-2025.json.gz");
const WEEKS = [4, 8, 12];
const THRESHOLDS = [2, 4, 6, 8, 10, 12, 16, 20, 28];

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

function realizedPoints(roster, settings, startWeek, horizon = 6) {
  const realized = roster.map((row) => ({ ...row, weeklyProjections: row.actualWeekly, weeklyProjection: 0 }));
  let total = 0;
  for (let week = startWeek; week <= Math.min(17, startWeek + horizon - 1); week += 1) {
    total += core.optimizeWeeklyLineup(realized, settings, week).total;
  }
  return total;
}
function tradeGain(roster, give, receive, settings, week) {
  const before = realizedPoints(roster, settings, week);
  const afterRoster = [...roster.filter((row) => row.id !== give.id), receive];
  return realizedPoints(afterRoster, settings, week) - before;
}
function rosterAssets(roster, settings) {
  const replacement = core.computeReplacementLevels(roster, settings);
  return roster.filter((row) => !["K", "DST"].includes(row.position))
    .sort((left, right) => core.draftAssetValue(right, replacement, settings) - core.draftAssetValue(left, replacement, settings))
    .slice(0, 9);
}
function sampleSeason(data, season, seeds = 1) {
  const pool = (data.drafts[String(season)] || []).map(player).filter((row) => row.adp !== null && row.projectedPoints > 0);
  const byId = new Map(pool.map((row) => [row.id, row]));
  const samples = [];
  for (const teams of [10, 12]) {
    const base = core.cloneSettings({ teams, rounds: 16, scoring: "ppr", draftPosition: 1 });
    for (const slot of [1, Math.ceil(teams / 2), teams]) for (let seedIndex = 0; seedIndex < seeds; seedIndex += 1) {
      const settings = { ...base, draftPosition: slot };
      const result = draft.simulateDraft({ players: pool, settings, userTeamId: slot, userStrategy: "espn-market", opponentStrategy: "mixed", seed: `trade:${season}:${teams}:${slot}:${seedIndex}` });
      const userRoster = (result.state.rosters[String(slot)] || []).map((id) => byId.get(String(id))).filter(Boolean);
      const opponentId = slot === teams ? slot - 1 : slot + 1;
      const opponentRoster = (result.state.rosters[String(opponentId)] || []).map((id) => byId.get(String(id))).filter(Boolean);
      const userAssets = rosterAssets(userRoster, settings), opponentAssets = rosterAssets(opponentRoster, settings);
      for (const week of WEEKS) {
        for (const give of userAssets) for (const receive of opponentAssets) {
          const analysis = core.analyzeTrade({ roster: userRoster, give: [give], receive: [receive], players: pool, settings, week });
          if (analysis.fairness < 55) continue;
          const gain = tradeGain(userRoster, give, receive, settings, week);
          samples.push({ season, teams, slot, seedIndex, week, score: analysis.score, fairness: analysis.fairness, lineupGain: analysis.lineupGain, assetGain: analysis.assetGain, gain, give: give.name, receive: receive.name });
        }
      }
    }
  }
  return samples;
}
function scoreThreshold(samples, threshold) {
  const accepts = samples.filter((row) => row.score >= threshold);
  const passes = samples.filter((row) => row.score <= -threshold);
  const naiveAccepts = samples.filter((row) => row.lineupGain > 0);
  return {
    threshold,
    samples: samples.length,
    accepts: accepts.length,
    passes: passes.length,
    acceptMeanGain: mean(accepts.map((row) => row.gain)),
    acceptPositiveRate: accepts.filter((row) => row.gain > 0).length / Math.max(1, accepts.length),
    passMeanGain: mean(passes.map((row) => row.gain)),
    passCorrectRate: passes.filter((row) => row.gain < 0).length / Math.max(1, passes.length),
    naiveAcceptMeanGain: mean(naiveAccepts.map((row) => row.gain)),
    naiveAcceptPositiveRate: naiveAccepts.filter((row) => row.gain > 0).length / Math.max(1, naiveAccepts.length),
  };
}

function chooseThreshold(development, selection) {
  const rows = THRESHOLDS.map((threshold) => ({
    threshold,
    development: scoreThreshold(development, threshold),
    selection: scoreThreshold(selection, threshold),
  }));
  rows.sort((left, right) => {
    const stable = (row) => row.development.acceptMeanGain > 0 && row.selection.acceptMeanGain > 0
      && row.development.passMeanGain < 0 && row.selection.passMeanGain < 0
      && row.selection.accepts >= 12 && row.selection.passes >= 12;
    const leftStable = stable(left), rightStable = stable(right);
    if (leftStable !== rightStable) return Number(rightStable) - Number(leftStable);
    const utility = (row) => row.development.acceptMeanGain + row.selection.acceptMeanGain
      - row.development.passMeanGain - row.selection.passMeanGain
      + 10 * (row.selection.acceptPositiveRate + row.selection.passCorrectRate);
    return utility(right) - utility(left);
  });
  return rows;
}

function main() {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(artifact)).toString("utf8"));
  const bySeason = {};
  for (const season of [2021, 2022, 2023, 2024, 2025]) {
    bySeason[season] = sampleSeason(data, season, season >= 2024 ? 2 : 1);
    console.log(`trade ${season}: ${bySeason[season].length} candidate trades`);
  }
  const ranked = chooseThreshold([...bySeason[2021], ...bySeason[2022]], bySeason[2023]);
  const selected = ranked[0];
  const frozen2024 = scoreThreshold(bySeason[2024], selected.threshold);
  const consistency2025 = scoreThreshold(bySeason[2025], selected.threshold);
  const admitted = frozen2024.acceptMeanGain > 0 && frozen2024.acceptPositiveRate > frozen2024.naiveAcceptPositiveRate
    && frozen2024.passMeanGain < 0 && frozen2024.passCorrectRate > 0.5
    && consistency2025.acceptMeanGain >= 0 && consistency2025.passMeanGain <= 0;
  const report = { version: "trade-history-audit-2026.1", generatedAt: new Date().toISOString(), split: { development: [2021, 2022], selection: 2023, frozenTest: 2024, consistencyOnly: 2025 }, selectedThreshold: selected.threshold, selected, frozen2024, consistency2025, admitted, candidates: ranked };
  console.log("selected", selected.threshold, "2024", frozen2024, "2025", consistency2025, "admitted", admitted);
  fs.writeFileSync(path.join(root, "data", "validation", "trade-audit-report.json"), JSON.stringify(report, null, 2));
  if (!admitted) process.exitCode = 2;
}

main();

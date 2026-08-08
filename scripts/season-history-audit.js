"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const core = require("../src/engine/core.js");
const draft = require("../src/engine/draft-sim.js");
const engine = require("../src/engine/runtime.js");
const calibration = require("../src/engine/calibration.js");
const intelligence = require("../src/engine/intelligence.js");
calibration.install(engine, intelligence);

const root = path.resolve(__dirname, "..");
const artifact = path.join(root, "data", "validation", "historical-ppr-2020-2025.json.gz");

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
    pprRank: adp, standardRank: adp, superflexRank: adp, injuryRisk: 0, injuryStatus: "ACTIVE", reliability: 0.72,
    actualWeekly: (row.actualWeekly || []).map((value) => finite(value)),
  };
}

function roundRobinPairings(teamIds, week) {
  const teams = [...teamIds];
  if (teams.length % 2) teams.push(null);
  const fixed = teams[0];
  const rotating = teams.slice(1);
  const round = (Math.max(1, week) - 1) % (teams.length - 1);
  const shifted = rotating.map((_, index) => rotating[(index + round) % rotating.length]);
  const ordered = [fixed, ...shifted];
  const pairs = [];
  for (let index = 0; index < ordered.length / 2; index += 1) {
    const left = ordered[index], right = ordered[ordered.length - 1 - index];
    if (left !== null && right !== null) pairs.push([String(left), String(right)]);
  }
  return pairs;
}
function actualWeekScore(roster, settings, week) {
  const realized = roster.map((row) => ({ ...row, weeklyProjections: row.actualWeekly, weeklyProjection: 0 }));
  return core.optimizeWeeklyLineup(realized, settings, week).total;
}
function playoffWinner(left, right, scores, seeds) {
  if (Math.abs(scores[left] - scores[right]) > 1e-9) return scores[left] > scores[right] ? left : right;
  return seeds.get(left) <= seeds.get(right) ? left : right;
}
function actualChampion(teams, settings, regularSeasonEnd = 14, championshipWeek = 17, playoffTeams = 6, playoffByes = 2) {
  const state = Object.fromEntries(teams.map((team) => [team.teamId, { wins: 0, points: 0 }]));
  for (let week = 1; week <= regularSeasonEnd; week += 1) {
    const scores = Object.fromEntries(teams.map((team) => [team.teamId, actualWeekScore(team.roster, settings, week)]));
    for (const team of teams) state[team.teamId].points += scores[team.teamId];
    for (const [left, right] of roundRobinPairings(teams.map((team) => team.teamId), week)) {
      if (scores[left] === scores[right]) { state[left].wins += 0.5; state[right].wins += 0.5; }
      else state[scores[left] > scores[right] ? left : right].wins += 1;
    }
  }
  const standings = teams.map((team) => ({ teamId: team.teamId, ...state[team.teamId] }))
    .sort((left, right) => right.wins - left.wins || right.points - left.points || left.teamId.localeCompare(right.teamId));
  const seeds = new Map(standings.map((row, index) => [row.teamId, index + 1]));
  let active = standings.slice(0, playoffTeams).map((row) => row.teamId);
  for (let week = 15; week <= championshipWeek && active.length > 1; week += 1) {
    const scores = Object.fromEntries(active.map((id) => {
      const team = teams.find((row) => row.teamId === id);
      return [id, actualWeekScore(team.roster, settings, week)];
    }));
    const byes = week === 15 ? standings.slice(0, playoffByes).map((row) => row.teamId).filter((id) => active.includes(id)) : [];
    const available = active.filter((id) => !byes.includes(id)).sort((left, right) => seeds.get(left) - seeds.get(right));
    const advanced = [...byes];
    while (available.length > 1) {
      const high = available.shift(), low = available.pop();
      advanced.push(playoffWinner(high, low, scores, seeds));
    }
    if (available.length === 1) advanced.push(available[0]);
    active = advanced;
  }
  return active[0];
}
function softmaxStrength(teams, settings) {
  const strengths = teams.map((team) => draft.rosterSummary(team.roster, settings).expectedSeasonStarterPoints);
  const average = mean(strengths);
  const deviation = Math.sqrt(mean(strengths.map((value) => (value - average) ** 2))) || 1;
  const weights = strengths.map((value) => Math.exp((value - average) / (deviation * 1.6)));
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(teams.map((team, index) => [team.teamId, weights[index] / total]));
}
function brier(probabilities, champion, teamIds) {
  return mean(teamIds.map((id) => (finite(probabilities[id]) - (id === champion ? 1 : 0)) ** 2));
}
function logLoss(probabilities, champion) {
  return -Math.log(Math.max(1e-6, finite(probabilities[champion])));
}

function sampleSeason(data, season, seeds = 2) {
  const pool = (data.drafts[String(season)] || []).map(player).filter((row) => row.adp !== null && row.projectedPoints > 0);
  const byId = new Map(pool.map((row) => [row.id, row]));
  const samples = [];
  for (const teamCount of [10, 12]) for (let seedIndex = 0; seedIndex < seeds; seedIndex += 1) {
    const settings = core.cloneSettings({ teams: teamCount, rounds: 16, scoring: "ppr", draftPosition: 1 });
    const drafted = draft.simulateDraft({ players: pool, settings, userTeamId: 1, userStrategy: "espn-market", opponentStrategy: "mixed", seed: `season:${season}:${teamCount}:${seedIndex}` });
    const teams = Array.from({ length: teamCount }, (_, index) => {
      const teamId = String(index + 1);
      return { teamId, name: `Team ${teamId}`, roster: (drafted.state.rosters[teamId] || []).map((id) => byId.get(String(id))).filter(Boolean) };
    });
    const champion = actualChampion(teams, settings);
    const simulation = engine.simulateLeague({ teams, settings, startWeek: 1, regularSeasonEnd: 14, championshipWeek: 17, playoffTeams: 6, playoffByes: 2, simulations: 600, seed: `season-prob:${season}:${teamCount}:${seedIndex}` });
    const model = Object.fromEntries(simulation.teams.map((team) => [team.teamId, team.championshipProbability]));
    const strength = softmaxStrength(teams, settings);
    const uniform = Object.fromEntries(teams.map((team) => [team.teamId, 1 / teamCount]));
    const teamIds = teams.map((team) => team.teamId);
    samples.push({ season, teamCount, seedIndex, champion,
      modelBrier: brier(model, champion, teamIds), strengthBrier: brier(strength, champion, teamIds), uniformBrier: brier(uniform, champion, teamIds),
      modelLogLoss: logLoss(model, champion), strengthLogLoss: logLoss(strength, champion), uniformLogLoss: logLoss(uniform, champion),
      championProbability: model[champion], strengthChampionProbability: strength[champion],
    });
  }
  return samples;
}
function summarize(rows) {
  return {
    n: rows.length,
    modelBrier: mean(rows.map((row) => row.modelBrier)), strengthBrier: mean(rows.map((row) => row.strengthBrier)), uniformBrier: mean(rows.map((row) => row.uniformBrier)),
    modelLogLoss: mean(rows.map((row) => row.modelLogLoss)), strengthLogLoss: mean(rows.map((row) => row.strengthLogLoss)), uniformLogLoss: mean(rows.map((row) => row.uniformLogLoss)),
    championProbability: mean(rows.map((row) => row.championProbability)), strengthChampionProbability: mean(rows.map((row) => row.strengthChampionProbability)),
  };
}

function main() {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(artifact)).toString("utf8"));
  const bySeason = {};
  for (const season of [2021, 2022, 2023, 2024, 2025]) {
    bySeason[season] = sampleSeason(data, season, season >= 2024 ? 5 : 3);
    console.log(`season ${season}`, summarize(bySeason[season]));
  }
  const development = summarize([...bySeason[2021], ...bySeason[2022]]);
  const selection = summarize(bySeason[2023]);
  const frozen2024 = summarize(bySeason[2024]);
  const consistency2025 = summarize(bySeason[2025]);
  const beatsBaselines = (row) => row.modelBrier < row.uniformBrier && row.modelLogLoss < row.uniformLogLoss
    && row.modelBrier <= row.strengthBrier && row.modelLogLoss <= row.strengthLogLoss;
  const admitted = beatsBaselines(frozen2024)
    && consistency2025.modelBrier < consistency2025.uniformBrier
    && consistency2025.modelLogLoss < consistency2025.uniformLogLoss;
  const report = { version: "season-history-audit-2026.1", generatedAt: new Date().toISOString(), split: { development: [2021, 2022], selection: 2023, frozenTest: 2024, consistencyOnly: 2025 }, development, selection, frozen2024, consistency2025, admitted };
  console.log("season admitted", admitted);
  fs.writeFileSync(path.join(root, "data", "validation", "season-audit-report.json"), JSON.stringify(report, null, 2));
  if (!admitted) process.exitCode = 2;
}

main();

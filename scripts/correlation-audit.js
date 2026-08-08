"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const intelligence = require("../src/engine/intelligence.js");
const engine = require("../src/engine/runtime.js");

const POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const FACTORS = ["scoring", "passing", "rushing", "pace", "chaos"];
const LEGACY = Object.freeze({
  QB: { scoring: 0.28, passing: 0.35, rushing: 0.08, pace: 0.12, team: 0.12, chaos: 0 },
  RB: { scoring: 0.26, passing: 0.05, rushing: 0.38, pace: 0.10, team: 0.14, chaos: 0 },
  WR: { scoring: 0.30, passing: 0.38, rushing: 0, pace: 0.10, team: 0.12, chaos: 0 },
  TE: { scoring: 0.29, passing: 0.36, rushing: 0, pace: 0.10, team: 0.13, chaos: 0 },
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function standardDeviation(values) {
  if (!values.length) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function weightedRecentMean(values) {
  const recent = values.slice(-5);
  let sum = 0;
  let weight = 0;
  for (let index = 0; index < recent.length; index += 1) {
    const nextWeight = index + 1;
    sum += recent[index] * nextWeight;
    weight += nextWeight;
  }
  return weight ? sum / weight : 0;
}

function correlation(pairs) {
  if (pairs.length < 3) return 0;
  const leftMean = mean(pairs.map((pair) => pair[0]));
  const rightMean = mean(pairs.map((pair) => pair[1]));
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (const [left, right] of pairs) {
    const dl = left - leftMean;
    const dr = right - rightMean;
    numerator += dl * dr;
    leftVariance += dl * dl;
    rightVariance += dr * dr;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? numerator / denominator : 0;
}
function loadSeason(season) {
  const file = path.join(__dirname, "..", "data", "history", `stats_player_week_${season}.csv.gz`);
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  return intelligence.parseWeeklyStatsCsv(text)
    .filter((row) => row.seasonType === "REG" && POSITIONS.has(row.position));
}

function rollingResiduals(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.season}|${row.playerId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const residuals = [];
  for (const playerRows of grouped.values()) {
    playerRows.sort((left, right) => left.week - right.week);
    const history = [];
    for (const row of playerRows) {
      if (history.length >= 4) {
        const prior = history.slice(-6).map((entry) => finite(entry.fantasyPpr));
        const prediction = weightedRecentMean(prior);
        if (prediction >= 4) {
          const scale = Math.max(3, standardDeviation(prior));
          residuals.push({
            season: row.season,
            gameId: row.gameId,
            team: row.team,
            position: row.position,
            playerId: row.playerId,
            z: clamp((finite(row.fantasyPpr) - prediction) / scale, -3, 3),
          });
        }
      }
      history.push(row);
    }
  }
  return residuals;
}
function pairGroups(residuals, season) {
  const games = new Map();
  for (const row of residuals) {
    if (row.season !== season) continue;
    if (!games.has(row.gameId)) games.set(row.gameId, []);
    games.get(row.gameId).push(row);
  }
  const groups = new Map();
  for (const rows of games.values()) {
    for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
        const left = rows[leftIndex];
        const right = rows[rightIndex];
        if (left.playerId === right.playerId) continue;
        const relation = left.team === right.team ? "same" : "opp";
        const positions = [left.position, right.position].sort();
        const key = `${relation}|${positions[0]}|${positions[1]}`;
        const pair = left.position <= right.position ? [left.z, right.z] : [right.z, left.z];
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(pair);
      }
    }
  }
  return groups;
}

function modelCorrelation(key, weights) {
  const [relation, leftPosition, rightPosition] = key.split("|");
  const left = weights[leftPosition];
  const right = weights[rightPosition];
  if (!left || !right) return 0;
  let value = 0;
  for (const factor of FACTORS) value += finite(left[factor]) * finite(right[factor]);
  if (relation === "same") value += finite(left.team) * finite(right.team);
  return value;
}

function weightedRmse(groups, weights) {
  let squared = 0;
  let samples = 0;
  for (const [key, pairs] of groups) {
    if (pairs.length < 30) continue;
    const empirical = correlation(pairs);
    const modeled = modelCorrelation(key, weights);
    squared += pairs.length * (modeled - empirical) ** 2;
    samples += pairs.length;
  }
  return samples ? Math.sqrt(squared / samples) : null;
}
function activeWeights() {
  return Object.fromEntries(["QB", "RB", "WR", "TE"].map((position) => [position, engine.factorWeights(position)]));
}

function metric(groups, relation, left, right) {
  const key = `${relation}|${[left, right].sort().join("|")}`;
  const pairs = groups.get(key) || [];
  return { samples: pairs.length, correlation: correlation(pairs) };
}

function main() {
  const rows = [2023, 2024, 2025].flatMap(loadSeason);
  const residuals = rollingResiduals(rows);
  const years = Object.fromEntries([2023, 2024, 2025].map((season) => [season, pairGroups(residuals, season)]));
  const current = activeWeights();
  const legacy = LEGACY;
  const currentErrors = Object.fromEntries([2023, 2024, 2025].map((season) => [season, weightedRmse(years[season], current)]));
  const legacyErrors = Object.fromEntries([2023, 2024, 2025].map((season) => [season, weightedRmse(years[season], legacy)]));

  console.log("SnapCount scenario-correlation audit");
  console.log("Fit target: 2023 REG | Validation: 2024 REG | 2025: consistency check only");
  console.log("Residuals use only the player's previous games: prior-six scale + prior-five recency mean.\n");
  console.log("Year   legacy RMSE   calibrated RMSE");
  for (const season of [2023, 2024, 2025]) {
    console.log(`${season}      ${legacyErrors[season].toFixed(4)}            ${currentErrors[season].toFixed(4)}`);
  }

  const examples = [
    ["same", "QB", "WR"],
    ["same", "QB", "TE"],
    ["same", "QB", "RB"],
    ["same", "RB", "WR"],
    ["same", "WR", "WR"],
    ["opp", "QB", "WR"],
    ["opp", "WR", "WR"],
  ];
  console.log("\nSelected empirical correlations (2023 / 2024 / 2025) and calibrated model:");
  for (const [relation, left, right] of examples) {
    const key = `${relation}|${[left, right].sort().join("|")}`;
    const values = [2023, 2024, 2025].map((season) => metric(years[season], relation, left, right));
    console.log(`${key.padEnd(14)} ${values.map((row) => row.correlation.toFixed(3)).join(" / ")}   model ${modelCorrelation(key, current).toFixed(3)}`);
  }

  if (!(currentErrors[2024] < legacyErrors[2024] * 0.40)) throw new Error("Correlation calibration did not materially improve 2024 validation RMSE");
  if (!(currentErrors[2025] < legacyErrors[2025] * 0.45)) throw new Error("Correlation calibration failed the 2025 consistency check");
  if (modelCorrelation("same|QB|WR", current) < 0.18) throw new Error("QB-WR stack correlation became implausibly weak");
  if (modelCorrelation("same|RB|WR", current) > 0.06) throw new Error("RB-WR teammate correlation remains too broad");
  if (modelCorrelation("same|WR|WR", current) > 0.10) throw new Error("WR-WR teammate correlation remains too broad");
  if (modelCorrelation("opp|WR|WR", current) > 0.05) throw new Error("Opponent WR-WR correlation remains too broad");
}

main();

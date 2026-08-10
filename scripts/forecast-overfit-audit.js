"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const audit = require("./forecast-history-audit.js");

const root = path.resolve(__dirname, "..");
const validation = path.join(root, "data", "validation");
const dataFile = path.join(validation, "historical-ppr-2020-2025.json.gz");
const reportFile = path.join(validation, "forecast-audit-report.json");
const outputFile = path.join(validation, "forecast-overfit-audit.json");
const SEASONS = [2020, 2021, 2022, 2023, 2024, 2025];
const POSITIONS = ["QB", "RB", "WR", "TE"];
const BOOTSTRAPS = 200000;

function round(value, digits = 8) { return Number(Number(value).toFixed(digits)); }
function canonical(value) { return JSON.stringify(value); }
function quantile(values, probability) {
  const ordered = values.slice().sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.floor(probability * ordered.length)));
  return ordered[index];
}
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function frozenModel(report, position) {
  const entry = report.positions?.[position];
  if (!entry?.frozen2024?.admitted) return null;
  return {
    features: entry.model.features,
    rawIntercept: entry.model.intercept,
    rawCoefficients: entry.model.coefficients,
  };
}
function predictor(report) {
  const models = Object.fromEntries(POSITIONS.map((position) => [position, frozenModel(report, position)]));
  return (row) => models[row.position] ? audit.predict(row, models[row.position]) : row.baseline;
}
function rowsFor(data, seasons, position = null) {
  const selected = new Set(seasons);
  return data.weeks.filter((row) => selected.has(row.season)
    && POSITIONS.includes(row.position) && row.baseline >= 2
    && (!position || row.position === position));
}
function rawComponents(rows, predict) {
  let rawAbs = 0, correctedAbs = 0, rawSq = 0, correctedSq = 0;
  for (const row of rows) {
    const corrected = predict(row);
    const rawError = row.baseline - row.actual;
    const correctedError = corrected - row.actual;
    rawAbs += Math.abs(rawError); correctedAbs += Math.abs(correctedError);
    rawSq += rawError ** 2; correctedSq += correctedError ** 2;
  }
  return { n: rows.length, rawAbs, correctedAbs, rawSq, correctedSq };
}
function summarize(rows, predict) {
  const raw = audit.metrics(rows, (row) => row.baseline);
  const corrected = audit.metrics(rows, predict);
  return {
    n: rows.length,
    raw: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, typeof value === "number" ? round(value) : value])),
    corrected: Object.fromEntries(Object.entries(corrected).map(([key, value]) => [key, typeof value === "number" ? round(value) : value])),
    delta: {
      maeImprovement: round(raw.mae - corrected.mae),
      rmseImprovement: round(raw.rmse - corrected.rmse),
      rankImprovement: round(corrected.rank - raw.rank),
      absoluteBiasImprovement: round(Math.abs(raw.bias) - Math.abs(corrected.bias)),
    },
  };
}
function combineComponents(items) {
  const total = items.reduce((sum, item) => sum + item.n, 0);
  const rawAbs = items.reduce((sum, item) => sum + item.rawAbs, 0);
  const correctedAbs = items.reduce((sum, item) => sum + item.correctedAbs, 0);
  const rawSq = items.reduce((sum, item) => sum + item.rawSq, 0);
  const correctedSq = items.reduce((sum, item) => sum + item.correctedSq, 0);
  return {
    maeImprovement: (rawAbs - correctedAbs) / total,
    rmseImprovement: Math.sqrt(rawSq / total) - Math.sqrt(correctedSq / total),
  };
}
function choose(n, k) {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = result * (n - k + i) / i;
  return result;
}
function oneSidedSignP(wins, total) {
  let probability = 0;
  for (let k = wins; k <= total; k += 1) probability += choose(total, k) * (0.5 ** total);
  return probability;
}
function build() {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(dataFile)));
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const predict = predictor(report);
  const seasons = {};
  const components = {};
  const cells = [];
  for (const season of SEASONS) {
    const rows = rowsFor(data, [season]);
    seasons[season] = summarize(rows, predict);
    components[season] = rawComponents(rows, predict);
    for (const position of POSITIONS) {
      const positionRows = rowsFor(data, [season], position);
      const score = summarize(positionRows, predict);
      cells.push({ season, position, ...score.delta, n: score.n });
    }
  }
  const jackknife = {};
  for (const omitted of SEASONS) {
    const kept = SEASONS.filter((season) => season !== omitted);
    jackknife[omitted] = summarize(rowsFor(data, kept), predict).delta;
  }
  const rng = prng(0x5A17C0DE);
  const bootstrapMae = [], bootstrapRmse = [];
  for (let replicate = 0; replicate < BOOTSTRAPS; replicate += 1) {
    const sample = Array.from({ length: SEASONS.length }, () => components[SEASONS[Math.floor(rng() * SEASONS.length)]]);
    const score = combineComponents(sample);
    bootstrapMae.push(score.maeImprovement);
    bootstrapRmse.push(score.rmseImprovement);
  }
  const maeWins = SEASONS.filter((season) => seasons[season].delta.maeImprovement > 0).length;
  const rmseWins = SEASONS.filter((season) => seasons[season].delta.rmseImprovement > 0).length;
  const rankWins = SEASONS.filter((season) => seasons[season].delta.rankImprovement >= 0).length;
  const nonImprovingCells = cells.filter((cell) => cell.maeImprovement <= 0 || cell.rmseImprovement <= 0);
  const negativeCells = cells.filter((cell) => cell.maeImprovement < 0 || cell.rmseImprovement < 0);
  const gates = {
    allSeasonMaePositive: maeWins === SEASONS.length,
    allSeasonRmsePositive: rmseWins === SEASONS.length,
    allSeasonRankNonnegative: rankWins === SEASONS.length,
    leaveOneSeasonOutPositive: Object.values(jackknife).every((row) => row.maeImprovement > 0 && row.rmseImprovement > 0),
    seasonBootstrap95Positive: quantile(bootstrapMae, 0.025) > 0 && quantile(bootstrapRmse, 0.025) > 0,
    originalFrozen2024Positive: seasons[2024].delta.maeImprovement > 0 && seasons[2024].delta.rmseImprovement > 0,
    noNegativePositionSeasonCells: negativeCells.length === 0,
  };
  gates.robustnessPass = Object.values(gates).every(Boolean);
  return {
    version: "forecast-overfit-audit-2026.1",
    purpose: "post-selection robustness audit of the exact frozen serving mean; no fitting, feature selection, coefficient tuning, or policy selection",
    evidenceYears: SEASONS,
    evidenceDiscipline: {
      independentFrozenTest: 2024,
      consistencyOnly: 2025,
      developmentOrRetrospective: [2020, 2021, 2022, 2023],
      prospectiveNext: 2026,
      warning: "Only the original 2024 frozen test was uninspected at admission. The multi-year checks are robustness diagnostics, not six independent holdouts.",
    },
    seasons,
    leaveOneSeasonOut: jackknife,
    seasonClusterBootstrap: {
      replicates: BOOTSTRAPS,
      seed: "0x5A17C0DE",
      maeImprovement95: [round(quantile(bootstrapMae, 0.025)), round(quantile(bootstrapMae, 0.975))],
      rmseImprovement95: [round(quantile(bootstrapRmse, 0.025)), round(quantile(bootstrapRmse, 0.975))],
    },
    seasonSignTests: {
      mae: { wins: maeWins, total: SEASONS.length, oneSidedP: round(oneSidedSignP(maeWins, SEASONS.length)) },
      rmse: { wins: rmseWins, total: SEASONS.length, oneSidedP: round(oneSidedSignP(rmseWins, SEASONS.length)) },
      rank: { wins: rankWins, total: SEASONS.length, oneSidedP: round(oneSidedSignP(rankWins, SEASONS.length)) },
    },
    nonImprovingPositionSeasonCells: nonImprovingCells,
    negativePositionSeasonCells: negativeCells,
    gates,
    interpretation: gates.robustnessPass
      ? "No material season-level overfit is detected for the exact frozen serving mean under these post-selection robustness tests. This does not prove zero overfit; 2026 remains the next prospective confirmation."
      : "The exact frozen serving mean fails at least one season-level robustness gate. Do not strengthen the qualification claim without new evidence.",
  };
}

function main() {
  const result = build();
  if (process.argv.includes("--verify")) {
    const committed = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    if (canonical(committed) !== canonical(result)) throw new Error("Forecast overfit audit drift");
    console.log(`Forecast overfit audit verified: ${result.gates.robustnessPass}`);
  } else {
    fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Wrote ${outputFile}`);
  }
  console.log(`Bootstrap MAE improvement 95%: ${result.seasonClusterBootstrap.maeImprovement95.join(" to ")}`);
  console.log(`Bootstrap RMSE improvement 95%: ${result.seasonClusterBootstrap.rmseImprovement95.join(" to ")}`);
  console.log(`Non-improving position-season cells: ${result.nonImprovingPositionSeasonCells.length}`);
  console.log(`Negative position-season cells: ${result.negativePositionSeasonCells.length}`);
}

if (require.main === module) main();
module.exports = { build };

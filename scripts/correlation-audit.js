"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const intelligence = require("../src/engine/intelligence.js");
const correlationModel = require("../src/engine/correlation.js");

const POSITIONS = ["QB", "RB", "WR", "TE"];
const TRAINING_SEASONS = correlationModel.TRAINING_SEASONS;
const CONSISTENCY_SEASON = correlationModel.CONSISTENCY_SEASON;
const MIN_HISTORY = 3;
const MIN_BUCKET_PAIRS = 40;
const SHRINKAGE_GRID = [0, 25, 50, 100, 200, 400, 800, 1600];
const LEGACY_WEIGHTS = Object.freeze({
  QB: { scoring: 0.28, passing: 0.35, rushing: 0.08, pace: 0.12, team: 0.12, chaos: 0 },
  RB: { scoring: 0.26, passing: 0.05, rushing: 0.38, pace: 0.10, team: 0.14, chaos: 0 },
  WR: { scoring: 0.30, passing: 0.38, rushing: 0, pace: 0.10, team: 0.12, chaos: 0 },
  TE: { scoring: 0.29, passing: 0.36, rushing: 0, pace: 0.10, team: 0.13, chaos: 0 },
});
function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function weightedRecentMean(rows) {
  const recent = rows.slice(-5);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < recent.length; index += 1) {
    const weight = index + 1;
    numerator += Number(recent[index].fantasyPpr || 0) * weight;
    denominator += weight;
  }
  return denominator ? numerator / denominator : 0;
}

function correlation(pairs) {
  if (!pairs || pairs.length < 3) return 0;
  const leftMean = mean(pairs.map((pair) => pair[0]));
  const rightMean = mean(pairs.map((pair) => pair[1]));
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (const [left, right] of pairs) {
    const dl = left - leftMean;
    const dr = right - rightMean;
    covariance += dl * dr;
    leftVariance += dl * dl;
    rightVariance += dr * dr;
  }
  return leftVariance > 0 && rightVariance > 0 ? covariance / Math.sqrt(leftVariance * rightVariance) : 0;
}
function pairKey(leftPosition, rightPosition) {
  const leftIndex = POSITIONS.indexOf(leftPosition);
  const rightIndex = POSITIONS.indexOf(rightPosition);
  return leftIndex <= rightIndex
    ? `${leftPosition}-${rightPosition}`
    : `${rightPosition}-${leftPosition}`;
}

function bucketKey(relation, leftPosition, rightPosition) {
  return `${relation}|${pairKey(leftPosition, rightPosition)}`;
}

function loadSeason(season) {
  const file = path.join(__dirname, "..", "data", "history", `stats_player_week_${season}.csv.gz`);
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  return intelligence.parseWeeklyStatsCsv(text)
    .filter((row) => row.seasonType === "REG" && POSITIONS.includes(row.position));
}

function residualRows(rows) {
  const historyByPlayer = new Map();
  const output = [];
  const ordered = [...rows].sort((left, right) => left.week - right.week || left.playerId.localeCompare(right.playerId));
  for (const row of ordered) {
    const playerKey = `${row.season}|${row.playerId}`;
    const history = historyByPlayer.get(playerKey) || [];
    if (history.length >= MIN_HISTORY) {
      const prediction = weightedRecentMean(history);
      if (prediction >= 2) output.push({ ...row, residual: Number(row.fantasyPpr || 0) - prediction });
    }
    history.push(row);
    historyByPlayer.set(playerKey, history);
  }
  return output;
}
function pairBuckets(rows) {
  const games = new Map();
  for (const row of residualRows(rows)) {
    const key = `${row.season}|${row.week}|${row.gameId}`;
    if (!games.has(key)) games.set(key, []);
    games.get(key).push(row);
  }
  const buckets = new Map();
  for (const players of games.values()) {
    for (let leftIndex = 0; leftIndex < players.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < players.length; rightIndex += 1) {
        const left = players[leftIndex];
        const right = players[rightIndex];
        const relation = left.team === right.team ? "same" : "opponent";
        const key = bucketKey(relation, left.position, right.position);
        if (!buckets.has(key)) buckets.set(key, []);
        const ordered = POSITIONS.indexOf(left.position) <= POSITIONS.indexOf(right.position)
          ? [left.residual, right.residual]
          : [right.residual, left.residual];
        buckets.get(key).push(ordered);
      }
    }
  }
  return buckets;
}

function summarizeBuckets(buckets) {
  return new Map([...buckets.entries()].map(([key, pairs]) => [key, {
    samples: pairs.length,
    correlation: correlation(pairs),
  }]));
}
function shrunkCorrelation(summary, shrinkage) {
  if (!summary || summary.samples < MIN_BUCKET_PAIRS) return 0;
  return summary.correlation * summary.samples / (summary.samples + shrinkage);
}

function legacyCorrelation(key) {
  const [relation, pair] = key.split("|");
  const [leftPosition, rightPosition] = pair.split("-");
  const left = LEGACY_WEIGHTS[leftPosition];
  const right = LEGACY_WEIGHTS[rightPosition];
  if (!left || !right) return 0;
  let rho = 0;
  for (const factor of ["scoring", "passing", "rushing", "pace", "chaos"]) {
    rho += Number(left[factor] || 0) * Number(right[factor] || 0);
  }
  if (relation === "same") rho += Number(left.team || 0) * Number(right.team || 0);
  return rho;
}

function scorePredictions(train, test, shrinkage) {
  let weightedSquaredError = 0;
  let weightedAbsoluteError = 0;
  let weight = 0;
  for (const [key, actual] of test) {
    if (actual.samples < MIN_BUCKET_PAIRS) continue;
    const source = train.get(key);
    const predicted = shrunkCorrelation(source, shrinkage);
    const error = predicted - actual.correlation;
    weightedSquaredError += actual.samples * error * error;
    weightedAbsoluteError += actual.samples * Math.abs(error);
    weight += actual.samples;
  }
  return {
    rmse: weight ? Math.sqrt(weightedSquaredError / weight) : null,
    mae: weight ? weightedAbsoluteError / weight : null,
    weight,
  };
}
function scoreAgainst(test, predictor) {
  let squaredError = 0;
  let absoluteError = 0;
  let weight = 0;
  for (const [key, actual] of test) {
    if (actual.samples < MIN_BUCKET_PAIRS) continue;
    const predicted = predictor(key);
    const error = predicted - actual.correlation;
    squaredError += actual.samples * error * error;
    absoluteError += actual.samples * Math.abs(error);
    weight += actual.samples;
  }
  return {
    rmse: weight ? Math.sqrt(squaredError / weight) : null,
    mae: weight ? absoluteError / weight : null,
    weight,
  };
}

function combineScores(left, right) {
  const weight = left.weight + right.weight;
  const mse = ((left.rmse ** 2) * left.weight + (right.rmse ** 2) * right.weight) / weight;
  const mae = (left.mae * left.weight + right.mae * right.weight) / weight;
  return { rmse: Math.sqrt(mse), mae, weight };
}

function crossValidationScores(bySeason, shrinkage) {
  return {
    empirical: combineScores(
      scorePredictions(bySeason.get(2023), bySeason.get(2024), shrinkage),
      scorePredictions(bySeason.get(2024), bySeason.get(2023), shrinkage)),
    independence: combineScores(scoreAgainst(bySeason.get(2024), () => 0), scoreAgainst(bySeason.get(2023), () => 0)),
    legacy: combineScores(scoreAgainst(bySeason.get(2024), legacyCorrelation), scoreAgainst(bySeason.get(2023), legacyCorrelation)),
  };
}

function chooseShrinkage(bySeason) {
  const rows = SHRINKAGE_GRID.map((shrinkage) => {
    const forward = scorePredictions(bySeason.get(2023), bySeason.get(2024), shrinkage);
    const backward = scorePredictions(bySeason.get(2024), bySeason.get(2023), shrinkage);
    const weight = forward.weight + backward.weight;
    const mse = ((forward.rmse ** 2) * forward.weight + (backward.rmse ** 2) * backward.weight) / weight;
    const mae = (forward.mae * forward.weight + backward.mae * backward.weight) / weight;
    return { shrinkage, rmse: Math.sqrt(mse), mae, weight };
  });
  rows.sort((left, right) => left.rmse - right.rmse || left.mae - right.mae || left.shrinkage - right.shrinkage);
  return { selected: rows[0], rows };
}

function validateEmbeddedModel(training, selectedShrinkage) {
  const errors = [];
  if (selectedShrinkage !== correlationModel.SHRINKAGE_PAIRS) {
    errors.push(`cross-validation selected ${selectedShrinkage}, embedded uses ${correlationModel.SHRINKAGE_PAIRS}`);
  }
  for (const relation of ["same", "opponent"]) {
    for (const [pair, embedded] of Object.entries(correlationModel.PAIR_CORRELATIONS[relation])) {
      const summary = training.get(`${relation}|${pair}`);
      const expected = shrunkCorrelation(summary, correlationModel.SHRINKAGE_PAIRS);
      const support = correlationModel.PAIR_SUPPORT[relation][pair];
      if (!summary || support !== summary.samples) errors.push(`${relation}|${pair} support mismatch`);
      if (Math.abs(embedded - expected) > 0.0015) {
        errors.push(`${relation}|${pair}: embedded=${embedded.toFixed(3)} derived=${expected.toFixed(3)}`);
      }
    }
  }
  if (errors.length) throw new Error(`Embedded correlation model drifted:\n${errors.join("\n")}`);
}

function format(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}
function main() {
  const rowsBySeason = new Map([2023, 2024, 2025].map((season) => [season, loadSeason(season)]));
  const summariesBySeason = new Map([...rowsBySeason].map(([season, rows]) => [season, summarizeBuckets(pairBuckets(rows))]));
  const tuning = chooseShrinkage(summariesBySeason);
  const selectedShrinkage = tuning.selected.shrinkage;
  const crossValidation = crossValidationScores(summariesBySeason, selectedShrinkage);
  const trainingRows = TRAINING_SEASONS.flatMap((season) => rowsBySeason.get(season));
  const training = summarizeBuckets(pairBuckets(trainingRows));
  validateEmbeddedModel(training, selectedShrinkage);

  const consistency = summariesBySeason.get(CONSISTENCY_SEASON);
  const consistencyIndependence = scoreAgainst(consistency, () => 0);
  const consistencyLegacy = scoreAgainst(consistency, legacyCorrelation);
  const consistencyEmpirical = scoreAgainst(consistency, (key) => shrunkCorrelation(training.get(key), selectedShrinkage));

  console.log("SnapCount residual-correlation audit");
  console.log("Admission evidence: bidirectional 2023<->2024 cross-validation");
  console.log("2025 is a consistency check only because its pair structure was inspected before this fit was frozen.");
  console.log(`Selected shrinkage: ${selectedShrinkage} pair pseudo-observations (CV RMSE ${format(crossValidation.empirical.rmse)})\n`);
  console.log("Cross-validated bucket error (2023<->2024)");
  console.log(`independence RMSE ${format(crossValidation.independence.rmse)} | MAE ${format(crossValidation.independence.mae)}`);
  console.log(`legacy       RMSE ${format(crossValidation.legacy.rmse)} | MAE ${format(crossValidation.legacy.mae)}`);
  console.log(`empirical    RMSE ${format(crossValidation.empirical.rmse)} | MAE ${format(crossValidation.empirical.mae)}\n`);
  console.log("bucket           trainN  trainR  fittedR  checkN checkR legacyR");
  for (const key of [...training.keys()].sort()) {
    const train = training.get(key);
    const check = consistency.get(key);
    if (!check || check.samples < MIN_BUCKET_PAIRS) continue;
    console.log([
      key.padEnd(16),
      String(train.samples).padStart(6),
      format(train.correlation).padStart(7),
      format(shrunkCorrelation(train, selectedShrinkage)).padStart(8),
      String(check.samples).padStart(7),
      format(check.correlation).padStart(6),
      format(legacyCorrelation(key)).padStart(7),
    ].join(" "));
  }
  console.log("\n2025 consistency-check bucket error");
  console.log(`independence RMSE ${format(consistencyIndependence.rmse)} | MAE ${format(consistencyIndependence.mae)}`);
  console.log(`legacy       RMSE ${format(consistencyLegacy.rmse)} | MAE ${format(consistencyLegacy.mae)}`);
  console.log(`empirical    RMSE ${format(consistencyEmpirical.rmse)} | MAE ${format(consistencyEmpirical.mae)}`);

  if (!(crossValidation.empirical.rmse < crossValidation.legacy.rmse &&
        crossValidation.empirical.mae < crossValidation.legacy.mae &&
        crossValidation.empirical.rmse < crossValidation.independence.rmse)) {
    throw new Error("Empirical pair correlations did not improve cross-validated 2023-2024 error");
  }
  if (!(consistencyEmpirical.rmse < consistencyLegacy.rmse && consistencyEmpirical.rmse < consistencyIndependence.rmse)) {
    throw new Error("Empirical pair correlations failed the non-pristine 2025 consistency check");
  }
}

main();

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const embeddedMean = require("../src/engine/mean-calibration.js");

const root = path.resolve(__dirname, "..");
const artifactPath = path.join(root, "data", "validation", "historical-ppr-2020-2025.json.gz");
const positions = ["QB", "RB", "WR", "TE"];
const lambdaGrid = [0, 0.1, 1, 5, 20, 100, 400];

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
function std(values, average = mean(values)) {
  return values.length ? Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length) : 0;
}
function statusIncludes(value, token) {
  return String(value || "").toLowerCase().includes(token);
}

function rawFeature(row, name) {
  const baseline = row.baseline;
  const snapPrior = row.position === "RB" ? 0.56 : row.position === "QB" ? 0.96 : 0.74;
  switch (name) {
    case "form_gap": return Number.isFinite(row.recentPpr) ? row.recentPpr - baseline : 0;
    case "trend": return finite(row.recentTrend);
    case "target": return Number.isFinite(row.targetDelta) ? baseline * row.targetDelta : 0;
    case "carry": return Number.isFinite(row.carryDelta) ? baseline * row.carryDelta : 0;
    case "xfp_gap": return Number.isFinite(row.xfp) ? row.xfp - baseline : 0;
    case "fpoe": return finite(row.fpoe);
    case "snap": return Number.isFinite(row.snapShare) ? baseline * (row.snapShare - snapPrior) : 0;
    case "defense": return baseline * finite(row.defenseGrade);
    case "game_total": return Number.isFinite(row.gameTotal) ? baseline * (row.gameTotal - 44) / 10 : 0;
    case "implied": return Number.isFinite(row.teamImplied) ? baseline * (row.teamImplied - 22.5) / 7 : 0;
    case "wind": return baseline * Math.max(0, finite(row.wind) - 15) / 10;
    case "questionable": return statusIncludes(row.injuryStatus, "question") ? baseline : 0;
    case "doubtful": return statusIncludes(row.injuryStatus, "doubt") ? baseline : 0;
    case "out": return statusIncludes(row.injuryStatus, "out") ? baseline : 0;
    case "limited": return statusIncludes(row.practiceStatus, "limited") ? baseline : 0;
    case "practice_dnp": return statusIncludes(row.practiceStatus, "did not") ? baseline : 0;
    case "qb_replacement": return row.qbReplacement ? baseline : 0;
    case "qb_quality": return baseline * finite(row.qbQualityDelta);
    case "qb_style": return baseline * finite(row.qbStyleDelta);
    case "team_change": return row.teamChanged ? baseline : 0;
    case "coach_change": return row.coachChanged ? baseline : 0;
    case "pass_rate": return baseline * finite(row.passRateDelta);
    case "pace": return baseline * finite(row.paceDelta) / 10;
    case "ol_continuity": return Number.isFinite(row.olContinuity) ? baseline * (row.olContinuity - 1) : 0;
    case "ol_injury": return baseline * finite(row.olInjury);
    case "vacated_target": return baseline * finite(row.vacatedTargetShare);
    case "vacated_carry": return baseline * finite(row.vacatedCarryShare);
    case "competition_target": return baseline * finite(row.competitorTargetShare);
    case "competition_carry": return baseline * finite(row.competitorCarryShare);
    case "qb_ol": return row.qbReplacement ? baseline * Math.min(2, finite(row.olInjury)) : 0;
    default: return 0;
  }
}

const common = [
  "form_gap", "trend", "xfp_gap", "fpoe", "defense", "game_total", "implied", "wind",
  "questionable", "doubtful", "out", "limited", "practice_dnp",
  "team_change", "coach_change", "pass_rate", "pace", "ol_continuity", "ol_injury",
];
const candidates = {
  QB: [...common],
  RB: [...common, "target", "carry", "snap", "qb_replacement", "qb_quality", "qb_style", "vacated_target", "vacated_carry", "competition_target", "competition_carry", "qb_ol"],
  WR: [...common, "target", "snap", "qb_replacement", "qb_quality", "qb_style", "vacated_target", "competition_target", "qb_ol"],
  TE: [...common, "target", "snap", "qb_replacement", "qb_quality", "qb_style", "vacated_target", "competition_target", "qb_ol"],
};

function solve(matrix, vector) {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    if (Math.abs(augmented[pivot][column]) < 1e-12) continue;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let j = column; j <= n; j += 1) augmented[column][j] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let j = column; j <= n; j += 1) augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return augmented.map((row, index) => Number.isFinite(row[n]) ? row[n] : 0);
}

function fitModel(rows, features, lambda = 0) {
  const residuals = rows.map((row) => row.actual - row.baseline);
  const yMean = mean(residuals);
  if (!features.length) return { features, lambda, yMean, means: [], scales: [], beta: [], rawIntercept: yMean, rawCoefficients: {} };
  const columns = features.map((feature) => rows.map((row) => rawFeature(row, feature)));
  const means = columns.map((column) => mean(column));
  const scales = columns.map((column, index) => Math.max(1e-6, std(column, means[index])));
  const p = features.length;
  const xtx = Array.from({ length: p }, () => Array(p).fill(0));
  const xty = Array(p).fill(0);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const x = columns.map((column, featureIndex) => (column[rowIndex] - means[featureIndex]) / scales[featureIndex]);
    const y = residuals[rowIndex] - yMean;
    for (let left = 0; left < p; left += 1) {
      xty[left] += x[left] * y;
      for (let right = 0; right < p; right += 1) xtx[left][right] += x[left] * x[right];
    }
  }
  for (let index = 0; index < p; index += 1) xtx[index][index] += lambda;
  const beta = solve(xtx, xty);
  const rawCoefficients = Object.fromEntries(features.map((feature, index) => [feature, beta[index] / scales[index]]));
  const rawIntercept = yMean - features.reduce((sum, feature, index) => sum + rawCoefficients[feature] * means[index], 0);
  return { features, lambda, yMean, means, scales, beta, rawIntercept, rawCoefficients };
}

function predict(row, model) {
  let correction = model.rawIntercept;
  for (const feature of model.features) correction += model.rawCoefficients[feature] * rawFeature(row, feature);
  correction = clamp(correction, -row.baseline, Math.max(3, row.baseline * 0.65));
  return Math.max(0, row.baseline + correction);
}

function rank(values) {
  const ordered = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const output = Array(values.length).fill(0);
  let index = 0;
  while (index < ordered.length) {
    let end = index + 1;
    while (end < ordered.length && ordered[end].value === ordered[index].value) end += 1;
    const averageRank = (index + end - 1) / 2;
    for (let cursor = index; cursor < end; cursor += 1) output[ordered[cursor].index] = averageRank;
    index = end;
  }
  return output;
}
function correlation(left, right) {
  if (left.length < 3 || left.length !== right.length) return 0;
  const lm = mean(left), rm = mean(right);
  let cov = 0, lv = 0, rv = 0;
  for (let index = 0; index < left.length; index += 1) {
    const dl = left[index] - lm, dr = right[index] - rm;
    cov += dl * dr; lv += dl * dl; rv += dr * dr;
  }
  return lv > 0 && rv > 0 ? cov / Math.sqrt(lv * rv) : 0;
}
function weeklyRankCorrelation(rows, predictor) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.season}|${row.week}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const scores = [];
  for (const group of groups.values()) {
    if (group.length < 20) continue;
    const predictedRanks = rank(group.map(predictor));
    const actualRanks = rank(group.map((row) => row.actual));
    scores.push(correlation(predictedRanks, actualRanks));
  }
  return mean(scores);
}

function metrics(rows, predictor) {
  let absolute = 0, squared = 0, error = 0;
  for (const row of rows) {
    const prediction = predictor(row);
    const delta = prediction - row.actual;
    absolute += Math.abs(delta); squared += delta * delta; error += delta;
  }
  return {
    n: rows.length,
    mae: absolute / Math.max(1, rows.length),
    rmse: Math.sqrt(squared / Math.max(1, rows.length)),
    bias: error / Math.max(1, rows.length),
    rank: weeklyRankCorrelation(rows, predictor),
  };
}
function combine(left, right) {
  const n = left.n + right.n;
  return {
    n,
    mae: (left.mae * left.n + right.mae * right.n) / n,
    rmse: Math.sqrt((left.rmse ** 2 * left.n + right.rmse ** 2 * right.n) / n),
    rank: (left.rank * left.n + right.rank * right.n) / n,
  };
}
function rowsFor(data, seasons, position) {
  const set = new Set(seasons);
  return data.weeks.filter((row) => set.has(row.season) && row.position === position && row.baseline >= 2);
}
function chooseLambda(data, features, position, seasons = [2021, 2022]) {
  if (!features.length) return 0;
  let best = null;
  for (const lambda of lambdaGrid) {
    const firstTrain = rowsFor(data, [seasons[0]], position), firstTest = rowsFor(data, [seasons[1]], position);
    const secondTrain = rowsFor(data, [seasons[1]], position), secondTest = rowsFor(data, [seasons[0]], position);
    const firstModel = fitModel(firstTrain, features, lambda), secondModel = fitModel(secondTrain, features, lambda);
    const first = metrics(firstTest, (row) => predict(row, firstModel));
    const second = metrics(secondTest, (row) => predict(row, secondModel));
    const score = combine(first, second);
    if (!best || score.rmse < best.score.rmse - 1e-9 || (Math.abs(score.rmse - best.score.rmse) < 1e-9 && score.mae < best.score.mae)) best = { lambda, score };
  }
  return best.lambda;
}
function crossScore(data, features, position, lambda) {
  const train21 = rowsFor(data, [2021], position), test22 = rowsFor(data, [2022], position);
  const train22 = rowsFor(data, [2022], position), test21 = rowsFor(data, [2021], position);
  const model21 = fitModel(train21, features, lambda), model22 = fitModel(train22, features, lambda);
  return combine(
    metrics(test22, (row) => predict(row, model21)),
    metrics(test21, (row) => predict(row, model22)),
  );
}
function evaluateDevSet(data, position, features) {
  const lambda = chooseLambda(data, features, position);
  const training = rowsFor(data, [2021, 2022], position);
  const selectionRows = rowsFor(data, [2023], position);
  const model = fitModel(training, features, lambda);
  const selection = metrics(selectionRows, (row) => predict(row, model));
  const cv = crossScore(data, features, position, lambda);
  return { features, lambda, selection, cv, model };
}

function selectFeatures(data, position) {
  let selected = [];
  let current = evaluateDevSet(data, position, selected);
  const steps = [];
  while (selected.length < 8) {
    let best = null;
    for (const candidate of candidates[position]) {
      if (selected.includes(candidate)) continue;
      const trial = evaluateDevSet(data, position, [...selected, candidate]);
      const improvesSelection = trial.selection.mae < current.selection.mae - 0.002
        && trial.selection.rmse < current.selection.rmse - 0.002
        && trial.selection.rank >= current.selection.rank - 0.003;
      const stableCv = trial.cv.mae <= current.cv.mae + 0.003 && trial.cv.rmse <= current.cv.rmse + 0.003;
      if (!improvesSelection || !stableCv) continue;
      const gain = (current.selection.rmse - trial.selection.rmse)
        + 0.45 * (current.selection.mae - trial.selection.mae)
        + 0.35 * (current.cv.rmse - trial.cv.rmse)
        + 0.15 * (current.cv.mae - trial.cv.mae);
      if (!best || gain > best.gain) best = { candidate, trial, gain };
    }
    if (!best) break;
    selected = [...selected, best.candidate];
    current = best.trial;
    steps.push({ feature: best.candidate, gain: best.gain, selection: current.selection, cv: current.cv });
  }
  return { selected, development: current, steps };
}

function chooseFinalLambda(data, features, position) {
  if (!features.length) return 0;
  let best = null;
  const seasons = [2021, 2022, 2023];
  for (const lambda of lambdaGrid) {
    let combined = null;
    for (const holdout of seasons) {
      const train = rowsFor(data, seasons.filter((season) => season !== holdout), position);
      const test = rowsFor(data, [holdout], position);
      const model = fitModel(train, features, lambda);
      const score = metrics(test, (row) => predict(row, model));
      combined = combined ? combine(combined, score) : score;
    }
    if (!best || combined.rmse < best.score.rmse - 1e-9 || (Math.abs(combined.rmse - best.score.rmse) < 1e-9 && combined.mae < best.score.mae)) best = { lambda, score: combined };
  }
  return best.lambda;
}

function roundObject(model) {
  return {
    features: model.features,
    lambda: model.lambda,
    intercept: Number(model.rawIntercept.toFixed(6)),
    coefficients: Object.fromEntries(Object.entries(model.rawCoefficients).map(([key, value]) => [key, Number(value.toFixed(6))])),
  };
}
function fmt(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}
function metricLine(label, score) {
  return `${label.padEnd(11)} n=${String(score.n).padStart(4)} MAE ${fmt(score.mae)} RMSE ${fmt(score.rmse)} bias ${fmt(score.bias)} rank ${fmt(score.rank)}`;
}
function validateEmbedded(report) {
  for (const position of positions) {
    const entry = report.positions[position];
    const embedded = embeddedMean.MODELS[position];
    if (!entry.frozen2024.admitted) {
      if (embedded !== null) throw new Error(`${position} mean model is embedded despite failing frozen 2024 admission`);
      continue;
    }
    if (!embedded) throw new Error(`${position} admitted model is missing from production`);
    if (Math.abs(embedded.intercept - entry.model.intercept) > 1e-9) throw new Error(`${position} intercept drift`);
    const keys = Object.keys(entry.model.coefficients);
    if (keys.length !== Object.keys(embedded.coefficients).length) throw new Error(`${position} coefficient set drift`);
    for (const key of keys) if (Math.abs(embedded.coefficients[key] - entry.model.coefficients[key]) > 1e-9) throw new Error(`${position}.${key} coefficient drift`);
  }
}

function main() {
  if (!fs.existsSync(artifactPath)) throw new Error("Historical validation artifact is missing; run build-historical-validation first.");
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(artifactPath)).toString("utf8"));
  const report = {
    version: "forecast-history-audit-2026.1",
    generatedAt: new Date().toISOString(),
    split: { development: [2021, 2022], selection: 2023, frozenTest: 2024, consistencyOnly: 2025 },
    minimumBaselinePpr: 2,
    positions: {},
  };
  console.log("SnapCount historical PPR forecast tournament");
  console.log("Development 2021-2022 | feature selection 2023 | frozen internal test 2024 | 2025 consistency only\n");
  for (const position of positions) {
    const selection = selectFeatures(data, position);
    const finalLambda = chooseFinalLambda(data, selection.selected, position);
    const finalTraining = rowsFor(data, [2021, 2022, 2023], position);
    const model = fitModel(finalTraining, selection.selected, finalLambda);
    const frozenRows = rowsFor(data, [2024], position), consistencyRows = rowsFor(data, [2025], position);
    const rawFrozen = metrics(frozenRows, (row) => row.baseline);
    const finalFrozen = metrics(frozenRows, (row) => predict(row, model));
    const rawConsistency = metrics(consistencyRows, (row) => row.baseline);
    const finalConsistency = metrics(consistencyRows, (row) => predict(row, model));
    const admitted = finalFrozen.mae < rawFrozen.mae && finalFrozen.rmse < rawFrozen.rmse && finalFrozen.rank >= rawFrozen.rank - 0.005;
    report.positions[position] = {
      selectedFeatures: selection.selected,
      selectionSteps: selection.steps,
      development: { selection: selection.development.selection, crossValidation: selection.development.cv },
      model: roundObject(model),
      frozen2024: { raw: rawFrozen, corrected: finalFrozen, admitted },
      consistency2025: { raw: rawConsistency, corrected: finalConsistency },
    };
    console.log(`${position} selected: ${selection.selected.join(", ") || "bias-only"} | lambda ${finalLambda}`);
    console.log(metricLine("2024 raw", rawFrozen));
    console.log(metricLine("2024 model", finalFrozen));
    console.log(`admitted: ${admitted ? "YES" : "NO"}\n`);
  }

  const frozenAll = data.weeks.filter((row) => row.season === 2024 && positions.includes(row.position) && row.baseline >= 2);
  const consistencyAll = data.weeks.filter((row) => row.season === 2025 && positions.includes(row.position) && row.baseline >= 2);
  const admittedModels = Object.fromEntries(positions.map((position) => {
    const entry = report.positions[position];
    const model = { features: entry.model.features, rawIntercept: entry.model.intercept, rawCoefficients: entry.model.coefficients };
    return [position, entry.frozen2024.admitted ? model : null];
  }));
  const corrected = (row) => admittedModels[row.position] ? predict(row, admittedModels[row.position]) : row.baseline;
  report.overall = {
    frozen2024: { raw: metrics(frozenAll, (row) => row.baseline), corrected: metrics(frozenAll, corrected) },
    consistency2025: { raw: metrics(consistencyAll, (row) => row.baseline), corrected: metrics(consistencyAll, corrected) },
  };
  console.log("Overall admitted model");
  console.log(metricLine("2024 raw", report.overall.frozen2024.raw));
  console.log(metricLine("2024 model", report.overall.frozen2024.corrected));
  console.log(metricLine("2025 raw", report.overall.consistency2025.raw));
  console.log(metricLine("2025 model", report.overall.consistency2025.corrected));
  validateEmbedded(report);
  const output = path.join(root, "data", "validation", "forecast-audit-report.json");
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  if (!(report.overall.frozen2024.corrected.mae < report.overall.frozen2024.raw.mae
    && report.overall.frozen2024.corrected.rmse < report.overall.frozen2024.raw.rmse
    && report.overall.frozen2024.corrected.rank >= report.overall.frozen2024.raw.rank - 0.003)) {
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { candidates, fitModel, metrics, predict, rawFeature, rowsFor, selectFeatures };

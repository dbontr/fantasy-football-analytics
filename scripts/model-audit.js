"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const intelligence = require("../src/engine/intelligence.js");
const calibration = require("../src/engine/calibration.js");

const POSITIONS = ["QB", "RB", "WR", "TE"];
const LEGACY_CV = Object.freeze({ QB: 0.27, RB: 0.43, WR: 0.49, TE: 0.51 });
const Z80 = 1.2815515655446004;

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function weightedRecentMean(rows) {
  const recent = rows.slice(-5);
  let weighted = 0;
  let weightTotal = 0;
  for (let index = 0; index < recent.length; index += 1) {
    const weight = index + 1;
    weighted += Number(recent[index].fantasyPpr || 0) * weight;
    weightTotal += weight;
  }
  return weightTotal ? weighted / weightTotal : 0;
}

function loadSeason(season) {
  const file = path.join(__dirname, "..", "data", "history", `stats_player_week_${season}.csv.gz`);
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  return intelligence.parseWeeklyStatsCsv(text)
    .filter((row) => row.seasonType === "REG" && POSITIONS.includes(row.position));
}

function groupPlayerSeasons(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.season}|${row.playerId}|${row.position}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  for (const values of grouped.values()) values.sort((left, right) => left.week - right.week);
  return grouped;
}

function deriveTrainingCalibration(grouped) {
  const byPositionBin = new Map();
  const byPosition = new Map();
  for (const position of POSITIONS) {
    byPosition.set(position, []);
    for (let bin = 0; bin < calibration.BINS.length - 1; bin += 1) byPositionBin.set(`${position}|${bin}`, []);
  }
  for (const rows of grouped.values()) {
    if (!rows.length || !calibration.TRAINING_SEASONS.includes(rows[0].season)) continue;
    const values = rows.map((row) => Number(row.fantasyPpr || 0));
    if (values.length < 6) continue;
    const average = mean(values);
    if (average < 2) continue;
    const cv = standardDeviation(values) / average;
    const position = rows[0].position;
    const bin = calibration.binIndex(average);
    byPosition.get(position).push(cv);
    byPositionBin.get(`${position}|${bin}`).push(cv);
  }

  const derived = {};
  for (const position of POSITIONS) {
    const positionMedian = median(byPosition.get(position));
    derived[position] = [];
    for (let bin = 0; bin < calibration.BINS.length - 1; bin += 1) {
      const values = byPositionBin.get(`${position}|${bin}`);
      const binMedian = values.length ? median(values) : positionMedian;
      const shrunk = (binMedian * values.length + positionMedian * calibration.SHRINKAGE_GAMES) /
        (values.length + calibration.SHRINKAGE_GAMES);
      derived[position].push({ cv: shrunk, players: values.length });
    }
  }
  return derived;
}

function holdoutExamples(grouped) {
  const examples = [];
  for (const rows of grouped.values()) {
    if (!rows.length || rows[0].season !== calibration.HOLDOUT_SEASON) continue;
    const history = [];
    for (const row of rows) {
      if (history.length >= 3) {
        const prediction = weightedRecentMean(history);
        if (prediction >= 2) examples.push({ position: row.position, prediction, actual: Number(row.fantasyPpr || 0) });
      }
      history.push(row);
    }
  }
  return examples;
}

function evaluate(examples, cvFor) {
  const results = {};
  for (const position of POSITIONS) {
    const rows = examples.filter((row) => row.position === position);
    let covered = 0;
    let mae = 0;
    let mse = 0;
    let width = 0;
    for (const row of rows) {
      const cv = cvFor(position, row.prediction);
      const sd = Math.max(1.5, row.prediction * cv);
      const lower = Math.max(0, row.prediction - Z80 * sd);
      const upper = row.prediction + Z80 * sd;
      if (row.actual >= lower && row.actual <= upper) covered += 1;
      const error = row.actual - row.prediction;
      mae += Math.abs(error);
      mse += error * error;
      width += upper - lower;
    }
    results[position] = {
      samples: rows.length,
      coverage80: rows.length ? covered / rows.length : null,
      meanWidth: rows.length ? width / rows.length : null,
      mae: rows.length ? mae / rows.length : null,
      rmse: rows.length ? Math.sqrt(mse / rows.length) : null,
    };
  }
  return results;
}

function validateEmbeddedCalibration(derived) {
  const errors = [];
  for (const position of POSITIONS) {
    for (let bin = 0; bin < calibration.EMPIRICAL_CV[position].length; bin += 1) {
      const expected = calibration.EMPIRICAL_CV[position][bin];
      const actual = derived[position][bin].cv;
      if (Math.abs(expected - actual) > 0.006) {
        errors.push(`${position} bin ${bin}: embedded=${expected.toFixed(3)} derived=${actual.toFixed(3)}`);
      }
    }
  }
  return errors;
}

function formatPercent(value) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function main() {
  const rows = [2023, 2024, 2025].flatMap(loadSeason);
  const grouped = groupPlayerSeasons(rows);
  const derived = deriveTrainingCalibration(grouped);
  const mismatches = validateEmbeddedCalibration(derived);
  if (mismatches.length) throw new Error(`Embedded calibration drifted from 2023-2024 derivation:\n${mismatches.join("\n")}`);

  const examples = holdoutExamples(grouped);
  const legacy = evaluate(examples, (position) => LEGACY_CV[position]);
  const calibrated = evaluate(examples, (position, prediction) => calibration.empiricalCv(position, prediction));

  console.log("SnapCount uncertainty proxy audit");
  console.log("Training: 2023-2024 only | Holdout: 2025 only | Target interval: 80%");
  console.log("Important: rolling prior-game PPR is a proxy mean, not the production ESPN projection baseline.\n");
  console.log("Pos   N     MAE   RMSE   legacy80  calibrated80  legacyWidth  calibratedWidth");
  for (const position of POSITIONS) {
    const left = legacy[position];
    const right = calibrated[position];
    console.log([
      position.padEnd(4),
      String(left.samples).padStart(4),
      left.mae.toFixed(2).padStart(6),
      left.rmse.toFixed(2).padStart(6),
      formatPercent(left.coverage80).padStart(10),
      formatPercent(right.coverage80).padStart(13),
      left.meanWidth.toFixed(1).padStart(12),
      right.meanWidth.toFixed(1).padStart(15),
    ].join(" "));
  }

  const legacyError = mean(POSITIONS.map((position) => Math.abs(legacy[position].coverage80 - 0.8)));
  const calibratedError = mean(POSITIONS.map((position) => Math.abs(calibrated[position].coverage80 - 0.8)));
  console.log(`\nMean absolute 80% coverage error: legacy ${(legacyError * 100).toFixed(1)} pp -> calibrated ${(calibratedError * 100).toFixed(1)} pp`);
  if (!(calibratedError < legacyError)) throw new Error("Empirical uncertainty calibration did not improve holdout coverage error");
}

main();

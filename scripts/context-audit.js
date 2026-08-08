"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const intelligence = require("../src/engine/intelligence.js");
const context = require("../src/engine/context.js");

const TRAINING_SEASONS = [2023, 2024];
const CONSISTENCY_SEASON = 2025;
const POSITIONS = ["WR", "TE"];
const SHRINKAGE_GRID = [0, 10, 25, 50, 100, 200, 400, 800, 1600];
const MIN_HISTORY = 3;
const MIN_QB_ATTEMPTS = 12;
const MIN_BASELINE = 4;

function loadSeason(season) {
  const file = path.join(__dirname, "..", "data", "history", `stats_player_week_${season}.csv.gz`);
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  return intelligence.parseWeeklyStatsCsv(text)
    .filter((row) => row.seasonType === "REG" && ["QB", "WR", "TE"].includes(row.position));
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

function buildQuarterbackMaps(rowsBySeason) {
  const gameLeader = new Map();
  const incumbentBeforeWeek = new Map();
  for (const [season, rows] of rowsBySeason) {
    const quarterbacks = rows.filter((row) => row.position === "QB");
    for (const row of quarterbacks) {
      const key = `${season}|${row.week}|${row.team}`;
      const current = gameLeader.get(key);
      if (!current || row.attempts > current.attempts) gameLeader.set(key, { id: row.playerId, attempts: row.attempts });
    }
    const cumulative = new Map();
    for (let week = 1; week <= 18; week += 1) {
      const weekRows = quarterbacks.filter((row) => row.week === week);
      for (const team of new Set(weekRows.map((row) => row.team))) {
        const attempts = cumulative.get(team) || new Map();
        const incumbent = [...attempts].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
        incumbentBeforeWeek.set(`${season}|${week}|${team}`, incumbent);
      }
      for (const row of weekRows) {
        if (!cumulative.has(row.team)) cumulative.set(row.team, new Map());
        const attempts = cumulative.get(row.team);
        attempts.set(row.playerId, (attempts.get(row.playerId) || 0) + Number(row.attempts || 0));
      }
    }
  }
  return { gameLeader, incumbentBeforeWeek };
}

function replacementSamples(rowsBySeason) {
  const { gameLeader, incumbentBeforeWeek } = buildQuarterbackMaps(rowsBySeason);
  const histories = new Map();
  for (const [season, rows] of rowsBySeason) {
    for (const row of rows) {
      const key = `${season}|${row.playerId}`;
      if (!histories.has(key)) histories.set(key, []);
      histories.get(key).push(row);
    }
  }
  for (const history of histories.values()) history.sort((left, right) => left.week - right.week);
  const samples = [];
  for (const [season, rows] of rowsBySeason) {
    for (const row of rows) {
      if (!POSITIONS.includes(row.position)) continue;
      const history = (histories.get(`${season}|${row.playerId}`) || []).filter((prior) => prior.week < row.week);
      if (history.length < MIN_HISTORY) continue;
      const baseline = weightedRecentMean(history);
      if (baseline < MIN_BASELINE) continue;
      const gameQb = gameLeader.get(`${season}|${row.week}|${row.team}`);
      const incumbent = incumbentBeforeWeek.get(`${season}|${row.week}|${row.team}`);
      if (!gameQb || gameQb.attempts < MIN_QB_ATTEMPTS || !incumbent) continue;
      samples.push({
        season, position: row.position, baseline, actual: Number(row.fantasyPpr || 0),
        replacement: gameQb.id !== incumbent,
      });
    }
  }
  return samples;
}

function metrics(rows, penalty = 0) {
  if (!rows.length) return { n: 0, mae: null, rmse: null };
  let absolute = 0;
  let squared = 0;
  for (const row of rows) {
    const prediction = row.baseline * (row.replacement ? 1 - penalty : 1);
    const error = prediction - row.actual;
    absolute += Math.abs(error);
    squared += error * error;
  }
  return { n: rows.length, mae: absolute / rows.length, rmse: Math.sqrt(squared / rows.length) };
}

function rawPenalty(rows) {
  let numerator = 0;
  let denominator = 0;
  for (const row of rows) {
    numerator += row.baseline * (row.baseline - row.actual);
    denominator += row.baseline * row.baseline;
  }
  return denominator ? Math.max(0, Math.min(0.25, numerator / denominator)) : 0;
}
function shrunkPenalty(rows, pseudoObservations) {
  const raw = rawPenalty(rows);
  return raw * rows.length / (rows.length + pseudoObservations);
}

function combine(left, right) {
  const n = left.n + right.n;
  return {
    n,
    mae: n ? (left.mae * left.n + right.mae * right.n) / n : null,
    rmse: n ? Math.sqrt((left.rmse ** 2 * left.n + right.rmse ** 2 * right.n) / n) : null,
  };
}

function crossValidate(samples, position, pseudoObservations) {
  const bySeason = Object.fromEntries(TRAINING_SEASONS.map((season) => [
    season,
    samples.filter((row) => row.position === position && row.season === season && row.replacement),
  ]));
  const forwardPenalty = shrunkPenalty(bySeason[2023], pseudoObservations);
  const backwardPenalty = shrunkPenalty(bySeason[2024], pseudoObservations);
  return {
    pseudoObservations,
    forwardPenalty,
    backwardPenalty,
    score: combine(metrics(bySeason[2024], forwardPenalty), metrics(bySeason[2023], backwardPenalty)),
  };
}

function chooseShrinkage(samples, position) {
  const rows = SHRINKAGE_GRID.map((pseudo) => crossValidate(samples, position, pseudo));
  rows.sort((left, right) => left.score.rmse - right.score.rmse || left.score.mae - right.score.mae || left.pseudoObservations - right.pseudoObservations);
  return { selected: rows[0], rows };
}
function format(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function main() {
  const rowsBySeason = new Map([2023, 2024, 2025].map((season) => [season, loadSeason(season)]));
  const samples = replacementSamples(rowsBySeason);
  console.log("SnapCount QB-context audit");
  console.log("Admission evidence: bidirectional 2023<->2024 as-of incumbent-QB cross-validation.");
  console.log("2025 is a consistency check only because it was inspected during development.\n");

  for (const position of POSITIONS) {
    const tuning = chooseShrinkage(samples, position);
    const selected = tuning.selected;
    const training = samples.filter((row) => row.position === position && TRAINING_SEASONS.includes(row.season) && row.replacement);
    const baselineCv = metrics(training, 0);
    const embedded = context.QB_CONTEXT_CALIBRATION[position];
    const derivedPenalty = shrunkPenalty(training, selected.pseudoObservations);
    const consistency = samples.filter((row) => row.position === position && row.season === CONSISTENCY_SEASON && row.replacement);
    const consistencyBase = metrics(consistency, 0);
    const consistencyAdjusted = metrics(consistency, derivedPenalty);

    if (selected.score.rmse >= baselineCv.rmse || selected.score.mae >= baselineCv.mae) {
      throw new Error(`${position} replacement-QB adjustment failed cross-validation admission`);
    }
    if (Math.abs(embedded.penalty - derivedPenalty) > 1e-6) throw new Error(`${position} embedded QB penalty drifted`);
    if (embedded.support !== training.length) throw new Error(`${position} embedded QB support drifted`);
    if (embedded.shrinkage !== selected.pseudoObservations) throw new Error(`${position} embedded QB shrinkage drifted`);

    console.log(`${position}: penalty ${(derivedPenalty * 100).toFixed(1)}% | support ${training.length} | shrinkage ${selected.pseudoObservations}`);
    console.log(`  CV baseline RMSE ${format(baselineCv.rmse)} | MAE ${format(baselineCv.mae)}`);
    console.log(`  CV adjusted RMSE ${format(selected.score.rmse)} | MAE ${format(selected.score.mae)}`);
    console.log(`  2025 consistency RMSE ${format(consistencyBase.rmse)} -> ${format(consistencyAdjusted.rmse)} | MAE ${format(consistencyBase.mae)} -> ${format(consistencyAdjusted.mae)}\n`);
  }

  console.log("Generic team-change and coaching mean scalars are not admitted by this audit.");
  console.log("Known staff/team context may be retained as metadata, but direct mean effects require their own walk-forward gate.");
}

main();

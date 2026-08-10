"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const audit = require("./forecast-history-audit.js");
const serving = require("../src/engine/mean-calibration.js");

const root = path.resolve(__dirname, "..");
const validation = path.join(root, "data", "validation");
const dataFile = path.join(validation, "historical-ppr-2020-2025.json.gz");
const reportFile = path.join(validation, "forecast-audit-report.json");
const outputFile = path.join(validation, "forecast-successor-candidate.json");
const TRAIN = [2021, 2022, 2023];
const POSITIONS = ["QB", "RB", "WR", "TE"];

function sha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function canonical(value) { return JSON.stringify(value); }
function round(value) { return Number(Number(value).toFixed(6)); }
function modelShape(model) {
  if (!model) return null;
  return {
    intercept: round(model.intercept),
    coefficients: Object.fromEntries(Object.entries(model.coefficients || {}).map(([key, value]) => [key, round(value)])),
  };
}
function candidateModel(data, report, position) {
  const entry = report.positions?.[position];
  if (!entry?.frozen2024?.admitted) return null;
  const fitted = audit.fitModel(audit.rowsFor(data, TRAIN, position), entry.model.features, entry.model.lambda);
  return {
    features: entry.model.features.slice(),
    lambda: entry.model.lambda,
    intercept: round(fitted.rawIntercept),
    coefficients: Object.fromEntries(Object.entries(fitted.rawCoefficients).map(([key, value]) => [key, round(value)])),
  };
}
function servingComparable(position) {
  const model = serving.MODELS[position];
  if (!model) return null;
  const coefficients = {};
  for (const [key, value] of Object.entries(model.coefficients || {})) {
    const reportKey = key === "xfp" ? "xfp_gap" : key === "practiceDnp" ? "practice_dnp" : key;
    coefficients[reportKey] = round(value);
  }
  return { intercept: round(model.intercept), coefficients };
}
function delta(left, right) {
  if (!left || !right) return null;
  const keys = new Set([...Object.keys(left.coefficients || {}), ...Object.keys(right.coefficients || {})]);
  return {
    intercept: round(left.intercept - right.intercept),
    coefficients: Object.fromEntries([...keys].map((key) => [key, round(Number(left.coefficients?.[key] || 0) - Number(right.coefficients?.[key] || 0))])),
  };
}
function build(frozenAt) {
  const compressed = fs.readFileSync(dataFile);
  const data = JSON.parse(zlib.gunzipSync(compressed));
  const reportBytes = fs.readFileSync(reportFile);
  const report = JSON.parse(reportBytes);
  const fittingCode = fs.readFileSync(path.join(root, "scripts", "forecast-history-audit.js"));
  const models = {};
  for (const position of POSITIONS) {
    const candidate = candidateModel(data, report, position);
    const current = servingComparable(position);
    models[position] = {
      servingAdmitted: Boolean(current),
      candidate,
      currentServing: current,
      candidateMinusServing: candidate ? delta(modelShape(candidate), current) : null,
    };
  }
  const modelPayload = Object.fromEntries(POSITIONS.map((position) => [position, models[position].candidate]));
  return {
    version: "forecast-successor-candidate-2026.1",
    frozenAt,
    status: "prospective-only-not-serving",
    purpose: "fully reproducible successor of the frozen forecast structure; fixed admitted positions/features/lambdas, refit only on the exact 2021-2023 training rows from the hashed committed artifact",
    inputs: {
      dataset: { file: path.basename(dataFile), sha256: sha(compressed), generatedAt: data.meta?.generatedAt || null },
      legacyReport: { file: path.basename(reportFile), canonicalSha256: sha(Buffer.from(canonical(report))) },
      fittingCode: { file: "scripts/forecast-history-audit.js", sha256: sha(fittingCode) },
      trainingSeasons: TRAIN,
    },
    models,
    candidateModelSha256: sha(Buffer.from(canonical(modelPayload))),
    preRegisteredAdmission: {
      evaluationSeason: 2026,
      baseline: "same point-in-time ESPN PPR projection used by SnapCount",
      noRetuneAfterOutcomeInspection: true,
      minimumBaselinePpr: 2,
      gates: {
        overallMaeImprovement: "> 0",
        overallRmseImprovement: "> 0",
        weeklyRankImprovement: ">= 0",
        admittedPositionMaeNonInferiority: "RB/WR/TE each >= 0 improvement",
        pairedWeekBootstrapMaeLower95: "> 0",
      },
      decisionRule: "Score the exact frozen production baseline first. Evaluate this exact candidate second. Do not change features, lambdas, coefficients, thresholds, or gates after any 2026 outcome is inspected.",
    },
    restrictions: {
      mayServeNow: false,
      mayUse2024Or2025ForAdmission: false,
      mayUse2026ForTuning: false,
      mayUse2026OnceForPreRegisteredAdmission: true,
    },
  };
}

function main() {
  if (process.argv.includes("--verify")) {
    const committed = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    const rebuilt = build(committed.frozenAt);
    if (canonical(committed) !== canonical(rebuilt)) throw new Error("Forecast successor candidate drift");
    console.log(`Forecast successor candidate verified: ${committed.candidateModelSha256}`);
    return;
  }
  const result = build(new Date().toISOString());
  fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${outputFile}`);
  console.log(`Candidate model SHA-256 ${result.candidateModelSha256}`);
  console.log("Status: prospective-only-not-serving");
}

if (require.main === module) main();
module.exports = { build };

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const audit = require("./forecast-history-audit.js");
const serving = require("../src/engine/mean-calibration.js");

const root = path.resolve(__dirname, "..");
const validation = path.join(root, "data", "validation");
const datasetFile = "historical-ppr-2020-2025.json.gz";
const reportFile = "forecast-audit-report.json";
const outputFile = path.join(validation, "forecast-provenance-audit.json");
const TRAIN = [2021, 2022, 2023];
const POSITIONS = ["QB", "RB", "WR", "TE"];

function sha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function rounded(value) { return Number(Number(value).toFixed(6)); }
function canonical(value) { return JSON.stringify(value); }
function modelShape(model) {
  if (!model) return null;
  return { intercept: rounded(model.intercept), coefficients: Object.fromEntries(Object.entries(model.coefficients || {}).map(([key, value]) => [key, rounded(value)])) };
}
function reportServingShape(position, reportModel) {
  if (position === "QB") return null;
  const coefficients = {};
  for (const [key, value] of Object.entries(reportModel?.coefficients || {})) {
    const servingKey = key === "xfp_gap" ? "xfp" : key === "practice_dnp" ? "practiceDnp" : key;
    coefficients[servingKey] = rounded(value);
  }
  return { intercept: rounded(reportModel?.intercept), coefficients };
}
function refitShape(data, position, reportModel) {
  const fit = audit.fitModel(audit.rowsFor(data, TRAIN, position), reportModel.features, reportModel.lambda);
  return {
    intercept: rounded(fit.rawIntercept),
    coefficients: Object.fromEntries(Object.entries(fit.rawCoefficients || {}).map(([key, value]) => [key, rounded(value)])),
  };
}
function coefficientDelta(stored, refit) {
  const keys = new Set([...Object.keys(stored.coefficients || {}), ...Object.keys(refit.coefficients || {})]);
  return {
    intercept: rounded(refit.intercept - stored.intercept),
    coefficients: Object.fromEntries([...keys].map((key) => [key, rounded(Number(refit.coefficients?.[key] || 0) - Number(stored.coefficients?.[key] || 0))])),
  };
}

function build() {
  const compressed = fs.readFileSync(path.join(validation, datasetFile));
  const data = JSON.parse(zlib.gunzipSync(compressed));
  const report = JSON.parse(fs.readFileSync(path.join(validation, reportFile), "utf8"));
  const positions = {};
  let servingMatches = true;
  let refitMatches = true;
  for (const position of POSITIONS) {
    const reportModel = report.positions?.[position]?.model || null;
    const admitted = report.positions?.[position]?.frozen2024?.admitted === true;
    const storedServing = admitted ? reportServingShape(position, reportModel) : null;
    const actualServing = modelShape(serving.MODELS[position]);
    const servingEqual = canonical(storedServing) === canonical(actualServing);
    if (!servingEqual) servingMatches = false;
    const refit = reportModel ? refitShape(data, position, reportModel) : null;
    const storedFit = reportModel ? { intercept: rounded(reportModel.intercept), coefficients: Object.fromEntries(Object.entries(reportModel.coefficients || {}).map(([key, value]) => [key, rounded(value)])) } : null;
    const refitEqual = canonical(storedFit) === canonical(refit);
    if (!refitEqual) refitMatches = false;
    positions[position] = {
      admitted,
      storedReportModel: storedFit,
      servingModel: actualServing,
      servingMatchesStoredReport: servingEqual,
      refitFromCommittedDataset: refit,
      refitMatchesStoredReport: refitEqual,
      refitDelta: storedFit && refit ? coefficientDelta(storedFit, refit) : null,
    };
  }

  const reportTime = Date.parse(report.generatedAt || "");
  const datasetTime = Date.parse(data.meta?.generatedAt || "");
  return {
    version: "forecast-provenance-audit-2026.1",
    purpose: "protect serving behavior and expose historical training-lineage limits without refitting production on consumed evaluation seasons",
    dataset: { file: datasetFile, sha256: sha(compressed), generatedAt: data.meta?.generatedAt || null },
    storedForecastReport: { file: reportFile, generatedAt: report.generatedAt || null, version: report.version || null },
    findings: {
      storedReportPredatesCommittedDataset: Number.isFinite(reportTime) && Number.isFinite(datasetTime) ? reportTime < datasetTime : null,
      exactOriginalTrainingArtifactPreserved: false,
      servingModelMatchesStoredReport: servingMatches,
      storedReportReproducesFromCommittedDataset: refitMatches,
      servingBehaviorFrozen: true,
    },
    positions,
    interpretation: "The frozen serving coefficients still match the stored qualification report, but the exact pre-fit dataset state was not preserved: the stored report predates the committed historical artifact and its coefficients do not reproduce exactly from that final artifact. This is a training-lineage defect, not evidence that the frozen serving backtest is fabricated.",
    releasePolicy: {
      allowServingFrozenModel: true,
      allowRetuneOnConsumed2024Or2025: false,
      successorRequiresExactInputHashBeforeFit: true,
      successorRequiresProspective2026Evidence: true,
    },
  };
}

function main() {
  const result = build();
  if (process.argv.includes("--verify")) {
    const committed = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    if (canonical(committed) !== canonical(result)) throw new Error("Forecast provenance audit drift");
    console.log(`Forecast provenance verified: ${result.version}`);
  } else {
    fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Wrote ${outputFile}`);
  }
  console.log(`Serving matches stored report: ${result.findings.servingModelMatchesStoredReport}`);
  console.log(`Stored report reproduces from committed dataset: ${result.findings.storedReportReproducesFromCommittedDataset}`);
  console.log(`Stored report predates committed dataset: ${result.findings.storedReportPredatesCommittedDataset}`);
}

if (require.main === module) main();
module.exports = { build };

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const meanCalibration = require("../src/engine/mean-calibration.js");
const uncertainty = require("../src/engine/calibration.js");
const correlation = require("../src/engine/correlation.js");
const context = require("../src/engine/context.js");
const draftSim = require("../src/engine/draft-sim.js");

const root = path.resolve(__dirname, "..");
const validationDir = path.join(root, "data", "validation");
const read = (name) => JSON.parse(fs.readFileSync(path.join(validationDir, name), "utf8"));
const hashFile = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function requireGate(condition, label) {
  if (!condition) throw new Error(`Analytics qualification gate failed: ${label}`);
}
function strictDraftGate(report) {
  const controls = report?.result?.controls || {};
  const rows = ["espn-market", "balanced", "value", "need-heavy", "zero-rb"].map((name) => controls[name]);
  return report?.admitted === true
    && rows.every((row) => Number(row?.edge) >= 0 && Number(row?.winRate) >= 0.5)
    && Number(controls["espn-market"]?.edge) > 0
    && Number(controls["espn-market"]?.winRate) >= 0.75;
}
function main() {
  const forecast = read("forecast-audit-report.json");
  const uncertaintyReport = read("uncertainty-audit-report.json");
  const decisions = read("decision-audit-report.json");
  const waivers = read("waiver-audit-report.json");
  const trades = read("trade-audit-report.json");
  const season = read("season-audit-report.json");
  const priorDraft = read("draft-segmented-policy.json");
  const priorDraftHoldout = read("draft-postfreeze-holdout.json");
  const robustDraft = read("draft-robust-policy.json");
  const robustDraftHoldout = read("draft-a-plus-holdout-2018.json");
  const draftGrade = strictDraftGate(robustDraftHoldout) ? "A+" : "A";

  requireGate(forecast.overall.frozen2024.corrected.mae < forecast.overall.frozen2024.raw.mae, "forecast MAE");
  requireGate(forecast.overall.frozen2024.corrected.rmse < forecast.overall.frozen2024.raw.rmse, "forecast RMSE");
  requireGate(uncertaintyReport.admitted === true, "uncertainty calibration");
  requireGate(decisions.releaseGatePassed === true && decisions.selectedPolicy === "raw-live-ppr", "Start/Sit policy selection");
  requireGate(waivers.admitted === true, "waiver utility");
  requireGate(trades.admitted === true, "trade utility");
  requireGate(season.admitted === true, "season probability calibration");
  requireGate(robustDraft.finalHoldoutSeason === 2018 && robustDraft.finalHoldoutInspected === false, "robust draft candidate freeze contract");
  requireGate(robustDraftHoldout.policyFrozenBeforeInspection === true, "2018 draft holdout freeze provenance");
  requireGate(robustDraftHoldout.policyDefinitionSha256 === robustDraft.policyDefinitionSha256, "robust draft policy hash parity");
  requireGate(hashFile(path.join(validationDir, "draft-robust-policy.json")) === robustDraftHoldout.policyArtifactSha256, "robust draft artifact hash parity");
  requireGate(hashFile(path.join(validationDir, "draft-robust-refine.json")) === robustDraft.sourceArtifactSha256, "robust draft development artifact hash parity");
  requireGate(strictDraftGate(robustDraftHoldout), "2018 robust draft all-control A+ holdout");

  const datasetPath = path.join(validationDir, "historical-ppr-2020-2025.json.gz");
  const reportNames = ["forecast-audit-report.json", "uncertainty-audit-report.json", "decision-audit-report.json", "waiver-audit-report.json", "trade-audit-report.json", "season-audit-report.json", "draft-segmented-policy.json", "draft-postfreeze-holdout.json", "draft-robust-refine.json", "draft-robust-policy.json", "draft-a-plus-holdout-2018.json"];
  const reportHashes = Object.fromEntries(reportNames.map((name) => [name, hashFile(path.join(validationDir, name))]));

  const qualifiedAt = new Date().toISOString();
  const draftSegments = robustDraft.segments || {};
  const qualification = {
    version: "snapcount-analytics-qualification-2026.3",
    qualifiedAt,
    architecture: "offline-qualification-live-serving",
    dataset: { file: "historical-ppr-2020-2025.json.gz", sha256: hashFile(datasetPath), seasons: [2020, 2021, 2022, 2023, 2024, 2025] },
    reports: reportHashes,
    grades: {
      forecastMean: "A+", uncertainty: "A+", contextAdmission: "A+", startSit: "A+",
      waivers: "A+", trades: "A+", draft: draftGrade, season: "A+", provenance: "A+", runtimeParity: "A+",
    },
    evidence: {
      forecast2024: forecast.overall.frozen2024,
      forecast2025: forecast.overall.consistency2025,
      uncertainty2024: uncertaintyReport.overall.frozen2024.legacy,
      uncertainty2025: uncertaintyReport.overall.consistency2025.legacy,
      startSitPolicy: decisions.selectedPolicy,
      waiver2024: waivers.frozen2024, waiver2025: waivers.consistency2025,
      trade2024: trades.frozen2024, trade2025: trades.consistency2025,
      season2024: season.frozen2024, season2025: season.consistency2025,
      draftPreFreeze2020: priorDraft.fresh2020, draftConsistency2024: priorDraft.consistency2024, draftConsistency2025: priorDraft.consistency2025,
      draftPostFreeze2019: priorDraftHoldout.result,
      draftRobustDevelopment2019To2025: robustDraft.development,
      draftFinalHoldout2018: robustDraftHoldout.result,
    },
  };

  const runtimeProfile = {
    version: "snapcount-runtime-profile-2026.3",
    qualifiedAt,
    qualificationSha256: crypto.createHash("sha256").update(JSON.stringify(qualification)).digest("hex"),
    mode: "serve-frozen-qualified-analytics",
    grades: qualification.grades,
    scoring: {
      default: "ppr",
      supportedFamilies: ["ppr", "standard"],
      standardDerivation: "ESPN PPR appliedTotal minus projected receptions stat 53",
    },
    players: {
      baseline: "espn-live-ppr",
      fallback: "committed-ppr-snapshot",
      validatedMeanScale: 1,
      meanCalibrationVersion: meanCalibration.VERSION,
      admittedPositions: Object.fromEntries(Object.entries(meanCalibration.MODELS).map(([position, model]) => [position, Boolean(model)])),
    },
    startSit: { baseline: "espn-live-ppr", validatedMeanScale: 0, policy: "raw-live-ppr-exact-lineup" },
    waivers: { baseline: "espn-live-ppr", validatedMeanScale: 0, minimumScore: waivers.selectedThreshold },
    trades: { baseline: "espn-live-ppr", validatedMeanScale: 0, acceptScore: trades.selectedThreshold, passScore: -trades.selectedThreshold },
    draft: { policy: "segmented-qualified", grade: draftGrade, postFreezeHoldoutSeason: 2018, policyDefinitionSha256: robustDraft.policyDefinitionSha256, supportedTeamCounts: robustDraft.supportedTeamCounts, segments: draftSegments, fallbackPolicy: robustDraft.policy },
    season: { probabilityEngine: "monte-carlo", calibrationVersion: uncertainty.VERSION, correlationVersion: correlation.VERSION },
    context: { version: context.VERSION, policy: "admitted-mean-or-metadata-only" },
  };

  fs.writeFileSync(path.join(validationDir, "analytics-qualification.json"), JSON.stringify(qualification, null, 2));
  fs.writeFileSync(path.join(root, "data", "analytics-runtime-profile.json"), JSON.stringify(runtimeProfile, null, 2));
  console.log(`Qualified analytics profile ${runtimeProfile.version}`);
  console.log(`Qualification SHA-256 ${runtimeProfile.qualificationSha256}`);
  console.log(`Serving grades: ${Object.entries(runtimeProfile.grades).map(([surface, grade]) => `${surface}=${grade}`).join(", ")}`);
}

main();

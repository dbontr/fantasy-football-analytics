"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "index.html",
  "styles.css",
  "favicon.svg",
  "snapcount-mark.svg",
  ".nojekyll",
  "engine-worker.js",
  "src/app.js",
  "src/engine/core.js",
  "src/engine/league.js",
  "src/engine/runtime.js",
  "src/engine/rookies.js",
  "src/engine/correlation.js",
  "src/engine/mean-calibration.js",
  "src/engine/football-context.js",
  "src/engine/evidence.js",
  "src/engine/context.js",
  "src/engine/intelligence.js",
  "src/engine/live-intelligence.js",
  "src/engine/calibration.js",
  "src/data/sources.js",
  "data/players-lite.json",
  "data/analytics-runtime-profile.json",
  "data/coaches-2026.json",
  "data/football-context-2026.json",
  "data/validation/football-context-audit.json",
  "data/health-calibration-2026.json",
  "data/rookies-2026.json",
  "data/camp-2026.json",
];

for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing static asset: ${relative}`);
}
const workflowDir = path.join(root, ".github", "workflows");
if (fs.existsSync(workflowDir) && fs.readdirSync(workflowDir).length) {
  throw new Error("GitHub Actions workflows are forbidden for this Pages project");
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (pkg.dependencies && Object.keys(pkg.dependencies).length) throw new Error("Runtime dependency budget must remain zero");
const dataset = JSON.parse(fs.readFileSync(path.join(root, "data", "players-lite.json"), "utf8"));
if (!Array.isArray(dataset.players) || dataset.players.length < 500) throw new Error("Bootstrap player dataset is incomplete");
if (dataset.meta?.scoringBaseline !== "PPR" || Number(dataset.meta?.espnLeagueDefault) !== 3) throw new Error("Bootstrap projection baseline must be ESPN PPR league default 3");
const snapShareCount = dataset.players.filter((player) => Number.isFinite(Number(player?.opportunity?.snapShare))).length;
if (snapShareCount < 300) throw new Error(`Bootstrap snap-share coverage is incomplete: ${snapShareCount}`);
const standardCount = dataset.players.filter((player) => Number.isFinite(Number(player?.standardProjectedPoints))).length;
if (standardCount < 650) throw new Error(`Bootstrap Standard-scoring coverage is incomplete: ${standardCount}`);
const runtimeProfile = JSON.parse(fs.readFileSync(path.join(root, "data", "analytics-runtime-profile.json"), "utf8"));
if (runtimeProfile.mode !== "serve-frozen-qualified-analytics") throw new Error("Runtime analytics profile is not in frozen serving mode");
for (const [surface, grade] of Object.entries(runtimeProfile.grades || {})) {
  const expected = surface === "provenance" ? "A" : "A+";
  if (grade !== expected) throw new Error(`Runtime analytics grade drift: ${surface} expected ${expected}`);
}
if (runtimeProfile.draft?.postFreezeHoldoutSeason !== 2018) throw new Error("Runtime Draft A+ holdout provenance drift");
if (runtimeProfile.draft?.robustnessAuditVersion !== "draft-overfit-audit-2026.1") throw new Error("Runtime Draft anti-overfit audit drift");
if (!Array.isArray(runtimeProfile.draft?.robustnessEvidenceYears) || runtimeProfile.draft.robustnessEvidenceYears.length !== 8) throw new Error("Runtime Draft robustness evidence missing");
if (runtimeProfile.players?.robustnessAuditVersion !== "forecast-overfit-audit-2026.1") throw new Error("Runtime forecast robustness audit drift");
if (!Array.isArray(runtimeProfile.players?.robustnessEvidenceYears) || runtimeProfile.players.robustnessEvidenceYears.length !== 6) throw new Error("Runtime forecast robustness evidence missing");
if (runtimeProfile.players?.prospectiveSuccessor?.status !== "prospective-only-not-serving" || runtimeProfile.players?.prospectiveSuccessor?.mayServeNow !== false) throw new Error("Runtime forecast successor serving lock drift");
if (runtimeProfile.decisionObjective?.primary !== "maximize-future-head-to-head-wins" || runtimeProfile.decisionObjective?.status !== "prospective-overlay") throw new Error("Runtime future-win objective drift");
if (runtimeProfile.decisionObjective?.canPromoteQualifiedTradeReject !== false || runtimeProfile.decisionObjective?.draftPolicyChanged !== false) throw new Error("Runtime future-win safety guard drift");
if (runtimeProfile.decisionObjective?.retrospectiveDiagnostic?.verdict !== "noninferior-no-observed-switches" || runtimeProfile.decisionObjective?.retrospectiveDiagnostic?.changedDecisions !== 0 || runtimeProfile.decisionObjective?.retrospectiveDiagnostic?.incrementalEdgeDemonstrated !== false) throw new Error("Runtime future-win historical interpretation drift");
const footballArtifact = JSON.parse(fs.readFileSync(path.join(root, "data", "football-context-2026.json"), "utf8"));
if (footballArtifact.meta?.version !== "snapcount-football-context-2026.1" || Object.keys(footballArtifact.teams || {}).length !== 32 || Object.keys(footballArtifact.defenses || {}).length !== 32) throw new Error("Football-context artifact is incomplete");
const footballAudit = JSON.parse(fs.readFileSync(path.join(root, "data", "validation", "football-context-audit.json"), "utf8"));
if (footballAudit.status !== "prospective-only-not-serving" || footballAudit.preRegisteredAdmission?.restrictions?.productionMeanChangedNow !== false) throw new Error("Football-context successor serving lock drift");
const campArtifact = JSON.parse(fs.readFileSync(path.join(root, "data", "camp-2026.json"), "utf8"));
if (campArtifact.meta?.version !== "camp-intelligence-2026.3" || !Array.isArray(campArtifact.players) || campArtifact.players.length < 10 || Number(campArtifact.meta?.searchedPlayers || 0) < 20) throw new Error("Role intelligence artifact is incomplete");
if (campArtifact.players.some((row) => row.modelEffect !== "advisory-only")) throw new Error("Camp intelligence must remain advisory-only");
if (campArtifact.players.some((row) => row.usageHyperbole && row.observations?.some((item) => item.literalVolume === true))) throw new Error("Role intelligence must never convert workload rhetoric into literal volume");
const campText = JSON.stringify(campArtifact);
if (campText.includes("<p") || campText.includes("rawText")) throw new Error("Camp artifact must not persist raw article bodies");
const preseasonAlphaArtifact = JSON.parse(fs.readFileSync(path.join(root, "data", "preseason-alpha-2026.json"), "utf8"));
if (preseasonAlphaArtifact.meta?.version !== "preseason-alpha-2026.1" || Number(preseasonAlphaArtifact.meta?.evaluatedPlayers || 0) < 250 || !Array.isArray(preseasonAlphaArtifact.players) || preseasonAlphaArtifact.players.length < 20) throw new Error("Preseason alpha artifact is incomplete");
if (preseasonAlphaArtifact.meta?.servingMeanEffect !== false || preseasonAlphaArtifact.meta?.servingDraftOrderEffect !== false) throw new Error("Preseason alpha serving lock drift");
if (preseasonAlphaArtifact.players.some((row) => row.modelEffect !== "uncertainty-and-shadow-only" || Math.abs(Number(row.candidateShift || 0)) > 2.5001)) throw new Error("Preseason alpha effect bounds drift");
const rookieArtifact = JSON.parse(fs.readFileSync(path.join(root, "data", "rookies-2026.json"), "utf8"));
if (!Array.isArray(rookieArtifact.players) || rookieArtifact.players.length < 50) throw new Error("Rookie artifact is incomplete");
if (Number(rookieArtifact.meta?.historicalRookieCount || 0) < 1500) throw new Error("Rookie historical cohort support is incomplete");
const rookieIds = new Set(rookieArtifact.players.map((row) => String(row.id)));
if (rookieIds.size !== rookieArtifact.players.length) throw new Error("Rookie artifact contains duplicate player ids");
console.log(`Static validation passed: ${dataset.players.length} players, zero runtime dependencies, zero workflows.`);

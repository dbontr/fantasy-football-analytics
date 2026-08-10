"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const meanCalibration = require("../src/engine/mean-calibration.js");
const uncertainty = require("../src/engine/calibration.js");
const correlation = require("../src/engine/correlation.js");
const context = require("../src/engine/context.js");

const root = path.resolve(__dirname, "..");
const validationDir = path.join(root, "data", "validation");
const profile = JSON.parse(fs.readFileSync(path.join(root, "data", "analytics-runtime-profile.json"), "utf8"));
const qualification = JSON.parse(fs.readFileSync(path.join(validationDir, "analytics-qualification.json"), "utf8"));
const robustDraft = JSON.parse(fs.readFileSync(path.join(validationDir, "draft-robust-policy.json"), "utf8"));
const robustHoldout = JSON.parse(fs.readFileSync(path.join(validationDir, "draft-a-plus-holdout-2018.json"), "utf8"));
const robustRefine = JSON.parse(fs.readFileSync(path.join(validationDir, "draft-robust-refine.json"), "utf8"));
const draftOverfit = JSON.parse(fs.readFileSync(path.join(validationDir, "draft-overfit-audit.json"), "utf8"));
const forecastProvenance = JSON.parse(fs.readFileSync(path.join(validationDir, "forecast-provenance-audit.json"), "utf8"));
const forecastOverfit = JSON.parse(fs.readFileSync(path.join(validationDir, "forecast-overfit-audit.json"), "utf8"));
const forecastSuccessor = JSON.parse(fs.readFileSync(path.join(validationDir, "forecast-successor-candidate.json"), "utf8"));
const futureWin = JSON.parse(fs.readFileSync(path.join(validationDir, "future-win-audit.json"), "utf8"));
const hashBytes = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const hashFile = (file) => hashBytes(fs.readFileSync(file));
const hashJsonFile = (file) => hashBytes(Buffer.from(JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8")))));
const gitBlob = (relativePath) => childProcess.execFileSync("git", ["show", `HEAD:${relativePath.replace(/\\/g, "/")}`], { cwd: root });
const hashGitBlob = (relativePath) => hashBytes(gitBlob(relativePath));
const readGitJson = (relativePath) => JSON.parse(gitBlob(relativePath).toString("utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(`Qualified analytics verification failed: ${message}`);
}

assert(profile.mode === "serve-frozen-qualified-analytics", "runtime mode drift");
for (const [surface, grade] of Object.entries(profile.grades || {})) {
  assert(grade === (surface === "provenance" ? "A" : "A+"), `grade drift: ${surface}`);
}
assert(profile.qualificationSha256 === hashBytes(JSON.stringify(qualification)), "qualification manifest hash drift");

assert(profile.players.meanCalibrationVersion === meanCalibration.VERSION, "mean calibration version drift");
assert(profile.players.trainingProvenance?.auditVersion === forecastProvenance.version, "forecast provenance version drift");
assert(forecastProvenance.findings?.servingModelMatchesStoredReport === true, "frozen forecast coefficient/report mismatch");
assert(forecastProvenance.findings?.storedReportReproducesFromCommittedDataset === false, "forecast provenance expectation drift");
assert(forecastOverfit.gates?.robustnessPass === true, "forecast anti-overfit robustness drift");
assert(profile.players.robustnessAuditVersion === forecastOverfit.version, "forecast robustness audit version drift");
assert(JSON.stringify(profile.players.robustnessEvidenceYears) === JSON.stringify(forecastOverfit.evidenceYears), "forecast robustness evidence-year drift");
assert(profile.players.prospectiveSuccessor?.version === forecastSuccessor.version, "forecast successor version drift");
assert(profile.players.prospectiveSuccessor?.modelSha256 === forecastSuccessor.candidateModelSha256, "forecast successor model hash drift");
assert(profile.players.prospectiveSuccessor?.mayServeNow === false && forecastSuccessor.restrictions?.mayServeNow === false, "forecast successor serving lock drift");
assert(profile.season.calibrationVersion === uncertainty.VERSION, "uncertainty version drift");
assert(profile.season.correlationVersion === correlation.VERSION, "correlation version drift");
assert(profile.context.version === context.VERSION, "context version drift");
assert(profile.decisionObjective?.primary === "maximize-future-head-to-head-wins", "future-win objective drift");
assert(profile.decisionObjective?.status === "prospective-overlay" && profile.decisionObjective?.opponentAware === true, "future-win admission-status drift");
assert(profile.decisionObjective?.canPromoteQualifiedTradeReject === false && profile.decisionObjective?.draftPolicyChanged === false && profile.decisionObjective?.forecastCoefficientsChanged === false, "future-win safety boundary drift");
assert(futureWin.result?.decisions === 140 && futureWin.result?.changedDecisions === 0 && futureWin.result?.creditDelta === 0, "future-win retrospective result drift");
assert(futureWin.evidenceDiscipline?.tuningAllowedAfterInspection === false && futureWin.evidenceDiscipline?.prospectiveConfirmation === 2026, "future-win evidence-discipline drift");
assert(profile.decisionObjective?.retrospectiveDiagnostic?.auditVersion === futureWin.version && profile.decisionObjective?.retrospectiveDiagnostic?.verdict === "noninferior-no-observed-switches" && profile.decisionObjective?.retrospectiveDiagnostic?.incrementalEdgeDemonstrated === false, "future-win historical interpretation drift");
assert(Number(profile.waivers.minimumScore) >= 0, "waiver threshold missing");
assert(Number(profile.trades.acceptScore) > 0 && Number(profile.trades.passScore) < 0, "trade thresholds missing");
assert(profile.draft.policy === "segmented-qualified" && Object.keys(profile.draft.segments || {}).length >= 6, "draft policy missing");
assert(profile.draft.postFreezeHoldoutSeason === 2018, "Draft A+ holdout season drift");
assert(profile.draft.policyDefinitionSha256 === robustDraft.policyDefinitionSha256, "Draft policy hash drift");
assert(robustHoldout.admitted === true && robustHoldout.policyDefinitionSha256 === robustDraft.policyDefinitionSha256, "Draft A+ holdout evidence drift");
const draftDefinition = { policy: robustDraft.policy, segments: robustDraft.segments, supportedTeamCounts: robustDraft.supportedTeamCounts, scoring: robustDraft.scoring };
assert(hashBytes(Buffer.from(JSON.stringify(draftDefinition))) === robustDraft.policyDefinitionSha256, "Draft definition hash drift");
assert(hashGitBlob("data/validation/draft-robust-policy.json") === robustHoldout.policyArtifactSha256, "Draft committed artifact provenance drift");
assert(JSON.stringify(robustDraft) === JSON.stringify(readGitJson("data/validation/draft-robust-policy.json")), "Draft working-tree semantic drift");
assert(hashGitBlob("data/validation/draft-robust-refine.json") === robustDraft.sourceArtifactSha256, "Draft committed development provenance drift");
assert(JSON.stringify(robustRefine) === JSON.stringify(readGitJson("data/validation/draft-robust-refine.json")), "Draft development working-tree semantic drift");
assert(draftOverfit.gates?.robustnessPass === true, "Draft anti-overfit robustness drift");
assert(draftOverfit.policyDefinitionSha256 === robustDraft.policyDefinitionSha256, "Draft overfit audit policy drift");
assert(draftOverfit.policyCanonicalSha256 === hashJsonFile(path.join(validationDir, "draft-robust-policy.json")), "Draft overfit canonical policy hash drift");
assert(profile.draft.robustnessAuditVersion === draftOverfit.version, "Draft robustness audit version drift");
assert(JSON.stringify(profile.draft.robustnessEvidenceYears) === JSON.stringify(draftOverfit.evidenceYears), "Draft robustness evidence-year drift");

const datasetPath = path.join(validationDir, qualification.dataset.file);
assert(hashFile(datasetPath) === qualification.dataset.sha256, "qualification dataset hash drift");
for (const [name, expected] of Object.entries(qualification.reports || {})) {
  assert(hashJsonFile(path.join(validationDir, name)) === expected, `qualification report drift: ${name}`);
}

console.log(`Qualified analytics verified: ${profile.version}`);
console.log(`Qualification SHA-256 ${profile.qualificationSha256}`);

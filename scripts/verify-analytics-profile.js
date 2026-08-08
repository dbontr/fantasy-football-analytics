"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const meanCalibration = require("../src/engine/mean-calibration.js");
const uncertainty = require("../src/engine/calibration.js");
const correlation = require("../src/engine/correlation.js");
const context = require("../src/engine/context.js");

const root = path.resolve(__dirname, "..");
const validationDir = path.join(root, "data", "validation");
const profile = JSON.parse(fs.readFileSync(path.join(root, "data", "analytics-runtime-profile.json"), "utf8"));
const qualification = JSON.parse(fs.readFileSync(path.join(validationDir, "analytics-qualification.json"), "utf8"));
const hashBytes = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const hashFile = (file) => hashBytes(fs.readFileSync(file));

function assert(condition, message) {
  if (!condition) throw new Error(`Qualified analytics verification failed: ${message}`);
}

assert(profile.mode === "serve-frozen-qualified-analytics", "runtime mode drift");
assert(Object.values(profile.grades || {}).every((grade) => grade === "A+"), "grade drift");
assert(profile.qualificationSha256 === hashBytes(JSON.stringify(qualification)), "qualification manifest hash drift");

assert(profile.players.meanCalibrationVersion === meanCalibration.VERSION, "mean calibration version drift");
assert(profile.season.calibrationVersion === uncertainty.VERSION, "uncertainty version drift");
assert(profile.season.correlationVersion === correlation.VERSION, "correlation version drift");
assert(profile.context.version === context.VERSION, "context version drift");
assert(Number(profile.waivers.minimumScore) >= 0, "waiver threshold missing");
assert(Number(profile.trades.acceptScore) > 0 && Number(profile.trades.passScore) < 0, "trade thresholds missing");
assert(profile.draft.policy === "segmented-qualified" && Object.keys(profile.draft.segments || {}).length >= 6, "draft policy missing");

const datasetPath = path.join(validationDir, qualification.dataset.file);
assert(hashFile(datasetPath) === qualification.dataset.sha256, "qualification dataset hash drift");
for (const [name, expected] of Object.entries(qualification.reports || {})) {
  assert(hashFile(path.join(validationDir, name)) === expected, `qualification report drift: ${name}`);
}

console.log(`Qualified analytics verified: ${profile.version}`);
console.log(`Qualification SHA-256 ${profile.qualificationSha256}`);

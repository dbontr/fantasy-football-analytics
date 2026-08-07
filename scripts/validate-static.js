"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "index.html",
  "styles.css",
  ".nojekyll",
  "engine-worker.js",
  "src/app.js",
  "src/engine/core.js",
  "src/engine/runtime.js",
  "src/engine/rookies.js",
  "src/engine/evidence.js",
  "src/engine/context.js",
  "src/data/sources.js",
  "data/players-lite.json",
  "data/coaches-2026.json",
  "data/health-calibration-2026.json",
  "data/rookies-2026.json",
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
const rookieArtifact = JSON.parse(fs.readFileSync(path.join(root, "data", "rookies-2026.json"), "utf8"));
if (!Array.isArray(rookieArtifact.players) || rookieArtifact.players.length < 50) throw new Error("Rookie artifact is incomplete");
if (Number(rookieArtifact.meta?.historicalRookieCount || 0) < 1500) throw new Error("Rookie historical cohort support is incomplete");
const rookieIds = new Set(rookieArtifact.players.map((row) => String(row.id)));
if (rookieIds.size !== rookieArtifact.players.length) throw new Error("Rookie artifact contains duplicate player ids");
console.log(`Static validation passed: ${dataset.players.length} players, zero runtime dependencies, zero workflows.`);

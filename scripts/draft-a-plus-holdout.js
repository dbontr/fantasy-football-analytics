"use strict";

process.env.SNAPCOUNT_DRAFT_SEASON = "2018";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const historical = require("./draft-robust-historical.js");

const root = path.resolve(__dirname, "..");
const candidatePath = path.join(root, "data", "validation", "draft-robust-policy.json");
const outputPath = path.join(root, "data", "validation", "draft-a-plus-holdout-2018.json");
const candidateBytes = fs.readFileSync(candidatePath);
const candidate = JSON.parse(candidateBytes.toString("utf8"));
const controls = ["espn-market", "balanced", "value", "need-heavy", "zero-rb"];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function requireGate(condition, label) {
  if (!condition) throw new Error(`Final Draft A+ holdout precondition failed: ${label}`);
}
async function main() {
  requireGate(candidate.finalHoldoutSeason === 2018, "candidate holdout season must be 2018");
  requireGate(candidate.finalHoldoutInspected === false, "candidate must be frozen before holdout inspection");
  const definition = {
    policy: candidate.policy,
    segments: candidate.segments,
    supportedTeamCounts: candidate.supportedTeamCounts,
    scoring: candidate.scoring,
  };
  requireGate(sha256(JSON.stringify(definition)) === candidate.policyDefinitionSha256, "candidate policy hash");
  const status = childProcess.execFileSync("git", ["status", "--porcelain", "--", "data/validation/draft-robust-policy.json"], { cwd: root, encoding: "utf8" }).trim();
  requireGate(status === "", "candidate artifact must be committed and unchanged");
  const freezeCommit = childProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const built = await historical.buildPool();
  requireGate(built.pool.length >= 180, "2018 player pool coverage");
  const result = historical.evaluate(built.pool, [candidate.policy], 8)[0];
  const admitted = historical.grade(result);
  const report = {
    version: "draft-a-plus-holdout-2018-2026.1",
    evaluatedAt: new Date().toISOString(),
    season: 2018,
    policyArtifact: candidate.version,
    policyArtifactSha256: sha256(candidateBytes),
    policyDefinitionSha256: candidate.policyDefinitionSha256,
    freezeCommit,
    policyFrozenBeforeInspection: true,
    pairedSeedsPerSegment: 8,
    pairedRoomsPerControl: 48,
    poolPlayers: built.pool.length,
    sources: built.sources,
    result,
    gate: candidate.finalGate,
    admitted,
  };
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!admitted) process.exitCode = 2;
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

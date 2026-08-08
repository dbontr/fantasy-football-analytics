"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const validationDir = path.join(root, "data", "validation");
const sourcePath = path.join(validationDir, "draft-robust-refine.json");
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const controls = ["espn-market", "balanced", "value", "need-heavy", "zero-rb"];
const segmentKeys = ["10-early", "10-middle", "10-late", "12-early", "12-middle", "12-late"];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function requireGate(condition, label) {
  if (!condition) throw new Error(`Draft candidate freeze gate failed: ${label}`);
}
const winner = source.winner;
requireGate(winner?.aggregatePass === true, "development aggregate multi-control pass");
for (const control of controls) {
  requireGate(Number(winner.controls?.[control]?.edge) >= 0, `${control} development mean edge`);
  requireGate(Number(winner.controls?.[control]?.winRate) >= 0.5, `${control} development win rate`);
}
requireGate(Number(winner.controls?.["espn-market"]?.winRate) >= 0.75, "ESPN-market development win rate");

const policy = winner.policy;
const definition = {
  policy,
  segments: Object.fromEntries(segmentKeys.map((key) => [key, policy])),
  supportedTeamCounts: [10, 12],
  scoring: "ppr",
};
const artifact = {
  version: "draft-robust-policy-2026.2",
  frozenAt: new Date().toISOString(),
  developmentSeasons: source.developmentSeasons,
  selectionMethod: "global-multi-control-robustness",
  finalHoldoutSeason: 2018,
  finalHoldoutInspected: false,
  policyDefinitionSha256: sha256(JSON.stringify(definition)),
  sourceArtifactSha256: sha256(fs.readFileSync(sourcePath)),
  ...definition,
  development: {
    controls: winner.controls,
    seasons: winner.seasons,
    passCells: winner.passCells,
    worstEdge: winner.worstEdge,
    worstWin: winner.worstWin,
  },
  finalGate: {
    everyControlMeanEdgeAtLeast: 0,
    everyControlWinRateAtLeast: 0.5,
    espnMarketWinRateAtLeast: 0.75,
  },
};

const output = path.join(validationDir, "draft-robust-policy.json");
if (fs.existsSync(output)) {
  const existing = JSON.parse(fs.readFileSync(output, "utf8"));
  if (existing.policyDefinitionSha256 === artifact.policyDefinitionSha256
      && existing.sourceArtifactSha256 === artifact.sourceArtifactSha256) {
    console.log(`Candidate unchanged; preserving ${existing.version} frozen bytes.`);
    console.log(`Policy SHA-256 ${existing.policyDefinitionSha256}`);
    console.log(JSON.stringify(existing.policy));
  } else {
    fs.writeFileSync(output, JSON.stringify(artifact, null, 2));
    console.log(`Frozen new ${artifact.version}`);
    console.log(`Policy SHA-256 ${artifact.policyDefinitionSha256}`);
    console.log(JSON.stringify(policy));
  }
} else {
  fs.writeFileSync(output, JSON.stringify(artifact, null, 2));
  console.log(`Frozen ${artifact.version}`);
  console.log(`Policy SHA-256 ${artifact.policyDefinitionSha256}`);
  console.log(JSON.stringify(policy));
}

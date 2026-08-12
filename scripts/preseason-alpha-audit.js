"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const artifactPath = path.join(root, "data", "preseason-alpha-2026.json");
const outputPath = path.join(root, "data", "validation", "preseason-alpha-audit.json");
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const verify = process.argv.includes("--verify");
function walk(value, pathParts = [], out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) { value.forEach((row, index) => walk(row, [...pathParts, String(index)], out)); return out; }
  for (const [key, row] of Object.entries(value)) { out.push([...pathParts, key].join(".")); walk(row, [...pathParts, key], out); }
  return out;
}
function validate() {
  assert.equal(artifact.meta?.version, "preseason-alpha-2026.1");
  assert.equal(artifact.meta?.servingMeanEffect, false);
  assert.equal(artifact.meta?.servingDraftOrderEffect, false);
  assert.ok(Number(artifact.meta?.evaluatedPlayers || 0) >= 250, "preseason alpha build should evaluate the draftable pool");
  assert.ok((artifact.players || []).length >= 20, "preseason alpha should retain evidence-active players");
  assert.ok(Number(artifact.meta?.marketReactionPlayers || 0) >= 200, "market-reaction history coverage is too small");
  for (const row of artifact.players || []) {
    assert.ok(Math.abs(Number(row.alphaScore || 0)) <= 1.0001, `${row.name} alpha escaped bounds`);
    assert.ok(Math.abs(Number(row.candidateShift || 0)) <= 2.5001, `${row.name} candidate shift escaped cap`);
    assert.equal(row.modelEffect, "uncertainty-and-shadow-only");
    assert.ok(Math.abs(Number(row.genericPerformanceContribution || 0)) <= 0.0351, `${row.name} generic hype contribution too large`);
    const probability = (row.roleProbabilities || []).reduce((sum, item) => sum + Number(item.probability || 0), 0);
    assert.ok(Math.abs(probability - 1) <= 0.002, `${row.name} role probabilities do not sum to one`);
  }
  const achane = (artifact.players || []).find((row) => row.name === "De'Von Achane");
  if (achane) {
    assert.ok(Number(achane.alphaScore) > 0.15, "Achane usage-intent regression is missing");
    assert.ok(Number(achane.coachIntent?.directStories || 0) >= 1, "Achane direct coach signal is missing");
    assert.equal(achane.modelEffect, "uncertainty-and-shadow-only");
  }
  const keys = walk(artifact);
  assert.equal(keys.some((key) => /(?:articleBody|rawBody|storyBody|fullText|rawText)$/i.test(key)), false, "raw article text leaked into compact artifact");
  return achane;
}
const achane = validate();
const report = {
  version: "preseason-alpha-audit-2026.1",
  status: "prospective-shadow",
  purpose: "pre-registered serving lock for structural preseason information alpha",
  artifactVersion: artifact.meta.version,
  coverage: {
    evaluatedPlayers: artifact.meta.evaluatedPlayers,
    players: artifact.meta.players,
    signaledPlayers: artifact.meta.signaledPlayers,
    starterUsagePlayers: artifact.meta.starterUsagePlayers,
    coachIntentPlayers: artifact.meta.coachIntentPlayers,
    consensusPlayers: artifact.meta.consensusPlayers,
    injuryTrajectoryPlayers: artifact.meta.injuryTrajectoryPlayers,
    marketReactionPlayers: artifact.meta.marketReactionPlayers,
  },
  gates: {
    timestampCorrectInputsRequired: true,
    genericHypeCannotPromote: true,
    servingMeanEffectAllowed: false,
    servingDraftOrderEffectAllowed: false,
    prospective2026ConfirmationRequired: true,
    historicalWalkForwardRequiredForBackfilledCandidate: true,
    promotionRequiresStableMultiSplitImprovement: true,
  },
  promotionRule: "No direct mean or qualified-draft-order effect until timestamp-correct replay/prospective evidence has stable sign and a positive uncertainty-aware lower bound versus the frozen champion.",
  achaneRegression: achane ? { alphaScore: achane.alphaScore, confidence: achane.confidence, coachDirectStories: achane.coachIntent?.directStories || 0, marketLabel: achane.market?.label || null } : null,
};
if (!verify) fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
else {
  const stored = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(stored.status, report.status);
  assert.deepEqual(stored.gates, report.gates);
  assert.equal(stored.artifactVersion, report.artifactVersion);
}
console.log(`Preseason alpha audit ${verify ? "verified" : "written"}: ${report.status}`);

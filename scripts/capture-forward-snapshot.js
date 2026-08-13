"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sources = require("../src/data/sources.js");
const live = require("../src/engine/live-intelligence.js");

const root = path.resolve(__dirname, "..");
const forwardDir = path.join(root, "data", "forward");
const season = 2026;
function sha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function fileStamp(iso) { return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
const POLICY_BINDING_FILES = [
  "data/analytics-runtime-profile.json", "data/validation/draft-robust-policy.json",
  "src/engine/core.js", "src/engine/runtime.js", "src/engine/draft-sim.js",
  "src/engine/draft-intelligence.js", "src/engine/preseason-alpha.js",
  "src/engine/correlation.js", "src/engine/calibration.js", "src/engine/mean-calibration.js",
];
function decisionPolicyBinding() {
  const files = Object.fromEntries(POLICY_BINDING_FILES.map((relative) => {
    const bytes = fs.readFileSync(path.join(root, relative));
    return [relative, sha(bytes)];
  }));
  const canonical = Object.entries(files).map(([relative, digest]) => relative + ":" + digest).join("\n");
  return { version: "decision-policy-binding-2026.1", files, combinedSha256: sha(Buffer.from(canonical)) };
}

function compactProjection(player) {
  return {
    id: String(player.id), name: player.name, position: player.position, team: player.team,
    projectedPoints: Number(player.projectedPoints || 0), weeklyProjection: Number(player.weeklyProjection || 0),
    pprRank: Number.isFinite(Number(player.pprRank)) ? Number(player.pprRank) : null,
    adp: Number.isFinite(Number(player.adp)) ? Number(player.adp) : null,
    injuryStatus: player.injuryStatus || null, projectionSource: player.projectionSource || null,
    market: player.market ? { ...player.market } : null,
  };
}
function compactPreseasonAlpha(row) {
  return {
    id: String(row.id), alphaScore: Number(row.alphaScore || 0), confidence: Number(row.confidence || 0),
    candidateShift: Number(row.candidateShift || 0), roleProbabilities: row.roleProbabilities || [],
    market: row.market ? { pricedFraction: row.market.pricedFraction, movement: row.market.movement, label: row.market.label } : null,
    injury: row.injury ? { trend: row.injury.trend, latestState: row.injury.latestState } : null,
    modelEffect: row.modelEffect || "uncertainty-and-shadow-only",
  };
}
async function preseasonRows() {
  const boards = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => sources.espnNflScoreboard(season, 1, index + 1)));
  const events = [];
  for (const result of boards) if (result.status === "fulfilled") for (const event of result.value?.events || []) {
    if ((event?.status?.type?.completed === true || String(event?.status?.type?.name || "").includes("FINAL")) && event?.id) events.push(event);
  }
  const unique = [...new Map(events.map((event) => [String(event.id), event])).values()].slice(0, 32);
  const rows = [];
  for (let offset = 0; offset < unique.length; offset += 4) {
    const batch = await Promise.allSettled(unique.slice(offset, offset + 4).map((event) => sources.espnNflSummary(event.id)));
    for (const result of batch) if (result.status === "fulfilled") rows.push(...live.parseEspnPreseasonSummary(result.value));
  }
  return rows.map((row) => ({
    id: String(row.id), name: row.name, team: row.team, gameId: row.gameId, date: row.date,
    passingAttempts: row.passingAttempts, carries: row.carries, targets: row.targets,
    receptions: row.receptions, rushingYards: row.rushingYards, receivingYards: row.receivingYards,
  }));
}

async function main() {
  fs.mkdirSync(forwardDir, { recursive: true });
  const capturedAt = new Date().toISOString();
  const base = JSON.parse(fs.readFileSync(path.join(root, "data", "players-lite.json"), "utf8"));
  const campBytes = fs.readFileSync(path.join(root, "data", "camp-2026.json"));
  const camp = JSON.parse(campBytes);
  const alphaPath = path.join(root, "data", "preseason-alpha-2026.json");
  const alphaBytes = fs.existsSync(alphaPath) ? fs.readFileSync(alphaPath) : Buffer.from("{}");
  const preseasonAlpha = JSON.parse(alphaBytes.toString("utf8"));
  const [snapshot, news, adds, drops, preseason] = await Promise.all([
    sources.espnPprPlayerSnapshot(season), sources.espnNflNews(100),
    sources.loadSleeperTrending("add", 24, 100), sources.loadSleeperTrending("drop", 24, 100), preseasonRows(),
  ]);
  const enriched = sources.enrichPprProjectionBaseline(base.players || [], snapshot, season);
  const articles = live.extractNewsPulse(news, enriched).map((article) => ({
    id: article.id, headline: article.headline, published: article.published,
    playerIds: article.playerIds, teams: article.teams, camp: article.camp,
  }));
  const artifact = {
    meta: {
      version: "forward-input-snapshot-2026.3", season, capturedAt,
      purpose: "prospective pre-outcome input freeze for future validation; contains no regular-season realized labels",
      policy: "Record this snapshot before future outcomes. Do not retroactively edit it or use later results to change its inputs.",
      decisionPolicyBinding: decisionPolicyBinding(),
    },
    projections: enriched.map(compactProjection),
    camp: { artifactVersion: camp.meta?.version || null, capturedAt: camp.meta?.capturedAt || null, sha256: sha(campBytes), players: camp.players || [] },
    preseasonAlpha: {
      artifactVersion: preseasonAlpha.meta?.version || null,
      capturedAt: preseasonAlpha.meta?.capturedAt || null,
      sha256: alphaBytes.length > 2 ? sha(alphaBytes) : null,
      players: (preseasonAlpha.players || []).map(compactPreseasonAlpha),
    },
    news: articles,
    sleeperTrending: {
      adds: (adds || []).map((row) => ({ playerId: String(row.player_id), count: Number(row.count || 0) })),
      drops: (drops || []).map((row) => ({ playerId: String(row.player_id), count: Number(row.count || 0) })),
    },
    preseason,
  };
  const relative = `${fileStamp(capturedAt)}_inputs.json`;
  const bytes = Buffer.from(`${JSON.stringify(artifact)}\n`);
  fs.writeFileSync(path.join(forwardDir, relative), bytes);
  const manifestPath = path.join(forwardDir, "manifest.json");
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { version: "forward-manifest-2026.1", snapshots: [] };
  manifest.snapshots = [...(manifest.snapshots || []), { file: relative, capturedAt, sha256: sha(bytes), realizedOutcomesAttached: false }]
    .filter((row, index, rows) => rows.findIndex((other) => other.file === row.file) === index)
    .sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Captured ${artifact.projections.length} projections, ${artifact.camp.players.length} structural role signals, ${artifact.preseasonAlpha.players.length} preseason-alpha rows, ${artifact.preseason.length} preseason player-games.`);
  console.log(`Wrote data/forward/${relative}`);
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

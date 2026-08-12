"use strict";
const fs = require("node:fs");
const path = require("node:path");
const sources = require("../src/data/sources.js");
const live = require("../src/engine/live-intelligence.js");
const alpha = require("../src/engine/preseason-alpha.js");
const root = path.resolve(__dirname, ".."), season = 2026;
const outputPath = path.join(root, "data", "preseason-alpha-2026.json"), forwardDir = path.join(root, "data", "forward");
const dataset = JSON.parse(fs.readFileSync(path.join(root, "data", "players-lite.json"), "utf8"));
const camp = JSON.parse(fs.readFileSync(path.join(root, "data", "camp-2026.json"), "utf8"));
const SKILL = new Set(["QB", "RB", "WR", "TE"]);
const finite = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
function round(value, digits = 4) { const number = Number(value); if (!Number.isFinite(number)) return null; const scale = 10 ** digits; return Math.round(number * scale) / scale; }
const unique = (values) => [...new Set(values)];
function loadForwardSnapshots() {
  const manifestPath = path.join(forwardDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return (manifest.snapshots || []).flatMap((row) => {
    const file = path.join(forwardDir, row.file); if (!fs.existsSync(file)) return [];
    try { const payload = JSON.parse(fs.readFileSync(file, "utf8")); return [{ capturedAt: payload.meta?.capturedAt || row.capturedAt, projections: payload.projections || [], preseason: payload.preseason || [] }]; }
    catch (_) { return []; }
  });
}
function compactMarketRow(capturedAt, player) { return { capturedAt, adp: finite(player?.market?.averageDraftPosition, finite(player?.adp)), pprRank: finite(player?.pprRank, finite(player?.market?.consensusPprRank)), projectedPoints: finite(player?.projectedPoints) }; }
function marketHistoryById(forwardSnapshots, currentCapturedAt) {
  const out = new Map();
  const add = (id, row) => { if (!id || (!Number.isFinite(Number(row.adp)) && !Number.isFinite(Number(row.pprRank)))) return; if (!out.has(String(id))) out.set(String(id), []); out.get(String(id)).push(row); };
  for (const snapshot of forwardSnapshots) for (const player of snapshot.projections || []) add(player.id, compactMarketRow(snapshot.capturedAt, player));
  for (const player of dataset.players || []) add(player.id, compactMarketRow(currentCapturedAt, player));
  for (const [id, rows] of out) out.set(id, [...new Map(rows.map((row) => [String(row.capturedAt), row])).values()].sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt))));
  return out;
}
async function fetchPreseasonRows() {
  const boards = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => sources.espnNflScoreboard(season, 1, index + 1))), events = [];
  for (const result of boards) if (result.status === "fulfilled") for (const event of result.value?.events || []) {
    const completed = event?.status?.type?.completed === true || String(event?.status?.type?.name || "").includes("FINAL"); if (completed && event?.id) events.push(event);
  }
  const uniqueEvents = [...new Map(events.map((event) => [String(event.id), event])).values()].slice(0, 40), rows = [];
  for (let offset = 0; offset < uniqueEvents.length; offset += 4) {
    const batch = await Promise.allSettled(uniqueEvents.slice(offset, offset + 4).map((event) => sources.espnNflSummary(event.id)));
    for (const result of batch) if (result.status === "fulfilled") rows.push(...live.parseEspnPreseasonSummary(result.value));
  }
  return rows;
}
function combinedPreseasonRows(forwardSnapshots, liveRows) {
  const deduped = new Map();
  for (const row of forwardSnapshots.flatMap((snapshot) => snapshot.preseason || []).concat(liveRows || [])) { const key = `${row.gameId}|${row.id}`; deduped.set(key, { ...(deduped.get(key) || {}), ...row }); }
  return [...deduped.values()];
}
function compactAlphaRow(player, result) {
  return {
    id: String(player.id), name: player.name, team: player.team, position: player.position,
    alphaScore: round(result.alphaScore), rawStructuralSignal: round(result.rawStructuralSignal), confidence: round(result.confidence), candidateShift: round(result.candidateShift, 2),
    roleProbabilities: result.roleProbabilities.map((row) => ({ key: row.key, label: row.label, probability: round(row.probability) })),
    market: { available: result.market.available, snapshots: result.market.snapshots, movement: round(result.market.movement, 2), adpMovement: round(result.market.adpMovement, 2), rankMovement: round(result.market.rankMovement, 2), pricedFraction: round(result.market.pricedFraction), residualFactor: round(result.market.residualFactor), conflict: round(result.market.conflict), label: result.market.label, from: result.market.from || null, to: result.market.to || null },
    consensus: { available: result.consensus.available, stories: result.consensus.stories, sources: result.consensus.sources, agreement: round(result.consensus.agreement), strength: round(result.consensus.strength), signal: round(result.consensus.signal) },
    injury: { available: result.injury.available, trend: result.injury.trend, signal: round(result.injury.signal), confidence: round(result.injury.confidence), latestState: result.injury.latestState, observations: result.injury.observations },
    starterUsage: { available: result.starterUsage.available, games: result.starterUsage.games, opportunitiesPerGame: round(result.starterUsage.opportunitiesPerGame, 2), positionOpportunityShare: round(result.starterUsage.positionOpportunityShare), firstUnitTaggedGames: result.starterUsage.firstUnitTaggedGames || 0, signal: round(result.starterUsage.signal), confidence: round(result.starterUsage.confidence) },
    coachIntent: { available: result.coachIntent.available, signal: round(result.coachIntent.signal), confidence: round(result.coachIntent.confidence), directStories: result.coachIntent.directStories || 0 },
    firstUnit: { available: result.firstUnit.available, signal: round(result.firstUnit.signal), confidence: round(result.firstUnit.confidence), evidence: result.firstUnit.evidence || 0 },
    sensitivity: { factor: round(result.sensitivity.factor), rookie: result.sensitivity.rookie, established: result.sensitivity.established, roleUncertainty: round(result.sensitivity.roleUncertainty) },
    components: result.components.map((row) => ({ key: row.key, label: row.label, signal: round(row.signal), confidence: round(row.confidence), contribution: round(row.contribution), available: row.available })),
    genericPerformanceContribution: round(result.genericPerformanceContribution), modelEffect: result.modelEffect,
  };
}
async function main() {
  const capturedAt = new Date().toISOString(), forwardSnapshots = loadForwardSnapshots(), currentCapturedAt = dataset.meta?.refreshedAt || capturedAt;
  const marketById = marketHistoryById(forwardSnapshots, currentCapturedAt); let livePreseason = [];
  try { livePreseason = await fetchPreseasonRows(); } catch (error) { console.warn(`Preseason fetch unavailable; using frozen forward rows: ${error.message}`); }
  const preseasonRows = combinedPreseasonRows(forwardSnapshots, livePreseason), campById = new Map((camp.players || []).map((row) => [String(row.id), row]));
  const ranked = (dataset.players || []).filter((player) => SKILL.has(String(player.position))).sort((a, b) => Number(a.pprRank ?? a.adp ?? 9999) - Number(b.pprRank ?? b.adp ?? 9999));
  const selectedIds = new Set(ranked.slice(0, 320).map((player) => String(player.id))); for (const row of camp.players || []) selectedIds.add(String(row.id));
  const evaluated = [];
  for (const player of ranked.filter((row) => selectedIds.has(String(row.id)))) {
    const starterUsage = alpha.summarizeStarterUsage(preseasonRows, player, dataset.players || []);
    evaluated.push(compactAlphaRow(player, alpha.computePreseasonAlpha(player, { camp: campById.get(String(player.id)) || {}, starterUsage, marketHistory: marketById.get(String(player.id)) || [] })));
  }
  const rows = evaluated.filter((row) => row.components.some((component) => component.available) || row.starterUsage.available || Math.abs(Number(row.alphaScore || 0)) >= 0.05);
  rows.sort((a, b) => Number(a.alphaScore || 0) - Number(b.alphaScore || 0));
  const signaled = rows.filter((row) => Math.abs(Number(row.alphaScore || 0)) >= 0.15 && Number(row.confidence || 0) >= 0.15);
  const artifact = { meta: {
    version: "preseason-alpha-2026.1", engineVersion: alpha.VERSION, season, capturedAt,
    source: "ESPN first-team/usage/injury reporting + ESPN preseason box scores + frozen forward market snapshots",
    policy: "Generic hype has no standalone effect. Structural role, starter-unit usage, coach/playcaller intent, report consensus, injury trajectory, and unpriced market residual are combined with player-specific shrinkage. Output is uncertainty/shadow-only until prospective validation clears promotion.",
    marketSnapshots: unique([...forwardSnapshots.map((row) => row.capturedAt), currentCapturedAt]).filter(Boolean).sort(), preseasonPlayerGames: preseasonRows.length,
    evaluatedPlayers: evaluated.length, players: rows.length, signaledPlayers: signaled.length, coachIntentPlayers: rows.filter((row) => row.coachIntent.available).length, consensusPlayers: rows.filter((row) => row.consensus.stories >= 2).length,
    injuryTrajectoryPlayers: rows.filter((row) => row.injury.available).length, starterUsagePlayers: rows.filter((row) => row.starterUsage.available).length, marketReactionPlayers: evaluated.filter((row) => row.market.available).length,
    servingMeanEffect: false, servingDraftOrderEffect: false,
  }, players: rows };
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact)}\n`);
  const strongest = [...signaled].sort((a, b) => Math.abs(Number(b.alphaScore || 0) * Number(b.confidence || 0)) - Math.abs(Number(a.alphaScore || 0) * Number(a.confidence || 0))).slice(0, 8);
  console.log(`Wrote ${rows.length} preseason-alpha players (${signaled.length} signaled) to ${outputPath}`);
  console.log(`Coverage: ${artifact.meta.starterUsagePlayers} preseason usage | ${artifact.meta.coachIntentPlayers} coach intent | ${artifact.meta.consensusPlayers} consensus | ${artifact.meta.injuryTrajectoryPlayers} injury trajectory | ${artifact.meta.marketReactionPlayers} market reaction`);
  for (const row of strongest) console.log(`${row.name}: alpha ${row.alphaScore} conf ${row.confidence} · ${row.market.label}`);
}
if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { combinedPreseasonRows, compactMarketRow, loadForwardSnapshots, marketHistoryById };

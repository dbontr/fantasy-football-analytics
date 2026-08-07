"use strict";

importScripts(
  "./src/engine/core.js",
  "./src/engine/runtime.js",
  "./src/engine/evidence.js",
  "./src/engine/intelligence.js",
  "./src/data/sources.js",
);

const engine = self.OracleBrowserEngine;
const core = self.FantasyOracleCore;
const intelligence = self.OraclePlayerIntelligence;
const sources = self.OracleSources;
const historyCache = new Map();

function withoutSamples(result) {
  if (!result?.playerSamples) return result;
  const { playerSamples, ...rest } = result;
  return rest;
}

async function loadHistorySeason(season) {
  const selected = Math.round(Number(season || 2025));
  let cached = historyCache.get(selected);
  if (cached) return { selected, cached };
  const started = performance.now();
  const loaded = await sources.nflversePlayerWeeklyText(selected);
  const rows = intelligence.parseWeeklyStatsCsv(loaded.text);
  cached = {
    index: intelligence.indexWeeklyRows(rows),
    source: { name: loaded.name, bytes: loaded.bytes, compressed: loaded.compressed, rowCount: rows.length, loadMs: performance.now() - started },
  };
  historyCache.set(selected, cached);
  return { selected, cached };
}

function historyProfile(cached, player, includeGameLog = false, options = {}) {
  const gameLog = intelligence.findPlayerRows(cached.index, player, { seasonType: "REG" });
  const summary = intelligence.summarizeHistory(gameLog);
  return {
    ...(includeGameLog ? { gameLog } : {}),
    summary,
    evidence: intelligence.historyEvidence(summary, player, options),
  };
}

async function playerHistory(player, season, targetSeason) {
  const { selected, cached } = await loadHistorySeason(season);
  const options = { historySeason: selected, targetSeason: Number(targetSeason || selected) };
  return { version: intelligence.VERSION, season: selected, source: cached.source, defenseProfiles: cached.index.defenseProfiles, ...historyProfile(cached, player, true, options) };
}

async function playerHistoryBatch(players, season, targetSeason) {
  const { selected, cached } = await loadHistorySeason(season);
  const options = { historySeason: selected, targetSeason: Number(targetSeason || selected) };
  const histories = {};
  for (const player of players || []) {
    if (!player?.id) continue;
    histories[String(player.id)] = historyProfile(cached, player, false, options);
  }
  return { version: intelligence.VERSION, season: selected, source: cached.source, defenseProfiles: cached.index.defenseProfiles, histories };
}

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  const requestId = message.requestId;
  try {
    let result;
    switch (message.type) {
      case "forecast": result = engine.forecastPlayers(message.players || [], message.options || {}); break;
      case "scenario": result = withoutSamples(engine.simulateForecasts(message.forecasts || [], message.options || {})); break;
      case "portfolio": result = engine.evaluatePortfolios(message.forecasts || [], message.portfolios || [], message.options || {}); break;
      case "season": result = engine.simulateRosterSeason(message.options || {}); break;
      case "league": result = engine.simulateLeague(message.options || {}); break;
      case "championship-actions": result = engine.evaluateChampionshipActions(message.options || {}); break;
      case "trade-proposals": result = core.generateTradeProposals(message.options || {}); break;
      case "player-history": result = await playerHistory(message.player, message.season, message.targetSeason); break;
      case "player-history-batch": result = await playerHistoryBatch(message.players || [], message.season, message.targetSeason); break;
      case "waivers":
        result = core.waiverRecommendations(message.roster || [], message.freeAgents || [], message.settings || {}, message.limit || 12, message.week || null);
        break;
      case "draft-window": result = core.simulatePickWindow(message.options || {}); break;
      default: throw new RangeError(`Unknown worker task: ${message.type}`);
    }
    self.postMessage({ type: "result", requestId, result });
  } catch (error) {
    self.postMessage({
      type: "error", requestId,
      error: error?.message || String(error),
      stack: error?.stack || null,
    });
  }
});

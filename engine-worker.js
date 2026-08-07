"use strict";

importScripts(
  "./src/engine/core.js",
  "./src/engine/rookies.js",
  "./src/engine/runtime.js",
  "./src/engine/evidence.js",
  "./src/engine/intelligence.js",
  "./src/engine/live-intelligence.js",
  "./src/engine/draft-sim.js",
  "./src/data/sources.js",
);

const engine = self.OracleBrowserEngine;
const core = self.FantasyOracleCore;
const intelligence = self.OraclePlayerIntelligence;
const live = self.OracleLiveIntelligence;
const draftSim = self.OracleDraftSim;
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
  let xfpIndex = null;
  let xfpSource = null;
  try {
    const xfp = await sources.bundledXfpWeeklyText(selected);
    const xfpRows = intelligence.parseXfpWeeklyCsv(xfp.text);
    xfpIndex = intelligence.indexXfpRows(xfpRows);
    xfpSource = { name: xfp.name, bytes: xfp.bytes, rowCount: xfpRows.length };
  } catch (_) { /* xFP is optional for seasons without a bundled artifact */ }
  cached = {
    index: intelligence.indexWeeklyRows(rows),
    xfpIndex, xfpSource,
    source: { name: loaded.name, bytes: loaded.bytes, compressed: loaded.compressed, rowCount: rows.length, loadMs: performance.now() - started },
  };
  historyCache.set(selected, cached);
  return { selected, cached };
}

function historyProfile(cached, player, includeGameLog = false, options = {}) {
  const gameLog = intelligence.findPlayerRows(cached.index, player, { seasonType: "REG" });
  const summary = intelligence.summarizeHistory(gameLog);
  const xfpRows = cached.xfpIndex ? intelligence.findXfpRows(cached.xfpIndex, player) : [];
  const xfpSummary = intelligence.summarizeXfp(xfpRows);
  const gap = Math.max(0, Number(options.targetSeason || 0) - Number(options.historySeason || 0));
  const confidenceMultiplier = gap === 0 ? 1 : gap === 1 ? 0.65 : 0.45;
  return {
    ...(includeGameLog ? { gameLog } : {}),
    summary, xfpSummary,
    evidence: {
      ...intelligence.historyEvidence(summary, player, options),
      ...intelligence.xfpEvidence(xfpSummary, player, { confidenceMultiplier }),
    },
  };
}

async function playerHistory(player, season, targetSeason) {
  const { selected, cached } = await loadHistorySeason(season);
  const options = { historySeason: selected, targetSeason: Number(targetSeason || selected) };
  return { version: intelligence.VERSION, season: selected, source: cached.source, xfpSource: cached.xfpSource, defenseProfiles: cached.index.defenseProfiles, ...historyProfile(cached, player, true, options) };
}

async function playerHistoryBatch(players, season, targetSeason) {
  const { selected, cached } = await loadHistorySeason(season);
  const options = { historySeason: selected, targetSeason: Number(targetSeason || selected) };
  const histories = {};
  for (const player of players || []) {
    if (!player?.id) continue;
    histories[String(player.id)] = historyProfile(cached, player, false, options);
  }
  return { version: intelligence.VERSION, season: selected, source: cached.source, xfpSource: cached.xfpSource, defenseProfiles: cached.index.defenseProfiles, histories };
}

async function preseasonSync(options = {}) {
  const season = Math.round(Number(options.season || 2026));
  const maxWeek = Math.max(1, Math.min(5, Math.round(Number(options.maxWeek || 5))));
  const scoreboards = await Promise.allSettled(Array.from({ length: maxWeek }, (_, index) => sources.espnNflScoreboard(season, 1, index + 1)));
  const events = [];
  for (const result of scoreboards) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value?.events || []) {
      const completed = event?.status?.type?.completed === true || String(event?.status?.type?.name || "").includes("FINAL");
      if (completed && event?.id) events.push(event);
    }
  }
  const unique = [...new Map(events.map((event) => [String(event.id), event])).values()]
    .sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0)).slice(0, Math.max(1, Math.min(24, Number(options.maxGames || 20))));
  const rows = [];
  for (let offset = 0; offset < unique.length; offset += 4) {
    const summaries = await Promise.allSettled(unique.slice(offset, offset + 4).map((event) => sources.espnNflSummary(event.id)));
    for (const result of summaries) if (result.status === "fulfilled") rows.push(...live.parseEspnPreseasonSummary(result.value));
  }
  return { version: live.VERSION, season, games: unique.length, rows };
}

async function marketWeek(options = {}) {
  const season = Math.round(Number(options.season || 2026));
  const week = Math.round(Number(options.week || 1));
  const scoreboard = await sources.espnNflScoreboard(season, 2, week);
  return { version: live.VERSION, season, week, byTeam: live.parseEspnMarketScoreboard(scoreboard) };
}

async function newsPulse(players = []) {
  const [news, adds, drops] = await Promise.allSettled([sources.espnNflNews(50), sources.loadSleeperTrending("add", 24, 50), sources.loadSleeperTrending("drop", 24, 50)]);
  return {
    version: live.VERSION,
    articles: news.status === "fulfilled" ? live.extractNewsPulse(news.value, players) : [],
    trendingAdds: adds.status === "fulfilled" ? adds.value : [],
    trendingDrops: drops.status === "fulfilled" ? drops.value : [],
  };
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
      case "draft-room-advance": result = draftSim.advanceToUser(message.options || {}); break;
      case "draft-room-window": result = draftSim.simulatePickWindow(message.options || {}); break;
      case "draft-benchmark": result = draftSim.benchmarkStrategies(message.options || {}); break;
      case "draft-full": result = draftSim.simulateDraft(message.options || {}); break;
      case "preseason-sync": result = await preseasonSync(message.options || {}); break;
      case "news-pulse": result = await newsPulse(message.players || []); break;
      case "market-week": result = await marketWeek(message.options || {}); break;
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

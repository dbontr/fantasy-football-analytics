"use strict";

importScripts(
  "./src/engine/core.js",
  "./src/engine/runtime.js",
  "./src/engine/evidence.js",
);

const engine = self.OracleBrowserEngine;
const core = self.FantasyOracleCore;

function withoutSamples(result) {
  if (!result?.playerSamples) return result;
  const { playerSamples, ...rest } = result;
  return rest;
}

self.addEventListener("message", (event) => {
  const message = event.data || {};
  const requestId = message.requestId;
  try {
    let result;
    switch (message.type) {
      case "forecast":
        result = engine.forecastPlayers(message.players || [], message.options || {});
        break;
      case "scenario":
        result = withoutSamples(engine.simulateForecasts(message.forecasts || [], message.options || {}));
        break;
      case "portfolio":
        result = engine.evaluatePortfolios(message.forecasts || [], message.portfolios || [], message.options || {});
        break;
      case "season":
        result = engine.simulateRosterSeason(message.options || {});
        break;
      case "league":
        result = engine.simulateLeague(message.options || {});
        break;
      case "championship-actions":
        result = engine.evaluateChampionshipActions(message.options || {});
        break;
      case "trade-proposals":
        result = core.generateTradeProposals(message.options || {});
        break;
      case "waivers":
        result = core.waiverRecommendations(
          message.roster || [],
          message.freeAgents || [],
          message.settings || {},
          message.limit || 12,
          message.week || null,
        );
        break;
      case "draft-window":
        result = core.simulatePickWindow(message.options || {});
        break;
      default:
        throw new RangeError(`Unknown worker task: ${message.type}`);
    }
    self.postMessage({ type: "result", requestId, result });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      error: error?.message || String(error),
      stack: error?.stack || null,
    });
  }
});

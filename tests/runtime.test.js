"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../src/engine/runtime.js");

function makePlayer(id, position, team, mean, extra = {}) {
  return {
    id: String(id),
    name: `Player ${id}`,
    position,
    team,
    projectedPoints: mean * 17,
    weeklyProjection: mean,
    weeklyProjections: Array(18).fill(mean),
    floorProjection: mean * 0.55,
    ceilingProjection: mean * 1.6,
    projectionStdDev: mean * 0.4,
    reliability: 0.8,
    injuryStatus: "ACTIVE",
    injuryRisk: 0.08,
    active: true,
    opportunity: {
      modelEdge: 0.03,
      usageTrend: 0.02,
      volumeStability: 0.8,
      reliability: 0.78,
      targetShare: position === "WR" ? 0.23 : 0.1,
      carryShare: position === "RB" ? 0.52 : 0.05,
    },
    ...extra,
  };
}

const player = makePlayer("wr1", "WR", "DET", 16);

test("forecast produces ordered zero-inflated distribution", () => {
  const forecast = engine.forecastPlayer(player, { week: 1 });
  assert.ok(forecast.distribution.p10 <= forecast.distribution.p50);
  assert.ok(forecast.distribution.p50 <= forecast.distribution.p90);
  assert.ok(forecast.availability.probability > 0.9);
  assert.ok(forecast.distribution.mean > 0);
});

test("bye week forecast is zero", () => {
  const forecast = engine.forecastPlayer({ ...player, byeWeek: 4 }, { week: 4 });
  assert.equal(forecast.distribution.mean, 0);
  assert.equal(forecast.availability.probability, 0);
});

test("scenario simulation is deterministic for a seed", () => {
  const forecasts = [
    engine.forecastPlayer(makePlayer("qb", "QB", "DET", 20), { week: 1 }),
    engine.forecastPlayer(makePlayer("wr", "WR", "DET", 15), { week: 1 }),
  ];
  const options = { week: 1, scenarios: 500, seed: "fixed", correlationPairs: [["qb", "wr"]] };
  const first = engine.simulateForecasts(forecasts, options);
  const second = engine.simulateForecasts(forecasts, options);
  assert.equal(first.playerSummaries.qb.mean, second.playerSummaries.qb.mean);
  assert.equal(first.correlations[0].correlation, second.correlations[0].correlation);
});

test("robust ranking prefers consistently stronger action", () => {
  const result = engine.rankPairedActions([
    { id: "a", samples: [10, 11, 12, 11, 10] },
    { id: "b", samples: [13, 14, 15, 14, 13] },
  ]);
  assert.equal(result.preferredActionId, "b");
  assert.ok(result.paretoFrontier.includes("b"));
});

test("league simulation awards exactly one championship per scenario", () => {
  const positions = ["QB", "RB", "RB", "WR", "WR", "TE", "DST", "K"];
  const teams = Array.from({ length: 4 }, (_, teamIndex) => ({
    teamId: String(teamIndex + 1),
    name: `Team ${teamIndex + 1}`,
    roster: positions.map((position, playerIndex) => makePlayer(
      `${teamIndex + 1}-${playerIndex}`,
      position,
      ["DET", "GB", "MIN", "CHI"][teamIndex],
      8 + playerIndex + teamIndex * 0.3,
    )),
  }));
  const result = engine.simulateLeague({
    teams,
    startWeek: 1,
    regularSeasonEnd: 2,
    championshipWeek: 4,
    playoffTeams: 4,
    simulations: 300,
    seed: "league-test",
  });
  const total = result.teams.reduce((sum, row) => sum + row.championshipProbability, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.equal(result.teams.length, 4);
});

test("online ensemble weights penalize higher loss", () => {
  const result = engine.updateEnsembleWeights({ modelA: 0.5, modelB: 0.5 }, { modelA: 2, modelB: 0.5 });
  assert.ok(result.modelB > result.modelA);
  assert.ok(Math.abs(result.modelA + result.modelB - 1) < 1e-12);
});

test("position-specific matchup prior moves forecasts in the expected direction", () => {
  const neutral = engine.forecastPlayer(player, { week: 1 });
  const favorable = engine.forecastPlayer(player, { week: 1, evidence: { "matchup.position_grade": { available: true, value: 1, confidence: 0.4, conflict: 0 } } });
  const difficult = engine.forecastPlayer(player, { week: 1, evidence: { "matchup.position_grade": { available: true, value: -1, confidence: 0.4, conflict: 0 } } });
  assert.ok(favorable.distribution.mean > neutral.distribution.mean);
  assert.ok(difficult.distribution.mean < neutral.distribution.mean);
  assert.ok(favorable.drivers.some((row) => row.feature === "matchup.position_grade"));
});


test("xFP, redistribution, and preseason evidence remain bounded forecast drivers", () => {
  const base = engine.forecastPlayer(player, { week: 1 });
  const enhanced = engine.forecastPlayer(player, { week: 1, evidence: {
    "opportunity.xfp": { available: true, value: 22, confidence: 0.32 },
    "efficiency.fpoe": { available: true, value: 4, confidence: 0.22 },
    "role.redistribution_delta": { available: true, value: 0.2, confidence: 0.42 },
    "preseason.usage_boost": { available: true, value: 0.2, confidence: 0.2 },
  } });
  assert.ok(enhanced.distribution.mean > base.distribution.mean);
  assert.ok(enhanced.drivers.some((row) => row.feature === "opportunity.xfp"));
  assert.ok(enhanced.drivers.some((row) => row.feature === "preseason.usage_boost"));
  assert.ok(enhanced.distribution.mean < base.distribution.mean * 1.7);
});

test("live scoring environment nudges offensive projections without dominating them", () => {
  const base = engine.forecastPlayer(player, { week: 1 });
  const high = engine.forecastPlayer(player, { week: 1, evidence: {
    "market.game_total": { available: true, value: 52, confidence: 0.42 },
    "market.team_implied_points": { available: true, value: 29, confidence: 0.46 },
  } });
  assert.ok(high.distribution.mean > base.distribution.mean);
  assert.ok(high.drivers.some((row) => row.feature === "market.team_implied_points"));
  assert.ok(high.distribution.mean < base.distribution.mean * 1.25);
});

test("cached scenario factors preserve stronger same-game correlation than unrelated players", () => {
  const forecasts = [
    engine.forecastPlayer(makePlayer("corr-qb", "QB", "DET", 20), { week: 1 }),
    engine.forecastPlayer(makePlayer("corr-wr", "WR", "DET", 15), { week: 1 }),
    engine.forecastPlayer(makePlayer("corr-other", "WR", "GB", 15), { week: 1 }),
  ];
  const result = engine.simulateForecasts(forecasts, {
    week: 1,
    scenarios: 5000,
    seed: "factor-cache-correlation",
    correlationPairs: [["corr-qb", "corr-wr"], ["corr-qb", "corr-other"]],
  });
  const sameGame = result.correlations[0].correlation;
  const unrelated = result.correlations[1].correlation;
  assert.ok(sameGame > 0.15);
  assert.ok(sameGame > unrelated + 0.12);
});

test("replacement QB context lowers pass-catcher mean with an explicit driver", () => {
  const base = engine.forecastPlayer(player, { week: 1 });
  const adjusted = engine.forecastPlayer(player, { week: 1, evidence: {
    "context.qb_replacement_delta": { available: true, value: -0.05, confidence: 1, conflict: 0.1 },
  } });
  assert.ok(adjusted.distribution.mean < base.distribution.mean);
  assert.ok(adjusted.drivers.some((row) => row.feature === "context.qb_replacement_delta"));
});

test("context-only coaching metadata cannot move the forecast mean", () => {
  const base = engine.forecastPlayer(player, { week: 1 });
  const contextual = engine.forecastPlayer(player, { week: 1, evidence: {
    "coaching.staff_context": { available: true, value: 1, confidence: 0.9, newStaff: true },
  } });
  assert.equal(contextual.distribution.mean, base.distribution.mean);
  assert.equal(contextual.drivers.some((row) => row.family === "coaching"), false);
});
test("live ESPN PPR anchor preserves expected mean when availability is already priced", () => {
  const live = makePlayer("live-qb", "QB", "DET", 20, { projectionSource: "espn-live-ppr" });
  const forecast = engine.forecastPlayer(live, { week: 1, evidence: {
    "health.active_probability": { available: true, value: 0.5, confidence: 1, conflict: 0 },
  } });
  assert.ok(Math.abs(forecast.distribution.mean - 20) < 1e-9);
  assert.ok(Math.abs(forecast.activeDistribution.mean - 20 / forecast.availability.probability) < 1e-9);
  assert.ok(forecast.availability.probability < 0.7);
});

test("decision scale zero keeps live PPR mean anchored while retaining uncertainty", () => {
  const live = makePlayer("live-rb", "RB", "DET", 15, { projectionSource: "espn-live-ppr" });
  const evidence = {
    "matchup.position_grade": { available: true, value: 1, confidence: 1 },
    "efficiency.fpoe": { available: true, value: 3, confidence: 1 },
  };
  const playerView = engine.forecastPlayer(live, { week: 1, evidence });
  const decisionView = engine.forecastPlayer(live, { week: 1, evidence, validatedMeanScale: 0 });
  assert.notEqual(playerView.distribution.mean, 15);
  assert.ok(Math.abs(decisionView.distribution.mean - 15) < 1e-9);
  assert.ok(decisionView.distribution.standardDeviation > 0);
});

test("static fallback keeps legacy evidence behavior", () => {
  const fallback = makePlayer("fallback-rb", "RB", "DET", 15);
  const forecast = engine.forecastPlayer(fallback, { week: 1, evidence: {
    "matchup.position_grade": { available: true, value: 1, confidence: 1 },
  }, validatedMeanScale: 0 });
  assert.ok(forecast.distribution.mean > 15);
});

test("future-win action evaluator uses the supplied opponent schedule and symmetric trades", () => {
  const settings = { slots: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, DST: 0, K: 0, BN: 1 } };
  const userQb = makePlayer("user-qb", "QB", "DET", 10, { projectionStdDev: 1.5 });
  const rivalQb = makePlayer("rival-qb", "QB", "GB", 20, { projectionStdDev: 1.5 });
  const thirdQb = makePlayer("third-qb", "QB", "MIN", 13, { projectionStdDev: 1.5 });
  const teams = [
    { teamId: "1", name: "Us", roster: [userQb] },
    { teamId: "2", name: "Rival", roster: [rivalQb] },
    { teamId: "3", name: "Third", roster: [thirdQb] },
  ];
  const options = {
    teams,
    userTeamId: "1",
    settings,
    startWeek: 1,
    regularSeasonEnd: 2,
    fantasySchedule: { 1: [["1", "2"]], 2: [["1", "3"]] },
    simulations: 2500,
    seed: "future-win-symmetric",
    actions: [{ id: "trade-up", type: "trade", opponentTeamId: "2", sendPlayerIds: ["user-qb"], receivePlayerIds: ["rival-qb"] }],
  };
  const first = engine.evaluateFutureWinActions(options);
  const second = engine.evaluateFutureWinActions(options);
  assert.deepEqual(first, second);
  assert.equal(first.objective, "maximize-future-head-to-head-wins");
  assert.equal(first.preferredActionId, "trade-up");
  const hold = first.actions.find((row) => row.id === "hold");
  const trade = first.actions.find((row) => row.id === "trade-up");
  assert.ok(trade.outcome.expectedFutureHeadToHeadWins > hold.outcome.expectedFutureHeadToHeadWins + 0.5);
  assert.ok(trade.outcome.matchupWinProbabilities.some((row) => row.week === 1 && row.opponentTeamId === "2"));
  assert.ok(trade.opponentOutcome.averageMatchupWinProbability < hold.opponents["2"].averageMatchupWinProbability);
  assert.ok(trade.delta.expectedFutureHeadToHeadWins95[0] > 0);
});

test("opponent-aware lineup can prefer upside when maximizing matchup win probability", () => {
  const settings = { slots: { QB: 0, RB: 0, WR: 1, TE: 0, FLEX: 0, SUPERFLEX: 0, DST: 0, K: 0, BN: 2 } };
  const safe = makePlayer("safe", "WR", "DET", 10, { projectionStdDev: 1.2, reliability: 0.95 });
  const upside = makePlayer("upside", "WR", "GB", 9, { projectionStdDev: 10, reliability: 0.7 });
  const opponent = makePlayer("opp", "WR", "MIN", 15, { projectionStdDev: 1.4, reliability: 0.95 });
  const result = engine.evaluateMatchupLineups({
    userRoster: [safe, upside],
    opponentRoster: [opponent],
    settings,
    week: 1,
    scenarios: 5000,
    seed: "matchup-upside",
  });
  assert.equal(result.baseline.starterIds[0], "safe");
  assert.equal(result.preferred.starterIds[0], "upside");
  assert.ok(result.preferred.winProbability > result.baseline.winProbability);
  assert.ok(result.evaluationScenarios >= 3000);
});


test("opponent-aware lineup cannot move a player out of a locked current slot", () => {
  const settings = { slots: { QB: 0, RB: 0, WR: 1, TE: 0, FLEX: 0, SUPERFLEX: 0, DST: 0, K: 0, BN: 2 } };
  const safe = makePlayer("locked-safe", "WR", "DET", 10, { projectionStdDev: 1.2, reliability: 0.95 });
  const upside = makePlayer("locked-upside", "WR", "GB", 9, { projectionStdDev: 10, reliability: 0.7 });
  const opponent = makePlayer("locked-opp", "WR", "MIN", 15, { projectionStdDev: 1.4, reliability: 0.95 });
  const result = engine.evaluateMatchupLineups({
    userRoster: [safe, upside], opponentRoster: [opponent], settings, week: 1,
    scenarios: 3000, seed: "matchup-locked-current-slot",
    userLineupConstraints: { lockedAssignments: [{ playerId: "locked-safe", slot: "WR" }] },
  });
  assert.deepEqual(result.baseline.starterIds, ["locked-safe"]);
  assert.deepEqual(result.preferred.starterIds, ["locked-safe"]);
  assert.equal(result.winProbabilityGain, 0);
});

test("future-win evaluator applies current-week lineup constraints without changing future weeks", () => {
  const settings = { slots: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, DST: 0, K: 0, BN: 1 } };
  const weak = makePlayer("constraint-weak", "QB", "DET", 5, { projectionStdDev: 0.5 });
  const strong = makePlayer("constraint-strong", "QB", "GB", 25, { projectionStdDev: 0.5 });
  const rival = makePlayer("constraint-rival", "QB", "MIN", 15, { projectionStdDev: 0.5 });
  const result = engine.evaluateFutureWinActions({
    teams: [{ teamId: "1", roster: [weak, strong] }, { teamId: "2", roster: [rival] }],
    userTeamId: "1", settings, startWeek: 1, regularSeasonEnd: 2,
    fantasySchedule: { 1: [["1", "2"]], 2: [["1", "2"]] }, simulations: 1200, seed: "future-lock-constraint",
    lineupConstraintsByTeamWeek: { 1: { 1: { lockedAssignments: [{ playerId: "constraint-weak", slot: "QB" }] } } },
  });
  const hold = result.actions.find((row) => row.id === "hold");
  assert.equal(hold.outcome.futureHeadToHeadGames, 2);
  assert.ok(hold.outcome.matchupWinProbabilities.find((row) => row.week === 1).winProbability < 0.1);
  assert.ok(hold.outcome.matchupWinProbabilities.find((row) => row.week === 2).winProbability > 0.9);
});

test("final live score overrides forecast uncertainty exactly", () => {
  const player = makePlayer("finished-player", "WR", "DET", 18, { projectionStdDev: 7 });
  const forecast = engine.forecastPlayer(player, { week: 1 });
  const [settled] = engine.applyFinalScores([forecast], { "finished-player": 27.4 });
  assert.equal(settled.distribution.mean, 27.4);
  assert.equal(settled.distribution.p10, 27.4);
  assert.equal(settled.distribution.p90, 27.4);
  assert.equal(settled.distribution.standardDeviation, 0);
  assert.equal(settled.availability.probability, 1);
  assert.equal(settled.finalScoreApplied, true);
});

test("future-win actions can apply a trade between two other teams while evaluating the user", () => {
  const settings = { slots: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, DST: 0, K: 0, BN: 1 } };
  const user = makePlayer("observer-qb", "QB", "DET", 15, { projectionStdDev: 0.5 });
  const strong = makePlayer("actor-strong", "QB", "GB", 24, { projectionStdDev: 0.5 });
  const weak = makePlayer("partner-weak", "QB", "MIN", 7, { projectionStdDev: 0.5 });
  const result = engine.evaluateFutureWinActions({
    teams: [{ teamId: "1", roster: [user] }, { teamId: "2", roster: [strong] }, { teamId: "3", roster: [weak] }],
    userTeamId: "1", settings, startWeek: 1, regularSeasonEnd: 2,
    fantasySchedule: { 1: [["1", "2"]], 2: [["1", "3"]] }, simulations: 1200, seed: "third-party-trade",
    actions: [{ id: "others-trade", type: "trade", actorTeamId: "2", opponentTeamId: "3", sendPlayerIds: ["actor-strong"], receivePlayerIds: ["partner-weak"] }],
  });
  const hold = result.actions.find((row) => row.id === "hold");
  const trade = result.actions.find((row) => row.id === "others-trade");
  assert.equal(trade.action.actorTeamId, "2");
  assert.ok(trade.outcome.matchupWinProbabilities.find((row) => row.week === 1).winProbability > hold.outcome.matchupWinProbabilities.find((row) => row.week === 1).winProbability);
  assert.ok(trade.outcome.matchupWinProbabilities.find((row) => row.week === 2).winProbability < hold.outcome.matchupWinProbabilities.find((row) => row.week === 2).winProbability);
});

test("future-win robustness recommends only a positive lower-bound action", () => {
  const hold = { id: "hold", action: { type: "none" }, delta: { expectedFutureHeadToHeadWins: 0, expectedFutureHeadToHeadWins95: [0, 0] } };
  const noisy = { id: "noisy", action: { type: "waiver" }, delta: { expectedFutureHeadToHeadWins: 0.18, expectedFutureHeadToHeadWins95: [-0.03, 0.39] } };
  const robust = { id: "robust", action: { type: "trade" }, delta: { expectedFutureHeadToHeadWins: 0.14, expectedFutureHeadToHeadWins95: [0.02, 0.26] } };
  assert.equal(engine.futureWinRobustness(noisy).status, "uncertain-positive");
  assert.equal(engine.futureWinRobustness(robust).status, "recommend");
  assert.equal(engine.selectRobustFutureWinAction([noisy, hold, robust]).id, "robust");
});

test("future-win robustness defaults to HOLD when no changed action clears uncertainty", () => {
  const rows = [
    { id: "hold", action: { type: "none" }, delta: { expectedFutureHeadToHeadWins: 0, expectedFutureHeadToHeadWins95: [0, 0] } },
    { id: "waiver", action: { type: "waiver" }, delta: { expectedFutureHeadToHeadWins: 0.08, expectedFutureHeadToHeadWins95: [-0.01, 0.17] } },
    { id: "trade", action: { type: "trade" }, delta: { expectedFutureHeadToHeadWins: -0.04, expectedFutureHeadToHeadWins95: [-0.12, 0.04] } },
  ];
  assert.equal(engine.selectRobustFutureWinAction(rows).id, "hold");
});

test("opponent-aware lineup consumes nested current-week final scores", () => {
  const settings = { slots: { QB: 0, RB: 0, WR: 1, TE: 0, FLEX: 0, SUPERFLEX: 0, DST: 0, K: 0, BN: 0 } };
  const user = makePlayer("final-user", "WR", "DET", 8, { projectionStdDev: 6 });
  const opponent = makePlayer("final-opp", "WR", "GB", 20, { projectionStdDev: 6 });
  const result = engine.evaluateMatchupLineups({
    userRoster: [user], opponentRoster: [opponent], settings, week: 1, scenarios: 1200, seed: "nested-final-score",
    finalScoresByTeamWeek: { 1: { 1: { "final-user": 27.4 }, 2: { "final-opp": 10.1 } } },
  });
  assert.ok(Math.abs(result.baseline.expectedPoints - 27.4) < 1e-4);
  assert.equal(result.baseline.winProbability, 1);
  assert.equal(result.preferred.winProbability, 1);
});

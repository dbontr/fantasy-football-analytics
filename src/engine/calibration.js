(function attachSnapCountCalibration(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.SnapCountCalibration = api;
    api.install(root.OracleBrowserEngine, root.OraclePlayerIntelligence);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createSnapCountCalibration() {
  "use strict";

  const VERSION = "snapcount-calibration-2026.1";
  const TRAINING_SEASONS = Object.freeze([2023, 2024]);
  const HOLDOUT_SEASON = 2025;
  const SHRINKAGE_GAMES = 8;
  const BINS = Object.freeze([0, 6, 10, 14, 18, Infinity]);

  // Derived only from bundled 2023-2024 nflverse REG player-week results.
  // For each player-season with >=6 games and >=2 PPR/game, compute weekly
  // coefficient of variation, then take a position/PPG-bin median and shrink
  // it toward the position median with 8 pseudo-observations. 2025 is held out.
  const EMPIRICAL_CV = Object.freeze({
    QB: Object.freeze([0.712, 0.615, 0.566, 0.446, 0.415]),
    RB: Object.freeze([0.959, 0.706, 0.562, 0.530, 0.567]),
    WR: Object.freeze([0.962, 0.694, 0.616, 0.555, 0.566]),
    TE: Object.freeze([0.910, 0.690, 0.647, 0.644, 0.771]),
  });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }

  function binIndex(mean) {
    const value = Math.max(0, finite(mean));
    for (let index = 0; index < BINS.length - 1; index += 1) {
      if (value >= BINS[index] && value < BINS[index + 1]) return index;
    }
    return BINS.length - 2;
  }

  function empiricalCv(position, weeklyMean) {
    const rows = EMPIRICAL_CV[String(position || "").toUpperCase()];
    if (!rows) return null;
    // The cap is a regularization guard for tiny projected means; it is not a
    // fitted 2025 parameter. Low-end fantasy scorers remain very volatile.
    return clamp(rows[binIndex(weeklyMean)], 0.32, 0.90);
  }

  function historicalVolatilityEvidence(summary, options = {}) {
    const games = finite(summary?.season?.games);
    const ppr = finite(summary?.season?.ppr, NaN);
    const volatility = finite(summary?.season?.volatility, NaN);
    if (games < 5 || !Number.isFinite(ppr) || ppr < 1 || !Number.isFinite(volatility)) return null;
    const historySeason = Number(options.historySeason || options.season || 0);
    const targetSeason = Number(options.targetSeason || historySeason || 0);
    const seasonGap = Math.max(0, targetSeason - historySeason);
    const recency = seasonGap === 0 ? 1 : seasonGap === 1 ? 0.65 : 0.45;
    return {
      available: true,
      value: clamp(volatility / Math.max(2, ppr), 0.12, 1.40),
      confidence: clamp((0.28 + Math.min(12, games) / 12 * 0.42) * recency, 0.12, 0.70),
      conflict: 0,
      source: seasonGap ? "nflverse prior-season realized volatility" : "nflverse current-season realized volatility",
      games,
    };
  }

  function calibratedCv(player, evidence = {}) {
    const mean = Math.max(0.1, finite(player?.weeklyProjection, finite(player?.projectedPoints) / 17));
    const floor = empiricalCv(player?.position, mean);
    if (floor === null) return null;
    const current = finite(player?.projectionStdDev, 0) / mean;
    let target = Math.max(floor, current);
    const history = evidence?.["uncertainty.volatility_cv"];
    if (history && history.available !== false) {
      const observed = clamp(history.value, 0.12, 1.40);
      const weight = clamp(history.confidence, 0, 1) * 0.45;
      // Player history can widen a forecast when the individual is more
      // volatile than the empirical cohort. It cannot make the cohort floor
      // narrower until that shrinkage direction is validated out of sample.
      if (observed > target) target += (observed - target) * weight;
    }
    return clamp(target, 0.20, 1.10);
  }

  function calibratePlayer(player, evidence = {}) {
    if (!player || typeof player !== "object") return player;
    const position = String(player.position || "").toUpperCase();
    if (!EMPIRICAL_CV[position]) return player;
    const mean = Math.max(0.1, finite(player.weeklyProjection, finite(player.projectedPoints) / 17));
    const targetCv = calibratedCv(player, evidence);
    if (targetCv === null) return player;
    const existing = Math.max(0, finite(player.projectionStdDev));
    const targetStdDev = mean * targetCv;
    if (existing >= targetStdDev - 1e-9) return player;
    return {
      ...player,
      projectionStdDev: targetStdDev,
      uncertaintyCalibration: {
        version: VERSION,
        empiricalCv: empiricalCv(position, mean),
        calibratedCv: targetCv,
        previousStdDev: existing,
        source: "nflverse 2023-2024 walk-forward uncertainty prior",
      },
    };
  }

  function calibrateTeams(teams, evidenceByPlayer = {}) {
    if (!Array.isArray(teams)) return teams;
    return teams.map((team) => ({
      ...team,
      roster: Array.isArray(team?.roster)
        ? team.roster.map((player) => calibratePlayer(player, evidenceByPlayer[String(player?.id)] || {}))
        : team?.roster,
    }));
  }

  function calibrateAction(action, evidenceByPlayer = {}) {
    if (!action || typeof action !== "object") return action;
    const next = { ...action };
    for (const key of ["player", "add", "drop", "give", "get", "addPlayer"]) {
      if (next[key] && typeof next[key] === "object" && next[key].position) {
        next[key] = calibratePlayer(next[key], evidenceByPlayer[String(next[key].id)] || {});
      }
    }
    for (const key of ["players", "adds", "drops", "givePlayers", "getPlayers", "receivePlayers"]) {
      if (Array.isArray(next[key])) next[key] = next[key].map((player) => calibratePlayer(player, evidenceByPlayer[String(player?.id)] || {}));
    }
    return next;
  }

  function install(engine, intelligence) {
    if (!engine || !intelligence) return false;
    if (engine.__snapCountCalibrationVersion === VERSION) return true;

    const originalHistoryEvidence = intelligence.historyEvidence.bind(intelligence);
    intelligence.historyEvidence = function calibratedHistoryEvidence(summary, player, options = {}) {
      const evidence = originalHistoryEvidence(summary, player, options) || {};
      const volatility = historicalVolatilityEvidence(summary, options);
      if (volatility) evidence["uncertainty.volatility_cv"] = volatility;
      return evidence;
    };

    const originalForecastPlayer = engine.forecastPlayer.bind(engine);
    engine.forecastPlayer = function calibratedForecastPlayer(player, options = {}) {
      return originalForecastPlayer(calibratePlayer(player, options.evidence || {}), options);
    };
    engine.forecastPlayers = function calibratedForecastPlayers(players, options = {}) {
      const evidenceByPlayer = options.evidenceByPlayer || {};
      return (players || []).map((player) => engine.forecastPlayer(player, {
        ...options,
        evidence: evidenceByPlayer[String(player?.id)] || {},
      }));
    };

    const originalRosterSeason = engine.simulateRosterSeason.bind(engine);
    engine.simulateRosterSeason = function calibratedRosterSeason(options = {}) {
      const evidence = options.evidenceByPlayer || {};
      return originalRosterSeason({
        ...options,
        roster: (options.roster || []).map((player) => calibratePlayer(player, evidence[String(player?.id)] || {})),
      });
    };

    const originalLeague = engine.simulateLeague.bind(engine);
    engine.simulateLeague = function calibratedLeague(options = {}) {
      const evidence = options.evidenceByPlayer || {};
      return originalLeague({ ...options, teams: calibrateTeams(options.teams, evidence) });
    };

    const originalChampionshipActions = engine.evaluateChampionshipActions.bind(engine);
    engine.evaluateChampionshipActions = function calibratedChampionshipActions(options = {}) {
      const evidence = options.evidenceByPlayer || {};
      return originalChampionshipActions({
        ...options,
        teams: calibrateTeams(options.teams, evidence),
        actions: (options.actions || []).map((action) => calibrateAction(action, evidence)),
      });
    };

    if (typeof engine.evaluateFutureWinActions === "function") {
      const originalFutureWinActions = engine.evaluateFutureWinActions.bind(engine);
      engine.evaluateFutureWinActions = function calibratedFutureWinActions(options = {}) {
        const evidence = options.evidenceByPlayer || {};
        return originalFutureWinActions({
          ...options,
          teams: calibrateTeams(options.teams, evidence),
          actions: (options.actions || []).map((action) => calibrateAction(action, evidence)),
        });
      };
    }
    if (typeof engine.evaluateMatchupLineups === "function") {
      const originalMatchupLineups = engine.evaluateMatchupLineups.bind(engine);
      engine.evaluateMatchupLineups = function calibratedMatchupLineups(options = {}) {
        const evidence = options.evidenceByPlayer || {};
        return originalMatchupLineups({
          ...options,
          userRoster: (options.userRoster || []).map((player) => calibratePlayer(player, evidence[String(player?.id)] || {})),
          opponentRoster: (options.opponentRoster || []).map((player) => calibratePlayer(player, evidence[String(player?.id)] || {})),
        });
      };
    }

    Object.defineProperty(engine, "__snapCountCalibrationVersion", { value: VERSION, configurable: false, enumerable: false });
    return true;
  }

  return {
    VERSION,
    TRAINING_SEASONS,
    HOLDOUT_SEASON,
    SHRINKAGE_GAMES,
    BINS,
    EMPIRICAL_CV,
    binIndex,
    empiricalCv,
    calibratedCv,
    calibratePlayer,
    historicalVolatilityEvidence,
    install,
  };
});

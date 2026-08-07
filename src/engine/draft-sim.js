(function attachOracleDraftSim(root, factory) {
  const core = typeof module !== "undefined" && module.exports
    ? require("./core.js")
    : root.FantasyOracleCore;
  const api = factory(core);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleDraftSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createDraftSim(core) {
  "use strict";

  const VERSION = "oracle-draft-sim-2026.1";
  const PROFILES = Object.freeze({
    "espn-market": { label: "ESPN market / ADP", market: 1.0, value: 0.05, need: 0.22, noise: 0.72 },
    balanced: { label: "Balanced market", market: 0.82, value: 0.18, need: 0.55, noise: 0.6 },
    value: { label: "Value / VORP", market: 0.48, value: 0.62, need: 0.35, noise: 0.42 },
    "need-heavy": { label: "Roster need heavy", market: 0.62, value: 0.18, need: 1.0, noise: 0.55 },
    "rb-heavy": { label: "RB-heavy", market: 0.72, value: 0.18, need: 0.45, noise: 0.58, RB: 12 },
    "wr-heavy": { label: "WR-heavy", market: 0.72, value: 0.18, need: 0.45, noise: 0.58, WR: 12 },
    "zero-rb": { label: "Zero-RB", market: 0.7, value: 0.22, need: 0.42, noise: 0.55, zeroRb: true },
    mixed: { label: "Mixed normal room", market: 0.78, value: 0.2, need: 0.48, noise: 0.75, mixed: true },
  });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }
  function normalizeName(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function hashSeed(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function seededRandom(seed) {
    let value = hashSeed(seed) || 1;
    return function random() {
      value += 0x6D2B79F5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gumbel(random) {
    const value = clamp(random(), 1e-9, 1 - 1e-9);
    return -Math.log(-Math.log(value));
  }

  function parseRankingBoard(text) {
    const input = String(text || "").trim();
    if (!input) return { rows: [], byId: {}, byName: {} };
    const lines = input.split(/\r?\n/).filter(Boolean);
    const delimiter = lines[0].includes("\t") ? "\t" : ",";
    const first = lines[0].split(delimiter).map((value) => value.trim().toLowerCase());
    const hasHeader = first.some((value) => ["name", "player", "rank", "adp", "id"].includes(value));
    const columns = hasHeader ? first : ["rank", "name"];
    const start = hasHeader ? 1 : 0;
    const rows = [];
    for (let index = start; index < lines.length; index += 1) {
      const values = lines[index].split(delimiter).map((value) => value.trim().replace(/^"|"$/g, ""));
      const row = Object.fromEntries(columns.map((column, columnIndex) => [column, values[columnIndex] || ""]));
      const name = row.name || row.player || row.player_name || row.full_name;
      const rank = Number(row.rank || row.adp || row.overall || (index - start + 1));
      if (!name || !Number.isFinite(rank) || rank <= 0) continue;
      rows.push({ id: String(row.id || row.player_id || ""), name, rank, normalizedName: normalizeName(name) });
    }
    rows.sort((a, b) => a.rank - b.rank);
    return {
      rows,
      byId: Object.fromEntries(rows.filter((row) => row.id).map((row) => [row.id, row.rank])),
      byName: Object.fromEntries(rows.map((row) => [row.normalizedName, row.rank])),
    };
  }

  function boardRank(player, settings, board = null) {
    const normalized = core.normalizePlayer(player);
    const imported = board?.byId?.[normalized.id] ?? board?.byName?.[normalizeName(normalized.name)];
    if (Number.isFinite(Number(imported))) return Number(imported);
    if (Number.isFinite(normalized.adp)) return normalized.adp;
    return core.rankForScoring(normalized, settings.scoring || "ppr") || 9999;
  }

  function rosterForTeam(state, teamId, byId) {
    return (state?.rosters?.[String(teamId)] || []).map((id) => byId.get(String(id))).filter(Boolean);
  }
  function positionCounts(roster) {
    return (roster || []).reduce((counts, player) => {
      counts[player.position] = finite(counts[player.position]) + 1;
      return counts;
    }, {});
  }
  function starterNeed(position, roster, settings) {
    const counts = positionCounts(roster);
    const direct = Math.max(0, finite(settings.slots?.[position]) - finite(counts[position]));
    if (!["RB", "WR", "TE"].includes(position)) return direct;
    const skill = finite(counts.RB) + finite(counts.WR) + finite(counts.TE);
    const directSkill = finite(settings.slots.RB) + finite(settings.slots.WR) + finite(settings.slots.TE);
    const flexNeed = Math.max(0, directSkill + finite(settings.slots.FLEX) - skill);
    return Math.max(direct, Math.min(1, flexNeed));
  }
  function effectiveProfile(strategy, seedKey) {
    const requested = PROFILES[strategy] || PROFILES["espn-market"];
    if (!requested.mixed) return requested;
    const names = ["espn-market", "balanced", "value", "need-heavy", "rb-heavy", "wr-heavy", "zero-rb"];
    return PROFILES[names[hashSeed(seedKey) % names.length]];
  }

  function createRoomContext(players, settings, board = null) {
    const config = core.cloneSettings(settings);
    const normalized = (players || []).map(core.normalizePlayer);
    const byId = new Map(normalized.map((player) => [player.id, player]));
    const replacement = core.computeReplacementLevels(normalized, config);
    const market = normalized.map((player) => ({
      player, rank: boardRank(player, config, board),
      asset: core.draftAssetValue(player, replacement, config),
    })).sort((a, b) => a.rank - b.rank || b.asset - a.asset);
    return { config, normalized, byId, replacement, market, board };
  }

  function oraclePolicyPick(context, state, teamId) {
    const drafted = new Set((state?.picks || []).map((pick) => String(pick.playerId)));
    const roster = rosterForTeam(state, teamId, context.byId);
    const pick = (state?.picks || []).length + 1;
    let best = null, bestScore = -Infinity;
    for (const row of context.market) {
      if (drafted.has(row.player.id)) continue;
      const need = starterNeed(row.player.position, roster, context.config);
      const pressure = clamp((pick - row.rank) * 0.32, -8, 11);
      let score = row.asset + need * 16 + pressure - row.player.injuryRisk * 11;
      if (["K", "DST"].includes(row.player.position) && pick < context.config.teams * 10) score -= 18;
      if (score > bestScore) { best = row.player; bestScore = score; }
    }
    return best ? { ...best, roomStrategy: "Oracle policy", roomScore: Number(bestScore.toFixed(2)) } : null;
  }

  function cpuPick(players, state, settings, teamId, options = {}) {
    const context = options.context || createRoomContext(players, settings, options.board || null);
    const config = context.config;
    const drafted = new Set((state?.picks || []).map((pick) => String(pick.playerId)));
    const roster = rosterForTeam(state, teamId, context.byId);
    const pickNumber = (state?.picks || []).length + 1;
    const profile = effectiveProfile(options.strategy || "espn-market", `${options.seed}:${teamId}`);
    const random = seededRandom(`${options.seed || 1}:${pickNumber}:${teamId}:${options.strategy || "market"}`);
    const candidates = context.market.filter((row) => !drafted.has(row.player.id)).slice(0, 96);
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const player = candidate.player;
      const rank = candidate.rank;
      const need = starterNeed(player.position, roster, config);
      const asset = candidate.asset;
      let score = -rank * profile.market + asset * profile.value + need * 11 * profile.need;
      score += finite(profile[player.position]);
      if (profile.zeroRb && player.position === "RB" && pickNumber <= config.teams * 5) score -= 13;
      if (["K", "DST"].includes(player.position) && pickNumber <= config.teams * Math.max(8, config.rounds - 5)) score -= 22;
      score += gumbel(random) * (3.2 + Math.sqrt(Math.max(1, rank)) * 0.35) * profile.noise;
      if (score > bestScore) { best = player; bestScore = score; }
    }
    return best ? { ...best, roomStrategy: profile.label, roomScore: Number(bestScore.toFixed(2)) } : null;
  }

  function cloneDraftState(state) {
    return {
      picks: [...(state?.picks || [])].map((pick) => ({ ...pick })),
      rosters: Object.fromEntries(Object.entries(state?.rosters || {}).map(([teamId, ids]) => [teamId, [...ids]])),
    };
  }

  function advanceToUser(options = {}) {
    const settings = core.cloneSettings(options.settings || {});
    const context = options.context || createRoomContext(options.players || [], settings, options.board || null);
    const userTeamId = Number(options.userTeamId || settings.draftPosition);
    let state = cloneDraftState(options.state || core.createDraftState(settings));
    const total = settings.teams * settings.rounds;
    let cpuPicks = 0;
    while (state.picks.length < total) {
      const summary = core.draftPickSummary(state, settings);
      if (Number(summary.teamId) === userTeamId) break;
      const selected = cpuPick(options.players || [], state, settings, summary.teamId, {
        strategy: options.strategy || "mixed",
        board: options.board || null,
        seed: options.seed || 1,
        context,
      });
      if (!selected) break;
      state = core.applyDraftPick(state, selected.id, settings);
      cpuPicks += 1;
    }
    return { state, cpuPicks, summary: core.draftPickSummary(state, settings) };
  }

  function chooseUserPick(players, state, settings, teamId, strategy, board, seed, context) {
    if (strategy === "oracle") return oraclePolicyPick(context || createRoomContext(players, settings, board), state, teamId);
    return cpuPick(players, state, settings, teamId, { strategy, board, seed, context });
  }

  function simulatePickWindow(options = {}) {
    const settings = core.cloneSettings(options.settings || {});
    const context = options.context || createRoomContext(options.players || [], settings, options.board || null);
    const state = options.state || core.createDraftState(settings);
    const targetTeamId = Number(options.targetTeamId || settings.draftPosition);
    const currentPick = (state.picks || []).length + 1;
    const startPick = Number(core.snakeTeamForPick(currentPick, settings.teams)) === targetTeamId ? currentPick + 1 : currentPick;
    let targetPick = currentPick;
    for (let pick = startPick; pick <= settings.teams * settings.rounds; pick += 1) {
      if (Number(core.snakeTeamForPick(pick, settings.teams)) === targetTeamId) { targetPick = pick; break; }
    }
    const picksBetween = Math.max(0, targetPick - startPick);
    const tracked = context.market.filter((row) => !(state.picks || []).some((pick) => String(pick.playerId) === row.player.id)).slice(0, Math.min(150, context.market.length));
    const counts = Object.fromEntries(tracked.map((row) => [row.player.id, 0]));
    const positionTaken = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0, K: 0 };
    const simulations = Math.round(clamp(options.simulations || 500, 20, 4000));
    for (let simulation = 0; simulation < simulations; simulation += 1) {
      let draftState = cloneDraftState(state);
      const before = new Set((draftState.picks || []).map((pick) => String(pick.playerId)));
      while (draftState.picks.length + 1 < targetPick) {
        const summary = core.draftPickSummary(draftState, settings);
        const selected = cpuPick(options.players || [], draftState, settings, summary.teamId, { strategy: options.strategy || "mixed", board: options.board || null, seed: String(options.seed || "window") + ":" + simulation, context });
        if (!selected) break;
        draftState = core.applyDraftPick(draftState, selected.id, settings);
      }
      const after = new Set((draftState.picks || []).map((pick) => String(pick.playerId)));
      for (const row of tracked) if (!after.has(row.player.id)) counts[row.player.id] += 1;
      for (const pick of draftState.picks || []) {
        const id = String(pick.playerId);
        if (before.has(id)) continue;
        const player = context.byId.get(id);
        if (player && positionTaken[player.position] !== undefined) positionTaken[player.position] += 1;
      }
    }
    return {
      simulations, targetPick, picksBetween,
      availabilityById: Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, count / simulations])),
      positionRunRates: Object.fromEntries(Object.entries(positionTaken).map(([position, count]) => [position, picksBetween ? clamp(count / (simulations * picksBetween), 0, 1) : 0])),
    };
  }

  function projectedSeasonPoints(roster, settings, endWeek = 17) {
    let total = 0;
    let floor = 0;
    let ceiling = 0;
    for (let week = 1; week <= endWeek; week += 1) {
      const lineup = core.optimizeWeeklyLineup(roster, settings, week);
      total += lineup.total;
      for (const row of lineup.starters) {
        if (!row.player) continue;
        const range = core.playerWeekRange(row.player, week);
        floor += range.floor;
        ceiling += range.ceiling;
      }
    }
    return { total, floor, ceiling };
  }

  function rosterSummary(roster, settings) {
    const season = projectedSeasonPoints(roster, settings, 17);
    const counts = positionCounts(roster);
    const reliability = roster.length
      ? roster.reduce((sum, player) => sum + finite(player.reliability, 0.7), 0) / roster.length
      : 0;
    return {
      expectedSeasonStarterPoints: Number(season.total.toFixed(2)),
      floorSeasonStarterPoints: Number(season.floor.toFixed(2)),
      ceilingSeasonStarterPoints: Number(season.ceiling.toFixed(2)),
      reliability: Number(reliability.toFixed(4)),
      counts,
    };
  }

  function simulateDraft(options = {}) {
    const settings = core.cloneSettings(options.settings || {});
    const userTeamId = Number(options.userTeamId || settings.draftPosition);
    const context = options.context || createRoomContext(options.players || [], settings, options.board || null);
    let state = core.createDraftState(settings);
    const total = settings.teams * settings.rounds;
    while (state.picks.length < total) {
      const summary = core.draftPickSummary(state, settings);
      const isUser = Number(summary.teamId) === userTeamId;
      const selected = isUser
        ? chooseUserPick(options.players || [], state, settings, userTeamId, options.userStrategy || "oracle", options.board, options.seed, context)
        : cpuPick(options.players || [], state, settings, summary.teamId, { strategy: options.opponentStrategy || "mixed", board: options.board, seed: options.seed, context });
      if (!selected) break;
      state = core.applyDraftPick(state, selected.id, settings);
    }
    const userRoster = (state.rosters[String(userTeamId)] || []).map((id) => context.byId.get(String(id))).filter(Boolean);
    return {
      version: VERSION,
      state,
      userTeamId,
      userRoster,
      summary: rosterSummary(userRoster, settings),
      completed: state.picks.length,
      total,
    };
  }

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const position = clamp(q, 0, 1) * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    const weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function benchmarkStrategies(options = {}) {
    const settings = core.cloneSettings(options.settings || {});
    const simulations = Math.round(clamp(options.simulations || 120, 10, 500));
    const context = options.context || createRoomContext(options.players || [], settings, options.board || null);
    const edges = [];
    let oracleWins = 0;
    let oracleTotal = 0;
    let baselineTotal = 0;
    for (let index = 0; index < simulations; index += 1) {
      const seed = `${options.seed || "benchmark"}:${index}`;
      const common = { ...options, settings, seed, board: options.board || null, context };
      const oracle = simulateDraft({ ...common, userStrategy: "oracle" });
      const baseline = simulateDraft({ ...common, userStrategy: options.baselineStrategy || "espn-market" });
      const oraclePoints = oracle.summary.expectedSeasonStarterPoints;
      const baselinePoints = baseline.summary.expectedSeasonStarterPoints;
      const edge = oraclePoints - baselinePoints;
      edges.push(edge);
      oracleTotal += oraclePoints;
      baselineTotal += baselinePoints;
      if (edge > 0) oracleWins += 1;
    }
    edges.sort((a, b) => a - b);
    const meanEdge = edges.reduce((sum, value) => sum + value, 0) / Math.max(1, edges.length);
    return {
      version: VERSION,
      simulations,
      opponentStrategy: options.opponentStrategy || "mixed",
      baselineStrategy: options.baselineStrategy || "espn-market",
      oracleWinRate: Number((oracleWins / simulations).toFixed(4)),
      oracleExpectedSeasonPoints: Number((oracleTotal / simulations).toFixed(2)),
      baselineExpectedSeasonPoints: Number((baselineTotal / simulations).toFixed(2)),
      meanSeasonEdge: Number(meanEdge.toFixed(2)),
      p10Edge: Number(quantile(edges, 0.1).toFixed(2)),
      medianEdge: Number(quantile(edges, 0.5).toFixed(2)),
      p90Edge: Number(quantile(edges, 0.9).toFixed(2)),
    };
  }

  function strategyCatalog() {
    return Object.entries(PROFILES).map(([id, profile]) => ({ id, label: profile.label }));
  }

  return {
    VERSION,
    PROFILES,
    advanceToUser,
    benchmarkStrategies,
    boardRank,
    cpuPick,
    createRoomContext,
    parseRankingBoard,
    projectedSeasonPoints,
    rosterSummary,
    simulateDraft,
    simulatePickWindow,
    strategyCatalog,
  };
});

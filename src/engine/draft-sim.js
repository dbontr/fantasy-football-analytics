(function attachOracleDraftSim(root, factory) {
  const core = typeof module !== "undefined" && module.exports
    ? require("./core.js")
    : root.FantasyOracleCore;
  const rookies = typeof module !== "undefined" && module.exports
    ? require("./rookies.js")
    : root.OracleRookies;
  const league = typeof module !== "undefined" && module.exports
    ? require("./league.js")
    : root.SnapCountLeague;
  const api = factory(core, rookies, league);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleDraftSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createDraftSim(core, rookies, league) {
  "use strict";

  const VERSION = "oracle-draft-sim-2026.2";
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
  const DEFAULT_ORACLE_POLICY = Object.freeze({
    market: 0.7, value: 0.1, need: 0.95, injury: 7, rookie: 0,
    maxQB: 2, maxTE: 2, maxK: 1, maxDST: 1,
    secondQbRound: 10, secondTeRound: 10, kickerRound: 14, dstRound: 13,
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
    return core.rankForScoring(normalized, settings.scoring || "ppr", settings.qbFormat) || 9999;
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
  function starterNeedFromCounts(position, counts, settings) {
    const direct = Math.max(0, finite(settings.slots?.[position]) - finite(counts?.[position]));
    if (!["RB", "WR", "TE"].includes(position)) return direct;
    const skill = finite(counts?.RB) + finite(counts?.WR) + finite(counts?.TE);
    const directSkill = finite(settings.slots.RB) + finite(settings.slots.WR) + finite(settings.slots.TE);
    const flexNeed = Math.max(0, directSkill + finite(settings.slots.FLEX) - skill);
    return Math.max(direct, Math.min(1, flexNeed));
  }
  function starterNeed(position, roster, settings) {
    return starterNeedFromCounts(position, positionCounts(roster), settings);
  }
  function effectiveProfile(strategy, seedKey) {
    const requested = PROFILES[strategy] || PROFILES["espn-market"];
    if (!requested.mixed) return requested;
    const names = ["espn-market", "balanced", "value", "need-heavy", "rb-heavy", "wr-heavy", "zero-rb"];
    return PROFILES[names[hashSeed(seedKey) % names.length]];
  }

  function scoringPlayer(player, settings) {
    return league?.playerForScoring ? league.playerForScoring(player, settings) : core.normalizePlayer(player);
  }

  function createRoomContext(players, settings, board = null) {
    const config = core.cloneSettings(settings);
    const normalized = (players || []).map((player) => scoringPlayer(player, config));
    const byId = new Map(normalized.map((player) => [player.id, player]));
    const replacement = core.computeReplacementLevels(normalized, config);
    const market = normalized.map((player) => ({
      player, rank: boardRank(player, config, board),
      asset: core.draftAssetValue(player, replacement, config),
    })).sort((a, b) => a.rank - b.rank || b.asset - a.asset);
    return { config, normalized, byId, replacement, market, board };
  }

  function createTracker(context, state) {
    const drafted = new Set((state?.picks || []).map((pick) => String(pick.playerId)));
    const countsByTeam = {};
    for (let teamId = 1; teamId <= context.config.teams; teamId += 1) {
      const counts = {};
      for (const id of state?.rosters?.[String(teamId)] || []) {
        const player = context.byId.get(String(id));
        if (player) counts[player.position] = finite(counts[player.position]) + 1;
      }
      countsByTeam[String(teamId)] = counts;
    }
    return { drafted, countsByTeam };
  }
  function trackPick(tracker, teamId, player) {
    if (!tracker || !player) return;
    tracker.drafted.add(String(player.id));
    const counts = tracker.countsByTeam[String(teamId)] || (tracker.countsByTeam[String(teamId)] = {});
    counts[player.position] = finite(counts[player.position]) + 1;
  }
  function rookieTailScore(player) {
    if (!player?.rookie || !rookies) return 0;
    const prior = player.rookie.prior || {};
    const weekly = Math.max(3, finite(player.weeklyProjection, finite(player.projectedPoints) / 17));
    const upside = clamp((finite(prior.p90, weekly) - weekly) / weekly, -0.45, 0.9);
    const hitRate = clamp(finite(prior.hitRate, 0.12), 0, 0.75);
    const capital = rookies.draftCapitalScore(player.rookie);
    let score = upside * 2.2 + (capital - 0.45) * 2 + (hitRate - 0.15) * 3.2;
    const depth = finite(player?.sleeper?.depthChartOrder, 0);
    if (depth === 1) score += 0.55;
    else if (depth === 2) score += 0.2;
    else if (depth >= 4) score -= 0.4;
    return clamp(score, -1.5, 4.5);
  }
  function adjustRecommendations(rows, limit = 18) {
    return (rows || []).map((row) => {
      const rookieEdge = rookieTailScore(row);
      if (!rookieEdge) return row;
      return { ...row, score: row.score + rookieEdge, rookieTailScore: rookieEdge, reasons: [...(row.reasons || []), `rookie tail +${rookieEdge.toFixed(1)}`] };
    }).sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
  }

  function oraclePolicyScore(row, context, state, teamId, tracker = null, policyOptions = null) {
    const room = tracker || createTracker(context, state);
    if (!row?.player || room.drafted.has(row.player.id)) return -Infinity;
    const counts = room.countsByTeam[String(teamId)] || {};
    const pick = (state?.picks || []).length + 1;
    const round = Math.ceil(pick / Math.max(1, context.config.teams));
    const policy = { ...DEFAULT_ORACLE_POLICY, ...(policyOptions || {}) };
    const superflex = finite(context.config.slots?.SUPERFLEX) > 0;
    const maxQB = superflex ? Math.max(3, finite(policy.maxQB, 3)) : finite(policy.maxQB, 2);
    const position = row.player.position;
    const count = finite(counts[position]);
    if (position === "QB" && (count >= maxQB || (!superflex && count >= 1 && round < policy.secondQbRound))) return -Infinity;
    if (position === "TE" && (count >= policy.maxTE || (count >= 1 && round < policy.secondTeRound))) return -Infinity;
    if (position === "K" && (count >= policy.maxK || round < policy.kickerRound)) return -Infinity;
    if (position === "DST" && (count >= policy.maxDST || round < policy.dstRound)) return -Infinity;
    const need = starterNeedFromCounts(position, counts, context.config);
    let score = -row.rank * policy.market + row.asset * policy.value + need * 11 * policy.need;
    score -= finite(row.player.injuryRisk) * policy.injury;
    score += rookieTailScore(row.player) * policy.rookie;
    return score;
  }

  function oraclePolicyPick(context, state, teamId, tracker = null, policyOptions = null) {
    let best = null, bestScore = -Infinity;
    for (const row of context.market) {
      const score = oraclePolicyScore(row, context, state, teamId, tracker, policyOptions);
      if (score > bestScore) { best = row.player; bestScore = score; }
    }
    return best ? { ...best, roomStrategy: "Oracle policy", roomScore: Number(bestScore.toFixed(2)) } : null;
  }

  function qualifyRecommendations(rows, players, state, settings, teamId, board = null, policyOptions = null, limit = 18) {
    const context = createRoomContext(players, settings, board);
    const tracker = createTracker(context, state);
    const explanationById = new Map((rows || []).map((row) => [String(row.id), row]));
    return context.market.map((market) => {
      const policyScore = oraclePolicyScore(market, context, state, teamId, tracker, policyOptions);
      if (!Number.isFinite(policyScore)) return null;
      const explanation = explanationById.get(String(market.player.id));
      const row = explanation || market.player;
      const rookieEdge = rookieTailScore(row);
      return {
        ...row,
        marketRank: market.rank,
        baseHeuristicScore: explanation?.score ?? null,
        score: Number(policyScore.toFixed(2)),
        roomScore: Number(policyScore.toFixed(2)),
        rookieTailScore: rookieEdge,
        returnChance: Number.isFinite(explanation?.returnChance) ? explanation.returnChance : 0.5,
        vona: Number.isFinite(explanation?.vona) ? explanation.vona : 0,
        need: Number.isFinite(explanation?.need) ? explanation.need : 0,
        reasons: [...(explanation?.reasons || []), "ranked by historically qualified draft policy"],
      };
    }).filter(Boolean).sort((left, right) => right.score - left.score || left.marketRank - right.marketRank)
      .slice(0, Math.max(1, limit));
  }

  function cpuPick(players, state, settings, teamId, options = {}) {
    const context = options.context || createRoomContext(players, settings, options.board || null);
    const config = context.config;
    const room = options.tracker || createTracker(context, state);
    const counts = room.countsByTeam[String(teamId)] || {};
    const pickNumber = (state?.picks || []).length + 1;
    const profile = effectiveProfile(options.strategy || "espn-market", String(options.seed) + ":" + teamId);
    const random = seededRandom(String(options.seed || 1) + ":" + pickNumber + ":" + teamId + ":" + (options.strategy || "market"));
    let best = null, bestScore = -Infinity, considered = 0;
    for (const candidate of context.market) {
      if (room.drafted.has(candidate.player.id)) continue;
      considered += 1;
      if (considered > 96) break;
      const player = candidate.player;
      const need = starterNeedFromCounts(player.position, counts, config);
      let score = -candidate.rank * profile.market + candidate.asset * profile.value + need * 11 * profile.need;
      score += finite(profile[player.position]);
      if (profile.zeroRb && player.position === "RB" && pickNumber <= config.teams * 5) score -= 13;
      if (["K", "DST"].includes(player.position) && pickNumber <= config.teams * Math.max(8, config.rounds - 5)) score -= 22;
      score += gumbel(random) * (3.2 + Math.sqrt(Math.max(1, candidate.rank)) * 0.35) * profile.noise;
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
    const tracker = createTracker(context, state);
    const total = settings.teams * settings.rounds;
    let cpuPicks = 0;
    while (state.picks.length < total) {
      const summary = core.draftPickSummary(state, settings);
      if (Number(summary.teamId) === userTeamId) break;
      const selected = cpuPick(options.players || [], state, settings, summary.teamId, {
        strategy: options.strategy || "mixed", board: options.board || null, seed: options.seed || 1, context, tracker,
      });
      if (!selected) break;
      state = core.applyDraftPick(state, selected.id, settings);
      trackPick(tracker, summary.teamId, selected);
      cpuPicks += 1;
    }
    return { state, cpuPicks, summary: core.draftPickSummary(state, settings) };
  }

  function chooseUserPick(players, state, settings, teamId, strategy, board, seed, context, tracker = null, oraclePolicy = null) {
    if (strategy === "oracle") return oraclePolicyPick(context || createRoomContext(players, settings, board), state, teamId, tracker, oraclePolicy);
    if (strategy === "site-board") {
      const sourceContext = createRoomContext(players, settings, board);
      const sourceTracker = createTracker(sourceContext, state);
      return cpuPick(players, state, settings, teamId, { strategy: "espn-market", board, seed, context: sourceContext, tracker: sourceTracker });
    }
    return cpuPick(players, state, settings, teamId, { strategy, board, seed, context, tracker });
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
    const baseTracker = createTracker(context, state);
    const tracked = [];
    for (const row of context.market) {
      if (!baseTracker.drafted.has(row.player.id)) tracked.push(row);
      if (tracked.length >= Math.min(150, context.market.length)) break;
    }
    const counts = Object.fromEntries(tracked.map((row) => [row.player.id, 0]));
    const positionTaken = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0, K: 0 };
    const simulations = Math.round(clamp(options.simulations || 500, 20, 4000));
    for (let simulation = 0; simulation < simulations; simulation += 1) {
      let draftState = cloneDraftState(state);
      const tracker = createTracker(context, draftState);
      while (draftState.picks.length + 1 < targetPick) {
        const summary = core.draftPickSummary(draftState, settings);
        const selected = cpuPick(options.players || [], draftState, settings, summary.teamId, {
          strategy: options.strategy || "mixed", board: options.board || null,
          seed: String(options.seed || "window") + ":" + simulation, context, tracker,
        });
        if (!selected) break;
        draftState = core.applyDraftPick(draftState, selected.id, settings);
        trackPick(tracker, summary.teamId, selected);
        if (positionTaken[selected.position] !== undefined) positionTaken[selected.position] += 1;
      }
      for (const row of tracked) if (!tracker.drafted.has(row.player.id)) counts[row.player.id] += 1;
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
    const tracker = createTracker(context, state);
    const total = settings.teams * settings.rounds;
    while (state.picks.length < total) {
      const summary = core.draftPickSummary(state, settings);
      const isUser = Number(summary.teamId) === userTeamId;
      const selected = isUser
        ? chooseUserPick(options.players || [], state, settings, userTeamId, options.userStrategy || "oracle", options.userBoard || options.board, options.seed, context, tracker, options.oraclePolicy || null)
        : cpuPick(options.players || [], state, settings, summary.teamId, { strategy: options.opponentStrategy || "mixed", board: options.board, seed: options.seed, context, tracker });
      if (!selected) break;
      state = core.applyDraftPick(state, selected.id, settings);
      trackPick(tracker, summary.teamId, selected);
    }
    const userRoster = (state.rosters[String(userTeamId)] || []).map((id) => context.byId.get(String(id))).filter(Boolean);
    return {
      version: VERSION, state, userTeamId, userRoster,
      summary: rosterSummary(userRoster, settings), completed: state.picks.length, total,
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
    DEFAULT_ORACLE_POLICY,
    advanceToUser,
    benchmarkStrategies,
    adjustRecommendations,
    boardRank,
    cpuPick,
    createRoomContext,
    parseRankingBoard,
    projectedSeasonPoints,
    qualifyRecommendations,
    rookieTailScore,
    rosterSummary,
    scoringPlayer,
    simulateDraft,
    simulatePickWindow,
    strategyCatalog,
  };
});

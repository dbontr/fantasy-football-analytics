(function init(root, factory) {
  const core = typeof module !== "undefined" && module.exports ? require("./core.js") : root.FantasyOracleCore;
  const api = factory(core);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnapCountLeague = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createLeagueApi(core) {
  "use strict";

  const VERSION = "snapcount-league-profile-2026.2";
  const SCORING = new Set(["ppr", "half-ppr", "standard", "superflex", "custom"]);

  function scoringName(value) {
    const scoring = String(value || "ppr").toLowerCase();
    return SCORING.has(scoring) ? scoring : "ppr";
  }

  function normalizeProfile(input = {}) {
    const settings = core.cloneSettings({
      teams: input.teams ?? input.settings?.teams,
      rounds: input.rounds ?? input.settings?.rounds,
      draftPosition: input.draftPosition ?? input.settings?.draftPosition,
      scoring: scoringName(input.scoring ?? input.settings?.scoring),
      slots: input.slots ?? input.settings?.slots,
    });
    const customScoring = normalizeCustomScoring(input.customScoring ?? input.settings?.customScoring);
    if (customScoring) settings.customScoring = customScoring;
    return {
      version: VERSION,
      source: String(input.source || "manual"),
      provider: input.provider ? String(input.provider) : null,
      supported: input.supported !== false,
      settings,
      customScoring,
      irSlots: Math.max(0, Math.round(Number(input.irSlots || 0))),
      lineupLockType: String(input.lineupLockType || "UNKNOWN"),
      unsupportedStarterSlotIds: [...(input.unsupportedStarterSlotIds || [])].map(String),
    };
  }


  function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeName(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function boolOrNull(value) {
    if (value === true || value === false) return value;
    const text = String(value ?? "").trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(text)) return true;
    if (["false", "0", "no", "n"].includes(text)) return false;
    return null;
  }

  function normalizeRuleRows(value) {
    if (!value) return [];
    const rows = Array.isArray(value) ? value : Object.entries(value).map(([stat, points]) => ({ stat, points }));
    return rows.map((row) => ({ stat: String(row?.stat || row?.key || "").trim(), points: Number(row?.points) }))
      .filter((row) => row.stat && Number.isFinite(row.points));
  }

  function normalizeCustomScoring(input) {
    if (!input || typeof input !== "object") return null;
    const rules = normalizeRuleRows(input.rules || input.linear || input.points);
    const positionRules = Object.fromEntries(Object.entries(input.positionRules || {}).map(([position, rows]) => [String(position).toUpperCase(), normalizeRuleRows(rows)]));
    const bonuses = (input.bonuses || []).map((row) => ({
      stat: String(row?.stat || "").trim(),
      points: Number(row?.points),
      probabilityStat: row?.probabilityStat ? String(row.probabilityStat) : null,
      expectedCountStat: row?.expectedCountStat ? String(row.expectedCountStat) : null,
      threshold: finiteOrNull(row?.threshold),
    })).filter((row) => row.stat && Number.isFinite(row.points));
    return { version: "snapcount-custom-scoring-2026.1", rules, positionRules, bonuses };
  }

  function scoreStatLine(stats, scoring, position = "") {
    const config = normalizeCustomScoring(scoring);
    if (!config || (!config.rules.length && !Object.values(config.positionRules).some((rows) => rows.length) && !config.bonuses.length)) {
      throw new RangeError("Exact custom scoring requires at least one projected-stat scoring rule.");
    }
    const source = stats && typeof stats === "object" ? stats : {};
    const missing = new Set();
    let total = 0;
    const addRules = (rows) => rows.forEach((rule) => {
      const value = finiteOrNull(source[rule.stat]);
      if (value === null) missing.add(rule.stat);
      else total += value * rule.points;
    });
    addRules(config.rules);
    addRules(config.positionRules[String(position || "").toUpperCase()] || []);
    for (const bonus of config.bonuses) {
      const sourceStat = bonus.expectedCountStat || bonus.probabilityStat;
      if (!sourceStat) {
        missing.add(bonus.stat + " bonus probability/count");
        continue;
      }
      const expected = finiteOrNull(source[sourceStat]);
      if (expected === null) missing.add(sourceStat);
      else total += expected * bonus.points;
    }
    if (missing.size) throw new RangeError("Exact custom scoring unavailable; missing projected stat components: " + [...missing].sort().join(", "));
    return Number(total.toFixed(4));
  }

  function customProjectionFamily(player, settings) {
    const scoring = settings?.customScoring;
    if (!scoring) throw new RangeError("Custom scoring is selected, but no exact scoring rules are configured.");
    const season = scoreStatLine(player?.projectionStats, scoring, player?.position);
    const weeklyStats = Array.isArray(player?.weeklyProjectionStats) ? player.weeklyProjectionStats : [];
    const weeks = Array.from({ length: 18 }, (_, index) => {
      if (!weeklyStats[index]) return null;
      return scoreStatLine(weeklyStats[index], scoring, player?.position);
    });
    const finiteWeeks = weeks.filter((value) => Number.isFinite(value));
    const weekly = finiteWeeks.length ? finiteWeeks.reduce((sum, value) => sum + value, 0) / finiteWeeks.length : season / 17;
    return { season, weekly, weeks };
  }

  function standardFamily(player) {
    const season = Number(player?.standardProjectedPoints);
    const weekly = Number(player?.standardWeeklyProjection);
    if (!Number.isFinite(season) || !Number.isFinite(weekly)) return null;
    const weeks = Array.isArray(player?.standardWeeklyProjections)
      ? player.standardWeeklyProjections.map((value) => Number.isFinite(Number(value)) ? Number(value) : null)
      : null;
    return { season, weekly, weeks };
  }

  function playerForScoring(player, settings = core.DEFAULT_SETTINGS) {
    const config = core.cloneSettings(settings);
    const normalized = core.normalizePlayer(player);
    if (player?._snapCountScoring === config.scoring) return normalized;
    if (config.scoring === "custom") {
      const custom = customProjectionFamily(player, config);
      const ratio = normalized.weeklyProjection > 0 ? custom.weekly / normalized.weeklyProjection : 1;
      return core.normalizePlayer({ ...normalized, _snapCountScoring: "custom", projectedPoints: custom.season, weeklyProjection: custom.weekly, weeklyProjections: custom.weeks, floorProjection: normalized.floorProjection * ratio, ceilingProjection: normalized.ceilingProjection * ratio, projectionStdDev: normalized.projectionStdDev * ratio });
    }
    if (!["standard", "half-ppr"].includes(config.scoring)) return normalized;
    const standard = standardFamily(player);
    if (!standard) return normalized;
    const pprWeight = config.scoring === "half-ppr" ? 0.5 : 0;
    const season = standard.season + (normalized.projectedPoints - standard.season) * pprWeight;
    const weekly = standard.weekly + (normalized.weeklyProjection - standard.weekly) * pprWeight;
    const ratio = normalized.weeklyProjection > 0 ? weekly / normalized.weeklyProjection : 1;
    const weeks = normalized.weeklyProjections.map((value, index) => {
      const ppr = Number(value);
      const std = Number(standard.weeks?.[index]);
      if (!Number.isFinite(std)) return Number.isFinite(ppr) ? ppr : null;
      if (!Number.isFinite(ppr)) return std;
      return std + (ppr - std) * pprWeight;
    });
    return core.normalizePlayer({
      ...normalized,
      _snapCountScoring: config.scoring,
      projectedPoints: season,
      weeklyProjection: weekly,
      weeklyProjections: weeks,
      floorProjection: normalized.floorProjection * ratio,
      ceilingProjection: normalized.ceilingProjection * ratio,
      projectionStdDev: normalized.projectionStdDev * ratio,
    });
  }

  function isQualifiedPprDraftScope(settings = core.DEFAULT_SETTINGS) {
    const config = core.cloneSettings(settings);
    const slots = config.slots;
    return [10, 12].includes(config.teams)
      && config.scoring === "ppr"
      && Number(slots.QB) === 1 && Number(slots.RB) === 2 && Number(slots.WR) === 2
      && Number(slots.TE) === 1 && Number(slots.FLEX) === 1 && Number(slots.SUPERFLEX) === 0
      && Number(slots.DST) === 1 && Number(slots.K) === 1;
  }

  function rosteredPlayerIds(teams = []) {
    const ids = new Set();
    for (const team of teams || []) {
      for (const player of team.roster || []) if (player?.id != null) ids.add(String(player.id));
      for (const id of team.rosterIds || []) if (id != null) ids.add(String(id));
    }
    return ids;
  }

  function availablePlayers(players = [], teams = null, ownRosterIds = []) {
    const blocked = teams?.length ? rosteredPlayerIds(teams) : new Set();
    for (const id of ownRosterIds || []) blocked.add(String(id));
    return (players || []).filter((player) => !blocked.has(String(player.id)));
  }

  function starterCoverage(roster = [], settings = core.DEFAULT_SETTINGS) {
    const config = core.cloneSettings(settings);
    const slots = core.expandedStarterSlots(config);
    if (!slots.length) return 1;
    const projected = roster.map((player) => playerForScoring(player, config));
    const lineup = core.optimizeLineup(projected, config, "weeklyProjection");
    return lineup.starters.filter((row) => row.player).length / slots.length;
  }


  function normalizeLineupSlot(value) {
    const slot = String(value || "").trim().toUpperCase().replace(/[\s_-]+/g, "");
    if (["BE", "BENCH", "BN"].includes(slot)) return "BN";
    if (["D/ST", "DEF", "DEFENSE", "DST"].includes(slot)) return "DST";
    if (["SF", "SUPERFLEX", "OP"].includes(slot)) return "SUPERFLEX";
    if (["FLEX", "RBWRTE", "WRRBTE"].includes(slot)) return "FLEX";
    if (["IR", "RESERVE"].includes(slot)) return "IR";
    return ["QB", "RB", "WR", "TE", "K"].includes(slot) ? slot : String(value || "").trim().toUpperCase();
  }

  function timestampOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number" && Number.isFinite(value)) return value < 1e11 ? value * 1000 : value;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 1e11 ? numeric * 1000 : numeric;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeTransactions(input = {}) {
    const result = {
      faabBudget: finiteOrNull(input.faabBudget ?? input.budget),
      acquisitionLimit: finiteOrNull(input.acquisitionLimit),
      tradeDeadline: timestampOrNull(input.tradeDeadline),
      rosterLimit: finiteOrNull(input.rosterLimit),
      irSlots: finiteOrNull(input.irSlots),
      waiverType: input.waiverType ? String(input.waiverType) : null,
      rosterLockType: input.rosterLockType ? String(input.rosterLockType) : null,
      lockDroppedPlayersAfterKickoff: boolOrNull(input.lockDroppedPlayersAfterKickoff),
      complete: input.complete === true,
    };
    result.known = Object.entries(result).some(([key, value]) => !["known", "complete"].includes(key) && value !== null);
    return result;
  }

  function normalizeTeamTransaction(input = {}) {
    const nonnegativeOrNull = (value) => {
      const number = finiteOrNull(value);
      return number === null ? null : Math.max(0, number);
    };
    return {
      faabSpent: nonnegativeOrNull(input.faabSpent ?? input.acquisitionBudgetSpent),
      faabRemaining: nonnegativeOrNull(input.faabRemaining),
      waiverPriority: finiteOrNull(input.waiverPriority ?? input.waiverRank),
      acquisitions: nonnegativeOrNull(input.acquisitions),
      irUsed: nonnegativeOrNull(input.irUsed),
    };
  }

  function transactionStateForTeam(league, teamId) {
    const rules = normalizeTransactions(league?.transactions || {});
    const team = (league?.teams || []).find((row) => String(row.teamId) === String(teamId));
    const usage = normalizeTeamTransaction(team?.transactions || team || {});
    const faabRemaining = usage.faabRemaining !== null ? Math.max(0, usage.faabRemaining)
      : rules.faabBudget !== null && usage.faabSpent !== null ? Math.max(0, rules.faabBudget - usage.faabSpent) : null;
    return { rules, usage, faabRemaining };
  }

  function transactionFeasibility(options = {}) {
    const state = transactionStateForTeam(options.league, options.teamId);
    const type = String(options.type || "").toLowerCase();
    const reasons = [];
    const now = timestampOrNull(options.now) ?? Date.now();
    const involved = new Set((options.involvedPlayerIds || []).map(String));
    const locked = new Set((options.lockedPlayerIds || []).map(String));
    const dropLockKnown = state.rules.lockDroppedPlayersAfterKickoff;
    const dropLockByType = /INDIVIDUAL.*GAME|GAME.*START/i.test(String(state.rules.rosterLockType || ""));
    if (type === "waiver" && (dropLockKnown === true || (dropLockKnown === null && dropLockByType)) && [...involved].some((id) => locked.has(id))) reasons.push("drop includes a player whose game is already locked");
    if (type === "trade" && state.rules.tradeDeadline !== null && now > state.rules.tradeDeadline) reasons.push("trade deadline has passed");
    if (type === "waiver" && state.rules.acquisitionLimit !== null && state.rules.acquisitionLimit >= 0 && state.usage.acquisitions !== null && state.usage.acquisitions >= state.rules.acquisitionLimit) reasons.push("acquisition limit has been reached");
    const bid = finiteOrNull(options.bid);
    if (type === "waiver" && bid !== null && state.faabRemaining !== null && bid > state.faabRemaining) reasons.push("FAAB bid exceeds remaining budget");
    const rosterAfter = finiteOrNull(options.rosterCountAfter);
    if (rosterAfter !== null && state.rules.rosterLimit !== null && rosterAfter > state.rules.rosterLimit) reasons.push("roster limit would be exceeded");
    const irAfter = finiteOrNull(options.irCountAfter);
    if (irAfter !== null && state.rules.irSlots !== null && irAfter > state.rules.irSlots) reasons.push("IR slot limit would be exceeded");
    return { allowed: reasons.length === 0, known: state.rules.known, reasons, ...state };
  }

  function playerKickoff(player, schedule, week) {
    const row = schedule?.[String(player?.team || "").toUpperCase()]?.weeks?.[Math.max(0, Number(week || 1) - 1)];
    return timestampOrNull(row?.date);
  }

  function leagueWeekKickoff(schedule, week) {
    const dates = Object.values(schedule || {}).map((team) => timestampOrNull(team?.weeks?.[Math.max(0, Number(week || 1) - 1)]?.date)).filter((value) => value !== null);
    return dates.length ? Math.min(...dates) : null;
  }

  function lineupConstraintsForTeam(team, players = [], schedule = {}, week = 1, options = {}) {
    const entries = Array.isArray(team?.rosterEntries) ? team.rosterEntries : [];
    if (!entries.length) return { available: false, complete: false, lockedAssignments: [], lockedBenchPlayerIds: [], lockedPlayerIds: [], lockedCount: 0, knownPoints: 0, entries: [] };
    const byId = new Map((players || []).map((player) => [String(player.id), player]));
    const now = timestampOrNull(options.now) ?? Date.now();
    const lockType = String(options.lineupLockType || team?.lineupLockType || "INDIVIDUAL_GAME").toUpperCase();
    const firstKickoff = leagueWeekKickoff(schedule, week);
    const lockAll = /FIRST|SCORING_PERIOD|LINEUP/.test(lockType) && firstKickoff !== null && now >= firstKickoff;
    const lockedAssignments = [], lockedBenchPlayerIds = [], lockedPlayerIds = [], unknownLockedPlayerIds = [], resolvedEntries = [];
    let knownPoints = 0;
    for (const entry of entries) {
      const id = String(entry?.playerId ?? entry?.id ?? "");
      const player = byId.get(id);
      if (!id || !player) continue;
      const slot = normalizeLineupSlot(entry?.lineupSlot ?? entry?.slot);
      const kickoff = timestampOrNull(entry?.kickoff) ?? playerKickoff(player, schedule, week);
      const explicit = boolOrNull(entry?.locked);
      const locked = explicit !== null ? explicit : lockAll || (kickoff !== null && now >= kickoff);
      const currentPoints = finiteOrNull(entry?.currentPoints);
      if (currentPoints !== null && core.STARTER_POSITIONS.includes(slot)) knownPoints += currentPoints;
      resolvedEntries.push({ playerId: id, slot, kickoff, locked, currentPoints, final: boolOrNull(entry?.final) === true });
      if (!locked) continue;
      lockedPlayerIds.push(id);
      if (core.STARTER_POSITIONS.includes(slot)) lockedAssignments.push({ playerId: id, slot });
      else if (["BN", "IR"].includes(slot)) lockedBenchPlayerIds.push(id);
      else unknownLockedPlayerIds.push(id);
    }
    return { available: true, complete: unknownLockedPlayerIds.length === 0, lockType, lockedAssignments, lockedBenchPlayerIds, lockedPlayerIds, unknownLockedPlayerIds, lockedCount: lockedPlayerIds.length, knownPoints: Number(knownPoints.toFixed(2)), entries: resolvedEntries };
  }


  function uniqueNameIndex(players = []) {
    const index = new Map();
    for (const player of players || []) {
      const key = normalizeName(player?.name);
      if (!key) continue;
      if (index.has(key)) index.set(key, null);
      else index.set(key, player);
    }
    return index;
  }

  function resolveImportedPlayer(entry, byId, byName) {
    if (entry === null || entry === undefined) return null;
    const object = typeof entry === "object" ? entry : { playerId: entry, playerName: entry };
    const id = String(object.playerId ?? object.id ?? "").trim();
    if (id && byId.has(id)) return byId.get(id);
    const name = normalizeName(object.playerName ?? object.name ?? (id && !/^\d+$/.test(id) ? id : ""));
    return name ? byName.get(name) || null : null;
  }

  function normalizeFantasySchedule(value) {
    const output = {};
    const add = (week, left, right) => {
      const key = String(Math.max(1, Math.min(18, Math.round(Number(week || 1)))));
      const a = String(left ?? "").trim(), b = String(right ?? "").trim();
      if (!a || !b || a === b) return;
      if (!output[key]) output[key] = [];
      if (!output[key].some((pair) => pair[0] === a && pair[1] === b || pair[0] === b && pair[1] === a)) output[key].push([a, b]);
    };
    if (Array.isArray(value)) value.forEach((row) => add(row?.week ?? row?.matchupPeriodId, row?.homeTeamId ?? row?.home ?? row?.team1, row?.awayTeamId ?? row?.away ?? row?.team2));
    else for (const [week, rows] of Object.entries(value || {})) for (const row of rows || []) Array.isArray(row) ? add(week, row[0], row[1]) : add(week, row?.homeTeamId ?? row?.home, row?.awayTeamId ?? row?.away);
    return output;
  }

  function normalizeLeagueState(input = {}, players = []) {
    const byId = new Map((players || []).map((player) => [String(player.id), player]));
    const byName = uniqueNameIndex(players);
    const rawTeams = Array.isArray(input.teams) ? input.teams : [];
    if (rawTeams.length < 2) throw new RangeError("League import requires at least two teams.");
    const seenTeamIds = new Set(), ownership = new Map();
    const teams = rawTeams.map((team, index) => {
      const teamId = String(team?.teamId ?? team?.id ?? index + 1);
      if (seenTeamIds.has(teamId)) throw new RangeError("League import contains duplicate team ID " + teamId + ".");
      seenTeamIds.add(teamId);
      const rawEntries = Array.isArray(team?.rosterEntries) ? team.rosterEntries : Array.isArray(team?.roster) ? team.roster : Array.isArray(team?.players) ? team.players : Array.isArray(team?.rosterIds) ? team.rosterIds : [];
      const rosterEntries = [], unmatchedPlayers = [];
      for (const rawEntry of rawEntries) {
        const object = typeof rawEntry === "object" && rawEntry !== null ? rawEntry : { playerId: rawEntry, playerName: rawEntry };
        const player = resolveImportedPlayer(object, byId, byName);
        if (!player) { unmatchedPlayers.push(String(object.playerName ?? object.name ?? object.playerId ?? object.id ?? "Unknown player")); continue; }
        const playerId = String(player.id);
        if (ownership.has(playerId) && ownership.get(playerId) !== teamId) throw new RangeError("Player " + player.name + " appears on multiple imported teams.");
        ownership.set(playerId, teamId);
        rosterEntries.push({
          playerId,
          lineupSlot: normalizeLineupSlot(object.lineupSlot ?? object.slot),
          locked: boolOrNull(object.locked),
          currentPoints: finiteOrNull(object.currentPoints ?? object.points),
          final: boolOrNull(object.final),
          kickoff: timestampOrNull(object.kickoff),
        });
      }
      const rosterIds = [...new Set(rosterEntries.map((entry) => entry.playerId))];
      const wins = Math.max(0, Number(team?.wins || 0)), losses = Math.max(0, Number(team?.losses || 0)), ties = Math.max(0, Number(team?.ties || 0));
      return { teamId, name: String(team?.name || "Team " + (index + 1)), ownerName: team?.ownerName ? String(team.ownerName) : "", rosterIds, rosterEntries, unmatchedPlayers, wins, losses, ties, pointsFor: Number(team?.pointsFor || 0), recordLabel: wins + "-" + losses + (ties ? "-" + ties : ""), transactions: normalizeTeamTransaction(team?.transactions || team) };
    });
    const profile = normalizeProfile({ ...(input.profile || input.settings || {}), ...(input.rules || {}), source: input.source || "import", provider: input.provider || "import", teams: teams.length, customScoring: input.customScoring ?? input.profile?.customScoring ?? input.settings?.customScoring });
    const fantasySchedule = normalizeFantasySchedule(input.fantasySchedule || input.schedule || []);
    const userTeamId = input.userTeamId !== undefined && input.userTeamId !== null ? String(input.userTeamId) : null;
    if (userTeamId && !teams.some((team) => team.teamId === userTeamId)) throw new RangeError("Imported userTeamId does not match an imported team.");
    const projectionSource = input.playerProjections || input.projectionStatsByPlayer || {};
    const projectionRows = Array.isArray(projectionSource) ? projectionSource : Object.entries(projectionSource).map(([playerId, row]) => ({ playerId, ...(row || {}) }));
    const playerProjections = {};
    for (const row of projectionRows) {
      const player = resolveImportedPlayer(row, byId, byName);
      if (!player) continue;
      playerProjections[String(player.id)] = { projectionStats: row.projectionStats || row.stats || null, weeklyProjectionStats: row.weeklyProjectionStats || row.weeklyStats || null };
    }
    return {
      version: "snapcount-league-state-2026.1", source: String(input.source || "import"), provider: input.provider ? String(input.provider) : "import",
      leagueId: input.leagueId != null ? String(input.leagueId) : null, season: Number(input.season || 2026), name: String(input.name || input.leagueName || "Imported league"),
      currentWeek: Math.max(1, Math.min(18, Math.round(Number(input.currentWeek || 1)))), userTeamId, teams, fantasySchedule,
      regularSeasonEnd: Math.max(1, Math.min(18, Math.round(Number(input.regularSeasonEnd || 14)))), championshipWeek: Math.max(1, Math.min(18, Math.round(Number(input.championshipWeek || 17)))),
      playoffTeams: Math.max(2, Math.min(teams.length, Math.round(Number(input.playoffTeams || Math.min(6, teams.length))))),
      settings: { ...profile.settings, supported: profile.supported, irSlots: profile.irSlots, lineupLockType: profile.lineupLockType, customScoring: profile.customScoring },
      scoringLabel: profile.settings.scoring === "custom" ? "Custom scoring" : profile.settings.scoring === "half-ppr" ? "Half PPR" : profile.settings.scoring === "standard" ? "Standard" : "PPR",
      transactions: normalizeTransactions({ ...(input.transactions || {}), irSlots: input.transactions?.irSlots ?? input.irSlots ?? input.settings?.irSlots ?? input.profile?.irSlots ?? null }), playerProjections,
      recognizedPlayers: teams.reduce((sum, team) => sum + team.rosterIds.length, 0), unmatchedPlayers: teams.reduce((sum, team) => sum + team.unmatchedPlayers.length, 0), syncedAt: Number(input.syncedAt || Date.now()),
    };
  }

  function parseCsv(text) {
    const rows = [], row = [];
    let cell = "", quoted = false;
    const pushCell = () => { row.push(cell); cell = ""; };
    const pushRow = () => { pushCell(); if (row.some((value) => String(value).trim() !== "")) rows.push(row.splice(0)); else row.splice(0); };
    for (let index = 0; index < String(text).length; index += 1) {
      const char = String(text)[index];
      if (char === '"') {
        if (quoted && String(text)[index + 1] === '"') { cell += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === "," && !quoted) pushCell();
      else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && String(text)[index + 1] === "\n") index += 1; pushRow(); }
      else cell += char;
    }
    if (cell || row.length) pushRow();
    if (!rows.length) return [];
    const headers = rows.shift().map((value) => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
    return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }

  function jsonCell(value, fallback = null) {
    if (!String(value || "").trim()) return fallback;
    try { return JSON.parse(String(value)); } catch (_) { throw new RangeError("League CSV contains invalid embedded JSON."); }
  }

  function csvLeagueInput(text) {
    const rows = parseCsv(text);
    if (!rows.length) throw new RangeError("League CSV is empty.");
    const leagueRow = rows.find((row) => ["league", "settings"].includes(String(row.row_type || row.type).toLowerCase())) || {};
    const transactionRow = rows.find((row) => String(row.row_type || row.type).toLowerCase() === "transaction") || {};
    const teamMap = new Map();
    for (const row of rows.filter((item) => ["", "roster", "player"].includes(String(item.row_type || item.type || "").toLowerCase()))) {
      const teamId = String(row.team_id || "").trim();
      if (!teamId) continue;
      if (!teamMap.has(teamId)) teamMap.set(teamId, { teamId, name: row.team_name || "Team " + teamId, rosterEntries: [], wins: row.wins, losses: row.losses, ties: row.ties, pointsFor: row.points_for, transactions: { faabSpent: row.faab_spent, faabRemaining: row.faab_remaining, waiverPriority: row.waiver_priority, acquisitions: row.acquisitions, irUsed: row.ir_used } });
      teamMap.get(teamId).rosterEntries.push({ playerId: row.player_id, playerName: row.player_name, lineupSlot: row.lineup_slot, locked: row.locked, currentPoints: row.current_points, final: row.final, kickoff: row.kickoff });
    }
    const schedule = rows.filter((row) => String(row.row_type || row.type).toLowerCase() === "schedule").map((row) => ({ week: row.week, homeTeamId: row.home_team_id || row.team1, awayTeamId: row.away_team_id || row.team2 }));
    const projections = rows.filter((row) => String(row.row_type || row.type).toLowerCase() === "projection").map((row) => ({ playerId: row.player_id, playerName: row.player_name, projectionStats: jsonCell(row.projection_stats_json), weeklyProjectionStats: jsonCell(row.weekly_projection_stats_json) }));
    const slots = {}; for (const slot of ["qb", "rb", "wr", "te", "flex", "superflex", "dst", "k", "bn"]) if (leagueRow["slot_" + slot] !== undefined && leagueRow["slot_" + slot] !== "") slots[slot.toUpperCase()] = Number(leagueRow["slot_" + slot]);
    return { source: "csv", provider: "import", name: leagueRow.league_name || leagueRow.name || "Imported league", season: leagueRow.season, currentWeek: leagueRow.current_week, userTeamId: leagueRow.user_team_id, regularSeasonEnd: leagueRow.regular_season_end, championshipWeek: leagueRow.championship_week, playoffTeams: leagueRow.playoff_teams, settings: { teams: teamMap.size, scoring: leagueRow.scoring || "ppr", slots, lineupLockType: leagueRow.lineup_lock_type || "INDIVIDUAL_GAME", irSlots: leagueRow.ir_slots, customScoring: jsonCell(leagueRow.custom_scoring_json) }, transactions: { faabBudget: transactionRow.faab_budget, acquisitionLimit: transactionRow.acquisition_limit, tradeDeadline: transactionRow.trade_deadline, rosterLimit: transactionRow.roster_limit, irSlots: transactionRow.ir_slots, waiverType: transactionRow.waiver_type, rosterLockType: transactionRow.roster_lock_type, lockDroppedPlayersAfterKickoff: boolOrNull(transactionRow.lock_dropped_players_after_kickoff), complete: boolOrNull(transactionRow.complete) === true }, teams: [...teamMap.values()], fantasySchedule: schedule, playerProjections: projections };
  }

  function parseLeagueImport(text, players = []) {
    const source = String(text || "").trim();
    if (!source) throw new RangeError("Choose a league JSON/CSV file or paste league data first.");
    let parsed;
    if (source.startsWith("{") || source.startsWith("[")) {
      try { parsed = JSON.parse(source); } catch (_) { throw new RangeError("League JSON is not valid JSON."); }
      if (Array.isArray(parsed)) throw new RangeError("League JSON must be an object with teams, rules, and schedule fields.");
    } else parsed = csvLeagueInput(source);
    return normalizeLeagueState(parsed, players);
  }

  function leagueImportTemplate() {
    return { version: "snapcount-league-state-2026.1", name: "My League", season: 2026, currentWeek: 1, userTeamId: "1", settings: { scoring: "ppr", lineupLockType: "INDIVIDUAL_GAME", slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, DST: 1, K: 1, BN: 6 } }, transactions: { faabBudget: 100, acquisitionLimit: -1, tradeDeadline: null, rosterLimit: 15, irSlots: 1, complete: false }, teams: [{ teamId: "1", name: "My Team", rosterEntries: [{ playerId: "4429795", playerName: "Jahmyr Gibbs", lineupSlot: "RB", locked: false, currentPoints: 0 }] }, { teamId: "2", name: "Opponent", rosterEntries: [] }], fantasySchedule: { 1: [["1", "2"]] }, playerProjections: {} };
  }

  return {
    VERSION,
    availablePlayers,
    customProjectionFamily,
    isQualifiedPprDraftScope,
    leagueImportTemplate,
    lineupConstraintsForTeam,
    normalizeCustomScoring,
    normalizeLeagueState,
    normalizeLineupSlot,
    normalizeProfile,
    normalizeTransactions,
    parseLeagueImport,
    playerForScoring,
    rosteredPlayerIds,
    scoreStatLine,
    scoringName,
    starterCoverage,
    transactionFeasibility,
    transactionStateForTeam,
  };
});

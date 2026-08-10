(function attachEspnFantasy(root, factory) {
  const sourceApi = typeof module !== "undefined" && module.exports ? require("./sources.js") : root.OracleSources;
  const api = factory(sourceApi);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleEspnFantasy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createEspnFantasy(sources) {
  "use strict";

  const VERSION = "oracle-espn-fantasy-browser-2026.1";
  const ESPN_FANTASY_ORIGIN = "https://lm-api-reads.fantasy.espn.com";

  function normalizeName(value) {
    if (sources?.normalizeName) return sources.normalizeName(value);
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function safeSeason(value, fallback = 2026) {
    const season = Math.round(Number(value || fallback));
    if (season < 2000 || season > 2100) throw new RangeError("Invalid ESPN fantasy season");
    return season;
  }

  function parseLeagueInput(input, fallbackSeason = 2026) {
    const text = String(input || "").trim();
    if (/^\d+$/.test(text)) return { leagueId: text, season: safeSeason(fallbackSeason) };
    let url;
    try { url = new URL(text); } catch (_) { throw new TypeError("Enter an ESPN league link or numeric league ID"); }
    if (!/(^|\.)espn\.com$/i.test(url.hostname)) throw new TypeError("Enter a fantasy.espn.com league link");
    const leagueId = String(url.searchParams.get("leagueId") || "").trim();
    if (!/^\d+$/.test(leagueId)) throw new TypeError("The ESPN link does not contain a valid leagueId");
    const season = safeSeason(url.searchParams.get("seasonId") || fallbackSeason);
    return { leagueId, season };
  }

  function leagueApiUrl(leagueId, season = 2026) {
    const id = String(leagueId || "").trim();
    if (!/^\d+$/.test(id)) throw new TypeError("Invalid ESPN league ID");
    const year = safeSeason(season);
    const url = new URL(`/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${id}`, ESPN_FANTASY_ORIGIN);
    ["mTeam", "mRoster", "mSettings", "mStatus", "mMatchup"].forEach((view) => url.searchParams.append("view", view));
    return url.href;
  }

  function friendlyLoadError(error, options = {}) {
    const message = String(error?.message || error || "ESPN sync failed");
    if (/HTTP\s+(401|403)/i.test(message)) {
      const result = options.browserSession
        ? new Error("ESPN did not accept this browser session. Sign in to ESPN in this browser and retry; some browsers may also block cross-site session cookies.")
        : new Error("This league needs an ESPN sign-in. SnapCount can try your browser's ESPN sign-in directly without reading or storing the cookie.");
      result.code = options.browserSession ? "ESPN_SESSION_FAILED" : "ESPN_AUTH_REQUIRED";
      return result;
    }
    if (/HTTP\s+404/i.test(message)) return new Error("SnapCount couldn't find that ESPN league for the selected season. Check the league link and season.");
    return error instanceof Error ? error : new Error(message);
  }

  async function loadLeague(input, fallbackSeason = 2026, options = {}) {
    const parsed = parseLeagueInput(input, fallbackSeason);
    const browserSession = options.browserSession === true;
    try {
      const raw = await sources.fetchJson("espnFantasy", leagueApiUrl(parsed.leagueId, parsed.season), { timeoutMs: 20_000, maxBytes: 24 * 1024 * 1024, credentials: browserSession ? "include" : "omit" });
      return { raw, ...parsed, browserSession };
    } catch (error) {
      throw friendlyLoadError(error, { browserSession });
    }
  }

  function teamName(team) {
    const direct = String(team?.name || "").trim();
    if (direct) return direct;
    const parts = [team?.location, team?.nickname].map((value) => String(value || "").trim()).filter(Boolean);
    return parts.join(" ") || `Team ${team?.id ?? "?"}`;
  }

  function buildPlayerIndexes(localPlayers) {
    const byId = new Map();
    const byName = new Map();
    for (const player of localPlayers || []) {
      byId.set(String(player.id), player);
      const key = normalizeName(player.name);
      if (!key) continue;
      const rows = byName.get(key) || [];
      rows.push(player);
      byName.set(key, rows);
    }
    return { byId, byName };
  }

  function matchLocalPlayer(espnPlayer, indexes) {
    const byId = indexes.byId.get(String(espnPlayer?.id ?? ""));
    if (byId) return byId;
    const name = normalizeName(espnPlayer?.fullName || espnPlayer?.name);
    const candidates = indexes.byName.get(name) || [];
    if (candidates.length === 1) return candidates[0];
    const position = String(espnPlayer?.defaultPositionId || "");
    return candidates.find((player) => String(player.espnPositionId || "") === position) || candidates[0] || null;
  }

  function recordSummary(team) {
    const record = team?.record?.overall || team?.record || {};
    const wins = Number(record.wins || 0);
    const losses = Number(record.losses || 0);
    const ties = Number(record.ties || 0);
    return {
      wins,
      losses,
      ties,
      pointsFor: Number(record.pointsFor || 0),
      recordLabel: `${wins}-${losses}${ties ? `-${ties}` : ""}`,
    };
  }

  function scheduleTeamId(side) {
    const value = side?.teamId ?? side?.team?.id ?? side?.id;
    return value === undefined || value === null || value === "" ? null : String(value);
  }

  function normalizeFantasySchedule(rows = []) {
    const byWeek = {};
    for (const row of rows || []) {
      const week = Math.round(Number(row?.scoringPeriodId ?? row?.matchupPeriodId ?? row?.periodId ?? 0));
      const home = scheduleTeamId(row?.home);
      const away = scheduleTeamId(row?.away);
      if (!(week >= 1 && week <= 18) || !home || !away || home === away) continue;
      if (!byWeek[week]) byWeek[week] = [];
      const key = [home, away].sort().join("|");
      if (!byWeek[week].some((pair) => [...pair].sort().join("|") === key)) byWeek[week].push([home, away]);
    }
    return Object.fromEntries(Object.entries(byWeek).sort((left, right) => Number(left[0]) - Number(right[0])));
  }

  const ESPN_SLOT_MAP = Object.freeze({
    "0": "QB", "2": "RB", "4": "WR",
    "6": "TE", "7": "SUPERFLEX", "16": "DST", "17": "K", "20": "BN", "23": "FLEX",
  });

  function scoringPreset(scoringSettings = {}) {
    const reception = (scoringSettings.scoringItems || []).find((row) => Number(row?.statId) === 53);
    const receptionPoints = Number(reception?.points);
    if (Number.isFinite(receptionPoints)) {
      if (receptionPoints >= 0.75) return "ppr";
      if (receptionPoints <= 0.25) return "standard";
      return "half-ppr";
    }
    const label = String(scoringSettings.playerRankType || "").toUpperCase();
    if (label.includes("HALF")) return "half-ppr";
    if (label.includes("STANDARD")) return "standard";
    return "ppr";
  }

  const BASE_OFFENSIVE_SCORING = Object.freeze({ "3": 0.04, "4": 4, "20": -2, "24": 0.1, "25": 6, "42": 0.1, "43": 6 });

  function unsupportedOffensiveScoring(scoringSettings = {}) {
    const unsupported = [];
    for (const row of scoringSettings.scoringItems || []) {
      const statId = String(row?.statId ?? "");
      if (!(statId in BASE_OFFENSIVE_SCORING)) continue;
      const points = Number(row?.points);
      if (Number.isFinite(points) && Math.abs(points - BASE_OFFENSIVE_SCORING[statId]) > 1e-9) unsupported.push(statId);
    }
    return [...new Set(unsupported)].sort((a, b) => Number(a) - Number(b));
  }

  function normalizeEspnSettings(settings = {}, teamCount = 12) {
    const roster = settings.rosterSettings || {};
    const counts = roster.lineupSlotCounts || {};
    const slots = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, DST: 0, K: 0, BN: 0 };
    const unsupportedStarterSlotIds = [];
    for (const [slotId, rawCount] of Object.entries(counts)) {
      const count = Math.max(0, Math.round(Number(rawCount || 0)));
      if (!count) continue;
      const mapped = ESPN_SLOT_MAP[String(slotId)];
      if (mapped) slots[mapped] += count;
      else if (String(slotId) !== "21") unsupportedStarterSlotIds.push(String(slotId));
    }
    const unsupportedScoringStatIds = unsupportedOffensiveScoring(settings.scoringSettings || {});
    return {
      teams: Math.max(4, Math.min(20, Math.round(Number(teamCount || 12)))),
      scoring: scoringPreset(settings.scoringSettings || {}),
      slots,
      irSlots: Math.max(0, Math.round(Number(counts[21] || counts["21"] || 0))),
      lineupLockType: String(roster.lineupLocktimeType || "UNKNOWN"),
      rosterLockType: String(roster.rosterLocktimeType || "UNKNOWN"),
      supported: unsupportedStarterSlotIds.length === 0 && unsupportedScoringStatIds.length === 0,
      unsupportedStarterSlotIds: unsupportedStarterSlotIds.sort((a, b) => Number(a) - Number(b)),
      unsupportedScoringStatIds,
    };
  }

  function normalizeLeague(raw, localPlayers = []) {
    const indexes = buildPlayerIndexes(localPlayers);
    const members = new Map((raw?.members || []).map((member) => [String(member.id), member]));
    const teams = (raw?.teams || []).map((team, index) => {
      const entries = team?.roster?.entries || [];
      const rosterIds = [];
      const unmatchedPlayers = [];
      for (const entry of entries) {
        const espnPlayer = entry?.playerPoolEntry?.player || entry?.player || null;
        if (!espnPlayer) continue;
        const local = matchLocalPlayer(espnPlayer, indexes);
        if (local) rosterIds.push(String(local.id));
        else if (espnPlayer.fullName || espnPlayer.name) unmatchedPlayers.push(String(espnPlayer.fullName || espnPlayer.name));
      }
      const ownerId = String(team?.primaryOwner || team?.owners?.[0] || "");
      const record = recordSummary(team);
      return {
        teamId: String(team?.id ?? index + 1),
        name: teamName(team),
        abbrev: String(team?.abbrev || "").trim(),
        ownerName: String(members.get(ownerId)?.displayName || "").trim(),
        rosterIds: [...new Set(rosterIds)],
        unmatchedPlayers,
        ...record,
      };
    });
    const scoringLabel = String(raw?.settings?.scoringSettings?.playerRankType || "ESPN scoring").replace(/_/g, " ");
    const fantasySchedule = normalizeFantasySchedule(raw?.schedule || []);
    const leagueSettings = normalizeEspnSettings(raw?.settings || {}, teams.length || 12);
    const regularSeasonEnd = Math.max(1, Number(raw?.settings?.scheduleSettings?.matchupPeriodCount || 14));
    const championshipWeek = Math.max(regularSeasonEnd + 1, Number(raw?.status?.finalScoringPeriod || raw?.settings?.scheduleSettings?.finalScoringPeriod || 17));
    return {
      provider: "espn",
      leagueId: String(raw?.id ?? ""),
      season: safeSeason(raw?.seasonId || 2026),
      name: String(raw?.settings?.name || raw?.name || "ESPN Fantasy League"),
      currentWeek: Math.max(1, Number(raw?.status?.currentScoringPeriod || raw?.scoringPeriodId || 1)),
      playoffTeams: Math.max(0, Number(raw?.settings?.scheduleSettings?.playoffTeamCount || 0)),
      regularSeasonEnd,
      championshipWeek,
      fantasySchedule,
      settings: leagueSettings,
      scoringLabel,
      teams,
      recognizedPlayers: teams.reduce((sum, team) => sum + team.rosterIds.length, 0),
      unmatchedPlayers: teams.reduce((sum, team) => sum + team.unmatchedPlayers.length, 0),
      syncedAt: new Date().toISOString(),
    };
  }

  return {
    VERSION,
    ESPN_FANTASY_ORIGIN,
    friendlyLoadError,
    leagueApiUrl,
    loadLeague,
    normalizeFantasySchedule,
    normalizeEspnSettings,
    normalizeLeague,
    parseLeagueInput,
  };
});

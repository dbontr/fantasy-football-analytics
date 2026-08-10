(function init(root, factory) {
  const core = typeof module !== "undefined" && module.exports ? require("./core.js") : root.FantasyOracleCore;
  const api = factory(core);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnapCountLeague = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createLeagueApi(core) {
  "use strict";

  const VERSION = "snapcount-league-profile-2026.1";
  const SCORING = new Set(["ppr", "half-ppr", "standard", "superflex"]);

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
    return {
      version: VERSION,
      source: String(input.source || "manual"),
      provider: input.provider ? String(input.provider) : null,
      supported: input.supported !== false,
      settings,
      irSlots: Math.max(0, Math.round(Number(input.irSlots || 0))),
      lineupLockType: String(input.lineupLockType || "UNKNOWN"),
      unsupportedStarterSlotIds: [...(input.unsupportedStarterSlotIds || [])].map(String),
    };
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

  return {
    VERSION,
    availablePlayers,
    isQualifiedPprDraftScope,
    normalizeProfile,
    playerForScoring,
    rosteredPlayerIds,
    scoringName,
    starterCoverage,
  };
});

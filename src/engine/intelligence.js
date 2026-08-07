(function attachOraclePlayerIntelligence(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OraclePlayerIntelligence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlayerIntelligence() {
  "use strict";

  const VERSION = "oracle-player-intelligence-2026.3";
  const REQUIRED_FIELDS = [
    "player_id", "player_display_name", "position", "season", "week", "season_type", "game_id",
    "team", "opponent_team", "attempts", "passing_yards", "passing_tds", "passing_interceptions",
    "carries", "rushing_yards", "rushing_tds", "receptions", "targets", "receiving_yards",
    "receiving_tds", "receiving_air_yards", "receiving_yards_after_catch", "target_share",
    "air_yards_share", "wopr", "fantasy_points", "fantasy_points_ppr",
  ];

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function nullable(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }

  function normalizeName(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/[^a-z0-9]/g, "");
  }

  function canonicalTeam(value) {
    const team = String(value || "").trim().toUpperCase();
    return ({ LAR: "LA", STL: "LA", WSH: "WAS", JAC: "JAX", OAK: "LV", SD: "LAC" })[team] || team;
  }

  function parseCsvLine(line) {
    const fields = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index <= line.length; index += 1) {
      const char = line[index] ?? ",";
      const next = line[index + 1];
      if (quoted) {
        if (char === '"' && next === '"') { field += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { fields.push(field); field = ""; }
      else field += char;
    }
    return fields;
  }

  function compactWeeklyRow(values, columns) {
    const get = (name) => values[columns[name]] ?? "";
    const row = {
      playerId: get("player_id"), name: get("player_display_name"), position: get("position"),
      season: finite(get("season")), week: finite(get("week")), seasonType: get("season_type"),
      gameId: get("game_id"), team: get("team"), opponent: get("opponent_team"),
      attempts: finite(get("attempts")), passingYards: finite(get("passing_yards")),
      passingTds: finite(get("passing_tds")), interceptions: finite(get("passing_interceptions")),
      carries: finite(get("carries")), rushingYards: finite(get("rushing_yards")), rushingTds: finite(get("rushing_tds")),
      receptions: finite(get("receptions")), targets: finite(get("targets")), receivingYards: finite(get("receiving_yards")),
      receivingTds: finite(get("receiving_tds")), receivingAirYards: finite(get("receiving_air_yards")),
      receivingYac: finite(get("receiving_yards_after_catch")), targetShare: nullable(get("target_share")),
      airYardsShare: nullable(get("air_yards_share")), wopr: nullable(get("wopr")),
      fantasyPoints: finite(get("fantasy_points")), fantasyPpr: finite(get("fantasy_points_ppr")),
    };
    row.opportunities = row.carries + row.targets;
    row.touches = row.carries + row.receptions;
    row.scrimmageYards = row.rushingYards + row.receivingYards;
    row.totalTds = row.passingTds + row.rushingTds + row.receivingTds;
    return row;
  }

  function parseWeeklyStatsCsv(text) {
    const lines = String(text || "").split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]);
    const columns = Object.fromEntries(headers.map((name, index) => [name, index]));
    for (const field of REQUIRED_FIELDS) {
      if (!Number.isInteger(columns[field])) throw new Error(`nflverse weekly stats missing field: ${field}`);
    }
    const rows = [];
    for (let index = 1; index < lines.length; index += 1) {
      const values = parseCsvLine(lines[index]);
      const row = compactWeeklyRow(values, columns);
      if (row.name && row.week > 0) rows.push(row);
    }
    return rows;
  }

  function indexWeeklyRows(rows) {
    const byNamePosition = new Map();
    const byName = new Map();
    const teamCarries = new Map();
    const defenseGameTotals = new Map();
    const supported = new Set(["QB", "RB", "WR", "TE"]);
    for (const row of rows || []) {
      const carryKey = [row.season, row.week, row.seasonType, row.team].join("|");
      teamCarries.set(carryKey, finite(teamCarries.get(carryKey)) + Math.max(0, finite(row.carries)));
      const position = String(row.position || "").toUpperCase();
      if (row.seasonType === "REG" && row.opponent && supported.has(position)) {
        const defenseKey = [row.season, row.week, canonicalTeam(row.opponent), position].join("|");
        defenseGameTotals.set(defenseKey, finite(defenseGameTotals.get(defenseKey)) + Math.max(0, finite(row.fantasyPpr)));
      }
    }
    const defenseAggregate = new Map();
    const leagueAggregate = new Map();
    for (const [key, points] of defenseGameTotals) {
      const [, , defense, position] = key.split("|");
      const defenseKey = `${defense}|${position}`;
      const current = defenseAggregate.get(defenseKey) || { points: 0, games: 0 };
      current.points += points; current.games += 1; defenseAggregate.set(defenseKey, current);
      const league = leagueAggregate.get(position) || { points: 0, games: 0 };
      league.points += points; league.games += 1; leagueAggregate.set(position, league);
    }
    const defenseProfiles = {};
    for (const [key, aggregate] of defenseAggregate) {
      const [defense, position] = key.split("|");
      const league = leagueAggregate.get(position);
      const leagueAverage = league?.games ? league.points / league.games : 0;
      if (!leagueAverage || aggregate.games < 3) continue;
      const rawAverage = aggregate.points / aggregate.games;
      const priorGames = 4;
      const shrunkAverage = (aggregate.points + leagueAverage * priorGames) / (aggregate.games + priorGames);
      const grade = clamp((shrunkAverage / leagueAverage - 1) / 0.22, -1, 1);
      if (!defenseProfiles[defense]) defenseProfiles[defense] = {};
      defenseProfiles[defense][position] = {
        games: aggregate.games, rawAverage, shrunkAverage, leagueAverage, grade,
        confidence: clamp(0.24 + aggregate.games / 17 * 0.18, 0.24, 0.42),
      };
    }
    for (const row of rows || []) {
      const teamKey = [row.season, row.week, row.seasonType, row.team].join("|");
      const teamTotal = finite(teamCarries.get(teamKey));
      row.carryShare = teamTotal > 0 ? clamp(row.carries / teamTotal, 0, 1) : null;
      const name = normalizeName(row.name);
      const positionKey = `${name}|${String(row.position || "").toUpperCase()}`;
      if (!byNamePosition.has(positionKey)) byNamePosition.set(positionKey, []);
      if (!byName.has(name)) byName.set(name, []);
      byNamePosition.get(positionKey).push(row);
      byName.get(name).push(row);
    }
    return { byNamePosition, byName, defenseProfiles, rows: rows?.length || 0 };
  }

  function findPlayerRows(index, player, options = {}) {
    if (!index || !player) return [];
    const name = normalizeName(player.name || player.player_display_name);
    const position = String(player.position || "").toUpperCase();
    let rows = index.byNamePosition?.get(`${name}|${position}`) || index.byName?.get(name) || [];
    if (options.seasonType) rows = rows.filter((row) => row.seasonType === options.seasonType);
    const exactTeam = rows.filter((row) => String(row.team).toUpperCase() === String(player.team || "").toUpperCase());
    if (exactTeam.length >= Math.min(3, rows.length)) rows = exactTeam;
    return [...rows].sort((a, b) => a.season - b.season || a.week - b.week);
  }

  function average(rows, field) {
    const values = (rows || []).map((row) => row[field]).filter((value) => Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function standardDeviation(values) {
    if (!values.length) return 0;
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
  }

  function summarizeWindow(rows, count) {
    const selected = count ? rows.slice(-count) : rows;
    const ppr = selected.map((row) => row.fantasyPpr);
    return {
      games: selected.length, ppr: average(selected, "fantasyPpr"), opportunities: average(selected, "opportunities"),
      targets: average(selected, "targets"), carries: average(selected, "carries"), touches: average(selected, "touches"),
      scrimmageYards: average(selected, "scrimmageYards"), passingYards: average(selected, "passingYards"),
      touchdowns: average(selected, "totalTds"), targetShare: average(selected, "targetShare"),
      carryShare: average(selected, "carryShare"), wopr: average(selected, "wopr"),
      volatility: standardDeviation(ppr),
    };
  }

  function summarizeHistory(rows) {
    const games = (rows || []).filter((row) => row.seasonType === "REG");
    const last3 = summarizeWindow(games, 3);
    const last5 = summarizeWindow(games, 5);
    const season = summarizeWindow(games, null);
    let trend = { direction: "stable", available: false, fantasyDelta: 0, opportunityDelta: 0, targetShareDelta: 0, score: 0 };
    if (games.length >= 6) {
      const previous3Rows = games.slice(-6, -3);
      const previous3 = summarizeWindow(previous3Rows, null);
      const fantasyDelta = finite(last3.ppr) - finite(previous3.ppr);
      const opportunityDelta = finite(last3.opportunities) - finite(previous3.opportunities);
      const targetShareDelta = finite(last3.targetShare) - finite(previous3.targetShare);
      const score = fantasyDelta / 4 + opportunityDelta / 3 + targetShareDelta * 10;
      trend = {
        available: true, fantasyDelta, opportunityDelta, targetShareDelta, score,
        direction: score > 0.7 ? "up" : score < -0.7 ? "down" : "stable",
      };
    }
    const consistency = season.games && finite(season.ppr) > 0
      ? 1 - clamp(season.volatility / Math.max(3, season.ppr * 1.2), 0, 1) : 0;
    return { games: games.length, last3, last5, season, trend, consistency };
  }

  function historyEvidence(summary, player, options = {}) {
    const evidence = {};
    const historySeason = Number(options.historySeason || options.season || 0);
    const targetSeason = Number(options.targetSeason || historySeason || 0);
    const seasonGap = Math.max(0, targetSeason - historySeason);
    const recencyMultiplier = seasonGap === 0 ? 1 : seasonGap === 1 ? 0.65 : 0.45;
    const sourcePrefix = seasonGap ? "nflverse prior-season" : "nflverse current-season";
    if (summary?.last3?.games >= 3 && Number.isFinite(summary.last3.targetShare) && ["RB", "WR", "TE"].includes(String(player?.position || ""))) {
      evidence["role.target_share"] = {
        available: true, value: clamp(summary.last3.targetShare, 0, 0.65),
        confidence: clamp((0.52 + summary.last3.games * 0.04) * recencyMultiplier, 0.2, 0.72), conflict: 0,
        source: sourcePrefix + " game log",
      };
    }
    if (summary?.last3?.games >= 3 && Number.isFinite(summary.last3.carryShare) && ["RB", "QB"].includes(String(player?.position || ""))) {
      evidence["role.carry_share"] = {
        available: true, value: clamp(summary.last3.carryShare, 0, 0.9),
        confidence: clamp((0.54 + summary.last3.games * 0.04) * recencyMultiplier, 0.2, 0.74), conflict: 0,
        source: sourcePrefix + " derived team carry share",
      };
    }
    return evidence;
  }

  function defenseMatchupEvidence(defenseProfiles, player, opponent) {
    const position = String(player?.position || "").toUpperCase();
    if (!["QB", "RB", "WR", "TE"].includes(position) || !opponent) return {};
    const normalizedOpponent = canonicalTeam(opponent);
    const profile = defenseProfiles?.[normalizedOpponent]?.[position];
    if (!profile || profile.games < 3) return {};
    return {
      "matchup.position_grade": {
        available: true, value: clamp(profile.grade, -1, 1), confidence: clamp(profile.confidence, 0, 0.5),
        conflict: 0.08, source: "nflverse prior-season position fantasy points allowed",
        opponent: normalizedOpponent, games: profile.games,
      },
    };
  }
  function currentHealth(player) {
    const sleeper = player?.sleeper || {};
    const live = Boolean(player?.sleeper);
    const status = String(player?.injuryStatus || sleeper.status || "ACTIVE").toUpperCase();
    const practice = sleeper.practiceParticipation || null;
    const bodyPart = sleeper.injuryBodyPart || null;
    const notes = sleeper.injuryNotes || null;
    const depth = Number.isFinite(Number(sleeper.depthChartOrder)) ? Number(sleeper.depthChartOrder) : null;
    return { status, practice, bodyPart, notes, live, source: live ? "Sleeper" : "bootstrap", injuryStartDate: sleeper.injuryStartDate || null, newsUpdated: sleeper.newsUpdated || null, depthChartOrder: depth, depthChartPosition: sleeper.depthChartPosition || null };
  }

  function generateOutlook(player, forecast, summary) {
    const health = currentHealth(player);
    const bullets = [];
    const mean = finite(forecast?.distribution?.mean, forecast?.baseline?.mean);
    const p90 = finite(forecast?.distribution?.p90);
    const active = clamp(forecast?.availability?.probability ?? 0.99, 0, 1);
    bullets.push(`Week ${forecast?.week || "?"} model: ${mean.toFixed(1)} mean, ${p90.toFixed(1)} P90 ceiling, ${(active * 100).toFixed(0)}% active probability.`);
    if (summary?.last3?.games) {
      const usage = summary.last3.opportunities === null ? "" : ` on ${summary.last3.opportunities.toFixed(1)} opportunities/game`;
      bullets.push(`Last ${summary.last3.games}: ${finite(summary.last3.ppr).toFixed(1)} PPR points/game${usage}.`);
    }
    if (summary?.trend?.available) {
      bullets.push(`Recent role/form trend is ${summary.trend.direction.toUpperCase()}: ${summary.trend.fantasyDelta >= 0 ? "+" : ""}${summary.trend.fantasyDelta.toFixed(1)} PPR and ${summary.trend.opportunityDelta >= 0 ? "+" : ""}${summary.trend.opportunityDelta.toFixed(1)} opportunities/game versus the prior three.`);
    }
    if (Number.isFinite(summary?.last3?.targetShare)) bullets.push(`Recent target share: ${(summary.last3.targetShare * 100).toFixed(1)}%.`);
    if (["RB", "QB"].includes(String(player?.position || "")) && Number.isFinite(summary?.last3?.carryShare)) {
      bullets.push(`Recent team carry share: ${(summary.last3.carryShare * 100).toFixed(1)}%.`);
    }
    if (health.live && (health.status !== "ACTIVE" || health.practice || health.bodyPart || health.notes)) {
      const parts = [health.status !== "ACTIVE" ? health.status : null, health.practice, health.bodyPart, health.notes].filter(Boolean);
      bullets.push(`Current Sleeper health evidence: ${parts.join(" · ")}.`);
    } else if (!health.live) {
      bullets.push(`Live Sleeper status unavailable; availability still reflects the bootstrap/model prior (${health.status}).`);
    }
    if (health.depthChartOrder) bullets.push(`Depth chart: ${health.depthChartPosition || player.position} ${health.depthChartOrder}.`);
    const volatility = finite(summary?.season?.volatility);
    let risk = "LOW";
    if (active < 0.8 || ["DOUBTFUL", "OUT", "IR", "PUP"].includes(health.status)) risk = "HIGH";
    else if (active < 0.93 || health.status === "QUESTIONABLE" || volatility > Math.max(7, mean * 0.55)) risk = "MEDIUM";
    const historyConfidence = clamp((summary?.games || 0) / 8, 0, 1);
    const modelConfidence = clamp(forecast?.baseline?.reliability ?? 0.65, 0, 1);
    const confidence = clamp(modelConfidence * 0.7 + historyConfidence * 0.3, 0.1, 0.98);
    const direction = summary?.trend?.available ? summary.trend.direction.toUpperCase() : "STABLE";
    return {
      direction, risk, confidence, health, bullets,
      headline: `${direction} · ${risk} RISK · ${(confidence * 100).toFixed(0)}% CONFIDENCE`,
      provenance: "Generated locally from Oracle forecast, nflverse game logs, and available Sleeper status fields.",
    };
  }

  return {
    VERSION, currentHealth, defenseMatchupEvidence, findPlayerRows, generateOutlook, historyEvidence, indexWeeklyRows,
    normalizeName, parseCsvLine, parseWeeklyStatsCsv, summarizeHistory, summarizeWindow,
  };
});

(function attachOracleLiveIntelligence(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleLiveIntelligence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createLiveIntelligence() {
  "use strict";

  const VERSION = "oracle-live-intelligence-2026.1";
  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }
  function numericStat(value) {
    const text = String(value ?? "0");
    if (text.includes("/")) return text.split("/").map(Number);
    return finite(text.replace(/[^0-9.-]/g, ""));
  }
  function ensurePlayer(map, athlete, team, gameId, date) {
    const id = String(athlete?.id || "");
    if (!id) return null;
    if (!map.has(id)) map.set(id, { id, name: athlete.displayName || athlete.fullName || "Unknown", team, gameId, date, passingAttempts: 0, passingYards: 0, passingTds: 0, interceptions: 0, carries: 0, rushingYards: 0, rushingTds: 0, receptions: 0, targets: 0, receivingYards: 0, receivingTds: 0 });
    return map.get(id);
  }

  function parseEspnPreseasonSummary(summary) {
    const gameId = String(summary?.header?.id || summary?.header?.competitions?.[0]?.id || "");
    const date = summary?.header?.competitions?.[0]?.date || summary?.gameInfo?.date || null;
    const players = new Map();
    for (const teamBlock of summary?.boxscore?.players || []) {
      const team = String(teamBlock?.team?.abbreviation || "").toUpperCase();
      for (const category of teamBlock?.statistics || []) {
        const keys = category.keys || [];
        for (const row of category.athletes || []) {
          const target = ensurePlayer(players, row.athlete, team, gameId, date);
          if (!target) continue;
          const values = Object.fromEntries(keys.map((key, index) => [key, numericStat(row.stats?.[index])]));
          if (category.name === "passing") {
            const compAtt = values["completions/passingAttempts"];
            target.passingAttempts += Array.isArray(compAtt) ? finite(compAtt[1]) : 0;
            target.passingYards += finite(values.passingYards);
            target.passingTds += finite(values.passingTouchdowns);
            target.interceptions += finite(values.interceptions);
          } else if (category.name === "rushing") {
            target.carries += finite(values.rushingAttempts);
            target.rushingYards += finite(values.rushingYards);
            target.rushingTds += finite(values.rushingTouchdowns);
          } else if (category.name === "receiving") {
            target.receptions += finite(values.receptions);
            target.targets += finite(values.receivingTargets);
            target.receivingYards += finite(values.receivingYards);
            target.receivingTds += finite(values.receivingTouchdowns);
          }
        }
      }
    }
    return [...players.values()];
  }

  function summarizePreseason(rows, player) {
    const id = String(player?.id || "");
    const games = (rows || []).filter((row) => String(row.id) === id);
    if (!games.length) return { games: 0, rows: [] };
    const totals = games.reduce((sum, row) => {
      for (const key of ["passingAttempts", "passingYards", "passingTds", "interceptions", "carries", "rushingYards", "rushingTds", "receptions", "targets", "receivingYards", "receivingTds"]) sum[key] += finite(row[key]);
      return sum;
    }, { passingAttempts: 0, passingYards: 0, passingTds: 0, interceptions: 0, carries: 0, rushingYards: 0, rushingTds: 0, receptions: 0, targets: 0, receivingYards: 0, receivingTds: 0 });
    const opportunities = totals.carries + totals.targets + totals.passingAttempts * (String(player.position) === "QB" ? 0.32 : 0);
    return {
      games: games.length,
      rows: games,
      totals,
      opportunities,
      opportunitiesPerGame: opportunities / games.length,
      scrimmageYards: totals.rushingYards + totals.receivingYards,
      touchdowns: totals.passingTds + totals.rushingTds + totals.receivingTds,
    };
  }

  function preseasonEvidence(summary, player) {
    if (!summary?.games || summary.opportunitiesPerGame < 4) return {};
    const rank = finite(player?.pprRank, finite(player?.adp, 150));
    const prospectWeight = rank <= 36 ? 0.35 : rank <= 80 ? 0.6 : 1;
    const value = clamp((summary.opportunitiesPerGame - 4) / 36, 0, 0.22);
    const confidence = clamp((0.16 + Math.min(0.1, summary.games * 0.035)) * prospectWeight, 0.06, 0.26);
    return {
      "preseason.usage_boost": { available: true, value, confidence, conflict: 0.12, source: "ESPN preseason boxscore usage", games: summary.games },
    };
  }

  function parseEspnMarketScoreboard(scoreboard) {
    const byTeam = {};
    for (const event of scoreboard?.events || []) {
      const competition = event?.competitions?.[0];
      const odds = competition?.odds?.[0];
      const total = Number(odds?.overUnder);
      const homeSpread = Number(odds?.spread);
      if (!Number.isFinite(total) || !Number.isFinite(homeSpread) || total <= 0) continue;
      const home = (competition.competitors || []).find((row) => row.homeAway === "home");
      const away = (competition.competitors || []).find((row) => row.homeAway === "away");
      const homeTeam = String(home?.team?.abbreviation || "").toUpperCase();
      const awayTeam = String(away?.team?.abbreviation || "").toUpperCase();
      if (!homeTeam || !awayTeam) continue;
      const homeImplied = (total - homeSpread) / 2;
      const awayImplied = (total + homeSpread) / 2;
      const common = { gameId: String(event.id || competition.id || ""), total, provider: odds?.provider?.displayName || odds?.provider?.name || "market", indoor: Boolean(competition?.venue?.indoor), venue: competition?.venue?.fullName || null, kickoff: event.date || competition.date || null };
      byTeam[homeTeam] = { ...common, team: homeTeam, opponent: awayTeam, spread: homeSpread, impliedPoints: homeImplied, home: true };
      byTeam[awayTeam] = { ...common, team: awayTeam, opponent: homeTeam, spread: -homeSpread, impliedPoints: awayImplied, home: false };
    }
    return byTeam;
  }

  function marketEvidence(row) {
    if (!row || !Number.isFinite(row.total) || !Number.isFinite(row.impliedPoints)) return {};
    return {
      "market.game_total": { available: true, value: clamp(row.total, 25, 70), confidence: 0.42, conflict: 0.08, source: "ESPN public game market", provider: row.provider },
      "market.team_implied_points": { available: true, value: clamp(row.impliedPoints, 10, 40), confidence: 0.46, conflict: 0.08, source: "ESPN public game market", provider: row.provider },
    };
  }

  function extractNewsPulse(news, players = []) {
    const playerByEspnId = new Map((players || []).map((player) => [String(player.id), player]));
    return (news?.articles || []).map((article) => {
      const athletes = (article.categories || []).filter((category) => category.type === "athlete");
      const teams = (article.categories || []).filter((category) => category.type === "team");
      const matched = athletes.map((category) => playerByEspnId.get(String(category.athleteId || category.athlete?.id))).filter(Boolean);
      return {
        id: String(article.id || article.contentKey || ""),
        headline: String(article.headline || "NFL update"),
        published: article.published || article.lastModified || null,
        url: article.links?.web?.href || null,
        premium: Boolean(article.premium),
        playerIds: matched.map((player) => String(player.id)),
        playerNames: matched.map((player) => player.name),
        teams: teams.map((category) => category.team?.abbreviation || category.description).filter(Boolean),
      };
    }).filter((article) => article.id && article.headline);
  }

  return {
    VERSION,
    extractNewsPulse,
    marketEvidence,
    parseEspnMarketScoreboard,
    parseEspnPreseasonSummary,
    preseasonEvidence,
    summarizePreseason,
  };
});

// Calibration is its own module, but this file is already parser-loaded after
// runtime + intelligence in the page and imported after them in the Web Worker.
// Bootstrap it synchronously here so both existing entry points receive the same
// calibrated engine without introducing a second application bootstrap path.
(function bootstrapSnapCountCalibration(root) {
  if (!root || root.SnapCountCalibration) return;
  if (typeof importScripts === "function" && typeof document === "undefined") {
    importScripts("./src/engine/calibration.js");
    return;
  }
  if (typeof document === "undefined") return;
  if (document.readyState === "loading") {
    document.write('<scr' + 'ipt src="./src/engine/calibration.js"></scr' + 'ipt>');
    return;
  }
  const script = document.createElement("script");
  script.src = "./src/engine/calibration.js";
  script.async = false;
  document.head.appendChild(script);
})(typeof globalThis !== "undefined" ? globalThis : this);

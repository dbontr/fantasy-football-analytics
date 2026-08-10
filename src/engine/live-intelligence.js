(function attachOracleLiveIntelligence(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleLiveIntelligence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createLiveIntelligence() {
  "use strict";

  const VERSION = "oracle-live-intelligence-2026.2";
  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }
  const CAMP_RULES = Object.freeze([
    { key: "role.first_team", family: "role", score: 0.9, weight: 1.0, phrases: ["first-team", "first team", "working with the ones", "runs with the ones", "starter reps", "starting reps"] },
    { key: "role.featured", family: "role", score: 0.7, weight: 0.9, phrases: ["lead back", "featured role", "primary receiver", "promoted", "every-down", "three-down"] },
    { key: "role.demoted", family: "role", score: -0.9, weight: 1.0, phrases: ["second-team", "second team", "third-team", "third team", "demoted", "buried", "losing reps", "lost reps", "backup reps"] },
    { key: "performance.positive", family: "performance", score: 0.5, weight: 0.55, phrases: ["standout", "standing out", "impressive", "sharp", "turning heads", "making plays", "strong camp", "explosive", "shined", "excellent"] },
    { key: "performance.negative", family: "performance", score: -0.55, weight: 0.6, phrases: ["struggling", "struggles", "rough practice", "rough day", "poor camp", "sluggish", "multiple drops", "couple of drops", "dropped passes", "mistakes"] },
    { key: "availability.negative", family: "availability", score: -0.45, weight: 0.7, phrases: ["held out", "sidelined", "missed practice", "not practicing", "left practice", "limited in practice"] },
  ]);
  const CAMP_CONTEXT = ["training camp", "preseason", "practice", "scrimmage", "reps", "depth chart", "roster battle", "position battle", "first-team", "first team", "second-team", "second team"];

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

  function opportunityValue(row, position) {
    return finite(row?.carries) + finite(row?.targets) + finite(row?.passingAttempts) * (String(position || "").toUpperCase() === "QB" ? 0.32 : 0);
  }

  function summarizePreseason(rows, player, roster = []) {
    const id = String(player?.id || "");
    const games = (rows || []).filter((row) => String(row.id) === id);
    if (!games.length) return { games: 0, rows: [] };
    const totals = games.reduce((sum, row) => {
      for (const key of ["passingAttempts", "passingYards", "passingTds", "interceptions", "carries", "rushingYards", "rushingTds", "receptions", "targets", "receivingYards", "receivingTds"]) sum[key] += finite(row[key]);
      return sum;
    }, { passingAttempts: 0, passingYards: 0, passingTds: 0, interceptions: 0, carries: 0, rushingYards: 0, rushingTds: 0, receptions: 0, targets: 0, receivingYards: 0, receivingTds: 0 });
    const opportunities = opportunityValue(totals, player.position);
    const positionById = new Map((roster || []).map((row) => [String(row?.id || ""), String(row?.position || "").toUpperCase()]));
    let positionPool = 0;
    for (const game of games) {
      for (const row of rows || []) {
        if (String(row?.gameId) !== String(game.gameId) || String(row?.team) !== String(game.team)) continue;
        if (positionById.get(String(row?.id)) !== String(player.position || "").toUpperCase()) continue;
        positionPool += opportunityValue(row, player.position);
      }
    }
    const positionOpportunityShare = positionPool > 0 ? clamp(opportunities / positionPool, 0, 1) : null;
    return {
      games: games.length,
      rows: games,
      totals,
      opportunities,
      opportunitiesPerGame: opportunities / games.length,
      positionOpportunityShare,
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
      "preseason.usage_boost": { available: true, value, confidence, conflict: 0.12, source: "ESPN preseason boxscore usage", games: summary.games, positionOpportunityShare: summary.positionOpportunityShare ?? null },
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

  function cleanText(value) {
    return String(value || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  }
  function phraseNegated(text, phrase) {
    const index = text.indexOf(phrase);
    if (index < 0) return false;
    const prefix = text.slice(Math.max(0, index - 24), index);
    return /(?:\bnot|\bno|\bwithout|\bnever)\s+(?:\w+\s+){0,2}$/.test(prefix);
  }
  function classifyCampText(input) {
    const text = cleanText(input).toLowerCase();
    if (!text || !CAMP_CONTEXT.some((phrase) => text.includes(phrase))) return { active: false, score: 0, roleScore: 0, performanceScore: 0, availabilityRisk: 0, matches: [] };
    const matches = [];
    for (const rule of CAMP_RULES) {
      const phrase = rule.phrases.find((candidate) => text.includes(candidate) && !phraseNegated(text, candidate));
      if (phrase) matches.push({ key: rule.key, family: rule.family, score: rule.score, weight: rule.weight, phrase });
    }
    const weighted = (family = null) => {
      const selected = family ? matches.filter((row) => row.family === family) : matches.filter((row) => row.family !== "availability");
      const denominator = selected.reduce((sum, row) => sum + row.weight, 0);
      return denominator ? selected.reduce((sum, row) => sum + row.score * row.weight, 0) / denominator : 0;
    };
    return {
      active: true,
      score: clamp(weighted(), -1, 1),
      roleScore: clamp(weighted("role"), -1, 1),
      performanceScore: clamp(weighted("performance"), -1, 1),
      availabilityRisk: clamp(-weighted("availability"), 0, 1),
      matches,
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
        description: String(article.description || ""),
        camp: classifyCampText(`${article.headline || ""} ${article.description || ""}`),
        published: article.published || article.lastModified || null,
        url: article.links?.web?.href || null,
        premium: Boolean(article.premium),
        playerIds: matched.map((player) => String(player.id)),
        playerNames: matched.map((player) => player.name),
        teams: teams.map((category) => category.team?.abbreviation || category.description).filter(Boolean),
      };
    }).filter((article) => article.id && article.headline);
  }

  function summarizeCampPulse(articles, player, options = {}) {
    const asOf = Number.isFinite(Number(options.asOf)) ? Number(options.asOf) : Date.now();
    const maxAgeDays = Math.max(1, finite(options.maxAgeDays, 21));
    const relevant = (articles || []).filter((article) => {
      const applies = article.playerIds?.length ? article.playerIds.includes(String(player?.id || "")) : article.teams?.includes(String(player?.team || ""));
      if (!applies || !article.camp?.active || !article.camp.matches?.length) return false;
      const published = Date.parse(article.published || "");
      return !Number.isFinite(published) || asOf - published <= maxAgeDays * 86400000;
    });
    if (!relevant.length) return { available: false, direction: "quiet", score: 0, confidence: 0, conflict: 0, articles: 0, modelEffect: "advisory-only" };
    const rows = relevant.map((article) => {
      const published = Date.parse(article.published || "");
      const ageDays = Number.isFinite(published) ? Math.max(0, asOf - published) / 86400000 : 7;
      const freshness = Math.exp((-Math.LN2 * ageDays) / 5);
      const structural = article.camp.matches.some((match) => match.family === "role") ? 1 : 0.6;
      return { article, weight: Math.max(0.05, freshness * structural) };
    });
    const total = rows.reduce((sum, row) => sum + row.weight, 0);
    const score = rows.reduce((sum, row) => sum + row.article.camp.score * row.weight, 0) / total;
    const roleScore = rows.reduce((sum, row) => sum + row.article.camp.roleScore * row.weight, 0) / total;
    const performanceScore = rows.reduce((sum, row) => sum + row.article.camp.performanceScore * row.weight, 0) / total;
    const availabilityRisk = rows.reduce((sum, row) => sum + row.article.camp.availabilityRisk * row.weight, 0) / total;
    const conflict = clamp(rows.reduce((sum, row) => sum + Math.abs(row.article.camp.score - score) * row.weight, 0) / Math.max(0.25, total), 0, 1);
    const confidence = clamp((0.14 + Math.min(0.34, total * 0.11)) * (1 - conflict * 0.45), 0.08, 0.55);
    const direction = score >= 0.18 ? "up" : score <= -0.18 ? "down" : conflict >= 0.3 ? "mixed" : "neutral";
    return {
      available: true, direction, score: clamp(score, -1, 1), roleScore: clamp(roleScore, -1, 1), performanceScore: clamp(performanceScore, -1, 1),
      availabilityRisk: clamp(availabilityRisk, 0, 1), confidence, conflict, articles: relevant.length, modelEffect: "advisory-only",
      evidenceKeys: [...new Set(relevant.flatMap((article) => article.camp.matches.map((match) => match.key)))],
      sources: [...new Set(relevant.map(() => "ESPN headline/description metadata"))],
    };
  }

  function campEvidence(summary) {
    if (!summary?.available) return {};
    return {
      "camp.signal": { available: true, value: summary.score, confidence: summary.confidence, conflict: summary.conflict, source: "ESPN camp headline/description classifier", modelEffect: "advisory-only" },
    };
  }

  return {
    VERSION,
    campEvidence,
    classifyCampText,
    extractNewsPulse,
    marketEvidence,
    parseEspnMarketScoreboard,
    parseEspnPreseasonSummary,
    preseasonEvidence,
    summarizeCampPulse,
    summarizePreseason,
  };
});

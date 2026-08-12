(function attachOracleLiveIntelligence(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleLiveIntelligence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createLiveIntelligence() {
  "use strict";

  const VERSION = "oracle-live-intelligence-2026.3";
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
  const USAGE_INTENT_RULES = Object.freeze([
    { key: "usage.featured", score: 0.95, weight: 1.0, phrases: ["heavy workload", "focal point", "centerpiece", "workhorse", "bell cow", "building block", "build around", "featured weapon", "feature him", "feature her", "feed him", "feed her", "touch the ball more than", "touches per game", "touches a game"] },
    { key: "usage.expand", score: 0.76, weight: 0.9, phrases: ["bigger role", "larger role", "expanded role", "more involved", "more touches", "more carries", "more targets", "more opportunities", "increase his workload", "increase her workload", "plenty of reps", "get him the ball", "get her the ball", "get the ball to him", "get the ball to her"] },
    { key: "usage.versatility", score: 0.58, weight: 0.72, phrases: ["can really do everything", "does it all well", "opens up a lot of doors", "stress a defense"] },
    { key: "usage.reduce", score: -0.88, weight: 1.0, phrases: ["reduce his workload", "reduce her workload", "fewer touches", "fewer carries", "fewer targets", "scale back", "limit his touches", "limit her touches", "manage his workload", "manage her workload", "keep him fresh", "keep her fresh"] },
    { key: "usage.committee", score: -0.68, weight: 0.86, phrases: ["committee backfield", "running back committee", "split carries", "split the carries", "timeshare", "rotate the backs", "share the workload"] },
  ]);
  const SOURCE_AUTHORITY = Object.freeze({ "head-coach": 1, "play-caller": 1, "offensive-coordinator": 0.94, "position-coach": 0.8, "general-manager": 0.72, player: 0.54, reporter: 0.48, analyst: 0.25, unknown: 0.34 });

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

  function classifyUsageIntentText(input, options = {}) {
    const sourceRole = String(options.sourceRole || "unknown").toLowerCase();
    const authority = SOURCE_AUTHORITY[sourceRole] ?? SOURCE_AUTHORITY.unknown;
    const text = cleanText(input).toLowerCase();
    const empty = { active: false, usageScore: 0, roleIntent: "neutral", confidence: 0, sourceAuthority: authority, sourceRole, hyperbole: false, literalVolume: false, matches: [], modelEffect: "role-state-only" };
    if (!text) return empty;
    const matches = [];
    for (const rule of USAGE_INTENT_RULES) {
      const phrase = rule.phrases.find((candidate) => text.includes(candidate) && !phraseNegated(text, candidate));
      if (phrase) matches.push({ key: rule.key, score: rule.score, weight: rule.weight, phrase });
    }
    const extremeVolume = /\b(?:3[5-9]|[4-9]\d)\s*(?:-|to)?\s*\d*\s*(?:touches|carries|targets)\b/i.test(text) || /\b(?:touch(?:es)?(?: the ball)?|carries|targets)\b.{0,32}\b(?:3[5-9]|[4-9]\d)\b/i.test(text) || /\bevery (?:single )?(?:snap|play)\b/i.test(text);
    const futureIntent = /\b(?:will|would|could|may|might|going to|plan|plans|planned|want|wants|wanted|promise|promised)\b/i.test(text);
    const hyperbole = extremeVolume && futureIntent && (options.directQuote === true || authority >= 0.8);
    if (hyperbole && !matches.length) {
      matches.push({ key: "usage.featured", score: 0.82, weight: 1, phrase: "extreme stated workload" });
    }
    if (!matches.length) return empty;
    const denominator = matches.reduce((sum, row) => sum + row.weight, 0);
    const raw = denominator ? matches.reduce((sum, row) => sum + row.score * row.weight, 0) / denominator : 0;
    let usageScore = clamp(raw, -1, 1);
    if (hyperbole && usageScore > 0.82) usageScore = 0.82;
    const directQuote = options.directQuote === true;
    const confidence = clamp(authority * (directQuote ? 0.9 : 0.72) * (hyperbole ? 0.82 : 1), 0.1, 0.9);
    const roleIntent = usageScore >= 0.2 ? "expand" : usageScore <= -0.2 ? "reduce" : "neutral";
    return { active: true, usageScore, roleIntent, confidence, sourceAuthority: authority, sourceRole, hyperbole, literalVolume: false, matches, modelEffect: "role-state-only" };
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
        usageIntent: classifyUsageIntentText(`${article.headline || ""} ${article.description || ""}`, { sourceRole: "reporter", directQuote: String(`${article.headline || ""} ${article.description || ""}`).includes(String.fromCharCode(34)) }),
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
      const campActive = Boolean(article.camp?.active && article.camp.matches?.length);
      const usageActive = Boolean(article.usageIntent?.active && article.usageIntent.matches?.length);
      if (!applies || (!campActive && !usageActive)) return false;
      const published = Date.parse(article.published || "");
      return !Number.isFinite(published) || asOf - published <= maxAgeDays * 86400000;
    });
    if (!relevant.length) return { available: false, direction: "quiet", score: 0, confidence: 0, conflict: 0, articles: 0, modelEffect: "advisory-only" };
    const rows = relevant.map((article) => {
      const published = Date.parse(article.published || "");
      const ageDays = Number.isFinite(published) ? Math.max(0, asOf - published) / 86400000 : 7;
      const freshness = Math.exp((-Math.LN2 * ageDays) / 5);
      const campStructural = article.camp?.matches?.some((match) => match.family === "role");
      const usageStructural = Boolean(article.usageIntent?.active);
      const structural = campStructural || usageStructural ? 1 : 0.6;
      const authority = usageStructural ? Math.max(0.5, finite(article.usageIntent.confidence, 0.5)) : 1;
      return { article, weight: Math.max(0.05, freshness * structural * authority) };
    });
    const total = rows.reduce((sum, row) => sum + row.weight, 0);
    const blendedSignal = (article, field) => {
      const campActive = Boolean(article.camp?.active && article.camp.matches?.length);
      const usageActive = Boolean(article.usageIntent?.active && article.usageIntent.matches?.length);
      const campValue = campActive ? finite(article.camp?.[field]) : 0;
      if (!usageActive || !["score", "roleScore"].includes(field)) return campValue;
      const usageValue = finite(article.usageIntent.usageScore);
      if (!campActive) return usageValue;
      const usageWeight = Math.max(0.35, finite(article.usageIntent.confidence, 0.35));
      return (campValue * 0.7 + usageValue * usageWeight) / (0.7 + usageWeight);
    };
    const score = rows.reduce((sum, row) => sum + blendedSignal(row.article, "score") * row.weight, 0) / total;
    const roleScore = rows.reduce((sum, row) => sum + blendedSignal(row.article, "roleScore") * row.weight, 0) / total;
    const usageScore = rows.reduce((sum, row) => sum + finite(row.article.usageIntent?.usageScore) * row.weight, 0) / total;
    const usageConfidence = rows.reduce((sum, row) => sum + finite(row.article.usageIntent?.confidence) * row.weight, 0) / total;
    const performanceScore = rows.reduce((sum, row) => sum + finite(row.article.camp?.performanceScore) * row.weight, 0) / total;
    const availabilityRisk = rows.reduce((sum, row) => sum + finite(row.article.camp?.availabilityRisk) * row.weight, 0) / total;
    const conflict = clamp(rows.reduce((sum, row) => sum + Math.abs(row.article.camp.score - score) * row.weight, 0) / Math.max(0.25, total), 0, 1);
    const confidence = clamp((0.14 + Math.min(0.34, total * 0.11)) * (1 - conflict * 0.45), 0.08, 0.55);
    const direction = score >= 0.18 ? "up" : score <= -0.18 ? "down" : conflict >= 0.3 ? "mixed" : "neutral";
    return {
      available: true, direction, score: clamp(score, -1, 1), roleScore: clamp(roleScore, -1, 1), usageScore: clamp(usageScore, -1, 1), usageConfidence: clamp(usageConfidence, 0, 0.9), performanceScore: clamp(performanceScore, -1, 1),
      availabilityRisk: clamp(availabilityRisk, 0, 1), confidence, conflict, articles: relevant.length, modelEffect: "advisory-only",
      evidenceKeys: [...new Set(relevant.flatMap((article) => [...(article.camp?.matches || []), ...(article.usageIntent?.matches || [])].map((match) => match.key)))],
      usageHyperbole: relevant.some((article) => article.usageIntent?.hyperbole === true),
      sources: [...new Set(relevant.map(() => "ESPN headline/description role-usage metadata"))],
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
    classifyUsageIntentText,
    extractNewsPulse,
    marketEvidence,
    parseEspnMarketScoreboard,
    parseEspnPreseasonSummary,
    preseasonEvidence,
    summarizeCampPulse,
    summarizePreseason,
  };
});

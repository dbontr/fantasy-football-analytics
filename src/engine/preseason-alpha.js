(function attachSnapCountPreseasonAlpha(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnapCountPreseasonAlpha = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPreseasonAlpha() {
  "use strict";

  const VERSION = "snapcount-preseason-alpha-2026.1";
  const SOURCE_AUTHORITY = Object.freeze({
    "head-coach": 1, "play-caller": 1, "offensive-coordinator": 0.94,
    "position-coach": 0.8, "general-manager": 0.72, player: 0.54,
    reporter: 0.48, analyst: 0.25, unknown: 0.34,
  });
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  const mean = (values = []) => {
    const rows = values.filter(Number.isFinite);
    return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
  };
  function normalizeProbabilities(values) {
    const total = values.reduce((sum, value) => sum + Math.max(0, finite(value)), 0);
    return total ? values.map((value) => Math.max(0, finite(value)) / total) : values.map(() => 1 / Math.max(1, values.length));
  }
  function roleLabels(position) {
    const pos = String(position || "").toUpperCase();
    if (pos === "RB") return ["Lead role", "Committee", "Depth role"];
    if (pos === "QB") return ["Clear starter", "Competition", "Backup"];
    if (pos === "TE") return ["Featured TE", "Starter", "Rotation"];
    return ["Featured role", "Starter", "Rotation"];
  }
  function sensitivityForPlayer(player = {}) {
    const reliability = clamp(player.reliability ?? player.opportunity?.reliability ?? 0.72, 0.3, 0.97);
    const stability = clamp(player.opportunity?.volumeStability ?? reliability, 0.2, 1);
    const rank = finite(player.pprRank, finite(player.adp, 999));
    const previous = finite(player.previousPoints);
    const rookie = Boolean(player.rookie || previous <= 0 || player.rookieYear === 2026);
    const established = rank <= 36 && previous >= 130 && reliability >= 0.78;
    let factor = 0.78 + (1 - stability) * 0.42 + (1 - reliability) * 0.3;
    if (rookie) factor += 0.22;
    if (established) factor -= 0.24;
    return { factor: clamp(factor, 0.5, 1.3), rookie, established, roleUncertainty: clamp((1 - stability) * 0.6 + (1 - reliability) * 0.4, 0, 1) };
  }
  function opportunityValue(row, position) {
    const pos = String(position || "").toUpperCase();
    return finite(row?.carries) + finite(row?.targets) + (pos === "QB" ? finite(row?.passingAttempts) * 0.28 : 0);
  }
  function summarizeStarterUsage(preseasonRows = [], player = {}, roster = []) {
    const id = String(player.id || ""), position = String(player.position || "").toUpperCase();
    const games = preseasonRows.filter((row) => String(row.id) === id);
    if (!games.length) return { available: false, games: 0, signal: 0, confidence: 0 };
    const positionById = new Map(roster.map((row) => [String(row.id), String(row.position || "").toUpperCase()]));
    const gameKeys = new Set(games.map((row) => `${row.gameId}|${row.team}`));
    let opportunities = 0, positionPool = 0, firstUnitTagged = 0;
    for (const row of preseasonRows) {
      if (!gameKeys.has(`${row.gameId}|${row.team}`) || positionById.get(String(row.id)) !== position) continue;
      const value = opportunityValue(row, position);
      positionPool += value;
      if (String(row.id) === id) { opportunities += value; if (row.starterUnit === true || row.openingDrive === true) firstUnitTagged += 1; }
    }
    const share = positionPool > 0 ? clamp(opportunities / positionPool, 0, 1) : null;
    const prior = { QB: 0.72, RB: 0.48, WR: 0.28, TE: 0.45 }[position] || 0.35;
    const scale = { QB: 0.3, RB: 0.3, WR: 0.22, TE: 0.28 }[position] || 0.28;
    const shareSignal = share == null ? 0 : clamp((share - prior) / scale, -1, 1);
    const volumeSignal = clamp((opportunities / games.length - 4) / 16, -0.35, 0.7);
    const firstUnitBonus = firstUnitTagged ? clamp(firstUnitTagged / games.length, 0, 1) * 0.25 : 0;
    return {
      available: true, games: games.length, opportunities, opportunitiesPerGame: opportunities / games.length,
      positionOpportunityShare: share, firstUnitTaggedGames: firstUnitTagged,
      signal: clamp(shareSignal * 0.72 + volumeSignal * 0.2 + firstUnitBonus, -1, 1),
      confidence: clamp(0.18 + games.length * 0.07 + (share == null ? 0 : 0.12) + firstUnitTagged * 0.05, 0.15, 0.58),
    };
  }
  const authorityFor = (role) => SOURCE_AUTHORITY[String(role || "unknown").toLowerCase()] ?? SOURCE_AUTHORITY.unknown;
  function structuralObservations(camp = {}) {
    return (camp.observations || []).filter((row) => (row.evidenceKeys || []).some((key) => key.startsWith("role.") || key.startsWith("usage.") || key.startsWith("availability.")) || row.starterUnit);
  }
  function reporterConsensus(camp = {}) {
    const rows = structuralObservations(camp);
    if (!rows.length) return { available: false, stories: 0, sources: 0, agreement: 0, strength: 0, signal: 0 };
    const stories = new Set(rows.map((row) => String(row.storyId || "")).filter(Boolean));
    const sources = new Set(rows.map((row) => String(row.sourceKey || row.usageSourceRole || row.storyId || "unknown")));
    let positive = 0, negative = 0, neutral = 0, weighted = 0, denominator = 0;
    for (const row of rows) {
      const score = finite(row.roleScore, finite(row.usageScore, finite(row.score)));
      const weight = authorityFor(row.usageSourceRole || row.sourceRole) * (row.usageHyperbole ? 0.82 : 1);
      weighted += score * weight; denominator += weight;
      if (score >= 0.18) positive += 1; else if (score <= -0.18) negative += 1; else neutral += 1;
    }
    const directional = positive + negative;
    const agreement = directional ? Math.max(positive, negative) / directional : 0.5;
    const sourceBreadth = clamp(1 - Math.exp(-sources.size / 2), 0, 1);
    const storyBreadth = clamp(1 - Math.exp(-stories.size / 2.5), 0, 1);
    const strength = clamp((sourceBreadth * 0.55 + storyBreadth * 0.45) * agreement, 0, 1);
    return { available: true, stories: stories.size, sources: sources.size, positive, negative, neutral, agreement, strength, signal: clamp(denominator ? weighted / denominator * strength : 0, -1, 1) };
  }
  function injuryTrajectory(camp = {}) {
    const rows = (camp.observations || []).filter((row) => row.availabilityScore !== null && row.availabilityScore !== undefined && Number.isFinite(Number(row.availabilityScore))).map((row) => ({
      published: Date.parse(row.published || "") || 0, score: clamp(row.availabilityScore, -1, 1), state: row.availabilityState || "unknown",
    })).sort((a, b) => a.published - b.published);
    if (!rows.length) {
      const risk = clamp(camp.availabilityRisk, 0, 1);
      return { available: risk > 0, trend: risk >= 0.55 ? "concerning" : "stable", signal: -risk * 0.7, confidence: risk > 0 ? clamp(camp.confidence, 0.12, 0.55) : 0, latestState: null, observations: 0 };
    }
    const first = rows[0], latest = rows.at(-1), improvement = latest.score - first.score;
    const recentMean = mean(rows.slice(-3).map((row) => row.score));
    const signal = clamp(recentMean * 0.62 + improvement * 0.38, -1, 1);
    const trend = improvement >= 0.3 ? "improving" : improvement <= -0.3 ? "worsening" : latest.score <= -0.55 ? "concerning" : "stable";
    return { available: true, trend, signal, confidence: clamp(0.2 + rows.length * 0.09, 0.2, 0.68), latestState: latest.state, observations: rows.length, improvement };
  }
  function marketReaction(history = [], rawSignal = 0) {
    const rows = history.filter((row) => Number.isFinite(Number(row.adp)) || Number.isFinite(Number(row.pprRank))).map((row) => ({ ...row, captured: Date.parse(row.capturedAt || "") || 0 })).sort((a, b) => a.captured - b.captured);
    if (rows.length < 2) return { available: false, snapshots: rows.length, movement: 0, pricedFraction: 0, residualFactor: 1, conflict: 0, label: "not enough market history" };
    const latest = rows.at(-1), cutoff = latest.captured - 10 * 86400000, oldest = rows.find((row) => row.captured >= cutoff) || rows[0];
    const moves = [];
    if (Number.isFinite(Number(oldest.adp)) && Number.isFinite(Number(latest.adp))) moves.push(Number(oldest.adp) - Number(latest.adp));
    if (Number.isFinite(Number(oldest.pprRank)) && Number.isFinite(Number(latest.pprRank))) moves.push(Number(oldest.pprRank) - Number(latest.pprRank));
    const movement = mean(moves), direction = Math.sign(rawSignal), sameDirection = direction !== 0 && Math.sign(movement) === direction, opposite = direction !== 0 && Math.sign(movement) === -direction;
    const expectedMove = Math.max(2, Math.abs(rawSignal) * 8);
    const pricedFraction = sameDirection ? clamp(Math.abs(movement) / expectedMove, 0, 1) : 0;
    const conflict = opposite ? clamp(Math.abs(movement) / Math.max(3, expectedMove), 0, 1) : 0;
    const residualFactor = clamp(1 - pricedFraction * 0.78, 0.22, 1);
    return {
      available: true, snapshots: rows.length, movement,
      adpMovement: Number.isFinite(Number(oldest.adp)) && Number.isFinite(Number(latest.adp)) ? Number(oldest.adp) - Number(latest.adp) : null,
      rankMovement: Number.isFinite(Number(oldest.pprRank)) && Number.isFinite(Number(latest.pprRank)) ? Number(oldest.pprRank) - Number(latest.pprRank) : null,
      pricedFraction, residualFactor, conflict, from: oldest.capturedAt || null, to: latest.capturedAt || null,
      label: pricedFraction >= 0.75 ? "mostly priced" : pricedFraction >= 0.35 ? "partly priced" : conflict >= 0.35 ? "market disagrees" : "mostly unpriced",
    };
  }
  function coachIntentSignal(camp = {}) {
    const rows = (camp.observations || []).filter((row) => Number.isFinite(Number(row.usageScore)) && Math.abs(Number(row.usageScore)) > 0.05);
    if (!rows.length) return { available: false, signal: 0, confidence: 0, directStories: 0 };
    let numerator = 0, denominator = 0, directStories = 0;
    for (const row of rows) {
      const authority = authorityFor(row.usageSourceRole || row.sourceRole), direct = authority >= 0.8;
      if (direct) directStories += 1;
      const weight = authority * clamp(row.usageConfidence || 0.35, 0.15, 0.9) * (row.usageHyperbole ? 0.78 : 1);
      numerator += clamp(row.usageScore, -1, 1) * weight; denominator += weight;
    }
    return { available: true, signal: clamp(denominator ? numerator / denominator : 0, -1, 1), confidence: clamp(0.2 + Math.min(0.5, denominator * 0.35) + Math.min(0.15, directStories * 0.08), 0.2, 0.82), directStories };
  }
  function firstUnitSignal(camp = {}) {
    const positive = finite(camp.firstTeamMentions) * 0.22 + finite(camp.starterUnitMentions) * 0.2 + finite(camp.twoMinuteMentions) * 0.12 + finite(camp.thirdDownMentions) * 0.1 + finite(camp.redZoneMentions) * 0.1 + finite(camp.openingDriveMentions) * 0.12;
    const demoted = (camp.evidenceKeys || []).includes("role.demoted") ? 0.7 : 0;
    const snaps = finite(camp.reportedFirstTeamSnaps) > 0 ? clamp(finite(camp.reportedFirstTeamSnaps) / 30, 0.15, 0.65) : 0;
    const signal = clamp(positive + snaps - demoted, -1, 1);
    const evidence = finite(camp.firstTeamMentions) + finite(camp.starterUnitMentions) + finite(camp.twoMinuteMentions) + finite(camp.thirdDownMentions) + finite(camp.redZoneMentions) + finite(camp.openingDriveMentions) + (snaps > 0 ? 1 : 0);
    return { available: evidence > 0 || demoted > 0, signal, confidence: clamp(0.18 + evidence * 0.07 + (demoted ? 0.12 : 0), 0.18, 0.7), evidence };
  }
  function roleProbabilities(player, structuralSignal, confidence, injury = {}) {
    const labels = roleLabels(player?.position), structural = clamp(structuralSignal + clamp(injury.signal, -1, 1) * 0.18, -1, 1);
    const raw = normalizeProbabilities([Math.exp(structural * 1.55), Math.exp((1 - Math.abs(structural)) * 0.5), Math.exp(-structural * 1.55)]);
    const prior = [0.24, 0.58, 0.18], blend = clamp(0.18 + confidence * 0.72, 0.18, 0.78);
    const probabilities = normalizeProbabilities(raw.map((value, index) => value * blend + prior[index] * (1 - blend)));
    return probabilities.map((probability, index) => ({ key: index === 0 ? "expanded" : index === 1 ? "baseline" : "reduced", label: labels[index], probability }));
  }
  function computeConfidence(parts, market) {
    const available = parts.filter((row) => row.available && row.confidence > 0);
    if (!available.length) return 0;
    const weighted = available.reduce((sum, row) => sum + row.confidence * row.weight, 0), denominator = available.reduce((sum, row) => sum + row.weight, 0), breadth = clamp(available.length / 5, 0.2, 1);
    return clamp(weighted / Math.max(0.1, denominator) * (0.72 + breadth * 0.28) - (market?.conflict || 0) * 0.2, 0.08, 0.82);
  }
  function computePreseasonAlpha(player = {}, inputs = {}) {
    const camp = inputs.camp || {}, starterUsage = inputs.starterUsage || summarizeStarterUsage(inputs.preseasonRows || [], player, inputs.roster || []);
    const firstUnit = firstUnitSignal(camp), coach = coachIntentSignal(camp), consensus = reporterConsensus(camp), injury = injuryTrajectory(camp), sensitivity = sensitivityForPlayer(player);
    const role = clamp(finite(camp.roleScore), -1, 1), usage = clamp(finite(camp.usageScore), -1, 1);
    const structuralAvailable = Boolean(camp.available && (Math.abs(role) >= 0.08 || Math.abs(usage) >= 0.08 || firstUnit.available));
    const structural = structuralAvailable ? clamp(role * 0.52 + usage * 0.32 + firstUnit.signal * 0.16, -1, 1) : 0;
    const tinyPerformance = structuralAvailable ? clamp(finite(camp.performanceScore), -1, 1) * 0.035 : 0;
    const parts = [
      { key: "role-state", label: "first-team / role state", signal: structural, confidence: clamp(camp.confidence || firstUnit.confidence, 0, 0.68), weight: 0.3, available: structuralAvailable },
      { key: "starter-usage", label: "preseason starter-unit usage", signal: starterUsage.signal || firstUnit.signal, confidence: Math.max(starterUsage.confidence || 0, firstUnit.confidence || 0), weight: 0.24, available: Boolean(starterUsage.available || firstUnit.available) },
      { key: "coach-intent", label: "coach / playcaller usage intent", signal: coach.signal, confidence: coach.confidence, weight: 0.22, available: coach.available },
      { key: "report-consensus", label: "structural report consensus", signal: consensus.signal, confidence: consensus.strength, weight: 0.12, available: consensus.available },
      { key: "injury-trajectory", label: "availability trajectory", signal: injury.signal, confidence: injury.confidence, weight: 0.12, available: injury.available },
    ];
    const numerator = parts.reduce((sum, row) => sum + (row.available ? row.signal * row.weight * (0.45 + row.confidence * 0.55) : 0), 0);
    const rawStructuralSignal = clamp(numerator + tinyPerformance, -1, 1);
    const sensitivityAdjusted = clamp(rawStructuralSignal * sensitivity.factor, -1, 1), market = marketReaction(inputs.marketHistory || [], sensitivityAdjusted), alphaScore = clamp(sensitivityAdjusted * market.residualFactor, -1, 1);
    const confidence = computeConfidence(parts, market), roleStates = roleProbabilities(player, structural || alphaScore, confidence, injury), candidateShift = clamp(alphaScore * confidence * 3.25, -2.5, 2.5);
    return { version: VERSION, playerId: String(player.id || ""), alphaScore, rawStructuralSignal, confidence, sensitivity, candidateShift, roleProbabilities: roleStates, market, consensus, injury, starterUsage, coachIntent: coach, firstUnit, components: parts.map((row) => ({ ...row, contribution: row.signal * row.weight * (0.45 + row.confidence * 0.55) })), genericPerformanceContribution: tinyPerformance, modelEffect: "uncertainty-and-shadow-only" };
  }
  function alphaEvidence(alpha) {
    if (!alpha || !Number.isFinite(Number(alpha.alphaScore)) || alpha.confidence <= 0) return {};
    const injuryRisk = alpha.injury?.available ? clamp(-finite(alpha.injury.signal), 0, 1) : 0;
    return { "role.preseason_alpha": { available: true, value: clamp(alpha.alphaScore, -1, 1), roleScore: clamp(alpha.rawStructuralSignal, -1, 1), availabilityRisk: injuryRisk, confidence: clamp(alpha.confidence, 0.05, 0.82), conflict: clamp(alpha.market?.conflict, 0, 1), marketPricedFraction: clamp(alpha.market?.pricedFraction, 0, 1), source: "structured preseason role, usage, coach-intent, consensus, injury, and market-reaction model", scoringEffect: "uncertainty-only", modelEffect: "uncertainty-and-shadow-only" } };
  }
  function summaryLabel(alpha) {
    if (!alpha || alpha.confidence < 0.12) return "No strong preseason read";
    const direction = alpha.alphaScore >= 0.2 ? "Positive role edge" : alpha.alphaScore <= -0.2 ? "Negative role edge" : "Role mostly priced / neutral";
    return `${direction}${alpha.market?.available ? ` · ${alpha.market.label}` : ""}`;
  }
  return { VERSION, SOURCE_AUTHORITY, alphaEvidence, coachIntentSignal, computePreseasonAlpha, firstUnitSignal, injuryTrajectory, marketReaction, reporterConsensus, roleProbabilities, sensitivityForPlayer, summarizeStarterUsage, summaryLabel };
});

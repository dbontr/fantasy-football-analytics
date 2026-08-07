(function attachOracleRookies(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleRookies = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createRookies() {
  "use strict";

  const VERSION = "oracle-rookies-2026.1";
  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }
  function hasNumber(value) {
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  }
  function normalizeName(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/[^a-z0-9]/g, "");
  }
  function key(name, position) {
    return `${normalizeName(name)}|${String(position || "").toUpperCase()}`;
  }
  function indexArtifact(artifact) {
    const players = artifact?.players || [];
    return {
      artifact,
      byId: new Map(players.map((player) => [String(player.id), player])),
      byNamePosition: new Map(players.map((player) => [key(player.name, player.position), player])),
    };
  }
  function enrichPlayers(players, artifactOrIndex) {
    const index = artifactOrIndex?.byId instanceof Map ? artifactOrIndex : indexArtifact(artifactOrIndex);
    return (players || []).map((player) => {
      const rookie = index.byId.get(String(player.id)) || index.byNamePosition.get(key(player.name, player.position));
      if (!rookie) return player;
      return {
        ...player,
        rookie: { ...rookie },
        age: player.age ?? rookie.age ?? null,
        birthDate: player.birthDate ?? rookie.birthDate ?? null,
        college: player.college ?? rookie.college ?? null,
        yearsExperience: 0,
      };
    });
  }

  function isRookie(player) {
    return Boolean(player?.rookie) || Number(player?.yearsExperience ?? player?.yearsExp ?? player?.sleeper?.yearsExperience) === 0 && Number(player?.rookieYear || player?.sleeper?.rookieYear) === 2026;
  }

  function draftCapitalScore(rookie) {
    const overall = finite(rookie?.draft?.overall, 0);
    if (!overall) return 0.08;
    if (overall <= 12) return 1;
    if (overall <= 32) return 0.86;
    if (overall <= 100) return 0.64;
    if (overall <= 175) return 0.4;
    if (overall <= 257) return 0.22;
    return 0.08;
  }

  function prospectScore(rookie) {
    const grade = finite(rookie?.draft?.grade, NaN);
    if (Number.isFinite(grade)) return clamp((grade - 55) / 40, 0, 1);
    const rank = finite(rookie?.draft?.prospectOverallRank, 0);
    if (rank > 0) return clamp(1 - (rank - 1) / 220, 0.05, 1);
    return 0.35;
  }

  function depthChartDelta(player) {
    const order = finite(player?.sleeper?.depthChartOrder, 0);
    if (!order) return null;
    if (order === 1) return 0.08;
    if (order === 2) return 0.035;
    if (order === 3) return -0.025;
    return -0.07;
  }
  function ageScore(player) {
    const age = finite(player?.age ?? player?.rookie?.age, NaN);
    if (!Number.isFinite(age)) return 0;
    const center = ({ QB: 23, RB: 22.5, WR: 22.5, TE: 23 })[String(player.position || "").toUpperCase()] || 23;
    return clamp((center - age) / 3, -1, 1);
  }

  function evidence(player, options = {}) {
    if (!player?.rookie) return {};
    const rookie = player.rookie;
    const prior = rookie.prior || {};
    const rows = {};
    const priorConfidence = clamp(finite(prior.confidence, 0.35) * 0.48, 0.08, 0.34);
    if (hasNumber(prior.p50)) {
      rows["rookie.cohort_ppg"] = {
        available: true, value: finite(prior.p50), confidence: priorConfidence, conflict: 0.18,
        source: "2016-2025 nflverse rookie cohort", sampleSize: finite(prior.sampleSize),
      };
    }
    rows["rookie.draft_capital"] = {
      available: true, value: draftCapitalScore(rookie), confidence: rookie?.draft?.overall ? 0.72 : 0.32,
      conflict: 0.08, source: rookie?.draft?.overall ? "2026 structured NFL draft capital" : "undrafted rookie prior",
    };
    if (rookie?.draft?.grade != null || rookie?.draft?.prospectOverallRank != null) {
      rows["rookie.prospect_score"] = { available: true, value: prospectScore(rookie), confidence: 0.42, conflict: 0.12, source: "structured predraft grade/rank" };
    }
    if (hasNumber(rookie?.combine?.percentile)) {
      rows["rookie.athletic_percentile"] = { available: true, value: clamp(rookie.combine.percentile, 0, 1), confidence: 0.26, conflict: 0.16, source: "nflverse combine percentile" };
    }
    rows["rookie.age_score"] = { available: true, value: ageScore(player), confidence: 0.22, conflict: 0.1, source: "rookie age prior" };
    const depthDelta = depthChartDelta(player);
    if (Number.isFinite(depthDelta)) {
      rows["rookie.depth_chart_delta"] = { available: true, value: depthDelta, confidence: 0.52, conflict: 0.12, source: "Sleeper live depth chart" };
    }
    const week = Math.max(1, Math.min(18, finite(options.week, 1)));
    const progress = clamp((week - 1) / 16, 0, 1);
    const lateLift = clamp(finite(prior.lateLiftPct), -0.35, 0.55) * progress;
    if (Math.abs(lateLift) >= 0.005) {
      rows["rookie.development_delta"] = {
        available: true, value: lateLift, confidence: clamp(priorConfidence * 0.72, 0.06, 0.22), conflict: 0.2,
        source: "historical rookie development curve",
      };
    }
    return rows;
  }

  function uncertainty(player, evidenceRows = {}) {
    if (!player?.rookie) return null;
    const rookie = player.rookie;
    const capital = draftCapitalScore(rookie);
    const prospect = prospectScore(rookie);
    let epistemicFloor = clamp(0.46 - capital * 0.14 - prospect * 0.06, 0.26, 0.46);
    let roleFloor = clamp(0.48 - capital * 0.08, 0.34, 0.48);
    const order = finite(player?.sleeper?.depthChartOrder, 0);
    if (order === 1) roleFloor -= 0.12;
    else if (order === 2) roleFloor -= 0.07;
    else if (order === 3) roleFloor += 0.01;
    else if (order >= 4) roleFloor += 0.06;
    const preseason = evidenceRows["preseason.usage_boost"];
    if (preseason?.available !== false && hasNumber(preseason?.value)) {
      roleFloor -= clamp(finite(preseason.value) * 0.35 * finite(preseason.confidence, 0.2) / 0.2, 0, 0.07);
    }
    if (order === 1 && preseason) epistemicFloor -= 0.025;
    return {
      epistemicFloor: clamp(epistemicFloor, 0.22, 0.5),
      roleFloor: clamp(roleFloor, 0.24, 0.58),
    };
  }
  function summary(player) {
    if (!player?.rookie) return null;
    const rookie = player.rookie;
    const prior = rookie.prior || {};
    const draft = rookie.draft || {};
    return {
      label: "ROOKIE",
      draftLabel: draft.overall ? `Pick ${draft.overall} · R${draft.round}` : "Undrafted",
      age: player.age ?? rookie.age ?? null,
      college: player.college ?? rookie.college ?? null,
      cohortP50: hasNumber(prior.p50) ? Number(prior.p50) : null,
      cohortP90: hasNumber(prior.p90) ? Number(prior.p90) : null,
      hitRate: hasNumber(prior.hitRate) ? Number(prior.hitRate) : null,
      athleticPercentile: hasNumber(rookie?.combine?.percentile) ? Number(rookie.combine.percentile) : null,
      depthChartOrder: hasNumber(player?.sleeper?.depthChartOrder) ? Number(player.sleeper.depthChartOrder) : null,
      capitalScore: draftCapitalScore(rookie),
      prospectScore: prospectScore(rookie),
    };
  }

  return {
    VERSION,
    ageScore,
    depthChartDelta,
    draftCapitalScore,
    enrichPlayers,
    evidence,
    indexArtifact,
    isRookie,
    normalizeName,
    prospectScore,
    summary,
    uncertainty,
  };
});

(function attachOracleContext(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createContextApi() {
  "use strict";

  const VERSION = "oracle-context-browser-2026.1";

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }
  function weeklyProjection(player, week) {
    const value = Number(player?.weeklyProjections?.[Math.max(0, Math.min(17, Number(week || 1) - 1))]);
    return Number.isFinite(value) ? Math.max(0, value) : Math.max(0, finite(player?.weeklyProjection));
  }
  function practiceKey(value) {
    const text = String(value || "").toLowerCase();
    if (!text) return null;
    if (text.includes("full")) return "full";
    if (text.includes("limited")) return "limited";
    if (text.includes("dnp") || text.includes("did not") || text.includes("not participate")) return "dnp";
    return null;
  }
  function statusKey(value) {
    const text = String(value || "").toLowerCase();
    if (!text || text === "active" || text === "healthy") return "none";
    if (text.includes("question")) return "questionable";
    if (text.includes("doubt")) return "doubtful";
    if (text === "out" || text.includes("injured reserve") || text === "ir") return "out";
    return text.replace(/\s+/g, "-");
  }

  function healthEvidence(player, calibration) {
    const groups = calibration?.availability?.groups || {};
    const status = statusKey(player?.injuryStatus);
    const practice = practiceKey(player?.sleeper?.practiceParticipation);
    const position = String(player?.position || "").toUpperCase();
    const keys = [
      practice && `position-status-practice:${position}|${status}|${practice}`,
      practice && `status-practice:${status}|${practice}`,
      `status:${status}`,
      practice && `practice:${practice}`,
    ].filter(Boolean);
    const match = keys.map((key) => ({ key, row: groups[key] })).find((entry) => entry.row && finite(entry.row.samples) >= 10);
    if (!match) return {};
    const samples = finite(match.row.samples);
    const confidence = clamp(samples / (samples + 80), 0.2, 0.96);
    return {
      "health.active_probability": {
        available: true,
        value: clamp(match.row.rate, 0, 1),
        confidence,
        conflict: 0,
        model: "historical-nflverse-availability",
        group: match.key,
        samples,
      },
    };
  }

  function coachingEvidence(player, profile) {
    if (!profile) return {};
    const position = String(player?.position || "").toUpperCase();
    const development = finite(profile.development?.[position], 0.67);
    const design = finite(profile.offense?.design, 0.67);
    const roleClarity = finite(profile.leadership?.roleClarity, 0.65);
    const continuity = finite(profile.leadership?.continuity, 0.55);
    const delta = clamp(
      (development - 0.67) * 0.045
      + (design - 0.67) * 0.025
      + (roleClarity - 0.65) * 0.015
      + (continuity - 0.55) * 0.008,
      -0.025,
      0.025,
    );
    return {
      "coaching.mean_delta": {
        available: true,
        value: delta,
        confidence: clamp(profile.confidence, 0.2, 0.9),
        conflict: profile.newStaff ? 0.18 : 0.05,
        model: "bayesian-shrunk-staff-prior",
        staff: profile.headCoach,
        scheme: profile.schemeLabel,
      },
    };
  }

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }
  function standardDeviation(values, average = mean(values)) {
    return values.length ? Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length) : 1;
  }

  function buildTeamContext(players, schedule, week) {
    const byTeam = new Map();
    for (const player of players || []) {
      const team = String(player.team || "FA");
      if (team === "FA") continue;
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team).push(player);
    }
    const raw = {};
    for (const [team, rows] of byTeam) {
      const at = (position, count) => rows.filter((player) => player.position === position)
        .sort((a, b) => weeklyProjection(b, week) - weeklyProjection(a, week))
        .slice(0, count)
        .reduce((sum, player) => sum + weeklyProjection(player, week), 0);
      const offense = at("QB", 1) + at("RB", 2) + at("WR", 3) + at("TE", 1);
      const defense = at("DST", 1);
      raw[team] = { offense, defense };
    }
    const offenseValues = Object.values(raw).map((row) => row.offense);
    const defenseValues = Object.values(raw).map((row) => row.defense);
    const offenseMean = mean(offenseValues);
    const defenseMean = mean(defenseValues);
    const offenseStd = Math.max(1, standardDeviation(offenseValues, offenseMean));
    const defenseStd = Math.max(0.5, standardDeviation(defenseValues, defenseMean));
    return Object.fromEntries(Object.entries(raw).map(([team, row]) => {
      const opponent = schedule?.[team]?.weeks?.[Math.max(0, Number(week || 1) - 1)]?.opponent || null;
      return [team, {
        offenseZ: clamp((row.offense - offenseMean) / offenseStd, -2.5, 2.5),
        defenseZ: clamp((row.defense - defenseMean) / defenseStd, -2.5, 2.5),
        opponent,
      }];
    }));
  }

  function matchupEvidence(player, teamContext) {
    const team = teamContext?.[String(player?.team || "")];
    if (!team?.opponent) return {};
    const opponent = teamContext[team.opponent];
    if (!opponent) return {};
    const position = String(player.position || "").toUpperCase();
    const offensivePlayer = ["QB", "RB", "WR", "TE"].includes(position);
    const grade = offensivePlayer ? clamp(-opponent.defenseZ / 2.2, -1, 1) : clamp(-opponent.offenseZ / 2.2, -1, 1);
    return {
      "matchup.pass_grade": { available: true, value: grade, confidence: 0.34, conflict: 0.15, proxy: true },
      "matchup.rush_grade": { available: true, value: grade, confidence: 0.34, conflict: 0.15, proxy: true },
    };
  }

  function mergeEvidence(...collections) {
    return Object.assign({}, ...collections.filter(Boolean));
  }

  return {
    VERSION,
    buildTeamContext,
    coachingEvidence,
    healthEvidence,
    matchupEvidence,
    mergeEvidence,
    practiceKey,
    statusKey,
  };
});

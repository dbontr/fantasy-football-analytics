(function attachOracleContext(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createContextApi() {
  "use strict";

  const VERSION = "oracle-context-browser-2026.3";

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
  function unavailablePlayer(row) {
    const status = statusKey(row?.injuryStatus);
    return row?.active === false || ["out", "ir", "pup", "suspended"].includes(status);
  }

  const QB_CONTEXT_CALIBRATION = Object.freeze({
    WR: Object.freeze({ penalty: 0.0455292991, support: 546, shrinkage: 800 }),
    TE: Object.freeze({ penalty: 0.0937176076, support: 255, shrinkage: 25 }),
  });

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

  function absenceRedistributionEvidence(player, players) {
    const team = String(player?.team || "").toUpperCase();
    const position = String(player?.position || "").toUpperCase();
    if (!team || !["QB", "RB", "WR", "TE"].includes(position)) return {};
    const teammates = (players || []).filter((row) => String(row?.team || "").toUpperCase() === team && String(row?.id) !== String(player?.id) && ["QB", "RB", "WR", "TE"].includes(String(row?.position || "").toUpperCase()));
    const absent = teammates.filter(unavailablePlayer);
    if (!absent.length) return {};
    const active = [player, ...teammates.filter((row) => !unavailablePlayer(row))];
    const target = (row) => Math.max(0, finite(row?.opportunity?.targetShare));
    const carry = (row) => Math.max(0, finite(row?.opportunity?.carryShare));
    const vacatedTarget = absent.reduce((sum, row) => sum + target(row), 0);
    const vacatedCarry = absent.reduce((sum, row) => sum + carry(row), 0);
    const remainingTarget = active.reduce((sum, row) => sum + target(row), 0);
    const remainingCarry = active.reduce((sum, row) => sum + carry(row), 0);
    const baseTarget = target(player), baseCarry = carry(player);
    const targetGain = remainingTarget > 0 ? vacatedTarget * baseTarget / remainingTarget : 0;
    const carryGain = remainingCarry > 0 ? vacatedCarry * baseCarry / remainingCarry : 0;
    const targetRelative = targetGain / Math.max(0.06, baseTarget);
    const carryRelative = carryGain / Math.max(0.08, baseCarry);
    let raw = position === "RB" ? targetRelative * 0.45 + carryRelative * 0.55 : position === "QB" ? carryRelative * 0.3 : targetRelative;
    raw = clamp(raw * 0.55, 0, 0.22);
    if (raw < 0.015) return {};
    return { "role.redistribution_delta": { available: true, value: raw, confidence: 0.42, conflict: 0.14, source: "structured teammate absence redistribution", absent: absent.map((row) => row.name).slice(0, 4) } };
  }

  function quarterbackContextEvidence(player, players, week = 1) {
    const position = String(player?.position || "").toUpperCase();
    const calibration = QB_CONTEXT_CALIBRATION[position];
    const team = String(player?.team || "").toUpperCase();
    if (!calibration || !team) return {};
    const quarterbacks = (players || [])
      .filter((row) => String(row?.team || "").toUpperCase() === team && String(row?.position || "").toUpperCase() === "QB")
      .sort((left, right) => weeklyProjection(right, week) - weeklyProjection(left, week));
    const incumbent = quarterbacks[0];
    if (!incumbent || !unavailablePlayer(incumbent)) return {};
    const replacement = quarterbacks.slice(1).filter((row) => !unavailablePlayer(row)).sort((left, right) => {
      const leftOrder = finite(left?.sleeper?.depthChartOrder, 99);
      const rightOrder = finite(right?.sleeper?.depthChartOrder, 99);
      return leftOrder - rightOrder || weeklyProjection(right, week) - weeklyProjection(left, week);
    })[0];
    if (!replacement) return {};
    return {
      "context.qb_replacement_delta": {
        available: true, value: -calibration.penalty, confidence: 1, conflict: 0.1,
        model: "as-of-incumbent-qb-calibration", source: "current QB availability + 2023<->2024 nflverse calibration",
        incumbent: incumbent.name, replacement: replacement.name, support: calibration.support, shrinkage: calibration.shrinkage,
      },
    };
  }

  function coachingEvidence(player, profile) {
    if (!profile) return {};
    return {
      "coaching.staff_context": {
        available: true,
        value: profile.newStaff ? 1 : 0,
        confidence: clamp(profile.confidence, 0.2, 0.9),
        conflict: profile.newStaff ? 0.18 : 0.05,
        model: "context-only-staff-profile",
        source: "staff context retained; direct mean effect disabled pending walk-forward validation",
        staff: profile.headCoach,
        scheme: profile.schemeLabel,
        newStaff: Boolean(profile.newStaff),
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
    QB_CONTEXT_CALIBRATION,
    absenceRedistributionEvidence,
    buildTeamContext,
    coachingEvidence,
    healthEvidence,
    matchupEvidence,
    mergeEvidence,
    practiceKey,
    quarterbackContextEvidence,
    statusKey,
  };
});

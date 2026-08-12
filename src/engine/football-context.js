(function attachSnapCountFootballContext(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnapCountFootballContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFootballContext() {
  "use strict";

  const VERSION = "snapcount-football-context-engine-2026.3";
  const BASELINES = Object.freeze({ plays: 64, passRate: 0.58, pressure: 0.18, rushSuccess: 0.42, passSuccess: 0.45 });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }
  function scheduledOpponent(schedule, team, week) {
    return schedule?.[String(team || "")]?.weeks?.[Math.max(0, Math.min(17, Number(week || 1) - 1))]?.opponent || null;
  }
  function grade(value, center, spread, invert = false) {
    if (!Number.isFinite(Number(value))) return null;
    const raw = clamp((Number(value) - center) / Math.max(1e-6, spread), -1, 1);
    return invert ? -raw : raw;
  }
  function evidenceRow(value, confidence, source, extra = {}) {
    return { available: Number.isFinite(Number(value)), value: finite(value), confidence: clamp(confidence, 0, 1), conflict: 0.08, source, scoringEffect: "shadow-only", ...extra };
  }

  function contextEvidence(player, artifact, schedule, week = 1) {
    const team = String(player?.team || "").toUpperCase();
    const position = String(player?.position || "").toUpperCase();
    const offense = artifact?.teams?.[team]?.weighted || null;
    const staff = artifact?.current?.[team] || null;
    const opponent = scheduledOpponent(schedule, team, week);
    const defense = opponent ? artifact?.defenses?.[opponent]?.weighted || null : null;
    if (!offense && !staff && !defense) return {};
    const out = {};
    if (offense) {
      out["system.team_volume"] = evidenceRow(grade(offense.playsPerGame, BASELINES.plays, 8) ?? 0, 0.58, "2023-2025 nflverse team play volume", { playsPerGame: offense.playsPerGame });
      out["system.pass_rate"] = evidenceRow(grade(offense.neutralPassRate ?? offense.passRate, BASELINES.passRate, 0.12) ?? 0, 0.58, "2023-2025 nflverse neutral/team pass rate", { passRate: offense.passRate, neutralPassRate: offense.neutralPassRate });
      out["system.target_concentration"] = evidenceRow(grade(offense.topTwoTargetConcentration, 0.48, 0.18) ?? 0, 0.5, "2023-2025 nflverse target concentration", { topTwoTargetConcentration: offense.topTwoTargetConcentration });
      out["system.rush_concentration"] = evidenceRow(grade(offense.topTwoRushConcentration, 0.64, 0.2) ?? 0, 0.48, "2023-2025 nflverse rushing concentration", { topTwoRushConcentration: offense.topTwoRushConcentration });
      out["line.pass_protection_proxy"] = evidenceRow(grade(offense.pressureRate, BASELINES.pressure, 0.08, true) ?? 0, 0.5, "2023-2025 offense pressure allowed proxy", { pressureAllowed: offense.pressureRate, sackRateAllowed: offense.sackRate });
      out["line.run_block_proxy"] = evidenceRow(grade(offense.rushSuccessRate, BASELINES.rushSuccess, 0.1) ?? 0, 0.42, "2023-2025 offense rushing success proxy", { rushSuccessRate: offense.rushSuccessRate });
    }
    if (defense) {
      out["matchup.pressure_grade"] = evidenceRow(grade(defense.pressureRate, BASELINES.pressure, 0.08, true) ?? 0, 0.54, "2023-2025 opponent pressure profile", { opponent, pressureRate: defense.pressureRate, sackRate: defense.sackRate });
      out["matchup.pass_efficiency_grade"] = evidenceRow(grade(defense.passSuccessRate, BASELINES.passSuccess, 0.1, true) ?? 0, 0.5, "2023-2025 opponent passing success allowed", { opponent, passSuccessAllowed: defense.passSuccessRate, explosivePassAllowed: defense.explosivePassRate });
      out["matchup.rush_front_grade"] = evidenceRow(grade(defense.rushSuccessRate, BASELINES.rushSuccess, 0.1, true) ?? 0, 0.5, "2023-2025 opponent rushing success allowed", { opponent, rushSuccessAllowed: defense.rushSuccessRate, explosiveRushAllowed: defense.explosiveRushRate });
      out["matchup.red_zone_grade"] = evidenceRow(grade(defense.redZoneTdRate, 0.22, 0.12, true) ?? 0, 0.44, "2023-2025 opponent red-zone touchdown profile", { opponent, redZoneTdRate: defense.redZoneTdRate });
    }
    if (staff) {
      const tendencies = staff.statedTendencies || {};
      out["coaching.system_tendencies"] = evidenceRow(0, clamp(staff.confidence ?? 0.5, 0.2, 0.8), "current SnapCount staff/playcaller map + historical system profile", {
        playCaller: staff.playCaller, coordinator: staff.offensiveCoordinator, headCoach: staff.headCoach,
        scheme: staff.scheme, archetype: staff.archetype, newStaff: Boolean(staff.newStaff),
        statedTendencies: tendencies, teamHistory: staff.teamHistory, playCallerHistory: staff.playCallerHistory,
      });
      out["system.playcaller_pace"] = evidenceRow((finite(tendencies.pace, 0.5) - 0.5) * 2, clamp(staff.confidence ?? 0.5, 0.2, 0.68), "current playcaller pace prior", { playCaller: staff.playCaller });
      out["system.playcaller_pass"] = evidenceRow((finite(tendencies.passRate, 0.5) - 0.5) * 2, clamp(staff.confidence ?? 0.5, 0.2, 0.68), "current playcaller pass-rate prior", { playCaller: staff.playCaller });
      out["system.play_action"] = evidenceRow((finite(tendencies.playAction, 0.5) - 0.5) * 2, clamp(staff.confidence ?? 0.5, 0.2, 0.62), "current playcaller play-action prior", { playCaller: staff.playCaller });
      out["system.motion"] = evidenceRow((finite(tendencies.motion, 0.5) - 0.5) * 2, clamp(staff.confidence ?? 0.5, 0.2, 0.6), "current playcaller motion prior", { playCaller: staff.playCaller });
      out["system.rb_committee"] = evidenceRow((0.5 - finite(tendencies.rbCommittee, 0.5)) * 2, clamp(staff.confidence ?? 0.5, 0.2, 0.66), "current playcaller backfield concentration prior", { playCaller: staff.playCaller });
      if (position === "TE") out["system.te_usage"] = evidenceRow((finite(tendencies.teUsage, 0.5) - 0.5) * 2, clamp(staff.confidence ?? 0.5, 0.2, 0.72), "current staff TE-usage prior", { playCaller: staff.playCaller });
      if (position === "QB") out["system.qb_run"] = evidenceRow((finite(tendencies.qbRun, 0.5) - 0.5) * 2, clamp(staff.confidence ?? 0.5, 0.2, 0.72), "current staff QB-run prior", { playCaller: staff.playCaller });
      out["system.red_zone"] = evidenceRow((finite(tendencies.redZone, 0.5) - 0.5) * 2, clamp(staff.confidence ?? 0.5, 0.2, 0.68), "current staff red-zone prior", { playCaller: staff.playCaller });
    }
    return out;
  }

  function campRoleEvidence(signal) {
    if (!signal?.available) return {};
    const structural = clamp(finite(signal.roleScore), -1, 1);
    const performance = clamp(finite(signal.performanceScore), -1, 1);
    const availabilityRisk = clamp(finite(signal.availabilityRisk), 0, 1);
    return {
      "role.camp_state": {
        available: true,
        value: structural,
        roleScore: structural,
        performanceScore: performance,
        usageScore: clamp(finite(signal.usageScore), -1, 1),
        usageConfidence: clamp(finite(signal.usageConfidence), 0, 0.9),
        availabilityRisk,
        confidence: clamp(signal.confidence, 0.05, 0.6),
        conflict: clamp(signal.conflict, 0, 1),
        source: "camp/news coach-usage role-state classifier",
        scoringEffect: "uncertainty-only",
      },
    };
  }

  function preseasonAlphaEvidence(alpha) {
    if (!alpha || !Number.isFinite(Number(alpha.alphaScore))) return {};
    return { "role.preseason_alpha": {
      available: true, value: clamp(alpha.alphaScore, -1, 1),
      roleScore: clamp(alpha.rawStructuralSignal, -1, 1),
      availabilityRisk: Number.isFinite(Number(alpha.injury?.signal)) ? clamp(-Number(alpha.injury.signal), 0, 1) : 0,
      confidence: clamp(alpha.confidence, 0.05, 0.82),
      conflict: clamp(alpha.market?.conflict, 0, 1),
      marketPricedFraction: clamp(alpha.market?.pricedFraction, 0, 1),
      source: "structured preseason role-state model", scoringEffect: "uncertainty-only",
    } };
  }

  function preseasonAlphaEvidence(alpha) {
    if (!alpha || !Number.isFinite(Number(alpha.alphaScore))) return {};
    return { "role.preseason_alpha": {
      available: true, value: clamp(alpha.alphaScore, -1, 1),
      roleScore: clamp(alpha.rawStructuralSignal, -1, 1),
      availabilityRisk: Number.isFinite(Number(alpha.injury?.signal)) ? clamp(-Number(alpha.injury.signal), 0, 1) : 0,
      confidence: clamp(alpha.confidence, 0.05, 0.82),
      conflict: clamp(alpha.market?.conflict, 0, 1),
      marketPricedFraction: clamp(alpha.market?.pricedFraction, 0, 1),
      source: "structured preseason role-state model", scoringEffect: "uncertainty-only",
    } };
  }

  function shadowDrivers(player, baseline, evidence = {}) {
    const mean = Math.max(0, finite(baseline?.mean));
    const position = String(player?.position || "").toUpperCase();
    const rows = [];
    const targetShare = clamp(finite(player?.opportunity?.targetShare), 0, 0.5);
    const carryShare = clamp(finite(player?.opportunity?.carryShare), 0, 0.8);
    const qbRushFraction = position === "QB" ? clamp(0.1 + carryShare * 0.9, 0.1, 0.38) : 0;
    const rbReceiveFraction = position === "RB" ? clamp(0.08 + targetShare * 1.35, 0.08, 0.38) : 0;
    const componentBase = (component) => {
      if (position === "QB" && component === "rushing") return mean * qbRushFraction;
      if (position === "QB" && component === "passing") return mean * (1 - qbRushFraction);
      if (position === "RB" && component === "receiving") return mean * rbReceiveFraction;
      if (position === "RB" && component === "rushing") return mean * (1 - rbReceiveFraction);
      return mean;
    };
    const add = (feature, label, weight, component = "total") => {
      const row = evidence?.[feature];
      if (!row || row.available === false || !Number.isFinite(Number(row.value))) return;
      const impact = componentBase(component) * clamp(Number(row.value), -1, 1) * weight * clamp(row.confidence ?? 0.5, 0, 1);
      if (Math.abs(impact) >= 0.01) rows.push({ feature, label, impact, component, confidence: row.confidence, source: row.source, scoringEffect: "shadow-only" });
    };
    add("system.team_volume", "team play volume", 0.055);
    add("system.playcaller_pace", "playcaller pace", 0.025);
    if (["QB", "WR", "TE"].includes(position)) {
      add("system.pass_rate", "passing volume tendency", 0.06, "passing");
      add("system.playcaller_pass", "playcaller pass tendency", 0.035, "passing");
      add("system.play_action", "play-action environment", 0.018, "passing");
      add("system.motion", "motion environment", 0.012, "passing");
      add("matchup.pressure_grade", "opponent pressure", 0.055, "passing");
      add("matchup.pass_efficiency_grade", "opponent pass efficiency", 0.045, "passing");
      add("line.pass_protection_proxy", "pass-protection environment", 0.04, "passing");
    }
    if (["RB", "QB"].includes(position)) {
      add("matchup.rush_front_grade", "opponent run front", 0.05, "rushing");
      add("line.run_block_proxy", "run-blocking environment", 0.035, "rushing");
    }
    if (position === "RB") add("system.rush_concentration", "backfield concentration", 0.045, "rushing");
    if (position === "RB") add("system.rb_committee", "playcaller backfield concentration", 0.035, "rushing");
    if (["WR", "TE"].includes(position)) add("system.target_concentration", "target concentration", 0.035, "receiving");
    if (position === "TE") add("system.te_usage", "playcaller TE usage", 0.055, "receiving");
    if (position === "QB") add("system.qb_run", "designed QB run tendency", 0.065, "rushing");
    add("system.red_zone", "red-zone system tendency", 0.025);
    add("matchup.red_zone_grade", "opponent red-zone profile", 0.025);
    const interaction = (leftFeature, rightFeature, feature, label, weight, component) => {
      const left = evidence?.[leftFeature], right = evidence?.[rightFeature];
      if (!left || !right || left.available === false || right.available === false) return;
      const value = clamp(finite(left.value) * finite(right.value), -1, 1);
      const confidence = Math.min(clamp(left.confidence ?? 0.5, 0, 1), clamp(right.confidence ?? 0.5, 0, 1));
      const impact = componentBase(component) * value * weight * confidence;
      if (Math.abs(impact) >= 0.01) rows.push({ feature, label, impact, component, confidence, source: "interaction of measured football context", scoringEffect: "shadow-only" });
    };
    interaction("line.pass_protection_proxy", "matchup.pressure_grade", "interaction.protection_pressure", "pass protection vs opponent pressure", 0.045, "passing");
    interaction("line.run_block_proxy", "matchup.rush_front_grade", "interaction.run_block_front", "run blocking vs opponent front", 0.04, "rushing");
    if (["WR", "TE", "RB"].includes(position) && targetShare > 0) {
      const row = evidence?.["system.team_volume"];
      if (row) rows.push({ feature: "interaction.volume_target_share", label: "team volume × target share", impact: componentBase("receiving") * clamp(row.value, -1, 1) * targetShare * 0.09 * clamp(row.confidence ?? 0.5, 0, 1), component: "receiving", confidence: row.confidence, source: row.source, scoringEffect: "shadow-only" });
    }
    if (["RB", "QB"].includes(position) && carryShare > 0) {
      const row = evidence?.["system.team_volume"];
      if (row) rows.push({ feature: "interaction.volume_carry_share", label: "team volume × carry share", impact: componentBase("rushing") * clamp(row.value, -1, 1) * carryShare * 0.06 * clamp(row.confidence ?? 0.5, 0, 1), component: "rushing", confidence: row.confidence, source: row.source, scoringEffect: "shadow-only" });
    }

    const cap = Math.max(0.35, mean * 0.18);
    const total = rows.reduce((sum, row) => sum + row.impact, 0);
    const scale = Math.abs(total) > cap ? cap / Math.abs(total) : 1;
    const adjusted = rows.map((row) => ({ ...row, impact: row.impact * scale }));
    const byComponent = adjusted.reduce((out, row) => { out[row.component] = finite(out[row.component]) + row.impact; return out; }, {});
    return { version: VERSION, drivers: adjusted, correction: adjusted.reduce((sum, row) => sum + row.impact, 0), byComponent, status: "shadow-only" };
  }

  function roleUncertaintyAdjustment(evidence = {}) {
    const state = evidence?.["role.preseason_alpha"] || evidence?.["role.camp_state"];
    if (!state || state.available === false) return { roleDelta: 0, availabilityDelta: 0, reason: null };
    const confidence = clamp(state.confidence, 0, state === evidence?.["role.preseason_alpha"] ? 0.82 : 0.6);
    const conflict = clamp(state.conflict, 0, 1);
    const structuralMagnitude = Math.abs(clamp(state.roleScore, -1, 1));
    const clarity = structuralMagnitude * confidence * (1 - conflict * 0.6);
    const roleDelta = state.roleScore >= 0 ? -0.12 * clarity : 0.16 * clarity;
    const availabilityDelta = clamp(state.availabilityRisk, 0, 1) * confidence * 0.08;
    return { roleDelta, availabilityDelta, reason: "structured preseason role state absorbed into uncertainty, not the forecast mean" };
  }

  return { VERSION, contextEvidence, campRoleEvidence, preseasonAlphaEvidence, shadowDrivers, roleUncertaintyAdjustment };
});

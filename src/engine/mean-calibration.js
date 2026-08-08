(function attachSnapCountMeanCalibration(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnapCountMeanCalibration = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMeanCalibration() {
  "use strict";

  const VERSION = "snapcount-mean-calibration-2026.1";
  const TRAINING_SEASONS = Object.freeze([2021, 2022, 2023]);
  const FROZEN_TEST_SEASON = 2024;
  const CONSISTENCY_SEASON = 2025;
  const MODELS = Object.freeze({
    QB: null,
    RB: Object.freeze({
      intercept: -0.418743,
      coefficients: Object.freeze({ defense: 0.056113, fpoe: 0.145512, implied: 0.034549, target: -0.656749, xfp: 0.087485 }),
    }),
    WR: Object.freeze({
      intercept: -0.393169,
      coefficients: Object.freeze({ implied: 0.05404, snap: 0.168455, practiceDnp: -0.121268, defense: 0.04127 }),
    }),
    TE: Object.freeze({ intercept: -0.041518, coefficients: Object.freeze({ snap: 0.239355 }) }),
  });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function evidenceValue(evidence, feature) {
    const row = evidence?.[feature];
    return row && row.available !== false && Number.isFinite(Number(row.value)) ? Number(row.value) : null;
  }
  function driver(rows, feature, label, impact, source = null) {
    if (!Number.isFinite(impact) || Math.abs(impact) < 0.001) return;
    rows.push({
      feature, family: "validated", label, impact,
      confidence: 1, conflict: 0,
      model: VERSION,
      source: source || "2021-2023 archived ESPN-PPR residual fit; frozen 2024 admission",
    });
  }

  function drivers(player, baseline, evidence = {}) {
    if (player?.projectionSource !== "espn-live-ppr") return [];
    const position = String(player?.position || "").toUpperCase();
    const model = MODELS[position];
    if (!model) return [];
    const mean = Math.max(0, finite(baseline?.mean));
    const rows = [];
    driver(rows, "validated.intercept", "historical residual calibration", model.intercept);
    if (position === "RB") {
      const defense = evidenceValue(evidence, "matchup.position_grade");
      const fpoe = evidenceValue(evidence, "efficiency.fpoe");
      const implied = evidenceValue(evidence, "market.team_implied_points");
      const target = evidenceValue(evidence, "role.target_share");
      const xfp = evidenceValue(evidence, "opportunity.xfp");
      if (defense !== null) driver(rows, "matchup.position_grade", "validated defense residual", mean * defense * model.coefficients.defense);
      if (fpoe !== null) driver(rows, "efficiency.fpoe", "validated FPOE residual", fpoe * model.coefficients.fpoe);
      if (implied !== null) driver(rows, "market.team_implied_points", "validated scoring-environment residual", mean * ((implied - 22.5) / 7) * model.coefficients.implied);
      if (target !== null) driver(rows, "role.target_share", "validated target-share shrinkage", mean * (target - 0.10) * model.coefficients.target);
      if (xfp !== null) driver(rows, "opportunity.xfp", "validated xFP residual", (xfp - mean) * model.coefficients.xfp);
    } else if (position === "WR") {
      const implied = evidenceValue(evidence, "market.team_implied_points");
      const snap = evidenceValue(evidence, "role.snap_share");
      const practiceDnp = evidenceValue(evidence, "health.practice_dnp");
      const defense = evidenceValue(evidence, "matchup.position_grade");
      if (implied !== null) driver(rows, "market.team_implied_points", "validated scoring-environment residual", mean * ((implied - 22.5) / 7) * model.coefficients.implied);
      if (snap !== null) driver(rows, "role.snap_share", "validated snap-share residual", mean * (snap - 0.74) * model.coefficients.snap);
      if (practiceDnp !== null) driver(rows, "health.practice_dnp", "validated practice DNP residual", mean * practiceDnp * model.coefficients.practiceDnp);
      if (defense !== null) driver(rows, "matchup.position_grade", "validated defense residual", mean * defense * model.coefficients.defense);
    } else if (position === "TE") {
      const snap = evidenceValue(evidence, "role.snap_share");
      if (snap !== null) driver(rows, "role.snap_share", "validated snap-share residual", mean * (snap - 0.74) * model.coefficients.snap);
    }
    return rows;
  }

  return {
    VERSION,
    TRAINING_SEASONS,
    FROZEN_TEST_SEASON,
    CONSISTENCY_SEASON,
    MODELS,
    drivers,
  };
});

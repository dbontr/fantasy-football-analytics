(function attachSnapCountCorrelation(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SnapCountCorrelation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSnapCountCorrelation() {
  "use strict";

  const VERSION = "snapcount-correlation-2026.1";
  const POSITIONS = Object.freeze(["QB", "RB", "WR", "TE"]);
  const TRAINING_SEASONS = Object.freeze([2023, 2024]);
  const CONSISTENCY_SEASON = 2025;
  const SHRINKAGE_PAIRS = 200;
  const MAX_SHARED_VARIANCE = 0.9;

  const PAIR_CORRELATIONS = Object.freeze({
    same: Object.freeze({
      "QB-RB": 0.051,
      "QB-WR": 0.277,
      "QB-TE": 0.172,
      "RB-RB": -0.003,
      "RB-WR": -0.031,
      "RB-TE": -0.006,
      "WR-WR": 0.008,
      "WR-TE": 0.006,
      "TE-TE": -0.016,
    }),
    opponent: Object.freeze({
      "QB-QB": 0.068,
      "QB-RB": -0.006,
      "QB-WR": 0.023,
      "QB-TE": 0.059,
      "RB-RB": 0.026,
      "RB-WR": -0.014,
      "RB-TE": 0,
      "WR-WR": 0.032,
      "WR-TE": 0.014,
      "TE-TE": 0.003,
    }),
  });

  const PAIR_SUPPORT = Object.freeze({
    same: Object.freeze({
      "QB-RB": 1738, "QB-WR": 2829, "QB-TE": 1303,
      "RB-RB": 1120, "RB-WR": 5969, "RB-TE": 2723,
      "WR-WR": 3735, "WR-TE": 4473, "TE-TE": 584,
    }),
    opponent: Object.freeze({
      "QB-QB": 408, "QB-RB": 1731, "QB-WR": 2808, "QB-TE": 1304,
      "RB-RB": 1830, "RB-WR": 5907, "RB-TE": 2741,
      "WR-WR": 4857, "WR-TE": 4451, "TE-TE": 1020,
    }),
  });
  function pairKey(leftPosition, rightPosition) {
    const left = String(leftPosition || "").toUpperCase();
    const right = String(rightPosition || "").toUpperCase();
    const leftIndex = POSITIONS.indexOf(left);
    const rightIndex = POSITIONS.indexOf(right);
    if (leftIndex < 0 || rightIndex < 0) return null;
    return leftIndex <= rightIndex ? `${left}-${right}` : `${right}-${left}`;
  }

  function targetCorrelation(leftPosition, rightPosition, sameTeam) {
    const key = pairKey(leftPosition, rightPosition);
    if (!key) return 0;
    const relation = sameTeam ? "same" : "opponent";
    return Number(PAIR_CORRELATIONS[relation][key] || 0);
  }

  function support(leftPosition, rightPosition, sameTeam) {
    const key = pairKey(leftPosition, rightPosition);
    if (!key) return 0;
    return Number(PAIR_SUPPORT[sameTeam ? "same" : "opponent"][key] || 0);
  }

  return {
    VERSION,
    POSITIONS,
    TRAINING_SEASONS,
    CONSISTENCY_SEASON,
    SHRINKAGE_PAIRS,
    MAX_SHARED_VARIANCE,
    PAIR_CORRELATIONS,
    PAIR_SUPPORT,
    pairKey,
    targetCorrelation,
    support,
  };
});

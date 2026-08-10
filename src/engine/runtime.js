(function attachOracleBrowserEngine(root, factory) {
  const core = typeof module !== "undefined" && module.exports
    ? require("./core.js")
    : root.FantasyOracleCore;
  const rookies = typeof module !== "undefined" && module.exports
    ? require("./rookies.js")
    : root.OracleRookies;
  const correlationModel = typeof module !== "undefined" && module.exports
    ? require("./correlation.js")
    : root.SnapCountCorrelation;
  const meanCalibration = typeof module !== "undefined" && module.exports
    ? require("./mean-calibration.js")
    : root.SnapCountMeanCalibration;
  const api = factory(core, rookies, correlationModel, meanCalibration);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleBrowserEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createEngine(core, rookies, correlationModel, meanCalibration) {
  "use strict";

  const VERSION = "oracle-browser-2026.8-future-win";
  const POSITION_VOLATILITY = Object.freeze({ QB: 0.27, RB: 0.43, WR: 0.49, TE: 0.51, K: 0.46, DST: 0.56 });
  const STATUS_AVAILABILITY = Object.freeze({ ACTIVE: 0.995, QUESTIONABLE: 0.82, DOUBTFUL: 0.35, OUT: 0.01, IR: 0.005, PUP: 0.08, SUSPENDED: 0 });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }
  function mean(values) {
    return values?.length ? values.reduce((sum, value) => sum + finite(value), 0) / values.length : 0;
  }
  function standardDeviation(values, average = mean(values)) {
    if (!values?.length) return 0;
    return Math.sqrt(values.reduce((sum, value) => sum + (finite(value) - average) ** 2, 0) / values.length);
  }
  function quantileSorted(sorted, probability) {
    if (!sorted?.length) return 0;
    const index = clamp(probability, 0, 1) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }
  function summarizeSamples(samples, options = {}) {
    const count = samples?.length || 0;
    if (!count) throw new TypeError("Sample summary requires values");
    const values = new Float64Array(count);
    for (let index = 0; index < count; index += 1) values[index] = finite(samples[index]);
    values.sort();
    let sum = 0, sumSquares = 0;
    for (let index = 0; index < count; index += 1) { sum += values[index]; sumSquares += values[index] * values[index]; }
    const average = sum / count;
    const target = finite(options.target, average);
    const tailCount = Math.max(1, Math.ceil(count * 0.1));
    let tailSum = 0, downside = 0;
    for (let index = 0; index < count; index += 1) {
      if (index < tailCount) tailSum += values[index];
      if (values[index] < target) downside += 1;
    }
    const variance = Math.max(0, sumSquares / count - average * average);
    return {
      samples: count, mean: average, standardDeviation: Math.sqrt(variance),
      p10: quantileSorted(values, 0.1), p25: quantileSorted(values, 0.25), p50: quantileSorted(values, 0.5),
      p75: quantileSorted(values, 0.75), p90: quantileSorted(values, 0.9), cvar10: tailSum / tailCount,
      downsideProbability: downside / count, targetProbability: 1 - downside / count,
    };
  }

  function normalCdf(value) {
    const x = finite(value) / Math.sqrt(2);
    const sign = x < 0 ? -1 : 1;
    const absolute = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * absolute);
    const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
    return clamp(0.5 * (1 + sign * (1 - polynomial * Math.exp(-absolute * absolute))), 0, 1);
  }
  function inverseNormalCdf(probability) {
    const p = clamp(probability, 1e-12, 1 - 1e-12);
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
    const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
    const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
    const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    const low = 0.02425;
    if (p < low) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - low) {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  function mixtureQuantile(probability, activeProbability, activeMean, activeStdDev) {
    const inactive = 1 - activeProbability;
    if (probability <= inactive) return 0;
    const conditional = (probability - inactive) / Math.max(activeProbability, 1e-12);
    return Math.max(0, activeMean + activeStdDev * inverseNormalCdf(conditional));
  }
  function mixtureMoments(activeProbability, activeMean, activeStdDev) {
    const expected = activeProbability * activeMean;
    const second = activeProbability * (activeStdDev ** 2 + activeMean ** 2);
    const variance = Math.max(0, second - expected ** 2);
    return { mean: expected, variance, standardDeviation: Math.sqrt(variance) };
  }

  function fnv1a(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function uniformFromParts(seed, scenario, key, channel) {
    let state = fnv1a(`${seed}|${scenario}|${key}|${channel}`) || 0x6d2b79f5;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) + 0.5) / 4294967296;
  }
  function normalFromParts(seed, scenario, key, channel) {
    const first = Math.max(1e-12, uniformFromParts(seed, scenario, key, `${channel}:u1`));
    const second = uniformFromParts(seed, scenario, key, `${channel}:u2`);
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  }
  function weeklyBaseline(player, week) {
    const normalized = core?.normalizePlayer ? core.normalizePlayer(player) : player;
    const selectedWeek = Math.round(clamp(week, 1, 18));
    const weekly = finite(normalized.weeklyProjections?.[selectedWeek - 1], NaN);
    const baseMean = Number.isFinite(weekly) ? Math.max(0, weekly) : Math.max(0, finite(normalized.weeklyProjection, finite(normalized.projectedPoints) / 17));
    const weeklyScale = baseMean > 0 ? baseMean / Math.max(0.1, finite(normalized.weeklyProjection, baseMean)) : 0;
    const baseStdDev = Math.max(baseMean * 0.12, finite(normalized.projectionStdDev, baseMean * (POSITION_VOLATILITY[normalized.position] || 0.46)) * weeklyScale);
    const status = String(normalized.injuryStatus || "ACTIVE").toUpperCase();
    const statusAvailability = STATUS_AVAILABILITY[status] ?? (normalized.active === false ? 0.05 : 0.99);
    return {
      player: normalized,
      week: selectedWeek,
      mean: baseMean,
      standardDeviation: baseStdDev,
      availability: normalized.byeWeek === selectedWeek ? 0 : statusAvailability,
      reliability: clamp(normalized.reliability ?? 0.68, 0.05, 0.995),
      bye: normalized.byeWeek === selectedWeek || baseMean <= 0,
    };
  }

  function opportunityDrivers(player, baseline) {
    const opportunity = player.opportunity || player.opportunityContext || {};
    const rows = [];
    const push = (label, impact, confidence = 0.7) => {
      if (Math.abs(impact) < 0.01) return;
      rows.push({ family: "opportunity", label, impact, confidence });
    };
    const position = player.position;
    const modelEdge = clamp(opportunity.modelEdge, -0.35, 0.35);
    push("historical opportunity forecast", baseline.mean * modelEdge * 0.22, opportunity.reliability || 0.65);
    const trend = clamp(opportunity.usageTrend, -0.5, 0.5);
    push("recent role trend", baseline.mean * trend * 0.1, opportunity.volumeStability || 0.6);
    if (["WR", "TE", "RB"].includes(position)) {
      const targetPrior = position === "WR" ? 0.2 : position === "TE" ? 0.17 : 0.1;
      const targetShare = finite(opportunity.targetShare, targetPrior);
      push("target share", baseline.mean * clamp(targetShare - targetPrior, -0.25, 0.35) * 0.45, 0.76);
    }
    if (["RB", "QB"].includes(position)) {
      const carryPrior = position === "RB" ? 0.48 : 0.08;
      const carryShare = finite(opportunity.carryShare, carryPrior);
      push("carry share", baseline.mean * clamp(carryShare - carryPrior, -0.4, 0.4) * 0.28, 0.72);
    }
    return rows;
  }

  const FAMILY_CAPS = Object.freeze({ market: 0.3, opportunity: 0.28, efficiency: 0.08, health: 0.45, environment: 0.12, matchup: 0.12, line: 0.1, news: 0.18, context: 0.12, rookie: 0.1 });
  function evidenceDrivers(player, baseline, evidence = {}) {
    const rows = [];
    const add = (feature, family, label, rawImpact) => {
      const resolved = evidence[feature];
      if (!resolved || resolved.available === false) return;
      const confidence = clamp(resolved.confidence ?? 0.65, 0, 1);
      rows.push({ feature, family, label, impact: rawImpact(resolved) * confidence, confidence, conflict: clamp(resolved.conflict, 0, 1) });
    };
    add("market.player_points", "market", "market projection", (r) => (finite(r.value) - baseline.mean) * 0.65);
    add("market.game_total", "market", "live game total", (r) => (finite(r.value) - 44) * baseline.mean * (player.position === "DST" ? -0.006 : 0.005));
    add("market.team_implied_points", "market", "team scoring environment", (r) => ["QB", "RB", "WR", "TE", "K"].includes(player.position) ? (finite(r.value) - 22.5) * baseline.mean * 0.012 : 0);
    add("rookie.cohort_ppg", "rookie", "historical rookie cohort", (r) => (finite(r.value) - baseline.mean) * 0.22);
    add("rookie.draft_capital", "rookie", "draft capital", (r) => (finite(r.value) - 0.45) * baseline.mean * 0.06);
    add("rookie.prospect_score", "rookie", "prospect grade", (r) => (finite(r.value) - 0.5) * baseline.mean * 0.04);
    add("rookie.athletic_percentile", "rookie", "combine athletic profile", (r) => (finite(r.value) - 0.5) * baseline.mean * 0.035);
    add("rookie.age_score", "rookie", "age-adjusted rookie prior", (r) => finite(r.value) * baseline.mean * 0.025);
    add("rookie.depth_chart_delta", "rookie", "live rookie depth chart", (r) => finite(r.value) * baseline.mean);
    add("rookie.development_delta", "rookie", "rookie development curve", (r) => finite(r.value) * baseline.mean * 0.24);
    add("role.target_share", "opportunity", "live target share", (r) => {
      const prior = player.position === "WR" ? 0.2 : player.position === "TE" ? 0.17 : 0.1;
      return (finite(r.value) - prior) * baseline.mean * 1.05;
    });
    add("role.carry_share", "opportunity", "live carry share", (r) => {
      const prior = player.position === "RB" ? 0.48 : 0.08;
      return (finite(r.value) - prior) * baseline.mean * 0.62;
    });
    add("role.snap_share", "opportunity", "snap share", (r) => (finite(r.value) - (player.position === "RB" ? 0.56 : 0.74)) * baseline.mean * 0.32);
    add("opportunity.xfp", "opportunity", "expected fantasy opportunity", (r) => (finite(r.value) - baseline.mean) * 0.38);
    add("efficiency.fpoe", "efficiency", "fantasy points over expectation", (r) => clamp(finite(r.value), -8, 8) * 0.14);
    add("role.redistribution_delta", "opportunity", "teammate absence redistribution", (r) => clamp(finite(r.value), -0.2, 0.3) * baseline.mean);
    add("health.snap_retention", "health", "health snap retention", (r) => (finite(r.value) - 1) * baseline.mean * 0.85);
    add("news.role_delta", "news", "reported role change", (r) => finite(r.value) * baseline.mean * 0.18);
    add("preseason.usage_boost", "news", "preseason usage signal", (r) => clamp(finite(r.value), 0, 0.25) * baseline.mean * 0.6);
    add("environment.wind_mph", "environment", "wind", (r) => {
      const excess = Math.max(0, finite(r.value) - 15);
      return excess * baseline.mean * (["QB", "WR", "TE", "K"].includes(player.position) ? -0.006 : 0.0015);
    });
    add("environment.precip_probability", "environment", "precipitation", (r) => finite(r.value) * baseline.mean * (["DST", "RB"].includes(player.position) ? 0.015 : -0.035));
    add("matchup.pass_grade", "matchup", "pass matchup", (r) => ["QB", "WR", "TE"].includes(player.position) ? finite(r.value) * baseline.mean * 0.08 : 0);
    add("matchup.rush_grade", "matchup", "rush matchup", (r) => ["RB", "QB"].includes(player.position) ? finite(r.value) * baseline.mean * 0.07 : 0);
    add("matchup.position_grade", "matchup", "prior-season positional matchup", (r) => ["QB", "RB", "WR", "TE"].includes(player.position) ? finite(r.value) * baseline.mean * 0.075 : 0);
    add("line.pass_block_grade", "line", "pass protection", (r) => ["QB", "WR", "TE"].includes(player.position) ? finite(r.value) * baseline.mean * 0.045 : 0);
    add("line.run_block_grade", "line", "run blocking", (r) => ["RB", "QB"].includes(player.position) ? finite(r.value) * baseline.mean * 0.055 : 0);
    add("context.qb_replacement_delta", "context", "starting QB replacement", (r) => finite(r.value) * baseline.mean);
    return rows;
  }

  function applyFamilyCaps(rows, baselineMean) {
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.family)) grouped.set(row.family, []);
      grouped.get(row.family).push(row);
    }
    const adjusted = [];
    for (const [family, familyRows] of grouped) {
      const absolute = familyRows.reduce((sum, row) => sum + Math.abs(row.impact), 0);
      const cap = Math.max(0.25, baselineMean * (FAMILY_CAPS[family] || 0.08));
      const scale = absolute > cap ? cap / absolute : 1;
      for (const row of familyRows) adjusted.push({ ...row, impact: row.impact * scale, capApplied: scale < 1 });
    }
    return adjusted.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  }

  function resolveAvailability(baseline, evidence = {}) {
    let probability = baseline.availability;
    let confidence = baseline.reliability;
    const active = evidence["health.active_probability"];
    if (active && active.available !== false) {
      const weight = clamp((active.confidence ?? 0.7) * 0.85, 0, 0.9);
      probability = probability * (1 - weight) + clamp(active.value, 0, 1) * weight;
      confidence = Math.max(confidence, clamp(active.confidence, 0, 1));
    }
    const designation = evidence["availability.designation"];
    if (designation && designation.available !== false) {
      const mapped = STATUS_AVAILABILITY[String(designation.value || "").toUpperCase()];
      if (mapped !== undefined) {
        const weight = clamp((designation.confidence ?? 0.75) * 0.95, 0, 0.98);
        probability = probability * (1 - weight) + mapped * weight;
        confidence = Math.max(confidence, clamp(designation.confidence, 0, 1));
      }
    }
    return { probability: baseline.bye ? 0 : clamp(probability, 0, 1), confidence };
  }

  function forecastPlayer(player, options = {}) {
    const baseline = weeklyBaseline(player, options.week || 1);
    const evidence = options.evidence || {};
    if (baseline.bye) {
      return {
        version: VERSION, player: baseline.player, week: baseline.week, baseline,
        availability: { probability: 0, confidence: 1 },
        activeDistribution: { mean: 0, standardDeviation: 0 },
        distribution: { mean: 0, standardDeviation: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, cvar10: 0 },
        uncertainty: { aleatoric: 0, epistemic: 0, availability: 0, role: 0, evidenceConflict: 0 },
        drivers: [{ family: "schedule", label: "bye week", impact: -baseline.mean }],
      };
    }
    const availability = resolveAvailability(baseline, evidence);
    const livePprAnchor = baseline.player.projectionSource === "espn-live-ppr";
    const validatedMeanScale = livePprAnchor ? clamp(options.validatedMeanScale ?? 1, 0, 1) : 1;
    const drivers = livePprAnchor
      ? (meanCalibration?.drivers?.(baseline.player, baseline, evidence) || []).map((row) => ({ ...row, impact: row.impact * validatedMeanScale }))
      : applyFamilyCaps([
        ...opportunityDrivers(baseline.player, baseline),
        ...evidenceDrivers(baseline.player, baseline, evidence),
      ], baseline.mean);
    let correction = drivers.reduce((sum, row) => sum + row.impact, 0);
    if (livePprAnchor) correction = clamp(correction, -baseline.mean, Math.max(3, baseline.mean * 0.65));
    const expectedMeanTarget = Math.max(0, baseline.mean + correction);
    const activeMean = livePprAnchor && availability.probability > 0
      ? expectedMeanTarget / Math.max(0.05, availability.probability)
      : expectedMeanTarget;
    const opportunity = baseline.player.opportunity || {};
    let roleUncertainty = clamp(1 - finite(opportunity.volumeStability, baseline.reliability), 0, 1);
    const conflict = clamp(mean(drivers.map((row) => row.conflict || 0)), 0, 1);
    let epistemic = clamp(1 - Math.max(baseline.reliability, finite(opportunity.reliability, 0)), 0, 1);
    const rookieProfile = rookies?.uncertainty?.(baseline.player, evidence);
    if (rookieProfile) {
      roleUncertainty = clamp(Math.max(roleUncertainty, finite(rookieProfile.roleFloor)), 0, 0.78);
      epistemic = clamp(Math.max(epistemic, finite(rookieProfile.epistemicFloor)), 0, 0.75);
    }
    const volatility = POSITION_VOLATILITY[baseline.player.position] || 0.46;
    const stdMultiplier = 1 + epistemic * 0.34 + roleUncertainty * 0.28 + conflict * 0.32;
    const activeStdDev = Math.max(activeMean * 0.12, baseline.standardDeviation, activeMean * volatility * 0.62) * stdMultiplier;
    const moments = mixtureMoments(availability.probability, activeMean, activeStdDev);
    const quantiles = Object.fromEntries([0.1, 0.25, 0.5, 0.75, 0.9].map((q) => [`p${Math.round(q * 100)}`, mixtureQuantile(q, availability.probability, activeMean, activeStdDev)]));
    const cvar10 = mean(Array.from({ length: 31 }, (_, index) => mixtureQuantile(((index + 0.5) / 31) * 0.1, availability.probability, activeMean, activeStdDev)));
    const expected = moments.mean;
    const bustThreshold = Math.max(4, baseline.mean * 0.6);
    const boomThreshold = Math.max(12, baseline.mean * 1.45);
    return {
      version: VERSION, player: baseline.player, week: baseline.week, baseline,
      availability,
      activeDistribution: { mean: activeMean, standardDeviation: activeStdDev },
      distribution: { ...moments, ...quantiles, cvar10 },
      probabilities: {
        active: availability.probability,
        boom: 1 - (1 - availability.probability + availability.probability * normalCdf((boomThreshold - activeMean) / activeStdDev)),
        bust: 1 - availability.probability + availability.probability * normalCdf((bustThreshold - activeMean) / activeStdDev),
      },
      uncertainty: {
        aleatoric: activeStdDev, epistemic, availability: 1 - availability.probability,
        role: roleUncertainty, evidenceConflict: conflict,
      },
      drivers,
      edge: { points: expected - baseline.mean, percent: baseline.mean > 0 ? (expected - baseline.mean) / baseline.mean : 0 },
    };
  }

  function forecastPlayers(players, options = {}) {
    const evidenceByPlayer = options.evidenceByPlayer || {};
    return (players || []).map((player) => forecastPlayer(player, {
      ...options,
      evidence: evidenceByPlayer[String(player.id)] || {},
    }));
  }

  function gameContext(player, schedule, week) {
    const team = String(player.team || "FA");
    const row = schedule?.[team]?.weeks?.[Math.max(0, Number(week || 1) - 1)] || null;
    const opponent = row?.opponent ? String(row.opponent) : null;
    return {
      team,
      opponent,
      gameKey: opponent ? [team, opponent].sort().join("-") : `unknown-${team}-week-${week}`,
      home: row?.home ?? null,
      indoor: row?.indoor ?? null,
      bye: row?.bye === true,
    };
  }
  function buildCorrelationPlan(forecasts, schedule, week) {
    const entries = (forecasts || []).map((forecast) => ({
      forecast,
      id: String(forecast.player.id),
      context: gameContext(forecast.player, schedule, week),
      activeMean: finite(forecast.activeDistribution?.mean),
      activeStdDev: finite(forecast.activeDistribution?.standardDeviation),
      availability: clamp(forecast.availability?.probability, 0, 1),
      residualWeight: 1,
    }));
    const loads = new Float64Array(entries.length);
    const rawEdges = [];
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const left = entries[leftIndex];
        const right = entries[rightIndex];
        if (left.context.gameKey !== right.context.gameKey) continue;
        const sameTeam = left.context.team === right.context.team;
        const rho = finite(correlationModel?.targetCorrelation(left.forecast.player.position, right.forecast.player.position, sameTeam), 0);
        if (Math.abs(rho) < 1e-6) continue;
        rawEdges.push({
          leftIndex,
          rightIndex,
          rho,
          key: [left.id, right.id].sort().join("|"),
        });
        loads[leftIndex] += Math.abs(rho);
        loads[rightIndex] += Math.abs(rho);
      }
    }
    const cap = clamp(correlationModel?.MAX_SHARED_VARIANCE ?? 0.9, 0.1, 0.98);
    const scales = Array.from(loads, (load) => load > cap ? Math.sqrt(cap / load) : 1);
    const sharedVariance = new Float64Array(entries.length);
    const edges = rawEdges.map((edge) => {
      const magnitude = Math.sqrt(Math.abs(edge.rho));
      const leftWeight = magnitude * scales[edge.leftIndex];
      const rightWeight = Math.sign(edge.rho) * magnitude * scales[edge.rightIndex];
      sharedVariance[edge.leftIndex] += leftWeight * leftWeight;
      sharedVariance[edge.rightIndex] += rightWeight * rightWeight;
      return { ...edge, leftWeight, rightWeight, realizedCorrelation: leftWeight * rightWeight };
    });
    entries.forEach((entry, index) => {
      entry.residualWeight = Math.sqrt(Math.max(0, 1 - sharedVariance[index]));
    });
    return { version: correlationModel?.VERSION || "uncalibrated", week, entries, edges };
  }

  function sampleCorrelationPlan(plan, seed, scenario, values = new Float64Array(plan.entries.length)) {
    const z = new Float64Array(plan.entries.length);
    for (let index = 0; index < plan.entries.length; index += 1) {
      const entry = plan.entries[index];
      z[index] = normalFromParts(seed, scenario, entry.id, "player-residual") * entry.residualWeight;
    }
    for (const edge of plan.edges) {
      const factor = normalFromParts(seed, scenario, edge.key, "pair-correlation");
      z[edge.leftIndex] += factor * edge.leftWeight;
      z[edge.rightIndex] += factor * edge.rightWeight;
    }
    for (let index = 0; index < plan.entries.length; index += 1) {
      const entry = plan.entries[index];
      if (entry.context.bye || entry.forecast.baseline?.bye ||
          uniformFromParts(seed, scenario, entry.id, "availability") > entry.availability) {
        values[index] = 0;
      } else {
        values[index] = Math.max(0, entry.activeMean + entry.activeStdDev * z[index]);
      }
    }
    return values;
  }

  function sampleForecast(forecast, context, seed, scenario) {
    if (context.bye || forecast.baseline?.bye) return 0;
    if (uniformFromParts(seed, scenario, String(forecast.player.id), "availability") > clamp(forecast.availability?.probability, 0, 1)) return 0;
    const residual = normalFromParts(seed, scenario, String(forecast.player.id), "player-residual");
    return Math.max(0, finite(forecast.activeDistribution?.mean) + finite(forecast.activeDistribution?.standardDeviation) * residual);
  }

  function correlation(left, right) {
    const count = Math.min(left?.length || 0, right?.length || 0);
    if (count < 2) return 0;
    let sumLeft = 0, sumRight = 0, sumLeftSq = 0, sumRightSq = 0, sumProduct = 0;
    for (let index = 0; index < count; index += 1) {
      const l = finite(left[index]), r = finite(right[index]);
      sumLeft += l; sumRight += r; sumLeftSq += l * l; sumRightSq += r * r; sumProduct += l * r;
    }
    const covariance = sumProduct - sumLeft * sumRight / count;
    const leftVariance = sumLeftSq - sumLeft * sumLeft / count;
    const rightVariance = sumRightSq - sumRight * sumRight / count;
    const denominator = Math.sqrt(Math.max(0, leftVariance) * Math.max(0, rightVariance));
    return denominator > 0 ? clamp(covariance / denominator, -1, 1) : 0;
  }

  function simulateForecasts(forecasts, options = {}) {
    if (!forecasts?.length) throw new TypeError("Scenario simulation requires forecasts");
    if (forecasts.length > 192) throw new RangeError("At most 192 players per scenario run");
    const scenarios = Math.min(50_000, Math.max(100, Number(options.scenarios || 5_000)));
    const seed = String(options.seed ?? 2026);
    const week = Math.round(clamp(options.week || forecasts[0].week || 1, 1, 18));
    const schedule = options.schedule || {};
    const plan = buildCorrelationPlan(forecasts, schedule, week);
    const sampleArrays = plan.entries.map(() => new Float32Array(scenarios));
    const scratch = new Float64Array(plan.entries.length);
    for (let scenario = 0; scenario < scenarios; scenario += 1) {
      sampleCorrelationPlan(plan, seed, scenario, scratch);
      for (let index = 0; index < plan.entries.length; index += 1) {
        sampleArrays[index][scenario] = scratch[index];
      }
    }
    const playerSamples = Object.fromEntries(plan.entries.map((entry, index) => [entry.id, sampleArrays[index]]));
    const playerSummaries = Object.fromEntries(plan.entries.map((entry, index) => [entry.id, {
      player: entry.forecast.player,
      ...summarizeSamples(sampleArrays[index], { target: entry.forecast.baseline?.mean }),
    }]));
    const correlations = [];
    for (const [leftId, rightId] of (options.correlationPairs || []).slice(0, 40)) {
      if (playerSamples[leftId] && playerSamples[rightId]) correlations.push({
        leftId,
        rightId,
        correlation: correlation(playerSamples[leftId], playerSamples[rightId]),
      });
    }
    return {
      version: VERSION,
      correlationVersion: plan.version,
      seed,
      scenarios,
      week,
      playerSamples,
      playerSummaries,
      correlations,
    };
  }

  function pairedRegrets(actions, sampleCount) {
    const regrets = actions.map(() => new Float32Array(sampleCount));
    const bestCredits = actions.map(() => 0);
    for (let index = 0; index < sampleCount; index += 1) {
      const values = actions.map((action) => finite(action.samples[index]));
      const best = Math.max(...values);
      const winners = values.map((value, actionIndex) => ({ value, actionIndex })).filter((row) => Math.abs(row.value - best) <= 1e-9);
      for (const winner of winners) bestCredits[winner.actionIndex] += 1 / winners.length;
      values.forEach((value, actionIndex) => { regrets[actionIndex][index] = best - value; });
    }
    return { regrets, probabilityBest: bestCredits.map((value) => value / sampleCount) };
  }
  function robustScore(summary, regret, probabilityBest, options = {}) {
    const riskAversion = clamp(options.riskAversion ?? 0.35, 0, 1);
    const regretPenalty = Math.max(0, finite(options.regretPenalty, 0.15));
    const bestBonus = Math.max(0, finite(options.bestProbabilityBonus, 0.05));
    return summary.mean * (1 - riskAversion) + summary.cvar10 * riskAversion - regret.expected * regretPenalty + probabilityBest * Math.max(1, Math.abs(summary.mean)) * bestBonus;
  }

  function paretoFrontier(rows) {
    return rows.filter((candidate) => !rows.some((other) => {
      if (candidate.id === other.id) return false;
      const noWorse = other.summary.mean >= candidate.summary.mean && other.summary.cvar10 >= candidate.summary.cvar10 && other.probabilityBest >= candidate.probabilityBest && other.regret.expected <= candidate.regret.expected;
      const better = other.summary.mean > candidate.summary.mean || other.summary.cvar10 > candidate.summary.cvar10 || other.probabilityBest > candidate.probabilityBest || other.regret.expected < candidate.regret.expected;
      return noWorse && better;
    })).map((row) => row.id);
  }
  function rankPairedActions(actions, options = {}) {
    if (!actions?.length) throw new TypeError("Robust ranking requires actions");
    const normalized = actions.map((action, index) => ({
      id: String(action.id || `action-${index + 1}`),
      label: String(action.label || action.id || `Action ${index + 1}`),
      samples: Array.from(action.samples || [], finite),
      metadata: action.metadata || {},
    }));
    const sampleCount = normalized[0].samples.length;
    if (!sampleCount || normalized.some((action) => action.samples.length !== sampleCount)) throw new RangeError("Paired samples must have equal non-zero lengths");
    const paired = pairedRegrets(normalized, sampleCount);
    const rows = normalized.map((action, index) => {
      const summary = summarizeSamples(action.samples, { target: options.target });
      const sortedRegret = Array.from(paired.regrets[index]).sort((a, b) => a - b);
      const regret = {
        expected: mean(sortedRegret), p90: quantileSorted(sortedRegret, 0.9),
        maximum: sortedRegret.at(-1) || 0,
        probability: sortedRegret.filter((value) => value > 1e-9).length / sampleCount,
      };
      return { ...action, summary, probabilityBest: paired.probabilityBest[index], regret, robustScore: robustScore(summary, regret, paired.probabilityBest[index], options) };
    }).sort((a, b) => b.robustScore - a.robustScore || b.probabilityBest - a.probabilityBest || b.summary.mean - a.summary.mean);
    const frontier = new Set(paretoFrontier(rows));
    const preferred = rows[0];
    const riskLevels = options.riskLevels || [0, 0.25, 0.5, 0.75, 1];
    const sensitivity = riskLevels.map((riskAversion) => {
      const ranked = rows.map((row) => ({ id: row.id, score: robustScore(row.summary, row.regret, row.probabilityBest, { ...options, riskAversion }) })).sort((a, b) => b.score - a.score);
      return { riskAversion, preferredActionId: ranked[0].id, margin: ranked[1] ? ranked[0].score - ranked[1].score : null };
    });
    const selectedRisk = clamp(options.riskAversion ?? 0.35, 0, 1);
    rows.forEach((row, index) => {
      const gap = Math.max(0, preferred.robustScore - row.robustScore);
      row.rank = index + 1;
      row.paretoOptimal = frontier.has(row.id);
      row.reversal = row.id === preferred.id ? { scoreGap: 0 } : { scoreGap: gap, meanLiftNeeded: gap / Math.max(0.05, 1 - selectedRisk), tailLiftNeeded: gap / Math.max(0.05, selectedRisk) };
      delete row.samples;
    });
    return {
      version: VERSION, sampleCount, preferredActionId: preferred.id,
      stability: sensitivity.filter((row) => row.preferredActionId === preferred.id).length / sensitivity.length,
      paretoFrontier: [...frontier], sensitivity, actions: rows,
    };
  }

  function evaluatePortfolios(forecasts, portfolios, options = {}) {
    if (!portfolios?.length) throw new TypeError("Portfolio evaluation requires portfolios");
    const ids = new Set(forecasts.map((forecast) => String(forecast.player.id)));
    const normalized = portfolios.map((portfolio, index) => {
      const playerIds = [...new Set((portfolio.playerIds || []).map(String))];
      if (!playerIds.length || playerIds.some((id) => !ids.has(id))) throw new RangeError(`Invalid portfolio ${index + 1}`);
      return {
        id: String(portfolio.id || `portfolio-${index + 1}`),
        label: String(portfolio.label || portfolio.id || `Portfolio ${index + 1}`),
        playerIds,
        weights: Object.fromEntries(playerIds.map((id) => [id, Math.max(0, finite(portfolio.weights?.[id], 1))])),
        metadata: portfolio.metadata || {},
      };
    });
    const usedIds = new Set(normalized.flatMap((row) => row.playerIds));
    const simulation = simulateForecasts(forecasts.filter((forecast) => usedIds.has(String(forecast.player.id))), options);
    const actions = normalized.map((portfolio) => {
      const samples = new Float32Array(simulation.scenarios);
      for (const playerId of portfolio.playerIds) {
        const weight = portfolio.weights[playerId];
        const values = simulation.playerSamples[playerId];
        for (let index = 0; index < samples.length; index += 1) samples[index] += values[index] * weight;
      }
      const totalWeight = Object.values(portfolio.weights).reduce((sum, value) => sum + value, 0);
      const concentration = totalWeight > 0 ? Object.values(portfolio.weights).reduce((sum, value) => sum + (value / totalWeight) ** 2, 0) : 0;
      return { id: portfolio.id, label: portfolio.label, samples, metadata: { ...portfolio.metadata, concentration } };
    });
    return {
      version: VERSION,
      simulation: { seed: simulation.seed, scenarios: simulation.scenarios, week: simulation.week, correlations: simulation.correlations },
      decision: rankPairedActions(actions, options),
      playerSummaries: simulation.playerSummaries,
    };
  }

  function roundRobinPairings(teamIds, week) {
    const teams = [...teamIds];
    if (teams.length % 2) teams.push(null);
    const fixed = teams[0];
    const rotating = teams.slice(1);
    const round = (Math.max(1, week) - 1) % (teams.length - 1);
    for (let r = 0; r < round; r += 1) rotating.unshift(rotating.pop());
    const ordered = [fixed, ...rotating];
    const pairs = [];
    for (let index = 0; index < ordered.length / 2; index += 1) {
      const left = ordered[index];
      const right = ordered[ordered.length - 1 - index];
      if (left != null && right != null) pairs.push([String(left), String(right)]);
    }
    return pairs;
  }

  function lineupForecastsForWeek(roster, settings, week, schedule, evidenceByPlayer = {}, evidenceByPlayerWeek = {}, validatedMeanScale = undefined) {
    const weeklyEvidence = evidenceByPlayerWeek?.[week] || evidenceByPlayerWeek?.[String(week)] || {};
    const mergedEvidence = Object.fromEntries((roster || []).map((player) => [String(player.id), { ...(evidenceByPlayer[String(player.id)] || {}), ...(weeklyEvidence[String(player.id)] || {}) }]));
    const forecasts = forecastPlayers(roster, { week, evidenceByPlayer: mergedEvidence, validatedMeanScale });
    const byId = new Map(forecasts.map((forecast) => [String(forecast.player.id), forecast]));
    const prepared = forecasts.map((forecast) => ({
      ...forecast.player,
      weekProjection: forecast.distribution.mean,
    }));
    const lineup = core.optimizeLineup(prepared, settings, "weekProjection");
    const selected = lineup.starters
      .filter((row) => row.player)
      .map((row) => byId.get(String(row.player.id)))
      .filter(Boolean);
    return { lineup, forecasts, selected, schedule, week };
  }

  function samplePlanTotal(plan, seed, scenario, scratch) {
    const values = sampleCorrelationPlan(plan, seed, scenario, scratch);
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += values[index];
    return total;
  }

  function simulateRosterSeason(options = {}) {
    const roster = options.roster || [];
    if (!roster.length) throw new TypeError("Roster season simulation requires a roster");
    const settings = core.cloneSettings(options.settings || {});
    const schedule = options.schedule || {};
    const startWeek = Math.round(clamp(options.startWeek || 1, 1, 18));
    const endWeek = Math.round(clamp(options.endWeek || 17, startWeek, 18));
    const simulations = Math.min(25_000, Math.max(250, Number(options.simulations || 4_000)));
    const seed = String(options.seed ?? 2026);
    const lineups = {};
    const plans = {};
    for (let week = startWeek; week <= endWeek; week += 1) {
      const selected = lineupForecastsForWeek(roster, settings, week, schedule, options.evidenceByPlayer, options.evidenceByPlayerWeek, options.validatedMeanScale).selected;
      lineups[week] = selected;
      const plan = buildCorrelationPlan(selected, schedule, week);
      plans[week] = { plan, scratch: new Float64Array(plan.entries.length) };
    }
    const seasonTotals = new Float32Array(simulations);
    for (let scenario = 0; scenario < simulations; scenario += 1) {
      let total = 0;
      for (let week = startWeek; week <= endWeek; week += 1) {
        const setup = plans[week];
        total += samplePlanTotal(setup.plan, seed, scenario * 31 + week, setup.scratch);
      }
      seasonTotals[scenario] = total;
    }
    return {
      version: VERSION,
      correlationVersion: correlationModel?.VERSION || "uncalibrated",
      simulations,
      startWeek,
      endWeek,
      summary: summarizeSamples(seasonTotals),
      expectedLineups: Object.fromEntries(Object.entries(lineups).map(([week, rows]) => [week, rows.map((forecast) => String(forecast.player.id))])),
    };
  }

  function normalizeLeagueTeams(teams) {
    if (!Array.isArray(teams) || teams.length < 2) throw new TypeError("League simulation requires at least two teams");
    return teams.map((team, index) => ({
      teamId: String(team.teamId ?? team.id ?? index + 1),
      name: String(team.name || `Team ${index + 1}`),
      roster: Array.isArray(team.roster) ? team.roster : [],
      wins: finite(team.wins, 0),
      losses: finite(team.losses, 0),
      ties: finite(team.ties, 0),
      pointsFor: finite(team.pointsFor, 0),
    }));
  }

  function fantasyPairings(teams, week, fantasySchedule = null) {
    const supplied = fantasySchedule?.[week] || fantasySchedule?.[String(week)];
    if (Array.isArray(supplied) && supplied.length) {
      return supplied.map((pair) => [String(pair[0] ?? pair.homeTeamId), String(pair[1] ?? pair.awayTeamId)]);
    }
    return roundRobinPairings(teams.map((team) => team.teamId), week);
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return quantileSorted(sorted, 0.5);
  }

  function playoffWinner(left, right, scores, standingsById) {
    const leftScore = finite(scores[left]);
    const rightScore = finite(scores[right]);
    if (Math.abs(leftScore - rightScore) > 1e-7) return leftScore > rightScore ? left : right;
    const leftSeed = standingsById.get(left)?.seed || 999;
    const rightSeed = standingsById.get(right)?.seed || 999;
    return leftSeed <= rightSeed ? left : right;
  }

  function advancePlayoffRound(active, byes, scores, standingsById) {
    const advanced = [...byes];
    const available = active.filter((id) => !byes.includes(id)).sort((a, b) => (standingsById.get(a)?.seed || 999) - (standingsById.get(b)?.seed || 999));
    while (available.length > 1) {
      const high = available.shift();
      const low = available.pop();
      advanced.push(playoffWinner(high, low, scores, standingsById));
    }
    if (available.length === 1) advanced.push(available[0]);
    return advanced;
  }

  function simulateLeague(options = {}) {
    const teams = normalizeLeagueTeams(options.teams);
    if (teams.some((team) => !team.roster.length)) throw new TypeError("Every league team requires a recognized roster");
    const settings = core.cloneSettings({ ...(options.settings || {}), teams: teams.length });
    const schedule = options.schedule || {};
    const fantasySchedule = options.fantasySchedule || null;
    const startWeek = Math.round(clamp(options.startWeek || 1, 1, 18));
    const regularSeasonEnd = Math.round(clamp(options.regularSeasonEnd || 14, startWeek, 17));
    const championshipWeek = Math.round(clamp(options.championshipWeek || 17, regularSeasonEnd + 1, 18));
    const playoffTeams = Math.min(teams.length, Math.max(2, Math.round(finite(options.playoffTeams, Math.min(6, teams.length)))));
    const playoffByes = Math.min(playoffTeams - 2, Math.max(0, Math.round(finite(options.playoffByes, playoffTeams === 6 ? 2 : 0))));
    const medianGame = Boolean(options.medianGame);
    const simulations = Math.min(20_000, Math.max(250, Number(options.simulations || 2_500)));
    const seed = String(options.seed ?? 2026);
    const evidenceByPlayer = options.evidenceByPlayer || {};
    const lineups = {};
    for (const team of teams) {
      lineups[team.teamId] = {};
      for (let week = startWeek; week <= championshipWeek; week += 1) {
        lineups[team.teamId][week] = lineupForecastsForWeek(
          team.roster,
          settings,
          week,
          schedule,
          evidenceByPlayer,
          options.evidenceByPlayerWeek,
          options.validatedMeanScale,
        ).selected;
      }
    }
    const weekPlans = {};
    for (let week = startWeek; week <= championshipWeek; week += 1) {
      const unique = new Map();
      for (const team of teams) {
        for (const forecast of lineups[team.teamId][week]) unique.set(String(forecast.player.id), forecast);
      }
      const plan = buildCorrelationPlan([...unique.values()], schedule, week);
      const indexById = new Map(plan.entries.map((entry, index) => [entry.id, index]));
      const teamIndexes = Object.fromEntries(teams.map((team) => [team.teamId,
        lineups[team.teamId][week].map((forecast) => indexById.get(String(forecast.player.id))).filter(Number.isInteger),
      ]));
      weekPlans[week] = { plan, teamIndexes, scratch: new Float64Array(plan.entries.length) };
    }

    const counters = Object.fromEntries(teams.map((team) => [team.teamId, {
      expectedWins: 0,
      expectedPoints: 0,
      allPlayWins: 0,
      allPlayGames: 0,
      futureHeadToHeadWins: 0,
      futureHeadToHeadGames: 0,
      matchupWins: {},
      playoffs: 0,
      championships: 0,
      seeds: Array(teams.length).fill(0),
    }]));
    const playoffRounds = Math.max(1, Math.ceil(Math.log2(playoffTeams)));
    const firstPlayoffWeek = Math.max(regularSeasonEnd + 1, championshipWeek - playoffRounds + 1);

    for (let simulation = 0; simulation < simulations; simulation += 1) {
      const state = Object.fromEntries(teams.map((team) => [team.teamId, {
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        points: team.pointsFor,
      }]));
      const weekScoreCache = new Map();
      const scoresForWeek = (week) => {
        if (!weekScoreCache.has(week)) {
          const setup = weekPlans[week];
          const values = sampleCorrelationPlan(setup.plan, seed, simulation * 37 + week, setup.scratch);
          const scores = {};
          for (const team of teams) {
            let total = 0;
            for (const index of setup.teamIndexes[team.teamId]) total += values[index];
            scores[team.teamId] = total;
          }
          weekScoreCache.set(week, scores);
        }
        return weekScoreCache.get(week);
      };
      const scoreFor = (teamId, week) => finite(scoresForWeek(week)[teamId]);

      for (let week = startWeek; week <= regularSeasonEnd; week += 1) {
        const scores = Object.fromEntries(teams.map((team) => [team.teamId, scoreFor(team.teamId, week)]));
        for (const team of teams) state[team.teamId].points += scores[team.teamId];
        for (const [left, right] of fantasyPairings(teams, week, fantasySchedule)) {
          const difference = scores[left] - scores[right];
          const leftCredit = Math.abs(difference) <= 1e-7 ? 0.5 : difference > 0 ? 1 : 0;
          const rightCredit = 1 - leftCredit;
          if (Math.abs(difference) <= 1e-7) {
            state[left].wins += 0.5;
            state[right].wins += 0.5;
            state[left].ties += 1;
            state[right].ties += 1;
          } else if (difference > 0) {
            state[left].wins += 1;
            state[right].losses += 1;
          } else {
            state[right].wins += 1;
            state[left].losses += 1;
          }
          for (const [teamId, opponentId, credit] of [[left, right, leftCredit], [right, left, rightCredit]]) {
            counters[teamId].futureHeadToHeadWins += credit;
            counters[teamId].futureHeadToHeadGames += 1;
            const key = `${week}|${opponentId}`;
            const matchup = counters[teamId].matchupWins[key] || { week, opponentTeamId: opponentId, wins: 0, games: 0 };
            matchup.wins += credit;
            matchup.games += 1;
            counters[teamId].matchupWins[key] = matchup;
          }
        }
        const weekScores = Object.values(scores);
        const weekMedian = median(weekScores);
        for (const team of teams) {
          const id = team.teamId;
          const score = scores[id];
          if (medianGame) state[id].wins += score > weekMedian ? 1 : score === weekMedian ? 0.5 : 0;
          const beaten = weekScores.filter((other) => score > other).length + weekScores.filter((other) => score === other).length * 0.5 - 0.5;
          counters[id].allPlayWins += beaten;
          counters[id].allPlayGames += Math.max(1, teams.length - 1);
        }
      }
      const standings = teams.map((team) => ({
        teamId: team.teamId,
        wins: state[team.teamId].wins,
        points: state[team.teamId].points,
      })).sort((a, b) => b.wins - a.wins || b.points - a.points || a.teamId.localeCompare(b.teamId));
      standings.forEach((row, index) => { row.seed = index + 1; });
      const standingsById = new Map(standings.map((row) => [row.teamId, row]));
      for (const row of standings) {
        counters[row.teamId].expectedWins += row.wins;
        counters[row.teamId].expectedPoints += row.points;
        counters[row.teamId].seeds[row.seed - 1] += 1;
      }

      let active = standings.slice(0, playoffTeams).map((row) => row.teamId);
      for (const id of active) counters[id].playoffs += 1;
      for (let week = firstPlayoffWeek; week <= championshipWeek && active.length > 1; week += 1) {
        const scores = Object.fromEntries(active.map((id) => [id, scoreFor(id, week)]));
        const isFirstRound = week === firstPlayoffWeek;
        const byes = isFirstRound && playoffByes > 0
          ? standings.slice(0, playoffByes).map((row) => row.teamId).filter((id) => active.includes(id))
          : [];
        active = advancePlayoffRound(active, byes, scores, standingsById);
      }
      if (active[0]) counters[active[0]].championships += 1;
    }

    const results = teams.map((team) => {
      const row = counters[team.teamId];
      return {
        teamId: team.teamId,
        name: team.name,
        expectedWins: row.expectedWins / simulations,
        expectedPoints: row.expectedPoints / simulations,
        allPlayWinPct: row.allPlayGames ? row.allPlayWins / row.allPlayGames : 0,
        expectedFutureHeadToHeadWins: row.futureHeadToHeadWins / simulations,
        futureHeadToHeadGames: row.futureHeadToHeadGames / simulations,
        averageMatchupWinProbability: row.futureHeadToHeadGames ? row.futureHeadToHeadWins / row.futureHeadToHeadGames : 0,
        matchupWinProbabilities: Object.values(row.matchupWins).map((matchup) => ({ week: matchup.week, opponentTeamId: matchup.opponentTeamId, winProbability: matchup.games ? matchup.wins / matchup.games : 0 })).sort((a, b) => a.week - b.week),
        playoffProbability: row.playoffs / simulations,
        championshipProbability: row.championships / simulations,
        seedProbabilities: row.seeds.map((count) => count / simulations),
      };
    }).sort((a, b) => b.championshipProbability - a.championshipProbability || b.playoffProbability - a.playoffProbability);

    return {
      version: VERSION,
      correlationVersion: correlationModel?.VERSION || "uncalibrated",
      simulations,
      seed,
      startWeek,
      regularSeasonEnd,
      firstPlayoffWeek,
      championshipWeek,
      playoffTeams,
      playoffByes,
      medianGame,
      teams: results,
    };
  }

  function cloneLeagueTeams(teams) {
    return normalizeLeagueTeams(teams).map((team) => ({ ...team, roster: [...team.roster] }));
  }

  function empiricalInterval(values, lower = 0.025, upper = 0.975) {
    const sorted = Array.from(values || [], finite).sort((a, b) => a - b);
    if (!sorted.length) return [0, 0];
    return [quantileSorted(sorted, lower), quantileSorted(sorted, upper)];
  }

  function meanConfidence95(values) {
    const rows = Array.from(values || [], finite);
    if (!rows.length) return [0, 0];
    const center = mean(rows);
    if (rows.length < 2) return [center, center];
    let sumSquares = 0;
    for (const value of rows) sumSquares += (value - center) ** 2;
    const standardError = Math.sqrt((sumSquares / (rows.length - 1)) / rows.length);
    return [center - 1.96 * standardError, center + 1.96 * standardError];
  }

  function uniqueRosterPlayers(teams) {
    const byId = new Map();
    for (const team of teams || []) {
      for (const player of team.roster || []) byId.set(String(player.id), player);
    }
    return [...byId.values()];
  }

  function forecastMapForWeek(players, options, week) {
    const weeklyEvidence = options.evidenceByPlayerWeek?.[week] || options.evidenceByPlayerWeek?.[String(week)] || {};
    const evidenceByPlayer = Object.fromEntries((players || []).map((player) => [String(player.id), {
      ...(options.evidenceByPlayer?.[String(player.id)] || {}),
      ...(weeklyEvidence[String(player.id)] || {}),
    }]));
    const forecasts = forecastPlayers(players, { week, evidenceByPlayer, validatedMeanScale: options.validatedMeanScale });
    return new Map(forecasts.map((forecast) => [String(forecast.player.id), forecast]));
  }

  function lineupFromForecastMap(roster, settings, forecastById, metric = "decisionMean") {
    const prepared = (roster || []).map((player) => {      const forecast = forecastById.get(String(player.id));
      return { ...player, [metric]: finite(forecast?.distribution?.mean, 0) };
    });
    const lineup = core.optimizeLineup(prepared, settings, metric);
    return {
      lineup,
      starterIds: lineup.starters.filter((row) => row.player).map((row) => String(row.player.id)),
    };
  }

  function lineupSampleTotal(starterIds, playerSamples, scenario) {
    let total = 0;
    for (const id of starterIds || []) total += finite(playerSamples?.[String(id)]?.[scenario], 0);
    return total;
  }

  function findTeam(teams, teamId) {
    return (teams || []).find((row) => String(row.teamId) === String(teamId)) || null;
  }

  function transferPlayerMap(teams) {
    return new Map((teams || []).flatMap((team) => (team.roster || []).map((player) => [String(player.id), player])));
  }

  function applyRosterAction(teams, userTeamId, action) {
    const next = cloneLeagueTeams(teams);
    const user = findTeam(next, userTeamId);
    if (!user) throw new RangeError(`Unknown user team ${userTeamId}`);
    if (!action || action.type === "none") return next;
    const playerMap = transferPlayerMap(next);    const sendIds = new Set((action.sendPlayerIds || []).map(String));
    const receiveIds = new Set([
      ...(action.receivePlayerIds || []),
      ...(action.receivePlayers || []).map((player) => String(player.id)),
    ].map(String));
    const sentPlayers = user.roster.filter((player) => sendIds.has(String(player.id)));
    const explicitIncoming = new Map((action.receivePlayers || []).map((player) => [String(player.id), player]));
    let incoming = [...receiveIds].map((id) => explicitIncoming.get(id) || playerMap.get(id)).filter(Boolean);

    if (action.type === "trade") {
      const opponent = findTeam(next, action.opponentTeamId);
      if (!opponent) throw new RangeError(`Unknown trade opponent ${action.opponentTeamId}`);
      incoming = incoming.length ? incoming : opponent.roster.filter((player) => receiveIds.has(String(player.id)));
      opponent.roster = opponent.roster.filter((player) => !receiveIds.has(String(player.id)));
      for (const player of sentPlayers) if (!opponent.roster.some((row) => String(row.id) === String(player.id))) opponent.roster.push(player);
    }

    const removeIds = new Set([...sendIds, ...(action.dropPlayerId ? [String(action.dropPlayerId)] : [])]);
    user.roster = user.roster.filter((player) => !removeIds.has(String(player.id)));
    const additions = [...incoming, ...(action.addPlayer ? [action.addPlayer] : [])];
    for (const player of additions) {
      if (player && !user.roster.some((row) => String(row.id) === String(player.id))) user.roster.push(player);
    }
    return next;
  }

  function summarizeFutureWins(teamData, simulations) {
    const expected = mean(teamData.winSamples);
    return {
      expectedFutureHeadToHeadWins: expected,
      futureHeadToHeadGames: teamData.games,
      averageMatchupWinProbability: teamData.games ? expected / teamData.games : 0,
      matchupWinProbabilities: teamData.matchups.map((row) => ({ ...row })),
    };
  }
  function evaluateFutureWinActions(options = {}) {
    const baseTeams = normalizeLeagueTeams(options.teams);
    const userTeamId = String(options.userTeamId ?? baseTeams[0].teamId);
    const settings = core.cloneSettings({ ...(options.settings || {}), teams: baseTeams.length });
    const startWeek = Math.round(clamp(options.startWeek || 1, 1, 18));
    const regularSeasonEnd = Math.round(clamp(options.regularSeasonEnd || 14, startWeek, 18));
    const simulations = Math.min(12_000, Math.max(400, Number(options.simulations || 2_000)));
    const seed = String(options.seed ?? "future-win-2026");
    const actions = [{ id: "hold", type: "none", label: "Current roster" }, ...(options.actions || []).slice(0, 12)];
    const states = actions.map((action) => applyRosterAction(baseTeams, userTeamId, action));
    const teamIds = baseTeams.map((team) => team.teamId);
    const actionData = actions.map(() => Object.fromEntries(teamIds.map((teamId) => [teamId, {
      winSamples: new Float32Array(simulations), games: 0, matchups: [],
    }])));

    for (let week = startWeek; week <= regularSeasonEnd; week += 1) {
      const allPlayers = uniqueRosterPlayers(states.flat());
      const forecastById = forecastMapForWeek(allPlayers, options, week);
      for (const [left, right] of fantasyPairings(baseTeams, week, options.fantasySchedule || null)) {
        const lineups = states.map((teams) => {
          const leftTeam = findTeam(teams, left), rightTeam = findTeam(teams, right);
          return {
            left: lineupFromForecastMap(leftTeam?.roster || [], settings, forecastById),
            right: lineupFromForecastMap(rightTeam?.roster || [], settings, forecastById),
          };
        });
        const usedIds = new Set(lineups.flatMap((row) => [...row.left.starterIds, ...row.right.starterIds]));
        const forecasts = [...usedIds].map((id) => forecastById.get(id)).filter(Boolean);
        if (!forecasts.length) continue;
        const simulation = simulateForecasts(forecasts, {
          week, scenarios: simulations, schedule: options.schedule || {},
          seed: `${seed}:week:${week}:pair:${left}|${right}`,
        });        lineups.forEach((lineup, actionIndex) => {
          let leftCredits = 0, rightCredits = 0;
          for (let scenario = 0; scenario < simulations; scenario += 1) {
            const leftScore = lineupSampleTotal(lineup.left.starterIds, simulation.playerSamples, scenario);
            const rightScore = lineupSampleTotal(lineup.right.starterIds, simulation.playerSamples, scenario);
            const difference = leftScore - rightScore;
            const leftCredit = Math.abs(difference) <= 1e-7 ? 0.5 : difference > 0 ? 1 : 0;
            const rightCredit = 1 - leftCredit;
            actionData[actionIndex][left].winSamples[scenario] += leftCredit;
            actionData[actionIndex][right].winSamples[scenario] += rightCredit;
            leftCredits += leftCredit;
            rightCredits += rightCredit;
          }
          actionData[actionIndex][left].games += 1;
          actionData[actionIndex][right].games += 1;
          actionData[actionIndex][left].matchups.push({ week, opponentTeamId: right, winProbability: leftCredits / simulations });
          actionData[actionIndex][right].matchups.push({ week, opponentTeamId: left, winProbability: rightCredits / simulations });
        });
      }
    }

    const rows = actions.map((action, actionIndex) => {
      const outcomes = Object.fromEntries(teamIds.map((teamId) => [teamId, summarizeFutureWins(actionData[actionIndex][teamId], simulations)]));
      return {
        id: String(action.id || `action-${actionIndex + 1}`),
        label: String(action.label || action.id || `Action ${actionIndex + 1}`),
        action,
        outcome: outcomes[userTeamId],
        opponents: Object.fromEntries(teamIds.filter((id) => id !== userTeamId).map((id) => [id, outcomes[id]])),
        opponentOutcome: action.opponentTeamId ? outcomes[String(action.opponentTeamId)] || null : null,
      };
    });    const baselineSamples = actionData[0][userTeamId].winSamples;
    const baseline = rows[0].outcome;
    rows.forEach((row, actionIndex) => {
      const deltaSamples = new Float32Array(simulations);
      for (let scenario = 0; scenario < simulations; scenario += 1) {
        deltaSamples[scenario] = actionData[actionIndex][userTeamId].winSamples[scenario] - baselineSamples[scenario];
      }
      const expectedDelta = mean(deltaSamples);
      row.delta = {
        expectedFutureHeadToHeadWins: expectedDelta,
        expectedFutureHeadToHeadWins95: meanConfidence95(deltaSamples),
        averageMatchupWinProbability: row.outcome.averageMatchupWinProbability - baseline.averageMatchupWinProbability,
      };
    });
    const leagueSimulations = Math.min(6_000, Math.max(0, Number(options.leagueSimulations || 0)));
    if (leagueSimulations >= 250) {
      let preferredOriginalIndex = 0;
      for (let index = 1; index < rows.length; index += 1) {
        if (rows[index].outcome.expectedFutureHeadToHeadWins > rows[preferredOriginalIndex].outcome.expectedFutureHeadToHeadWins ||
          (rows[index].outcome.expectedFutureHeadToHeadWins === rows[preferredOriginalIndex].outcome.expectedFutureHeadToHeadWins &&
            rows[index].outcome.averageMatchupWinProbability > rows[preferredOriginalIndex].outcome.averageMatchupWinProbability)) {
          preferredOriginalIndex = index;
        }
      }
      const indexes = rows.length <= 3 ? rows.map((_, index) => index) : [...new Set([0, preferredOriginalIndex])];
      for (const index of indexes) {
        const simulation = simulateLeague({
          ...options,
          teams: states[index],
          simulations: leagueSimulations,
          seed: `${seed}:league-equity`,
        });
        const userOutcome = simulation.teams.find((team) => String(team.teamId) === userTeamId);
        const opponentId = actions[index]?.opponentTeamId ? String(actions[index].opponentTeamId) : null;
        const opponentOutcome = opponentId ? simulation.teams.find((team) => String(team.teamId) === opponentId) || null : null;
        rows[index].leagueEquity = { user: userOutcome, opponent: opponentOutcome, simulations: leagueSimulations };
      }      const baseEquity = rows[0].leagueEquity?.user;
      if (baseEquity) {
        for (const row of rows) {
          if (!row.leagueEquity?.user) continue;
          row.delta.leagueEquity = {
            championshipProbability: row.leagueEquity.user.championshipProbability - baseEquity.championshipProbability,
            playoffProbability: row.leagueEquity.user.playoffProbability - baseEquity.playoffProbability,
          };
        }
      }
    }

    rows.sort((left, right) =>
      right.outcome.expectedFutureHeadToHeadWins - left.outcome.expectedFutureHeadToHeadWins ||
      right.outcome.averageMatchupWinProbability - left.outcome.averageMatchupWinProbability ||
      left.id.localeCompare(right.id));
    const preferred = rows[0];
    rows.forEach((row, index) => { row.rank = index + 1; });
    return {
      version: VERSION,
      objective: "maximize-future-head-to-head-wins",
      simulations,
      startWeek,
      regularSeasonEnd,
      preferredActionId: preferred.id,
      baseline,
      actions: rows,
    };
  }

  function lineupCandidateKey(lineup) {
    return lineup.starters.filter((row) => row.player).map((row) => String(row.player.id)).sort().join("|");
  }

  function lineupCandidate(forecasts, settings, metricName, metricValue) {
    const prepared = forecasts.map((forecast) => ({ ...forecast.player, [metricName]: metricValue(forecast) }));
    return core.optimizeLineup(prepared, settings, metricName);
  }
  function evaluateMatchupLineups(options = {}) {
    const userRoster = options.userRoster || [];
    const opponentRoster = options.opponentRoster || [];
    if (!userRoster.length || !opponentRoster.length) throw new TypeError("Opponent-aware lineup evaluation requires both rosters");
    const settings = core.cloneSettings(options.settings || {});
    const week = Math.round(clamp(options.week || 1, 1, 18));
    const scenarios = Math.min(20_000, Math.max(800, Number(options.scenarios || 5_000)));
    const seed = String(options.seed || `matchup-lineup-${week}`);
    const players = [...new Map([...userRoster, ...opponentRoster].map((player) => [String(player.id), player])).values()];
    const forecastById = forecastMapForWeek(players, options, week);
    const forecasts = [...forecastById.values()];
    const simulation = simulateForecasts(forecasts, { week, scenarios, schedule: options.schedule || {}, seed });
    const opponentForecasts = opponentRoster.map((player) => forecastById.get(String(player.id))).filter(Boolean);
    const opponentLineup = lineupCandidate(opponentForecasts, settings, "candidateMean", (forecast) => forecast.distribution.mean);
    const opponentIds = opponentLineup.starters.filter((row) => row.player).map((row) => String(row.player.id));
    const userForecasts = userRoster.map((player) => forecastById.get(String(player.id))).filter(Boolean);
    const candidateMap = new Map();
    const addCandidate = (lineup, source) => {
      const key = lineupCandidateKey(lineup);
      if (key && !candidateMap.has(key)) candidateMap.set(key, { key, lineup, source });
    };
    addCandidate(lineupCandidate(userForecasts, settings, "candidateMean", (forecast) => forecast.distribution.mean), "mean");
    for (const field of ["p25", "p50", "p75", "p90", "cvar10"]) {
      addCandidate(lineupCandidate(userForecasts, settings, `candidate_${field}`, (forecast) => finite(forecast.distribution[field], forecast.distribution.mean)), field);
    }

    const generationScenarios = Math.min(128, Math.max(32, Math.floor(scenarios * 0.2)));
    for (let scenario = 0; scenario < generationScenarios; scenario += 1) {
      const prepared = userForecasts.map((forecast) => ({
        ...forecast.player,
        scenarioValue: finite(simulation.playerSamples[String(forecast.player.id)]?.[scenario], 0),
      }));
      addCandidate(core.optimizeLineup(prepared, settings, "scenarioValue"), "held-out-generator");
      if (candidateMap.size >= 160) break;
    }
    const evaluationStart = generationScenarios;
    const evaluationScenarios = scenarios - evaluationStart;
    const candidates = [...candidateMap.values()].map((candidate) => {
      const starterIds = candidate.lineup.starters.filter((row) => row.player).map((row) => String(row.player.id));
      let wins = 0, points = 0;
      for (let scenario = evaluationStart; scenario < scenarios; scenario += 1) {
        const userScore = lineupSampleTotal(starterIds, simulation.playerSamples, scenario);
        const opponentScore = lineupSampleTotal(opponentIds, simulation.playerSamples, scenario);
        wins += Math.abs(userScore - opponentScore) <= 1e-7 ? 0.5 : userScore > opponentScore ? 1 : 0;
        points += userScore;
      }
      return {
        source: candidate.source,
        starterIds,
        lineup: candidate.lineup,
        winProbability: wins / Math.max(1, evaluationScenarios),
        expectedPoints: points / Math.max(1, evaluationScenarios),
      };
    }).sort((left, right) => right.winProbability - left.winProbability || right.expectedPoints - left.expectedPoints);
    const baselineKey = lineupCandidateKey(lineupCandidate(userForecasts, settings, "candidateMean2", (forecast) => forecast.distribution.mean));
    const baseline = candidates.find((row) => [...row.starterIds].sort().join("|") === baselineKey) || candidates[0];
    const preferred = candidates[0];
    const pairedWinDeltas = new Float32Array(evaluationScenarios);
    for (let offset = 0, scenario = evaluationStart; scenario < scenarios; scenario += 1, offset += 1) {
      const opponentScore = lineupSampleTotal(opponentIds, simulation.playerSamples, scenario);
      const baselineScore = lineupSampleTotal(baseline.starterIds, simulation.playerSamples, scenario);
      const preferredScore = lineupSampleTotal(preferred.starterIds, simulation.playerSamples, scenario);
      const baselineCredit = Math.abs(baselineScore - opponentScore) <= 1e-7 ? 0.5 : baselineScore > opponentScore ? 1 : 0;
      const preferredCredit = Math.abs(preferredScore - opponentScore) <= 1e-7 ? 0.5 : preferredScore > opponentScore ? 1 : 0;
      pairedWinDeltas[offset] = preferredCredit - baselineCredit;
    }
    const winProbabilityGain95 = meanConfidence95(pairedWinDeltas);
    return {
      version: VERSION,
      objective: "maximize-current-matchup-win-probability",
      week,
      scenarios,
      generationScenarios,
      evaluationScenarios,
      opponentStarterIds: opponentIds,
      baseline: { starterIds: baseline.starterIds, winProbability: baseline.winProbability, expectedPoints: baseline.expectedPoints },
      preferred: { starterIds: preferred.starterIds, winProbability: preferred.winProbability, expectedPoints: preferred.expectedPoints },
      winProbabilityGain: preferred.winProbability - baseline.winProbability,
      winProbabilityGain95,
      candidatesEvaluated: candidates.length,
    };
  }

  function evaluateChampionshipActions(options = {}) {
    const teams = normalizeLeagueTeams(options.teams);
    const userTeamId = String(options.userTeamId ?? teams[0].teamId);
    const actions = [{ id: "hold", type: "none", label: "Current roster" }, ...(options.actions || []).slice(0, 12)];
    const rows = actions.map((action, index) => {
      const candidateTeams = applyRosterAction(teams, userTeamId, action);
      const simulation = simulateLeague({ ...options, teams: candidateTeams });
      const outcome = simulation.teams.find((team) => String(team.teamId) === userTeamId);
      return {
        id: String(action.id || `action-${index + 1}`),
        label: String(action.label || `Action ${index + 1}`),
        action,
        outcome,
        simulation: { simulations: simulation.simulations, seed: simulation.seed },
      };
    });
    const baseline = rows[0].outcome;
    rows.forEach((row) => {
      row.delta = {
        championshipProbability: row.outcome.championshipProbability - baseline.championshipProbability,
        playoffProbability: row.outcome.playoffProbability - baseline.playoffProbability,
        expectedWins: row.outcome.expectedWins - baseline.expectedWins,
        expectedPoints: row.outcome.expectedPoints - baseline.expectedPoints,
        allPlayWinPct: row.outcome.allPlayWinPct - baseline.allPlayWinPct,
      };
    });
    rows.sort((a, b) => b.outcome.championshipProbability - a.outcome.championshipProbability || b.outcome.playoffProbability - a.outcome.playoffProbability || b.outcome.allPlayWinPct - a.outcome.allPlayWinPct);
    const preferred = rows[0];
    rows.forEach((row, index) => {
      row.rank = index + 1;
      const gap = Math.max(0, preferred.outcome.championshipProbability - row.outcome.championshipProbability);
      row.reversal = { titleProbabilityNeeded: gap };
    });
    return { version: VERSION, objective: "maximize-championship-probability", preferredActionId: preferred.id, baseline, actions: rows };
  }

  function updateEnsembleWeights(weights, losses, options = {}) {
    const learningRate = clamp(options.learningRate ?? 0.08, 0.001, 1);
    const keys = [...new Set([...Object.keys(weights || {}), ...Object.keys(losses || {})])];
    if (!keys.length) return {};
    const raw = Object.fromEntries(keys.map((key) => {
      const prior = Math.max(1e-6, finite(weights?.[key], 1 / keys.length));
      const loss = Math.max(0, finite(losses?.[key], 0));
      return [key, prior * Math.exp(-learningRate * loss)];
    }));
    const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
    return Object.fromEntries(keys.map((key) => [key, raw[key] / total]));
  }

  function calibrationMetrics(probabilities, outcomes) {
    const count = Math.min(probabilities?.length || 0, outcomes?.length || 0);
    if (!count) return { count: 0, brier: null, bias: null };
    let brier = 0;
    let bias = 0;
    for (let index = 0; index < count; index += 1) {
      const p = clamp(probabilities[index], 0, 1);
      const y = clamp(outcomes[index], 0, 1);
      brier += (p - y) ** 2;
      bias += p - y;
    }
    return { count, brier: brier / count, bias: bias / count };
  }

  return {
    VERSION,
    calibrationMetrics,
    correlation,
    evaluateChampionshipActions,
    evaluateFutureWinActions,
    evaluateMatchupLineups,
    evaluatePortfolios,
    buildCorrelationPlan,
    forecastPlayer,
    forecastPlayers,
    gameContext,
    mixtureMoments,
    mixtureQuantile,
    normalFromParts,
    rankPairedActions,
    sampleCorrelationPlan,
    sampleForecast,
    simulateForecasts,
    simulateLeague,
    simulateRosterSeason,
    summarizeSamples,
    uniformFromParts,
    updateEnsembleWeights,
  };
});

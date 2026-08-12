(function attachSnapCountDraftIntelligence(root, factory) {
  const core = typeof module !== "undefined" && module.exports
    ? require("./core.js")
    : root.FantasyOracleCore;
  const correlation = typeof module !== "undefined" && module.exports
    ? require("./correlation.js")
    : root.SnapCountCorrelation;
  const footballContext = typeof module !== "undefined" && module.exports
    ? require("./football-context.js")
    : root.SnapCountFootballContext;
  const api = factory(core, correlation, footballContext);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.SnapCountDraftIntelligence = api;
    api.installBrowser(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createDraftIntelligence(core, correlation, footballContext) {
  "use strict";

  const VERSION = "snapcount-draft-intelligence-2026.2";

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }

  function logistic(value) {
    if (value >= 35) return 1;
    if (value <= -35) return 0;
    return 1 / (1 + Math.exp(-value));
  }

  function normalizedPlayer(player) {
    return core.normalizePlayer ? core.normalizePlayer(player) : player;
  }

  function rosterPlayers(state, teamId, playerMap) {
    return (state?.rosters?.[String(teamId)] || [])
      .map((id) => playerMap.get(String(id)))
      .filter(Boolean);
  }

  function positionCounts(roster) {
    return (roster || []).reduce((out, player) => {
      const position = String(player?.position || "").toUpperCase();
      out[position] = finite(out[position]) + 1;
      return out;
    }, {});
  }

  function starterNeed(position, roster, settings) {
    const counts = positionCounts(roster);
    const slots = settings?.slots || {};
    const direct = Math.max(0, finite(slots[position]) - finite(counts[position]));
    if (!["RB", "WR", "TE", "QB"].includes(position)) return direct;
    if (position === "QB") {
      return Math.max(direct, Math.max(0, finite(slots.QB, 1) + finite(slots.SUPERFLEX) - finite(counts.QB)));
    }
    const skill = finite(counts.RB) + finite(counts.WR) + finite(counts.TE);
    const starters = finite(slots.RB) + finite(slots.WR) + finite(slots.TE) + finite(slots.FLEX);
    return Math.max(direct, Math.min(1, Math.max(0, starters - skill)));
  }

  function managerPositionBias(position, state, teamId, playerMap) {
    const picks = (state?.picks || []).filter((pick) => Number(pick.teamId) === Number(teamId));
    if (!picks.length) return 0;
    const same = picks.filter((pick) => playerMap.get(String(pick.playerId))?.position === position).length;
    const expected = { QB: 0.12, RB: 0.31, WR: 0.34, TE: 0.11, DST: 0.06, K: 0.06 }[position] || 0.1;
    return clamp((same / picks.length - expected) / Math.max(0.08, expected), -0.55, 0.55);
  }

  function pickHazard(player, pick, settings) {
    const normalized = normalizedPlayer(player);
    const center = finite(normalized.adp, core.rankForScoring(normalized, settings?.scoring || "ppr", settings?.qbFormat));
    const spreadScale = normalized.position === "QB" && ["superflex", "two-qb"].includes(String(settings?.qbFormat || "")) ? 0.8 : 1;
    const spread = clamp((4.5 + center * 0.12) * spreadScale, 4.5, 28);
    const previous = logistic(((pick - 1.5) - center) / spread);
    const current = logistic(((pick - 0.5) - center) / spread);
    return clamp((current - previous) / Math.max(1e-6, 1 - previous), 0, 0.92);
  }

  function managerSpecificSurvival(player, options = {}) {
    const settings = options.settings || {};
    const state = options.state || {};
    const teamId = Number(options.teamId || settings.draftPosition || 1);
    const playerMap = options.playerMap || new Map((options.players || []).map((row) => [String(row.id), normalizedPlayer(row)]));
    const currentPick = (state.picks || []).length + 1;
    const nextPick = core.nextPickNumberForTeam(state, settings, teamId, currentPick + 1);
    if (!nextPick || nextPick <= currentPick + 1) return { survival: 1, nextPick: nextPick || currentPick, managers: 0 };
    let survival = 1;
    let managers = 0;
    for (let pick = currentPick + 1; pick < nextPick; pick += 1) {
      const managerId = core.snakeTeamForPick(pick, settings.teams);
      if (Number(managerId) === teamId) continue;
      const roster = rosterPlayers(state, managerId, playerMap);
      const need = starterNeed(player.position, roster, settings);
      const bias = managerPositionBias(player.position, state, managerId, playerMap);
      const counts = positionCounts(roster);
      const depth = finite(counts[player.position]);
      const starterSlots = finite(settings?.slots?.[player.position], 1);
      const needMultiplier = need > 0 ? 1.65 : depth >= starterSlots + 2 ? 0.5 : 0.86;
      const preferenceMultiplier = clamp(1 + bias * 0.35, 0.72, 1.28);
      const hazard = clamp(pickHazard(player, pick, settings) * needMultiplier * preferenceMultiplier, 0, 0.82);
      survival *= (1 - hazard);
      managers += 1;
    }
    return { survival: clamp(survival, 0, 1), nextPick, managers };
  }

  function projectedStarterDelta(player, roster, settings, baselineWeekly = null) {
    if (!core.optimizeWeeklyLineup) return finite(player?.projectedPoints);
    let total = 0;
    for (let week = 1; week <= 17; week += 1) {
      const before = Array.isArray(baselineWeekly) ? finite(baselineWeekly[week - 1]) : core.optimizeWeeklyLineup(roster, settings, week).total;
      const after = core.optimizeWeeklyLineup([...roster, player], settings, week).total;
      total += Math.max(0, finite(after) - finite(before));
    }
    return total;
  }

  function median(values) {
    const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!rows.length) return 0;
    const middle = Math.floor(rows.length / 2);
    return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
  }

  function formatScarcity(player, settings, roster) {
    if (player.position !== "QB") return 0;
    const qbFormat = String(settings?.qbFormat || "one-qb");
    const superflex = qbFormat === "superflex" || qbFormat === "two-qb" || finite(settings?.slots?.SUPERFLEX) > 0 || finite(settings?.slots?.QB) >= 2;
    if (!superflex) return 0;
    const owned = finite(positionCounts(roster).QB);
    const demand = finite(settings?.slots?.QB, 1) + finite(settings?.slots?.SUPERFLEX);
    return clamp(0.75 + Math.max(0, demand - owned) * 0.75 + finite(player.tierCliff) * 0.025, 0, 2.2);
  }

  function availabilitySignal(player) {
    const risk = clamp(player?.injuryRisk, 0, 1);
    const reliability = clamp(player?.reliability ?? 0.72, 0, 1);
    const projectedGames = 17 * clamp(1 - risk * 0.2 + (reliability - 0.72) * 0.06, 0.72, 1.02);
    const signal = clamp((reliability - 0.72) * 1.2 - Math.max(0, risk - 0.28) * 1.5, -0.85, 0.65);
    return { signal, projectedGames };
  }

  function portfolioSignal(player, roster) {
    if (!roster.length) return { signal: 0, label: "portfolio neutral" };
    let signal = 0;
    let bestCorrelation = 0;
    let sameTeam = 0;
    for (const teammate of roster) {
      const isSameTeam = teammate.team && player.team && teammate.team === player.team;
      if (isSameTeam) sameTeam += 1;
      const rho = correlation?.targetCorrelation
        ? finite(correlation.targetCorrelation(player.position, teammate.position, isSameTeam), 0)
        : 0;
      bestCorrelation = Math.max(bestCorrelation, rho);
      if (isSameTeam && ((player.position === "QB" && ["WR", "TE"].includes(teammate.position)) || (teammate.position === "QB" && ["WR", "TE"].includes(player.position)))) signal += 0.45;
      else if (isSameTeam && player.position === teammate.position) signal -= 0.3;
    }
    if (sameTeam >= 3) signal -= (sameTeam - 2) * 0.2;
    const byeCount = roster.filter((teammate) => teammate.byeWeek && teammate.byeWeek === player.byeWeek).length;
    if (byeCount >= 3) signal -= 0.18 * (byeCount - 2);
    signal += clamp(bestCorrelation, 0, 0.35) * 0.5;
    return { signal: clamp(signal, -0.8, 0.8), label: signal > 0.2 ? "portfolio fit" : signal < -0.2 ? "portfolio concentration" : "portfolio neutral" };
  }

  function footballContextSignal(player, row = {}) {
    const mean = Math.max(1, finite(player?.weeklyProjection, finite(player?.projectedPoints) / 17));
    const correction = finite(row.correction);
    const roleDelta = finite(row.roleDelta);
    const availabilityDelta = finite(row.availabilityDelta);
    const context = clamp((correction / mean) * 5.5, -0.75, 0.75);
    const uncertainty = clamp(-roleDelta * 1.5 - availabilityDelta * 3, -0.4, 0.35);
    return { signal: clamp(context + uncertainty, -0.85, 0.85), correction, topDriver: row.topDriver || "football context" };
  }

  function marketResidualSignal(player, snapRankById = {}, settings = {}) {
    const espnRank = finite(player?.marketRank, finite(player?.adp, 9999));
    const snapRank = finite(snapRankById[String(player?.id)], espnRank);
    if (espnRank >= 9000 || snapRank >= 9000) return { signal: 0, edge: 0, espnRank, snapRank };
    const edge = espnRank - snapRank;
    const scale = Math.max(5, finite(settings?.teams, 12) * 0.65);
    return { signal: clamp(Math.tanh(edge / scale) * 1.15, -1.15, 1.15), edge, espnRank, snapRank };
  }

  function counterfactualSignal(row, starterDelta, medianDelta) {
    const relativeStarterValue = Math.tanh((starterDelta - medianDelta) / 36) * 1.4;
    const waitCost = Math.tanh(finite(row?.vona) / 10) * 1.1;
    return clamp(relativeStarterValue + waitCost, -1.8, 1.8);
  }

  function hazardSignal(baseReturnChance, managerSurvival, refined) {
    const base = clamp(baseReturnChance, 0, 1);
    const room = clamp(managerSurvival, 0, 1);
    const baseWeight = refined ? 0.78 : 0.56;
    const blended = clamp(base * baseWeight + room * (1 - baseWeight), 0, 1);
    return { returnChance: blended, signal: clamp((0.5 - blended) * 2.5, -1.15, 1.15) };
  }

  function applyDecisionMix(rows = [], options = {}) {
    const settings = options.settings || {};
    const state = options.state || {};
    const players = (options.players || []).map(normalizedPlayer);
    const playerMap = new Map(players.map((player) => [String(player.id), player]));
    const teamId = Number(options.teamId || settings.draftPosition || 1);
    const roster = rosterPlayers(state, teamId, playerMap);
    const contextById = options.footballContextById || {};
    const snapRankById = options.snapRankById || {};
    const baselineWeekly = core.optimizeWeeklyLineup ? Array.from({ length: 17 }, (_, index) => core.optimizeWeeklyLineup(roster, settings, index + 1).total) : null;
    const prepared = rows.map((raw, index) => {
      const player = normalizedPlayer(raw);
      const starterDelta = projectedStarterDelta(player, roster, settings, baselineWeekly);
      return { raw, player, baseRank: index + 1, starterDelta };
    });
    const medianDelta = median(prepared.map((row) => row.starterDelta));
    const rankCap = clamp(finite(settings.teams, 12) * 0.35, 2.5, 5);

    const scored = prepared.map(({ raw, player, baseRank, starterDelta }) => {
      const manager = managerSpecificSurvival(player, { players, playerMap, state, settings, teamId });
      const hazard = hazardSignal(finite(raw.returnChance, 0.5), manager.survival, Boolean(options.refined));
      const residual = marketResidualSignal({ ...player, marketRank: raw.marketRank }, snapRankById, settings);
      const availability = availabilitySignal(player);
      const portfolio = portfolioSignal(player, roster);
      const football = footballContextSignal(player, contextById[String(player.id)] || {});
      const components = [
        { key: "counterfactual", label: "counterfactual roster value", shift: counterfactualSignal(raw, starterDelta, medianDelta) },
        { key: "room-hazard", label: "room-specific survival", shift: hazard.signal },
        { key: "espn-residual", label: residual.edge > 0 ? "ESPN undervalues him" : residual.edge < 0 ? "ESPN may be high" : "market agrees", shift: residual.signal },
        { key: "availability", label: "season availability", shift: availability.signal },
        { key: "format", label: player.position === "QB" ? "QB format scarcity" : "format fit", shift: formatScarcity(player, settings, roster) },
        { key: "portfolio", label: portfolio.label, shift: portfolio.signal },
        { key: "football-context", label: football.topDriver, shift: football.signal },
      ];
      const rawShift = components.reduce((sum, component) => sum + finite(component.shift), 0);
      const decisionShift = clamp(rawShift, -rankCap, rankCap);
      return {
        ...raw,
        baseQualifiedRank: baseRank,
        decisionOrder: baseRank - decisionShift,
        decisionShift: Number(decisionShift.toFixed(2)),
        appliedDecisionShift: 0,
        decisionMixCap: Number(rankCap.toFixed(2)),
        returnChanceBase: finite(raw.returnChance, 0.5),
        shadowReturnChance: Number(hazard.returnChance.toFixed(4)),
        managerSurvival: Number(manager.survival.toFixed(4)),
        nextTeamPick: raw.nextTeamPick || manager.nextPick,
        marketResidualEdge: Number(residual.edge.toFixed(1)),
        availabilityAdjustedGames: Number(availability.projectedGames.toFixed(1)),
        counterfactualStarterPoints: Number(starterDelta.toFixed(1)),
        decisionComponents: components.sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift)),
        decisionMixVersion: VERSION,
        decisionMixStatus: "shadow-only-pending-validation",
      };
    });

    const shadowRankById = new Map(
      [...scored]
        .sort((left, right) => left.decisionOrder - right.decisionOrder || left.baseQualifiedRank - right.baseQualifiedRank)
        .map((row, index) => [String(row.id), index + 1]),
    );
    return scored.map((row, index) => ({
      ...row,
      decisionRank: index + 1,
      shadowDecisionRank: shadowRankById.get(String(row.id)) || index + 1,
    }));
  }

  const browserState = {
    artifact: null,
    schedule: null,
    campById: new Map(),
    lastRowsById: new Map(),
    loading: null,
    observer: null,
  };

  const PERSONAL_VIEW_LABELS = Object.freeze({
    unknown: "No view",
    "very-positive": "Much higher · ~1¼ rounds",
    positive: "Higher · ~¾ round",
    "somewhat-positive": "Moderately higher · ~⅓ round",
    "slightly-positive": "Slightly higher · ~⅙ round",
    neutral: "Same as ESPN",
    "slightly-negative": "Slightly lower · ~⅙ round",
    "somewhat-negative": "Moderately lower · ~⅓ round",
    negative: "Lower · ~¾ round",
    "very-negative": "Much lower · ~1¼ rounds",
  });

  function preloadBrowserContext(root) {
    if (browserState.loading || !root?.fetch) return browserState.loading;
    browserState.loading = Promise.all([
      root.fetch("./data/football-context-2026.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null),
      root.fetch("./data/players-lite.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null),
      root.fetch("./data/camp-2026.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null),
    ]).then(([artifact, players, camp]) => {
      browserState.artifact = artifact;
      browserState.schedule = players?.schedule || null;
      browserState.campById = new Map((camp?.players || []).map((row) => [String(row.id), row]));
      return browserState;
    });
    return browserState.loading;
  }

  function averageEvidence(rows) {
    const buckets = new Map();
    for (const evidence of rows) {
      for (const [key, row] of Object.entries(evidence || {})) {
        if (!row || row.available === false || !Number.isFinite(Number(row.value))) continue;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(row);
      }
    }
    const output = {};
    for (const [key, values] of buckets.entries()) {
      const first = values[0];
      output[key] = {
        ...first,
        value: values.reduce((sum, row) => sum + finite(row.value), 0) / values.length,
        confidence: values.reduce((sum, row) => sum + finite(row.confidence, 0.5), 0) / values.length,
        source: `${first.source || "football context"} · season-averaged for Draft`,
      };
    }
    return output;
  }

  function seasonFootballContext(player) {
    if (!footballContext || !browserState.artifact) return {};
    const weekly = Array.from({ length: 17 }, (_, index) => footballContext.contextEvidence(
      player, browserState.artifact, browserState.schedule || {}, index + 1,
    ));
    const evidence = averageEvidence(weekly);
    const camp = browserState.campById.get(String(player?.id));
    if (camp && footballContext.campRoleEvidence) Object.assign(evidence, footballContext.campRoleEvidence(camp));
    const mean = Math.max(0, finite(player?.weeklyProjection, finite(player?.projectedPoints) / 17));
    const shadow = footballContext.shadowDrivers(player, { mean }, evidence) || {};
    const role = footballContext.roleUncertaintyAdjustment(evidence) || {};
    const top = [...(shadow.drivers || [])].sort((a, b) => Math.abs(finite(b.impact)) - Math.abs(finite(a.impact)))[0];
    return {
      correction: finite(shadow.correction),
      roleDelta: finite(role.roleDelta),
      availabilityDelta: finite(role.availabilityDelta),
      topDriver: top?.label || "season football context",
    };
  }

  function snapRankMap(players, settings, teamId) {
    try {
      const empty = core.createDraftState(settings);
      const board = core.recommendPlayers(players, empty, settings, teamId, Math.max(players.length, 700));
      return Object.fromEntries(board.map((row, index) => [String(row.id), index + 1]));
    } catch (_) {
      return {};
    }
  }

  function shortDecisionLabel(component) {
    const labels = {
      counterfactual: "roster value",
      "room-hazard": "room survival",
      "espn-residual": component?.shift >= 0 ? "ESPN value gap" : "ESPN price risk",
      availability: "availability",
      format: "QB format",
      portfolio: component?.label || "portfolio fit",
      "football-context": component?.label || "football context",
    };
    return labels[component?.key] || component?.label || "decision signal";
  }

  function decoratePersonalViews(document) {
    const outlook = document.getElementById("outlooks");
    if (!outlook) return;
    const heading = outlook.querySelector(".section-heading p:last-child");
    const headingText = "Tell SnapCount roughly where you would draft a player versus ESPN. We only apply the part of that view SnapCount does not already agree with.";
    if (heading && heading.textContent !== headingText) heading.textContent = headingText;
    const explainer = outlook.querySelector(".outlook-explainer");
    if (explainer) {
      const strong = explainer.querySelector("strong");
      const span = explainer.querySelector("span");
      const small = explainer.querySelector("small");
      const strongText = "Think in draft position, not abstract sentiment.";
      const spanText = "Choose roughly how much higher or lower than ESPN you would take the player. SnapCount converts that into a target rank, compares it with its own board, and only applies the disagreement that remains.";
      const smallHtml = "<b>No view</b> = leave SnapCount alone. <b>Same as ESPN</b> = you intentionally agree with the market. <b>Pass</b> = keep the player visible but never recommend drafting him.";
      if (strong && strong.textContent !== strongText) strong.textContent = strongText;
      if (span && span.textContent !== spanText) span.textContent = spanText;
      if (small && small.innerHTML !== smallHtml) small.innerHTML = smallHtml;
    }
    const header = outlook.querySelector("thead th:last-child");
    if (header && /outlook/i.test(header.textContent)) header.textContent = "My view";
    outlook.querySelectorAll("[data-player-outlook]").forEach((select) => {
      [...select.options].forEach((option) => {
        if (PERSONAL_VIEW_LABELS[option.value] && option.textContent !== PERSONAL_VIEW_LABELS[option.value]) option.textContent = PERSONAL_VIEW_LABELS[option.value];
      });
      select.setAttribute("aria-label", select.getAttribute("aria-label")?.replace(/Outlook/i, "Draft view") || "Personal draft view");
    });
    outlook.querySelectorAll(".outlook-chip").forEach((chip) => {
      for (const [key, label] of Object.entries(PERSONAL_VIEW_LABELS)) {
        if (chip.classList.contains(key) && chip.textContent !== label) chip.textContent = label;
      }
    });
    document.querySelectorAll('[data-jump="outlooks"] small').forEach((node) => {
      const text = "Set where you would draft players versus ESPN.";
      if (node.textContent !== text) node.textContent = text;
    });
  }

  function decorateDraft(document) {
    const table = document.getElementById("draft-table");
    if (!table) return;
    table.querySelectorAll("tr").forEach((tr) => {
      const button = tr.querySelector("[data-draft-player]");
      const row = button ? browserState.lastRowsById.get(String(button.dataset.draftPlayer)) : null;
      if (!row) return;
      tr.dataset.decisionShift = Number(row.appliedDecisionShift || 0).toFixed(2);
      tr.dataset.shadowDecisionShift = Number(row.decisionShift || 0).toFixed(2);
      tr.dataset.shadowDecisionRank = String(row.shadowDecisionRank || row.baseQualifiedRank || "");
      tr.dataset.baseQualifiedRank = String(row.baseQualifiedRank || "");
      const signals = tr.querySelector(".draft-signal-row");
      if (signals) {
        const desired = (row.decisionComponents || []).filter((component) => Math.abs(finite(component.shift)) >= 0.55).slice(0, 2)
          .map((component) => ({
            text: `shadow · ${shortDecisionLabel(component)}`,
            tone: finite(component.shift) >= 0 ? "up" : "down",
            title: `Shadow only — ${component.label}: ${finite(component.shift) >= 0 ? "+" : ""}${finite(component.shift).toFixed(2)} candidate spots; not applied to the qualified order`,
          }));
        const existing = [...signals.querySelectorAll(".draft-signal.decision")];
        const matches = existing.length === desired.length && existing.every((node, index) => node.textContent === desired[index].text && node.classList.contains(desired[index].tone) && node.title === desired[index].title);
        if (!matches) {
          existing.forEach((node) => node.remove());
          desired.forEach((item) => {
            const chip = document.createElement("span");
            chip.className = `draft-signal decision shadow ${item.tone}`;
            chip.textContent = item.text;
            chip.title = item.title;
            signals.appendChild(chip);
          });
        }
      }
    });
    const firstButton = table.querySelector("tr [data-draft-player]");
    const top = firstButton ? browserState.lastRowsById.get(String(firstButton.dataset.draftPlayer)) : null;
    const metrics = document.querySelector("#draft-strategy-body .draft-strategy-metrics");
    if (top && metrics && !metrics.querySelector("[data-decision-mix-metric]")) {
      const metric = document.createElement("div");
      metric.dataset.decisionMixMetric = "true";
      metric.innerHTML = `<span>Shadow mix</span><strong>${finite(top.decisionShift) >= 0 ? "+" : ""}${finite(top.decisionShift).toFixed(1)} <small>not applied</small></strong>`;
      metrics.appendChild(metric);
    }
    const strategy = document.querySelector("#draft-strategy-body .draft-strategy-context");
    if (strategy && !strategy.querySelector("[data-decision-mix-note]")) {
      const note = document.createElement("p");
      note.className = "fineprint draft-decision-mix-note";
      note.dataset.decisionMixNote = "true";
      note.textContent = "The historically qualified draft policy controls the order. Counterfactual value, room survival, ESPN disagreement, availability, format scarcity, roster correlation, and football context are being measured as a shadow challenger and cannot move picks until they clear the historical and prospective validation gates.";
      strategy.appendChild(note);
    }
    const meta = document.getElementById("draft-meta");
    if (meta) {
      const nextMeta = meta.textContent
        .replace("A+ QUALIFIED PPR", "A+ QUALIFIED BASE · SHADOW")
        .replace("CUSTOM FORMAT · TRANSFER POLICY", "TRANSFER BASE · SHADOW");
      if (nextMeta !== meta.textContent) meta.textContent = nextMeta;
    }
  }

  function decorateBenchmark(document) {
    const note = document.getElementById("home-benchmark-note");
    if (!note || note.textContent.includes("frozen qualified base")) return;
    note.textContent = `${note.textContent} The SnapCount score is the frozen qualified base; shadow draft intelligence is deliberately excluded until it clears replay and prospective validation.`;
  }

  function decorateBrowser(document) {
    decoratePersonalViews(document);
    decorateDraft(document);
    decorateBenchmark(document);
  }

  function installBrowser(root) {
    if (!root?.document || root.document.documentElement.dataset.draftIntelligenceInstalled === "true") return;
    root.document.documentElement.dataset.draftIntelligenceInstalled = "true";
    preloadBrowserContext(root);
    const installPatch = () => {
      const draftSim = root.OracleDraftSim;
      if (!draftSim?.qualifyRecommendations || draftSim.__snapCountDecisionMixInstalled) return false;
      const original = draftSim.qualifyRecommendations;
      draftSim.qualifyRecommendations = function patchedQualify(rows, players, state, settings, teamId, board, policyOptions, limit) {
        const qualified = original.call(this, rows, players, state, settings, teamId, board, policyOptions, limit);
        const contextById = Object.fromEntries(qualified.map((row) => [String(row.id), seasonFootballContext(row)]));
        const mixed = applyDecisionMix(qualified, {
          players,
          state,
          settings,
          teamId,
          snapRankById: snapRankMap(players, settings, teamId),
          footballContextById: contextById,
          refined: false,
        });
        browserState.lastRowsById = new Map(mixed.map((row) => [String(row.id), row]));
        root.queueMicrotask(() => decorateBrowser(root.document));
        return mixed;
      };
      draftSim.__snapCountDecisionMixInstalled = VERSION;
      return true;
    };
    installPatch();
    root.setTimeout(installPatch, 0);
    root.setTimeout(installPatch, 250);
    decorateBrowser(root.document);
    browserState.observer = new root.MutationObserver(() => {
      root.queueMicrotask(() => decorateBrowser(root.document));
    });
    browserState.observer.observe(root.document.body, { childList: true, subtree: true });
  }

  return {
    VERSION,
    applyDecisionMix,
    availabilitySignal,
    counterfactualSignal,
    formatScarcity,
    managerSpecificSurvival,
    marketResidualSignal,
    portfolioSignal,
    installBrowser,
    PERSONAL_VIEW_LABELS,
  };
});

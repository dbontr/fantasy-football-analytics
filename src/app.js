(function startOracleApp() {
  "use strict";

  const core = window.FantasyOracleCore;
  const engine = window.OracleBrowserEngine;
  const evidenceApi = window.OracleEvidence;
  const sources = window.OracleSources;
  const context = window.OracleContext;
  const intelligence = window.OraclePlayerIntelligence;
  const store = window.OracleStore;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const num = (value, digits = 1) => Number(value || 0).toFixed(digits);
  const pct = (value, digits = 0) => `${(Number(value || 0) * 100).toFixed(digits)}%`;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value || 0)));

  const state = {
    dataset: null,
    players: [],
    schedule: {},
    coaches: null,
    healthCalibration: null,
    contextByWeek: new Map(),
    intelligenceHistory: new Map(),
    decisionHistorySeason: 2025,
    ledger: new evidenceApi.EvidenceLedger(),
    rosterIds: [],
    draftState: null,
    leagueTeams: null,
    sleeperLoaded: false,
    sleeperPositions: new Set(),
    ensembleWeights: { market: 0.55, opportunity: 0.45 },
  };

  const worker = new Worker("./engine-worker.js");
  let requestSequence = 0;
  const pending = new Map();
  worker.addEventListener("message", (event) => {
    const message = event.data || {};
    const job = pending.get(message.requestId);
    if (!job) return;
    pending.delete(message.requestId);
    if (message.type === "error") job.reject(new Error(message.error));
    else job.resolve(message.result);
  });
  worker.addEventListener("error", (event) => {
    $("#worker-status").textContent = "Worker error";
    $("#worker-status").classList.add("error");
    console.error(event.error || event.message);
  });

  function runWorker(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `job-${++requestSequence}`;
      pending.set(requestId, { resolve, reject });
      worker.postMessage({ type, requestId, ...payload });
    });
  }

  function status(message, kind = "") {
    const node = $("#global-status");
    node.textContent = message || "";
    node.className = `status-line ${kind}`.trim();
  }

  function playerById(id) {
    return state.players.find((player) => String(player.id) === String(id)) || null;
  }

  function rankedPlayers() {
    return [...state.players].sort((a, b) => (a.pprRank || a.adp || 9999) - (b.pprRank || b.adp || 9999));
  }

  function historyKey(player, season = Number($("#history-season")?.value || 2025)) {
    return `${player?.id || "unknown"}:${season}`;
  }

  function fillWeeks() {
    const options = Array.from({ length: 18 }, (_, index) => `<option value="${index + 1}">Week ${index + 1}</option>`).join("");
    ["#player-week", "#lineup-week", "#waiver-week", "#trade-week"].forEach((selector) => { $(selector).innerHTML = options; });
  }

  function fillPlayerSelects() {
    const options = rankedPlayers().map((player) => `<option value="${esc(player.id)}">${esc(player.name)} · ${esc(player.position)} ${esc(player.team)}</option>`).join("");
    $("#player-select").innerHTML = options;
    $("#roster-add").innerHTML = options;
  }

  function renderSources() {
    $("#source-catalog").innerHTML = sources.sourceCatalog().map((source) => `
      <div class="source-row"><div><strong>${esc(source.attribution)}</strong><span>${esc(source.license)}</span></div><b>FREE / KEYLESS</b></div>
    `).join("");
  }

  function activatePanel(name) {
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.panelTarget === name));
    $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
    history.replaceState(null, "", `#${name}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function savedEvidence(player, week = 1) {
    if (!state.contextByWeek.has(week)) state.contextByWeek.set(week, context.buildTeamContext(state.players, state.schedule, week));
    return context.mergeEvidence(
      context.coachingEvidence(player, state.coaches?.teams?.[player.team]),
      context.healthEvidence(player, state.healthCalibration),
      context.matchupEvidence(player, state.contextByWeek.get(week)),
      state.ledger.evidenceFor("player", String(player.id)),
    );
  }

  function historyEvidenceFor(player, season = state.decisionHistorySeason) {
    return state.intelligenceHistory.get(historyKey(player, season))?.evidence || {};
  }

  function decisionEvidence(player, week = 1) {
    return context.mergeEvidence(historyEvidenceFor(player), savedEvidence(player, week));
  }

  function staticDecisionEvidence(player) {
    return context.mergeEvidence(
      historyEvidenceFor(player),
      context.coachingEvidence(player, state.coaches?.teams?.[player.team]),
      context.healthEvidence(player, state.healthCalibration),
      state.ledger.evidenceFor("player", String(player.id)),
    );
  }

  function baselineWeekProjection(player, week) {
    const value = Number(player?.weeklyProjections?.[Math.max(0, week - 1)]);
    if (Number.isFinite(value)) return value;
    return Number(player?.weeklyProjection || 0);
  }

  function decisionPlayerForWeek(player, week) {
    const forecast = engine.forecastPlayer(player, { week, evidence: decisionEvidence(player, week) });
    const weekly = Array.isArray(player.weeklyProjections)
      ? [...player.weeklyProjections]
      : Array.from({ length: 18 }, () => Number(player.weeklyProjection || 0));
    weekly[Math.max(0, Math.min(17, week - 1))] = forecast.distribution.mean;
    return {
      ...player,
      weeklyProjections: weekly,
      decisionProjection: forecast.distribution.mean,
      decisionAvailability: forecast.availability.probability,
    };
  }

  async function ensureDecisionIntelligence(players, season = state.decisionHistorySeason) {
    const unique = [...new Map((players || []).filter((player) => player?.id).map((player) => [String(player.id), player])).values()];
    const missing = unique.filter((player) => !state.intelligenceHistory.has(historyKey(player, season)));
    if (!missing.length) return { loaded: 0, total: unique.length, cached: true };
    try {
      const result = await runWorker("player-history-batch", { players: missing, season });
      for (const [id, profile] of Object.entries(result.histories || {})) {
        const player = missing.find((row) => String(row.id) === String(id));
        if (!player) continue;
        state.intelligenceHistory.set(historyKey(player, season), { season, source: result.source, ...profile });
      }
      return { loaded: Object.keys(result.histories || {}).length, total: unique.length, source: result.source };
    } catch (error) {
      console.warn("Decision intelligence unavailable; continuing with bounded baseline evidence.", error);
      return { loaded: 0, total: unique.length, error };
    }
  }

  function refreshDecisionPlayers(players) {
    return (players || []).map((player) => playerById(player.id) || player);
  }

  async function ensureLiveDecisionStatus(players) {
    if (state.sleeperLoaded) return { synced: 0, failed: [], cached: true };
    const supported = new Set(["QB", "RB", "WR", "TE", "K"]);
    const positions = [...new Set((players || []).map((player) => String(player?.position || "").toUpperCase()))]
      .filter((position) => supported.has(position) && !state.sleeperPositions.has(position));
    if (!positions.length) return { synced: 0, failed: [], cached: true };
    const selectedPlayerId = $("#player-select").value;
    const results = await Promise.allSettled(positions.map(async (position) => ({
      position,
      players: await sources.loadSleeperPlayers(position),
    })));
    const failed = [];
    let synced = 0;
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status !== "fulfilled") { failed.push(positions[index]); continue; }
      state.players = sources.enrichLocalPlayers(state.players, result.value.players);
      state.sleeperPositions.add(result.value.position);
      synced += 1;
    }
    if (synced) {
      fillPlayerSelects();
      if (selectedPlayerId && playerById(selectedPlayerId)) $("#player-select").value = selectedPlayerId;
    }
    return { synced, failed, cached: false };
  }

  async function prepareDecisionContext(players) {
    const live = await ensureLiveDecisionStatus(players);
    const refreshed = refreshDecisionPlayers(players);
    const history = await ensureDecisionIntelligence(refreshed);
    return { players: refreshed, live, history };
  }

  function decisionContextLabel(contextState) {
    const history = contextState?.history?.error ? "history fallback" : "history-aware";
    const live = contextState?.live?.failed?.length ? "live-status fallback" : "live-status synced";
    return history + " · " + live;
  }

  function temporaryEvidence(player) {
    const evidence = { ...decisionEvidence(player, Number($("#player-week").value || 1)) };
    const active = $("#whatif-active").value;
    const target = $("#whatif-target").value;
    const wind = $("#whatif-wind").value;
    if (active !== "") evidence["health.active_probability"] = { available: true, value: clamp(Number(active) / 100, 0, 1), confidence: 0.85, conflict: 0 };
    if (target !== "") evidence["role.target_share"] = { available: true, value: clamp(Number(target), 0, 1), confidence: 0.72, conflict: 0 };
    if (wind !== "") evidence["environment.wind_mph"] = { available: true, value: Math.max(0, Number(wind)), confidence: 0.9, conflict: 0 };
    return evidence;
  }

  function rangeMarkup(summary) {
    const maximum = Math.max(1, summary.p90 * 1.15, summary.mean * 1.7);
    const left = clamp(summary.p10 / maximum * 100, 0, 100);
    const right = clamp(summary.p90 / maximum * 100, left, 100);
    const median = clamp(summary.p50 / maximum * 100, 0, 100);
    return `<div class="range-block"><div class="range-labels"><span>P10 ${num(summary.p10)}</span><span>P50 ${num(summary.p50)}</span><span>P90 ${num(summary.p90)}</span></div><div class="range-track"><div class="range-band" style="left:${left}%;width:${Math.max(1, right - left)}%"></div><div class="range-median" style="left:${median}%"></div></div></div>`;
  }

  function renderPlayerResult(forecast, simulationSummary) {
    const summary = simulationSummary || forecast.distribution;
    const drivers = forecast.drivers.length ? forecast.drivers : [{ label: "baseline projection", family: "baseline", impact: 0, confidence: forecast.baseline.reliability }];
    $("#player-result").className = "result-space";
    $("#player-result").innerHTML = `
      <div class="player-banner"><div><span class="pos-pill">${esc(forecast.player.position)}</span><h2>${esc(forecast.player.name)}</h2><p>${esc(forecast.player.team)} · Week ${forecast.week} · ${pct(forecast.availability.probability)} active</p></div><div class="rank-note">EDGE ${forecast.edge.points >= 0 ? "+" : ""}${num(forecast.edge.points)} PTS</div></div>
      <div class="metric-grid">
        <div class="metric"><span>MEAN</span><strong>${num(summary.mean)}</strong></div>
        <div class="metric"><span>MEDIAN</span><strong>${num(summary.p50)}</strong></div>
        <div class="metric"><span>CEILING P90</span><strong class="good">${num(summary.p90)}</strong></div>
        <div class="metric"><span>DOWNSIDE CVAR10</span><strong class="warn">${num(summary.cvar10)}</strong></div>
        <div class="metric"><span>BOOM / BUST</span><strong>${pct(forecast.probabilities.boom)} / ${pct(forecast.probabilities.bust)}</strong></div>
      </div>
      ${rangeMarkup(summary)}
      <p class="control-title">MODEL DRIVERS</p>
      <div class="driver-list">${drivers.slice(0, 10).map((driver) => `<div class="driver-row"><span>${esc(driver.label)}</span><b class="${driver.impact >= 0 ? "positive" : "negative"}">${driver.impact >= 0 ? "+" : ""}${num(driver.impact, 2)}</b><em>${esc(driver.family)} · ${pct(driver.confidence || 0)}</em></div>`).join("")}</div>
      <p class="fineprint">Uncertainty: epistemic ${pct(forecast.uncertainty.epistemic)}, role ${pct(forecast.uncertainty.role)}, evidence conflict ${pct(forecast.uncertainty.evidenceConflict)}.</p>
    `;
  }

  async function runPlayerLab() {
    const player = playerById($("#player-select").value);
    if (!player) return;
    const week = Number($("#player-week").value || 1);
    const forecast = engine.forecastPlayer(player, { week, evidence: temporaryEvidence(player) });
    $("#run-player").disabled = true;
    status(`Running ${$("#player-scenarios").value} local scenarios…`);
    try {
      const simulation = await runWorker("scenario", { forecasts: [forecast], options: { week, scenarios: Number($("#player-scenarios").value), schedule: state.schedule, seed: `player-${player.id}-${week}` } });
      renderPlayerResult(forecast, simulation.playerSummaries[String(player.id)]);
      status("Distribution complete.", "good");
    } catch (error) {
      status(error.message, "error");
    } finally {
      $("#run-player").disabled = false;
    }
  }

  function renderPlayerIntelligence(player, result, forecast) {
    const summary = result.summary;
    const outlook = intelligence.generateOutlook(player, forecast, summary);
    const health = outlook.health;
    const healthParts = health.live ? [health.status, health.practice, health.bodyPart, health.notes].filter(Boolean) : [`Live status unavailable · bootstrap ${health.status}`];
    const games = [...result.gameLog].reverse().slice(0, 10);
    const directionClass = outlook.direction === "UP" ? "good" : outlook.direction === "DOWN" ? "warn" : "";
    $("#intelligence-source").textContent = `${result.source.name} · ${(result.source.bytes / 1024 / 1024).toFixed(2)} MB · ${result.source.rowCount.toLocaleString()} rows`;
    $("#player-intelligence").className = "result-space";
    $("#player-intelligence").innerHTML = `
      <div class="intelligence-grid">
        <section class="outlook-card"><p class="control-title">ORACLE OUTLOOK</p><h3 class="${directionClass}">${esc(outlook.headline)}</h3>${outlook.bullets.map((item) => `<p>${esc(item)}</p>`).join("")}<small>${esc(outlook.provenance)}</small></section>
        <section><p class="control-title">ROLLING FORM</p><div class="metric-grid compact-metrics"><div class="metric"><span>LAST 3 PPR</span><strong>${summary.last3.ppr === null ? "—" : num(summary.last3.ppr)}</strong></div><div class="metric"><span>LAST 3 OPPS</span><strong>${summary.last3.opportunities === null ? "—" : num(summary.last3.opportunities)}</strong></div><div class="metric"><span>TARGET SHARE</span><strong>${summary.last3.targetShare === null ? "—" : pct(summary.last3.targetShare, 1)}</strong></div>${["RB", "QB"].includes(player.position) ? `<div class="metric"><span>CARRY SHARE</span><strong>${summary.last3.carryShare === null ? "—" : pct(summary.last3.carryShare, 1)}</strong></div>` : ""}<div class="metric"><span>CONSISTENCY</span><strong>${pct(summary.consistency, 0)}</strong></div></div><p class="fineprint">Current status: ${esc(healthParts.join(" · ") || "ACTIVE / no structured limitation reported")}.</p></section>
      </div>
      <div class="table-header"><h3>${esc(player.name)} · ${result.season} actual game log</h3><span>${summary.games} regular-season games</span></div>
      <div class="table-wrap"><table><thead><tr><th>Wk</th><th>Opp</th><th>PPR</th><th>Opps</th><th>Tgt</th><th>Car</th><th>Rec</th><th>Scrim Yd</th><th>Pass Yd</th><th>TD</th></tr></thead><tbody>${games.map((game) => `<tr><td>${game.week}</td><td>${esc(game.opponent)}</td><td><b>${num(game.fantasyPpr)}</b></td><td>${num(game.opportunities, 0)}</td><td>${num(game.targets, 0)}</td><td>${num(game.carries, 0)}</td><td>${num(game.receptions, 0)}</td><td>${num(game.scrimmageYards, 0)}</td><td>${num(game.passingYards, 0)}</td><td>${num(game.totalTds, 0)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  async function loadPlayerIntelligence() {
    const selectedId = $("#player-select").value;
    let player = playerById(selectedId);
    if (!player) return;
    const season = Number($("#history-season").value || 2025);
    $("#load-intelligence").disabled = true;
    $("#intelligence-source").textContent = `Loading ${season} nflverse game logs…`;
    status("Loading actual game history and current structured status…");
    try {
      if (!state.sleeperLoaded && !state.sleeperPositions.has(player.position)) {
        try { await syncSleeperPosition(player.position); } catch (_) { /* history remains usable if live status is unavailable */ }
      }
      player = playerById(selectedId) || player;
      const result = await runWorker("player-history", { player, season });
      state.intelligenceHistory.set(historyKey(player, season), result);
      const week = Number($("#player-week").value || 1);
      const forecast = engine.forecastPlayer(player, { week, evidence: temporaryEvidence(player) });
      renderPlayerIntelligence(player, result, forecast);
      status("Player intelligence loaded. Recent history is now available as bounded model evidence.", "good");
    } catch (error) {
      $("#intelligence-source").textContent = "History load failed";
      status(error.message, "error");
    } finally {
      $("#load-intelligence").disabled = false;
    }
  }

  async function saveEvidence() {
    const player = playerById($("#player-select").value);
    if (!player) return;
    const now = Date.now();
    const rows = [];
    if ($("#whatif-active").value !== "") rows.push({ feature: "health.active_probability", value: clamp(Number($("#whatif-active").value) / 100, 0, 1), type: "probability", confidence: 0.85 });
    if ($("#whatif-target").value !== "") rows.push({ feature: "role.target_share", value: clamp(Number($("#whatif-target").value), 0, 1), type: "numeric", confidence: 0.72 });
    if ($("#whatif-wind").value !== "") rows.push({ feature: "environment.wind_mph", value: Math.max(0, Number($("#whatif-wind").value)), type: "numeric", confidence: 0.9 });
    if (!rows.length) return status("Enter at least one temporary evidence value first.", "error");
    for (const row of rows) {
      await state.ledger.add({ ...row, entityType: "player", entityId: String(player.id), source: "local-observation", reliability: 0.75, observedAt: now, effectiveAt: now });
    }
    await store.set("evidence-ledger", state.ledger.export().observations);
    renderEvidenceStatus();
    status(`Saved ${rows.length} observation${rows.length === 1 ? "" : "s"} locally.`, "good");
  }

  function currentDraftSettings() {
    return core.cloneSettings({ teams: Number($("#draft-teams").value || 12), draftPosition: Number($("#draft-position").value || 6) });
  }

  function resetDraft() {
    const settings = currentDraftSettings();
    $("#draft-position").max = String(settings.teams);
    if (settings.draftPosition > settings.teams) $("#draft-position").value = String(settings.teams);
    state.draftState = core.createDraftState(settings);
    renderDraft();
  }

  function renderDraft() {
    const settings = currentDraftSettings();
    if (!state.draftState) state.draftState = core.createDraftState(settings);
    const summary = core.draftPickSummary(state.draftState, settings);
    const recommendations = core.advancedDraftRecommendations(state.players, state.draftState, settings, settings.draftPosition, 16);
    $("#draft-next").textContent = `P${summary.pickNumber} / T${summary.teamId}`;
    $("#draft-meta").textContent = `${state.draftState.picks.length} picks complete · ${summary.isUserPick ? "YOUR PICK" : `team ${summary.teamId}`}`;
    $("#draft-table").innerHTML = recommendations.map((row) => `
      <tr><td class="player-cell"><strong>${esc(row.name)}</strong><span>${esc(row.team)} · ADP ${row.adp ? num(row.adp, 1) : "—"}</span></td><td><span class="pos-pill">${esc(row.position)}</span></td><td>${esc(row.decision)}</td><td>${row.vona >= 0 ? "+" : ""}${num(row.vona)}</td><td>${pct(row.returnChance)}</td><td>${num(row.urgency, 0)}</td><td><button class="mini-button" data-draft-player="${esc(row.id)}" ${summary.isUserPick ? "" : "disabled"}>Draft</button></td></tr>
    `).join("");
    $$('[data-draft-player]').forEach((button) => button.addEventListener("click", () => {
      state.draftState = core.applyDraftPick(state.draftState, button.dataset.draftPlayer, settings);
      renderDraft();
    }));
  }

  function advanceDraftToUser() {
    const settings = currentDraftSettings();
    if (!state.draftState) state.draftState = core.createDraftState(settings);
    let guard = settings.teams * settings.rounds;
    while (guard-- > 0) {
      const summary = core.draftPickSummary(state.draftState, settings);
      if (summary.isUserPick || summary.remaining <= 0) break;
      const best = core.advancedDraftRecommendations(state.players, state.draftState, settings, summary.teamId, 1)[0];
      if (!best) break;
      state.draftState = core.applyDraftPick(state.draftState, best.id, settings);
    }
    renderDraft();
  }

  function rosterPlayers() {
    const ids = new Set(state.rosterIds.map(String));
    return state.players.filter((player) => ids.has(String(player.id)));
  }

  async function persistRoster() {
    await store.set("roster-ids", state.rosterIds);
  }

  function renderRoster() {
    const roster = rosterPlayers();
    $("#roster-strip").innerHTML = roster.length ? roster.map((player) => `<div class="roster-chip"><span>${esc(player.position)}</span>${esc(player.name)}<button type="button" aria-label="Remove ${esc(player.name)}" data-remove-roster="${esc(player.id)}">×</button></div>`).join("") : `<span class="fineprint">Roster is empty.</span>`;
    $$('[data-remove-roster]').forEach((button) => button.addEventListener("click", async () => {
      state.rosterIds = state.rosterIds.filter((id) => String(id) !== String(button.dataset.removeRoster));
      await persistRoster();
      renderRoster();
    }));
  }

  function addRosterPlayer(id) {
    if (!id || state.rosterIds.includes(String(id))) return;
    state.rosterIds.push(String(id));
    persistRoster();
    renderRoster();
  }

  function loadDemoRoster() {
    const quotas = { QB: 2, RB: 4, WR: 5, TE: 2, DST: 1, K: 1 };
    const counts = {};
    state.rosterIds = [];
    for (const player of rankedPlayers()) {
      if (!quotas[player.position]) continue;
      counts[player.position] = counts[player.position] || 0;
      if (counts[player.position] >= quotas[player.position]) continue;
      state.rosterIds.push(String(player.id));
      counts[player.position] += 1;
      if (Object.entries(quotas).every(([position, count]) => (counts[position] || 0) >= count)) break;
    }
    persistRoster();
    renderRoster();
  }

  async function analyzeLineup() {
    let roster = rosterPlayers();
    if (!roster.length) return status("Build a roster first.", "error");
    const week = Number($("#lineup-week").value || 1);
    status("Refreshing live health + recent role intelligence for the roster…");
    const contextState = await prepareDecisionContext(roster);
    roster = contextState.players;
    const forecasts = roster.map((player) => engine.forecastPlayer(player, { week, evidence: decisionEvidence(player, week) }));
    const byId = new Map(forecasts.map((forecast) => [String(forecast.player.id), forecast]));
    const prepared = forecasts.map((forecast) => ({ ...forecast.player, weekProjection: forecast.distribution.mean }));
    const lineup = core.optimizeLineup(prepared, core.DEFAULT_SETTINGS, "weekProjection");
    const starterIds = lineup.starters.filter((row) => row.player).map((row) => String(row.player.id));
    $("#run-lineup").disabled = true;
    status("Sampling correlated starter outcomes…");
    try {
      const portfolio = await runWorker("portfolio", {
        forecasts,
        portfolios: [{ id: "lineup", label: "Optimized lineup", playerIds: starterIds }],
        options: { week, scenarios: 4000, schedule: state.schedule, seed: `lineup-${week}` },
      });
      const summary = portfolio.decision.actions[0].summary;
      const starters = lineup.starters.map((row) => `<div class="lineup-row"><span>${esc(row.slot)}</span><strong>${row.player ? esc(row.player.name) : "EMPTY"}</strong><b>${row.player ? num(byId.get(String(row.player.id))?.distribution.mean) : "—"}</b></div>`).join("");
      const bench = lineup.bench.slice(0, 8).map((player) => `<div class="lineup-row"><span>BN</span><strong>${esc(player.name)}</strong><b>${num(byId.get(String(player.id))?.distribution.mean)}</b></div>`).join("");
      $("#lineup-result").className = "result-space";
      $("#lineup-result").innerHTML = `<div class="metric-grid"><div class="metric"><span>EXPECTED</span><strong>${num(summary.mean)}</strong></div><div class="metric"><span>P10</span><strong class="warn">${num(summary.p10)}</strong></div><div class="metric"><span>MEDIAN</span><strong>${num(summary.p50)}</strong></div><div class="metric"><span>P90</span><strong class="good">${num(summary.p90)}</strong></div><div class="metric"><span>CVaR10</span><strong>${num(summary.cvar10)}</strong></div></div>${rangeMarkup(summary)}<div class="result-grid"><div><p class="control-title">STARTERS</p><div class="lineup-list">${starters}</div></div><div><p class="control-title">BENCH ALTERNATIVES</p><div class="lineup-list">${bench || "<div class='lineup-row'><strong>No bench</strong></div>"}</div></div></div>`;
      status(`Lineup portfolio complete · ${decisionContextLabel(contextState)}.`, "good");
    } catch (error) {
      status(error.message, "error");
    } finally {
      $("#run-lineup").disabled = false;
    }
  }

  function faabRange(suggestion, budget, week) {
    const weeksRemaining = Math.max(1, 18 - Number(week || 1));
    const scarcity = suggestion.add.percentOwned >= 80 ? 1.18 : suggestion.add.percentOwned >= 50 ? 1.08 : 1;
    const urgency = Math.max(0, suggestion.lineupGain * 7 + suggestion.depthGain * 1.8 + suggestion.score * 0.55);
    const target = clamp(Math.round(urgency * scarcity * (1 + 3 / weeksRemaining)), 1, budget);
    return {
      floor: Math.max(1, Math.round(target * 0.68)),
      target,
      ceiling: Math.min(budget, Math.max(target, Math.round(target * 1.35))),
    };
  }

  async function runWaivers() {
    let roster = rosterPlayers();
    if (!roster.length) return status("Build a roster in the Lineup tab first.", "error");
    const rosterSet = new Set(state.rosterIds.map(String));
    let freeAgents = state.players.filter((player) => !rosterSet.has(String(player.id)));
    const week = Number($("#waiver-week").value || 1);
    const budget = Math.max(0, Number($("#faab-budget").value || 0));
    $("#run-waivers").disabled = true;
    status("Refreshing live health + recent role intelligence for waiver candidates…");
    let contextState = { live: { failed: [] }, history: {} };
    try {
      const intelligencePool = [...freeAgents].sort((a, b) => baselineWeekProjection(b, week) - baselineWeekProjection(a, week)).slice(0, 180);
      contextState = await prepareDecisionContext([...roster, ...intelligencePool]);
      roster = refreshDecisionPlayers(roster);
      freeAgents = state.players.filter((player) => !rosterSet.has(String(player.id)));
      const intelligenceIds = new Set(intelligencePool.map((player) => String(player.id)));
      const decisionRoster = roster.map((player) => decisionPlayerForWeek(player, week));
      const decisionFreeAgents = freeAgents.map((player) => intelligenceIds.has(String(player.id)) ? decisionPlayerForWeek(player, week) : player);
      status("Searching live + history-aware add/drop combinations in the worker…");
      const suggestions = await runWorker("waivers", { roster: decisionRoster, freeAgents: decisionFreeAgents, settings: core.DEFAULT_SETTINGS, limit: 12, week });
      $("#waiver-result").className = "result-space";
      $("#waiver-result").innerHTML = suggestions.length ? `<div class="decision-list">${suggestions.map((row) => {
        const bid = faabRange(row, budget, week);
        return `<article class="decision-card"><div class="decision-head"><strong>Add ${esc(row.add.name)} · Drop ${esc(row.drop.name)}</strong><b>$${bid.target}</b></div><p>${esc(row.reason)}</p><div class="decision-stats"><span>lineup ${row.lineupGain >= 0 ? "+" : ""}${num(row.lineupGain)}</span><span>depth ${row.depthGain >= 0 ? "+" : ""}${num(row.depthGain)}</span><span>FAAB $${bid.floor}–$${bid.ceiling}</span><span>score ${num(row.score)}</span></div></article>`;
      }).join("")}</div>` : `<p>No positive add/drop pairs found under the current roster and week.</p>`;
      status(`Waiver search complete · ${decisionContextLabel(contextState)}.`, "good");
    } catch (error) {
      status(error.message, "error");
    } finally {
      $("#run-waivers").disabled = false;
    }
  }

  function counterpartyRoster() {
    const used = new Set(state.rosterIds.map(String));
    const quotas = { QB: 2, RB: 4, WR: 5, TE: 2, DST: 1, K: 1 };
    const counts = {};
    const roster = [];
    for (const player of rankedPlayers()) {
      if (used.has(String(player.id)) || !quotas[player.position]) continue;
      counts[player.position] = counts[player.position] || 0;
      if (counts[player.position] >= quotas[player.position]) continue;
      roster.push(player);
      counts[player.position] += 1;
      if (Object.entries(quotas).every(([position, count]) => (counts[position] || 0) >= count)) break;
    }
    return roster;
  }

  async function runTrades() {
    let userRoster = rosterPlayers();
    if (!userRoster.length) return status("Build a roster in the Lineup tab first.", "error");
    let opponentRoster = counterpartyRoster();
    const week = Number($("#trade-week").value || 1);
    $("#run-trades").disabled = true;
    status("Refreshing live health + recent role intelligence for both rosters…");
    let contextState = { live: { failed: [] }, history: {} };
    try {
      contextState = await prepareDecisionContext([...userRoster, ...opponentRoster]);
      userRoster = refreshDecisionPlayers(userRoster);
      opponentRoster = refreshDecisionPlayers(opponentRoster);
      const decisionUserRoster = userRoster.map((player) => decisionPlayerForWeek(player, week));
      const decisionOpponentRoster = opponentRoster.map((player) => decisionPlayerForWeek(player, week));
      status("Searching live + history-aware bilateral packages in the worker…");
      const proposals = await runWorker("trade-proposals", { options: {
        userRoster: decisionUserRoster,
        opponentRoster: decisionOpponentRoster,
        players: state.players,
        settings: core.DEFAULT_SETTINGS,
        week,
        includeTwoForTwo: true,
        maxEvaluations: 700,
        limit: 10,
      } });
      $("#trade-result").className = "result-space";
      $("#trade-result").innerHTML = proposals.length ? `<div class="decision-list">${proposals.map((row) => `<article class="decision-card"><div class="decision-head"><strong>${esc(row.give.map((p) => p.name).join(" + "))} → ${esc(row.receive.map((p) => p.name).join(" + "))}</strong><b>${esc(row.packageType)}</b></div><p>${esc(row.summary)}</p><div class="decision-stats"><span>your lineup ${row.userAnalysis.lineupGain >= 0 ? "+" : ""}${num(row.userAnalysis.lineupGain)}</span><span>their lineup ${row.opponentAnalysis.lineupGain >= 0 ? "+" : ""}${num(row.opponentAnalysis.lineupGain)}</span><span>fairness ${row.fairness}%</span><span>mutual ${num(row.mutualScore)}</span></div></article>`).join("")}</div>` : `<p>No mutually plausible packages passed the current fairness thresholds.</p>`;
      status(`Trade search complete · ${decisionContextLabel(contextState)}.`, "good");
    } catch (error) {
      status(error.message, "error");
    } finally {
      $("#run-trades").disabled = false;
    }
  }

  function balancedLeague(teamCount = 10) {
    if (!state.rosterIds.length) loadDemoRoster();
    const userRoster = rosterPlayers();
    const used = new Set(userRoster.map((player) => String(player.id)));
    const teams = [{ teamId: "1", name: "My Team", roster: [...userRoster] }];
    for (let index = 2; index <= teamCount; index += 1) teams.push({ teamId: String(index), name: `Team ${index}`, roster: [] });
    const quotas = { QB: 2, RB: 4, WR: 5, TE: 2, DST: 1, K: 1 };
    const poolByPosition = Object.fromEntries(Object.keys(quotas).map((position) => [position, rankedPlayers().filter((player) => player.position === position && !used.has(String(player.id)))]));
    const cursor = Object.fromEntries(Object.keys(quotas).map((position) => [position, 0]));
    for (const team of teams) {
      const counts = team.roster.reduce((map, player) => ({ ...map, [player.position]: (map[player.position] || 0) + 1 }), {});
      for (const [position, target] of Object.entries(quotas)) {
        while ((counts[position] || 0) < target) {
          let player = poolByPosition[position][cursor[position]++];
          while (player && used.has(String(player.id))) player = poolByPosition[position][cursor[position]++];
          if (!player) break;
          team.roster.push(player);
          used.add(String(player.id));
          counts[position] = (counts[position] || 0) + 1;
        }
      }
    }
    state.leagueTeams = teams;
    state.leagueMeta = { playoffTeams: Math.min(6, teamCount), playoffByes: teamCount >= 6 ? 2 : 0 };
    $("#league-source-status").textContent = `Balanced ${teamCount}-team local league loaded.`;
    return teams;
  }

  async function syncSleeperPosition(position) {
    const selectedPlayerId = $("#player-select").value;
    const sleeperPlayers = await sources.loadSleeperPlayers(position);
    state.players = sources.enrichLocalPlayers(state.players, sleeperPlayers);
    state.sleeperPositions.add(String(position).toUpperCase());
    fillPlayerSelects();
    if (selectedPlayerId && playerById(selectedPlayerId)) $("#player-select").value = selectedPlayerId;
    return sleeperPlayers;
  }

  async function syncSleeper() {
    $("#sync-sleeper").disabled = true;
    status("Downloading public Sleeper player status…");
    try {
      const sleeperPlayers = await sources.loadSleeperPlayers();
      const selectedPlayerId = $("#player-select").value;
      state.players = sources.enrichLocalPlayers(state.players, sleeperPlayers);
      state.sleeperLoaded = true;
      fillPlayerSelects();
      if (selectedPlayerId && playerById(selectedPlayerId)) $("#player-select").value = selectedPlayerId;
      status("Sleeper status, injury, practice, and depth fields synced in memory.", "good");
      return sleeperPlayers;
    } catch (error) {
      status(`Sleeper sync failed: ${error.message}`, "error");
      throw error;
    } finally {
      $("#sync-sleeper").disabled = false;
    }
  }

  async function importSleeperLeague() {
    const leagueId = $("#sleeper-league-id").value.trim();
    if (!leagueId) return status("Enter a Sleeper league ID.", "error");
    $("#import-sleeper-league").disabled = true;
    $("#league-source-status").textContent = "Importing public Sleeper league…";
    try {
      if (!state.sleeperLoaded) await syncSleeper();
      const data = await sources.loadSleeperLeague(leagueId);
      const bySleeperId = new Map(state.players.filter((player) => player.sleeperId).map((player) => [String(player.sleeperId), player]));
      const users = new Map((data.users || []).map((user) => [String(user.user_id), user]));
      const teams = (data.rosters || []).map((roster, index) => {
        const user = users.get(String(roster.owner_id));
        const recognized = (roster.players || []).map((id) => bySleeperId.get(String(id))).filter(Boolean);
        return {
          teamId: String(roster.roster_id || index + 1),
          name: user?.metadata?.team_name || user?.display_name || `Team ${index + 1}`,
          roster: recognized,
          wins: Number(roster.settings?.wins || 0),
          losses: Number(roster.settings?.losses || 0),
          ties: Number(roster.settings?.ties || 0),
          pointsFor: Number(roster.settings?.fpts || 0) + Number(roster.settings?.fpts_decimal || 0) / 100,
        };
      });
      if (teams.length < 2 || teams.some((team) => !team.roster.length)) throw new Error("The imported league does not have enough recognized rosters for simulation");
      state.leagueTeams = teams;
      state.leagueMeta = {
        playoffTeams: Number(data.league?.settings?.playoff_teams || Math.min(6, teams.length)),
        playoffByes: Number(data.league?.settings?.playoff_teams || 6) === 6 ? 2 : 0,
      };
      const recognized = teams.reduce((sum, team) => sum + team.roster.length, 0);
      $("#league-source-status").textContent = `${data.league?.name || "Sleeper league"}: ${teams.length} teams / ${recognized} recognized roster slots.`;
      status("Sleeper league imported.", "good");
    } catch (error) {
      $("#league-source-status").textContent = error.message;
      status(error.message, "error");
    } finally {
      $("#import-sleeper-league").disabled = false;
    }
  }

  async function runLeague() {
    if (!state.leagueTeams) balancedLeague(10);
    const scenarios = Number($("#league-scenarios").value || 1500);
    const regularSeasonEnd = Number($("#regular-season-end").value || 14);
    const championshipWeek = Number($("#championship-week").value || 17);
    $("#run-league").disabled = true;
    let leaguePlayers = [...new Map(state.leagueTeams.flatMap((team) => team.roster).map((player) => [String(player.id), player])).values()];
    $("#league-source-status").textContent = `Refreshing live health + recent role intelligence for ${leaguePlayers.length} rostered players…`;
    let contextState = { live: { failed: [] }, history: {} };
    try {
      contextState = await prepareDecisionContext(leaguePlayers);
      state.leagueTeams = state.leagueTeams.map((team) => ({ ...team, roster: refreshDecisionPlayers(team.roster) }));
      leaguePlayers = [...new Map(state.leagueTeams.flatMap((team) => team.roster).map((player) => [String(player.id), player])).values()];
      const evidenceByPlayer = Object.fromEntries(leaguePlayers.map((player) => [String(player.id), staticDecisionEvidence(player)]));
      $("#league-source-status").textContent = `Running ${scenarios.toLocaleString()} live + history-aware league seasons in the worker…`;
      const result = await runWorker("league", { options: {
        teams: state.leagueTeams,
        settings: core.DEFAULT_SETTINGS,
        schedule: state.schedule,
        startWeek: 1,
        regularSeasonEnd,
        championshipWeek,
        playoffTeams: state.leagueMeta?.playoffTeams || Math.min(6, state.leagueTeams.length),
        playoffByes: state.leagueMeta?.playoffByes || 0,
        medianGame: $("#median-game").checked,
        evidenceByPlayer,
        simulations: scenarios,
        seed: `league-${state.leagueTeams.length}-${regularSeasonEnd}-${championshipWeek}`,
      } });
      $("#league-result").className = "result-space";
      $("#league-result").innerHTML = `<div class="table-header"><h2>Championship board</h2><span>${result.simulations.toLocaleString()} seasons · playoffs W${result.firstPlayoffWeek}–${result.championshipWeek}</span></div><div class="table-wrap"><table><thead><tr><th>Team</th><th>Title</th><th>Playoffs</th><th>Expected wins</th><th>All-play</th><th>Expected points</th></tr></thead><tbody>${result.teams.map((team) => `<tr><td class="player-cell"><strong>${esc(team.name)}</strong><span>team ${esc(team.teamId)}</span></td><td><b>${pct(team.championshipProbability, 1)}</b></td><td>${pct(team.playoffProbability, 1)}</td><td>${num(team.expectedWins, 2)}</td><td>${pct(team.allPlayWinPct, 1)}</td><td>${num(team.expectedPoints, 1)}</td></tr>`).join("")}</tbody></table></div>`;
      $("#league-source-status").textContent = `Title simulation complete · ${decisionContextLabel(contextState)}. Probabilities are model estimates, not guarantees.`;
      status(`League championship simulation complete · ${decisionContextLabel(contextState)}.`, "good");
    } catch (error) {
      $("#league-source-status").textContent = error.message;
      status(error.message, "error");
    } finally {
      $("#run-league").disabled = false;
    }
  }

  function renderWeights() {
    $("#weight-display").innerHTML = Object.entries(state.ensembleWeights).map(([key, value]) => `<div class="weight-cell"><span>${esc(key)}</span><strong>${pct(value, 1)}</strong></div>`).join("");
  }

  function renderEvidenceStatus() {
    const count = state.ledger.observations.length;
    $("#evidence-status").textContent = `${count} local observation${count === 1 ? "" : "s"}`;
    $("#evidence-count").textContent = String(count);
  }

  async function updateWeights() {
    state.ensembleWeights = engine.updateEnsembleWeights(state.ensembleWeights, {
      market: Number($("#loss-market").value || 0),
      opportunity: Number($("#loss-opportunity").value || 0),
    });
    await store.set("ensemble-weights", state.ensembleWeights);
    renderWeights();
    status("Ensemble weights updated locally from supplied realized loss.", "good");
  }

  async function verifyEvidenceChain() {
    const result = await state.ledger.verifyChain();
    $("#chain-status").textContent = result.valid ? `VALID · ${result.count}` : `INVALID · #${result.sequence}`;
    $("#chain-status").style.color = result.valid ? "var(--good)" : "var(--danger)";
  }

  async function clearLocalState() {
    await Promise.all([store.remove("roster-ids"), store.remove("evidence-ledger"), store.remove("ensemble-weights")]);
    state.rosterIds = [];
    state.ledger = new evidenceApi.EvidenceLedger();
    state.ensembleWeights = { market: 0.55, opportunity: 0.45 };
    state.leagueTeams = null;
    resetDraft();
    renderRoster();
    renderEvidenceStatus();
    renderWeights();
    $("#chain-status").textContent = "Not checked";
    status("Local roster, evidence, and calibration state cleared.", "good");
  }

  function bindEvents() {
    $$(".tab").forEach((tab) => tab.addEventListener("click", () => activatePanel(tab.dataset.panelTarget)));
    $$('[data-jump]').forEach((button) => button.addEventListener("click", () => activatePanel(button.dataset.jump)));
    $("#run-player").addEventListener("click", runPlayerLab);
    $("#load-intelligence").addEventListener("click", loadPlayerIntelligence);
    $("#save-evidence").addEventListener("click", saveEvidence);
    $("#draft-reset").addEventListener("click", resetDraft);
    $("#draft-advance").addEventListener("click", advanceDraftToUser);
    $("#draft-teams").addEventListener("change", resetDraft);
    $("#draft-position").addEventListener("change", resetDraft);
    $("#roster-add-button").addEventListener("click", () => addRosterPlayer($("#roster-add").value));
    $("#roster-demo").addEventListener("click", loadDemoRoster);
    $("#roster-clear").addEventListener("click", async () => { state.rosterIds = []; await persistRoster(); renderRoster(); });
    $("#run-lineup").addEventListener("click", analyzeLineup);
    $("#run-waivers").addEventListener("click", runWaivers);
    $("#run-trades").addEventListener("click", runTrades);
    $("#build-demo-league").addEventListener("click", () => { balancedLeague(10); status("Balanced demo league ready.", "good"); });
    $("#import-sleeper-league").addEventListener("click", importSleeperLeague);
    $("#run-league").addEventListener("click", runLeague);
    $("#sync-sleeper").addEventListener("click", () => syncSleeper().catch(() => {}));
    $("#clear-local").addEventListener("click", clearLocalState);
    $("#update-weights").addEventListener("click", updateWeights);
    $("#verify-chain").addEventListener("click", verifyEvidenceChain);
  }

  async function initialize() {
    renderSources();
    fillWeeks();
    $("#engine-version").textContent = engine.VERSION.replace("oracle-browser-", "v");
    $("#worker-status").textContent = "Web Worker online";
    try {
      const [response, coachResponse, healthResponse] = await Promise.all([
        fetch("./data/players-lite.json"),
        fetch("./data/coaches-2026.json"),
        fetch("./data/health-calibration-2026.json"),
      ]);
      if (!response.ok || !coachResponse.ok || !healthResponse.ok) throw new Error("one or more bootstrap model artifacts failed to load");
      state.dataset = await response.json();
      state.coaches = await coachResponse.json();
      state.healthCalibration = await healthResponse.json();
      state.players = state.dataset.players || [];
      state.schedule = state.dataset.schedule || {};
      $("#player-count").textContent = state.players.length.toLocaleString();
      $("#bootstrap-status").textContent = `${state.dataset.meta?.season || 2026} compact snapshot`;
      fillPlayerSelects();

      const [savedLedger, savedRoster, savedWeights] = await Promise.all([
        store.get("evidence-ledger", []),
        store.get("roster-ids", []),
        store.get("ensemble-weights", null),
      ]);
      state.ledger = new evidenceApi.EvidenceLedger(Array.isArray(savedLedger) ? savedLedger : []);
      state.rosterIds = Array.isArray(savedRoster) ? savedRoster.map(String).filter((id) => playerById(id)) : [];
      if (savedWeights && typeof savedWeights === "object") state.ensembleWeights = savedWeights;
      renderRoster();
      renderEvidenceStatus();
      renderWeights();
      resetDraft();
      bindEvents();
      $("#cache-status").textContent = globalThis.indexedDB ? "IndexedDB enabled" : "localStorage fallback";
      status("Bootstrap loaded. All analytical paths are local.", "good");
      const requested = location.hash.replace("#", "");
      if ($(`[data-panel="${CSS.escape(requested)}"]`)) activatePanel(requested);
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    } catch (error) {
      $("#bootstrap-status").textContent = "Load failed";
      status(`Startup failed: ${error.message}`, "error");
      console.error(error);
    }
  }

  initialize();
})();

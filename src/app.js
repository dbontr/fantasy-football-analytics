(function startOracleApp() {
  "use strict";

  const core = window.FantasyOracleCore;
  const engine = window.OracleBrowserEngine;
  const rookieModel = window.OracleRookies;
  const evidenceApi = window.OracleEvidence;
  const sources = window.OracleSources;
  const espnFantasy = window.OracleEspnFantasy;
  const context = window.OracleContext;
  const intelligence = window.OraclePlayerIntelligence;
  const liveIntelligence = window.OracleLiveIntelligence;
  const draftSim = window.OracleDraftSim;
  const store = window.OracleStore;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const num = (value, digits = 1) => Number(value || 0).toFixed(digits);
  const pct = (value, digits = 0) => `${(Number(value || 0) * 100).toFixed(digits)}%`;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value || 0)));

  const state = {
    dataset: null,
    analyticsProfile: null,
    players: [],
    playerIndex: new Map(),
    schedule: {},
    coaches: null,
    healthCalibration: null,
    rookieArtifact: null,
    rookieIndex: null,
    contextByWeek: new Map(),
    intelligenceHistory: new Map(),
    decisionHistorySeason: 2025,
    defenseProfiles: null,
    preseasonRows: [],
    preseasonByPlayer: new Map(),
    campArtifact: null,
    campIndex: new Map(),
    newsPulse: [],
    trendingAdds: new Map(),
    trendingDrops: new Map(),
    marketByWeek: new Map(),
    draftBoard: null,
    draftRenderToken: 0,
    ledger: new evidenceApi.EvidenceLedger(),
    rosterIds: [],
    draftState: null,
    leagueTeams: null,
    leagueMeta: null,
    espnLeague: null,
    espnConnection: null,
    espnNeedsSession: false,
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
    node.className = `status-line app-status ${kind}`.trim();
  }

  function reindexPlayers() {
    state.playerIndex = new Map(state.players.map((player) => [String(player.id), player]));
  }

  function playerById(id) {
    return state.playerIndex.get(String(id)) || null;
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

  function playerMatchesSearch(player, query) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return true;
    return `${player.name} ${player.position} ${player.team}`.toLowerCase().includes(needle);
  }

  function fillPlayerPicker(selector, query = "") {
    const node = $(selector);
    if (!node) return [];
    const previous = node.value;
    const rows = rankedPlayers().filter((player) => playerMatchesSearch(player, query)).slice(0, query ? 120 : 300);
    node.innerHTML = rows.map((player) => `<option value="${esc(player.id)}">${esc(player.name)} · ${esc(player.position)} ${esc(player.team)}</option>`).join("");
    if (rows.some((player) => String(player.id) === String(previous))) node.value = previous;
    return rows;
  }

  function fillPlayerSelects() {
    fillPlayerPicker("#player-select", $("#player-search")?.value || "");
    fillPlayerPicker("#roster-add", $("#roster-search")?.value || "");
  }

  function renderSources() {
    $("#source-catalog").innerHTML = sources.sourceCatalog().map((source) => `
      <div class="source-row"><div><strong>${esc(source.attribution)}</strong><span>${esc(source.license)}</span></div><b>FREE / KEYLESS</b></div>
    `).join("");
  }

  function activatePanel(name) {
    const activeTab = $$(".tab").find((tab) => tab.dataset.panelTarget === name) || null;
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab === activeTab));
    $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
    if (activeTab && window.matchMedia("(max-width: 780px)").matches) {
      const tabs = activeTab.parentElement;
      const left = activeTab.offsetLeft - Math.max(0, (tabs.clientWidth - activeTab.offsetWidth) / 2);
      tabs.scrollTo({ left, behavior: "smooth" });
    }
    status("");
    history.replaceState(null, "", `#${name}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function espnTeamById(teamId) {
    return state.espnLeague?.teams?.find((team) => String(team.teamId) === String(teamId)) || null;
  }

  function hydratedEspnTeams(league = state.espnLeague) {
    return (league?.teams || []).map((team) => ({
      ...team,
      roster: (team.rosterIds || []).map((id) => playerById(id)).filter(Boolean),
    }));
  }


  function connectedUserTeamId() {
    return state.espnConnection?.teamId ? String(state.espnConnection.teamId) : null;
  }

  function fantasyScheduleForLeague() {
    if (state.leagueMeta?.scheduleSource !== "espn") return state.leagueMeta?.fantasySchedule || null;
    return state.leagueMeta?.fantasySchedule || null;
  }

  function hasRealFantasySchedule() {
    return Boolean(fantasyScheduleForLeague() && Object.keys(fantasyScheduleForLeague()).length);
  }

  function leagueTeamForPlayer(playerId) {
    const id = String(playerId || "");
    if (!id) return null;
    return (state.leagueTeams || []).find((team) => (team.roster || []).some((player) => String(player.id) === id)) || null;
  }

  function leagueOpponentForWeek(week, teamId = connectedUserTeamId()) {
    const schedule = fantasyScheduleForLeague();
    if (!schedule || !teamId) return null;
    const pair = (schedule[week] || schedule[String(week)] || []).find((row) => row.map(String).includes(String(teamId)));
    if (!pair) return null;
    const opponentId = String(pair[0]) === String(teamId) ? String(pair[1]) : String(pair[0]);
    return (state.leagueTeams || []).find((team) => String(team.teamId) === opponentId) || null;
  }

  function rosterStarterCoverage(roster) {
    const slots = core.expandedStarterSlots(core.DEFAULT_SETTINGS);
    if (!slots.length) return 1;
    const lineup = core.optimizeLineup(roster || [], core.DEFAULT_SETTINGS, "weeklyProjection");
    const filled = lineup.starters.filter((row) => row.player).length;
    return filled / slots.length;
  }

  function hasReliableLeagueRosterCoverage(teams = currentLeagueTeamsForDecisions()) {
    return Boolean(teams?.length > 1 && teams.every((team) => rosterStarterCoverage(team.roster || []) >= 0.88));
  }

  function currentLeagueTeamsForDecisions() {
    const userTeamId = connectedUserTeamId();
    const currentRoster = rosterPlayers();
    return (state.leagueTeams || []).map((team) => ({
      ...team,
      roster: String(team.teamId) === String(userTeamId)
        ? [...currentRoster]
        : refreshDecisionPlayers(team.roster || []),
    }));
  }

  function setDecisionWeek(week) {
    const selected = Math.max(1, Math.min(18, Number(week || 1)));
    ["#player-week", "#lineup-week", "#waiver-week", "#trade-week"].forEach((selector) => {
      if ($(selector)) $(selector).value = String(selected);
    });
  }

  function populateEspnTeams() {
    const select = $("#espn-team-select");
    if (!select || !state.espnLeague) return;
    const previous = state.espnConnection?.teamId || select.value;
    select.innerHTML = state.espnLeague.teams.map((team) => `<option value="${esc(team.teamId)}">${esc(team.name)}${team.ownerName ? ` · ${esc(team.ownerName)}` : ""} · ${esc(team.recordLabel)}</option>`).join("");
    if (state.espnLeague.teams.some((team) => String(team.teamId) === String(previous))) select.value = String(previous);
  }

  function renderEspnConnection() {
    const league = state.espnLeague;
    const team = espnTeamById(state.espnConnection?.teamId);
    const authNeeded = state.espnNeedsSession && !league;
    $("#overview").classList.toggle("league-connected", Boolean(team));
    $("#masthead-team").textContent = team ? team.name : league ? league.name : "League not connected";
    $("#masthead-week").textContent = team && league ? `${team.recordLabel} · Week ${league.currentWeek}` : league ? `${league.teams.length} teams · ${league.scoringLabel}` : "2026 season";
    $("#rail-context-kicker").textContent = team && league ? `WEEK ${league.currentWeek}` : league ? "LEAGUE LOADED" : "NOT CONNECTED";
    $("#rail-context-team").textContent = team ? team.name : league ? league.name : "Connect ESPN Fantasy";
    $("#rail-context-week").textContent = team && league ? `${team.recordLabel} · ${league.name}` : league ? `${league.teams.length} teams · choose your team` : "Manual tools are available anytime.";
    $("#hero-lede").textContent = team
      ? `${team.name} is synced. Start with your lineup, the waiver wire, a trade, or your season outlook.`
      : "Connect ESPN or jump into a tool. SnapCount turns projections, injuries, matchups, news, and simulations into the next move for your team.";
    $("#espn-connect-empty").classList.toggle("hidden", Boolean(league) || authNeeded);
    $("#espn-team-step").classList.toggle("hidden", !league || Boolean(team));
    $("#espn-auth-step").classList.toggle("hidden", !authNeeded);
    $("#espn-connected").classList.toggle("hidden", !team);
    $("#league-command-strip").classList.toggle("hidden", !team);
    $("#season-connection-summary").classList.toggle("hidden", !team);
    $("#espn-connection-state").textContent = team ? "Connected" : league ? "Choose your team" : authNeeded ? "Sign-in needed" : "Not connected";
    $("#espn-connection-state").classList.toggle("connected", Boolean(team));
    if (!league) return;
    populateEspnTeams();
    $("#espn-league-found").textContent = `${league.name} · ${league.teams.length} teams · ${league.scoringLabel}`;
    if (!team) return;
    const rosterNote = `${team.rosterIds.length} players recognized${team.unmatchedPlayers.length ? ` · ${team.unmatchedPlayers.length} unmatched` : ""}`;
    $("#espn-connected-team").textContent = team.name;
    $("#espn-connected-meta").textContent = `${league.name} · ${team.recordLabel} · ${rosterNote}`;
    $("#home-league-label").textContent = league.name;
    $("#home-team-name").textContent = team.name;
    $("#home-team-record").textContent = `${team.recordLabel} · Week ${league.currentWeek} · ${rosterNote}`;
    $("#season-connected-team").textContent = team.name;
    $("#season-connected-league").textContent = `${league.name} · ${team.recordLabel} · Week ${league.currentWeek}`;
  }

  async function applyEspnTeam(teamId, persist = true) {
    const team = espnTeamById(teamId);
    if (!team || !state.espnLeague) throw new Error("Choose a valid ESPN team");
    state.espnConnection = {
      provider: "espn",
      leagueId: state.espnLeague.leagueId,
      season: state.espnLeague.season,
      teamId: String(team.teamId),
      authMode: state.espnConnection?.authMode || "anonymous",
      lastSync: state.espnLeague.syncedAt,
    };
    state.rosterIds = (team.rosterIds || []).map(String).filter((id) => playerById(id));
    state.leagueTeams = hydratedEspnTeams();
    state.leagueMeta = {
      playoffTeams: state.espnLeague.playoffTeams || Math.min(6, state.leagueTeams.length),
      playoffByes: (state.espnLeague.playoffTeams || 6) === 6 ? 2 : 0,
      regularSeasonEnd: state.espnLeague.regularSeasonEnd || 14,
      championshipWeek: state.espnLeague.championshipWeek || 17,
      fantasySchedule: state.espnLeague.fantasySchedule || null,
      scheduleSource: Object.keys(state.espnLeague.fantasySchedule || {}).length ? "espn" : "fallback",
    };
    setDecisionWeek(state.espnLeague.currentWeek);
    if ($("#regular-season-end")) $("#regular-season-end").value = String(state.leagueMeta.regularSeasonEnd);
    if ($("#championship-week")) $("#championship-week").value = String(state.leagueMeta.championshipWeek);
    if (persist) await Promise.all([
      store.set("roster-ids", state.rosterIds),
      store.set("espn-connection", state.espnConnection),
      store.set("espn-snapshot", state.espnLeague),
    ]);
    renderRoster();
    renderEspnConnection();
    $("#league-source-status").textContent = `${state.espnLeague.name} · ${team.name} loaded from ESPN.`;
    return team;
  }

  async function connectEspnLeague(options = {}) {
    const button = options.browserSession ? $("#connect-espn-session") : $("#connect-espn");
    const input = options.input || $("#espn-league-input").value;
    const season = Number(options.season || $("#espn-season").value || 2026);
    const preferredTeamId = options.teamId || null;
    const browserSession = options.browserSession === true;
    if (!input) return status("Paste an ESPN league link or league ID first.", "error");
    if (button) button.disabled = true;
    status(browserSession ? "Asking ESPN to use your existing browser sign-in…" : "Connecting to ESPN Fantasy…");
    try {
      const loaded = await espnFantasy.loadLeague(input, season, { browserSession });
      state.espnNeedsSession = false;
      state.espnLeague = espnFantasy.normalizeLeague(loaded.raw, state.players);
      state.espnConnection = { provider: "espn", leagueId: loaded.leagueId, season: loaded.season, teamId: null, authMode: loaded.browserSession ? "browser-session" : "anonymous", lastSync: state.espnLeague.syncedAt };
      $("#espn-league-input").value = loaded.leagueId;
      $("#espn-season").value = String(loaded.season);
      await Promise.all([store.set("espn-connection", state.espnConnection), store.set("espn-snapshot", state.espnLeague)]);
      if (preferredTeamId && espnTeamById(preferredTeamId)) {
        const team = await applyEspnTeam(preferredTeamId);
        status(`ESPN refreshed. ${team.name} is ready.`, "good");
      } else {
        renderEspnConnection();
        status(`${state.espnLeague.name} found. Choose your team.`, "good");
      }
    } catch (error) {
      if (error.code === "ESPN_AUTH_REQUIRED" || error.code === "ESPN_SESSION_FAILED") {
        state.espnNeedsSession = true;
        state.espnLeague = null;
        renderEspnConnection();
      }
      status(error.message, "error");
      throw error;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function refreshEspnLeague() {
    if (!state.espnConnection?.leagueId) return status("Connect an ESPN league first.", "error");
    const button = $("#refresh-espn");
    button.disabled = true;
    try {
      await connectEspnLeague({ input: state.espnConnection.leagueId, season: state.espnConnection.season, teamId: state.espnConnection.teamId, browserSession: state.espnConnection.authMode === "browser-session" });
    } catch (_) { /* connectEspnLeague already surfaced the error */ }
    finally { button.disabled = false; }
  }

  async function disconnectEspnLeague() {
    state.espnLeague = null;
    state.espnConnection = null;
    state.espnNeedsSession = false;
    state.leagueTeams = null;
    state.leagueMeta = null;
    await Promise.all([store.remove("espn-connection"), store.remove("espn-snapshot")]);
    renderEspnConnection();
    $("#league-source-status").textContent = "No league loaded.";
    status("ESPN league disconnected. Your current roster is still saved locally.", "good");
  }

  function savedEvidence(player, week = 1) {
    if (!state.contextByWeek.has(week)) state.contextByWeek.set(week, context.buildTeamContext(state.players, state.schedule, week));
    return context.mergeEvidence(
      context.coachingEvidence(player, state.coaches?.teams?.[player.team]),
      context.healthEvidence(player, state.healthCalibration),
      context.baselineRoleEvidence(player),
      context.absenceRedistributionEvidence(player, state.players),
      context.quarterbackContextEvidence(player, state.players, week),
      context.matchupEvidence(player, state.contextByWeek.get(week)),
      state.ledger.evidenceFor("player", String(player.id)),
    );
  }

  function historyEvidenceFor(player, season = state.decisionHistorySeason) {
    return state.intelligenceHistory.get(historyKey(player, season))?.evidence || {};
  }

  function scheduledOpponent(player, week = 1) {
    return state.schedule?.[String(player?.team || "")]?.weeks?.[Math.max(0, Number(week || 1) - 1)]?.opponent || null;
  }

  function priorDefenseEvidence(player, week = 1) {
    return intelligence.defenseMatchupEvidence(state.defenseProfiles, player, scheduledOpponent(player, week));
  }

  function rookieEvidenceFor(player, week = 1) {
    return rookieModel?.evidence?.(player, { week }) || {};
  }

  function preseasonEvidenceFor(player) {
    const summary = state.preseasonByPlayer.get(String(player?.id));
    return summary ? liveIntelligence.preseasonEvidence(summary, player) : {};
  }

  function campSignalFor(player) {
    const committed = state.campIndex.get(String(player?.id || "")) || null;
    if (committed) return committed;
    return liveIntelligence.summarizeCampPulse(state.newsPulse, player);
  }

  function campEvidenceFor(player) {
    return liveIntelligence.campEvidence(campSignalFor(player));
  }

  function trendEvidenceFor(player) {
    const id = String(player?.sleeperId || "");
    const adds = id ? Number(state.trendingAdds.get(id) || 0) : 0;
    const drops = id ? Number(state.trendingDrops.get(id) || 0) : 0;
    const net = adds - drops;
    if (Math.abs(net) < 150) return {};
    return { "news.role_delta": { available: true, value: clamp(net / 12000, -0.08, 0.08), confidence: 0.18, conflict: 0.22, source: "Sleeper 24h add/drop momentum", adds, drops } };
  }

  function marketEvidenceFor(player, week = 1) {
    const row = state.marketByWeek.get(Number(week))?.[String(player?.team || "").toUpperCase()] || null;
    return liveIntelligence.marketEvidence(row);
  }

  async function ensureMarketWeek(week) {
    const selected = Math.max(1, Math.min(18, Number(week || 1)));
    if (state.marketByWeek.has(selected)) return { available: Object.keys(state.marketByWeek.get(selected) || {}).length > 0, cached: true };
    try {
      const result = await runWorker("market-week", { options: { season: Number(state.dataset?.meta?.season || 2026), week: selected } });
      state.marketByWeek.set(selected, result.byTeam || {});
      return { available: Object.keys(result.byTeam || {}).length > 0, cached: false };
    } catch (error) {
      state.marketByWeek.set(selected, {});
      return { available: false, error };
    }
  }

  function decisionEvidence(player, week = 1) {
    const base = { ...savedEvidence(player, week) };
    const priorMatchup = priorDefenseEvidence(player, week);
    if (Object.keys(priorMatchup).length) { delete base["matchup.pass_grade"]; delete base["matchup.rush_grade"]; }
    return context.mergeEvidence(base, historyEvidenceFor(player), priorMatchup, marketEvidenceFor(player, week), rookieEvidenceFor(player, week), preseasonEvidenceFor(player), campEvidenceFor(player), trendEvidenceFor(player));
  }

  function staticDecisionEvidence(player) {
    return context.mergeEvidence(
      historyEvidenceFor(player),
      context.coachingEvidence(player, state.coaches?.teams?.[player.team]),
      context.healthEvidence(player, state.healthCalibration),
      context.baselineRoleEvidence(player),
      context.absenceRedistributionEvidence(player, state.players),
      context.quarterbackContextEvidence(player, state.players, 1),
      rookieEvidenceFor(player, 1),
      preseasonEvidenceFor(player),
      campEvidenceFor(player),
      trendEvidenceFor(player),
      state.ledger.evidenceFor("player", String(player.id)),
    );
  }

  function servingPolicy(surface) {
    return state.analyticsProfile?.[surface] || {};
  }
  function servingMeanScale(surface) {
    const value = Number(servingPolicy(surface).validatedMeanScale);
    return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
  }
  function draftPolicyForSettings(settings) {
    const profile = servingPolicy("draft");
    if (profile.policy !== "segmented-qualified" || !profile.segments) return profile.fallbackPolicy || null;
    if (!(profile.supportedTeamCounts || []).includes(Number(settings.teams))) return profile.fallbackPolicy || null;
    const anchors = [
      { bucket: "early", pick: 1 },
      { bucket: "middle", pick: Math.ceil(settings.teams / 2) },
      { bucket: "late", pick: settings.teams },
    ];
    anchors.sort((left, right) => Math.abs(left.pick - settings.draftPosition) - Math.abs(right.pick - settings.draftPosition));
    return profile.segments[`${settings.teams}-${anchors[0].bucket}`] || profile.fallbackPolicy || null;
  }

  function baselineWeekProjection(player, week) {
    const value = Number(player?.weeklyProjections?.[Math.max(0, week - 1)]);
    if (Number.isFinite(value)) return value;
    return Number(player?.weeklyProjection || 0);
  }

  function decisionPlayerForWeek(player, week, surface = "startSit") {
    const forecast = engine.forecastPlayer(player, { week, evidence: decisionEvidence(player, week), validatedMeanScale: servingMeanScale(surface) });
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

  function emptyHistoryWindow() {
    return { games: 0, ppr: null, opportunities: null, touches: null, targets: null, carries: null, receptions: null, scrimmageYards: null, passingYards: null, touchdowns: null, targetShare: null, carryShare: null, volatility: 0 };
  }
  function rookieHistoryResult(player, season) {
    const window = emptyHistoryWindow();
    return {
      version: rookieModel?.VERSION || "rookie-model",
      season,
      source: { name: "Rookie cohort model", bytes: 0, rowCount: state.rookieArtifact?.meta?.historicalRookieCount || 0 },
      summary: { games: 0, last3: { ...window }, last5: { ...window }, season: { ...window }, trend: { available: false, direction: "stable", delta: 0 }, consistency: 0 },
      xfpSummary: { games: 0, last3: {}, last5: {}, season: {} },
      evidence: {}, gameLog: [], rookie: true,
    };
  }

  async function ensureDecisionIntelligence(players, season = state.decisionHistorySeason) {
    const unique = [...new Map((players || []).filter((player) => player?.id).map((player) => [String(player.id), player])).values()];
    const rookieRows = unique.filter((player) => player?.rookie);
    for (const player of rookieRows) {
      if (!state.intelligenceHistory.has(historyKey(player, season))) state.intelligenceHistory.set(historyKey(player, season), rookieHistoryResult(player, season));
    }
    const missing = unique.filter((player) => !player?.rookie && !state.intelligenceHistory.has(historyKey(player, season)));
    if (!missing.length) return { loaded: 0, total: unique.length, rookiesSkipped: rookieRows.length, cached: true };
    try {
      const result = await runWorker("player-history-batch", { players: missing, season, targetSeason: Number(state.dataset?.meta?.season || 2026) });
      state.defenseProfiles = result.defenseProfiles || state.defenseProfiles;
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
      reindexPlayers();
      fillPlayerSelects();
      if (selectedPlayerId && playerById(selectedPlayerId)) $("#player-select").value = selectedPlayerId;
    }
    return { synced, failed, cached: false };
  }

  async function prepareDecisionContext(players, week = null) {
    const live = await ensureLiveDecisionStatus(players);
    const refreshed = refreshDecisionPlayers(players);
    const [history, market] = await Promise.all([ensureDecisionIntelligence(refreshed), week ? ensureMarketWeek(week) : Promise.resolve(null)]);
    return { players: refreshed, live, history, market };
  }


  async function prepareLeagueWinContext(startWeek, endWeek, surface) {
    let teams = currentLeagueTeamsForDecisions();
    if (!teams.length) return null;
    let leaguePlayers = [...new Map(teams.flatMap((team) => team.roster || []).map((player) => [String(player.id), player])).values()];
    await ensureLiveDecisionStatus(leaguePlayers);
    await ensureDecisionIntelligence(refreshDecisionPlayers(leaguePlayers));
    teams = teams.map((team) => ({ ...team, roster: refreshDecisionPlayers(team.roster || []) }));
    leaguePlayers = [...new Map(teams.flatMap((team) => team.roster || []).map((player) => [String(player.id), player])).values()];
    const evidenceByPlayer = Object.fromEntries(leaguePlayers.map((player) => [String(player.id), staticDecisionEvidence(player)]));
    const evidenceByPlayerWeek = {};
    for (let week = startWeek; week <= endWeek; week += 1) {
      const rows = leaguePlayers.map((player) => {
        const evidence = context.mergeEvidence(
          priorDefenseEvidence(player, week),
          marketEvidenceFor(player, week),
          rookieEvidenceFor(player, week),
        );
        return [String(player.id), evidence];
      }).filter(([, evidence]) => Object.keys(evidence).length);
      if (rows.length) evidenceByPlayerWeek[week] = Object.fromEntries(rows);
    }
    return {
      teams,
      evidenceByPlayer,
      evidenceByPlayerWeek,
      validatedMeanScale: servingMeanScale(surface),
    };
  }

  function futureWinRegularSeasonEnd(startWeek = 1) {
    return Math.max(startWeek, Number(state.leagueMeta?.regularSeasonEnd || $("#regular-season-end")?.value || 14));
  }


  async function runFutureWinActions(actions, surface, startWeek, simulations = 1600, seed = "future-win", leagueSimulations = 0) {
    if (!hasRealFantasySchedule() || !connectedUserTeamId() || !state.leagueTeams?.length) return null;
    const endWeek = futureWinRegularSeasonEnd(startWeek);
    const prepared = await prepareLeagueWinContext(startWeek, endWeek, surface);
    if (!prepared || !hasReliableLeagueRosterCoverage(prepared.teams)) return null;
    return runWorker("future-win-actions", { options: {
      teams: prepared.teams,
      userTeamId: connectedUserTeamId(),
      actions,
      settings: core.DEFAULT_SETTINGS,
      schedule: state.schedule,
      fantasySchedule: fantasyScheduleForLeague(),
      startWeek,
      regularSeasonEnd: endWeek,
      evidenceByPlayer: prepared.evidenceByPlayer,
      evidenceByPlayerWeek: prepared.evidenceByPlayerWeek,
      validatedMeanScale: prepared.validatedMeanScale,
      simulations,
      leagueSimulations,
      championshipWeek: Number(state.leagueMeta?.championshipWeek || 17),
      playoffTeams: state.leagueMeta?.playoffTeams || Math.min(6, prepared.teams.length),
      playoffByes: state.leagueMeta?.playoffByes || 0,
      seed,
    } });
  }

  function decisionContextLabel(contextState) {
    if (contextState?.live?.failed?.length || contextState?.history?.error) return "Some live updates were unavailable — SnapCount used its saved model instead";
    return "Updated with the latest available player context";
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

  function friendlyDriverLabel(label) {
    const value = String(label || "").toLowerCase();
    if (value.includes("historical opportunity")) return "Past usage and opportunity";
    if (value.includes("role trend")) return "Recent role trend";
    if (value.includes("target share")) return "Passing-game role";
    if (value.includes("carry share")) return "Rushing workload";
    if (value.includes("scoring environment") || value.includes("game total")) return "Expected game scoring";
    if (value.includes("matchup")) return "Matchup";
    if (value.includes("draft capital")) return "Draft investment";
    if (value.includes("rookie cohort")) return "Comparable rookies";
    if (value.includes("prospect")) return "Prospect profile";
    if (value.includes("athletic")) return "Athletic testing";
    return String(label || "Projection input");
  }

  function renderPlayerResult(forecast, simulationSummary) {
    const summary = simulationSummary || forecast.distribution;
    const drivers = forecast.drivers.length ? forecast.drivers : [{ label: "baseline projection", impact: 0 }];
    const availability = forecast.availability.probability;
    const bust = forecast.probabilities.bust;
    const risk = availability < 0.75 || bust > 0.4 ? "High" : availability < 0.92 || bust > 0.25 ? "Medium" : "Low";
    const verdict = forecast.edge.points >= 1.5 ? "Looking better than expected" : forecast.edge.points <= -1.5 ? "Looking shakier than expected" : "Right around expectations";
    $("#player-result").className = "result-space";
    $("#player-result").innerHTML = `
      <div class="friendly-verdict"><div><span class="pos-pill pos-${esc(String(forecast.player.position || '').toLowerCase())}">${esc(forecast.player.position)}</span>${forecast.player.rookie ? '<span class="rookie-pill">ROOKIE</span>' : ''}<h2>${esc(forecast.player.name)}</h2><p>${esc(forecast.player.team)} · Week ${forecast.week}</p></div><strong>${esc(verdict)}</strong></div>
      <div class="metric-grid friendly-metrics">
        <div class="metric"><span>PROJECTED POINTS</span><strong>${num(summary.mean)}</strong></div>
        <div class="metric"><span>LIKELY RANGE</span><strong>${num(summary.p25)}–${num(summary.p75)}</strong></div>
        <div class="metric"><span>UPSIDE</span><strong class="good">${num(summary.p90)}</strong></div>
        <div class="metric"><span>CHANCE TO PLAY</span><strong>${pct(availability)}</strong></div>
        <div class="metric"><span>RISK</span><strong class="${risk === "High" ? "warn" : ""}">${risk}</strong></div>
      </div>
      <div class="why-box"><h3>What is moving the call</h3>${drivers.slice(0, 5).map((driver) => `<div class="why-row"><span>${esc(friendlyDriverLabel(driver.label))}</span><b class="${driver.impact >= 0 ? "positive" : "negative"}">${driver.impact >= 0 ? "helps" : "hurts"} ${Math.abs(driver.impact) >= 1 ? "a lot" : "a little"}</b></div>`).join("")}</div>
      <details class="advanced-details result-details"><summary>See advanced projection details</summary>${rangeMarkup(summary)}<p class="fineprint">Median ${num(summary.p50)} · boom chance ${pct(forecast.probabilities.boom)} · bust chance ${pct(bust)}.</p></details>
    `;
  }

  async function runPlayerLab() {
    const player = playerById($("#player-select").value);
    if (!player) return;
    const week = Number($("#player-week").value || 1);
    await ensureMarketWeek(week);
    const forecast = engine.forecastPlayer(player, { week, evidence: temporaryEvidence(player) });
    $("#run-player").disabled = true;
    status("Checking this player…");
    try {
      const simulation = await runWorker("scenario", { forecasts: [forecast], options: { week, scenarios: Number($("#player-scenarios").value), schedule: state.schedule, seed: `player-${player.id}-${week}` } });
      renderPlayerResult(forecast, simulation.playerSummaries[String(player.id)]);
      status("Player check ready.", "good");
    } catch (error) {
      status(error.message, "error");
    } finally {
      $("#run-player").disabled = false;
    }
  }

  function rookieProfileMarkup(player) {
    const summary = rookieModel?.summary?.(player);
    if (!summary) return "";
    const athletic = Number.isFinite(summary.athleticPercentile) ? pct(summary.athleticPercentile, 0) : "—";
    const hit = Number.isFinite(summary.hitRate) ? pct(summary.hitRate, 0) : "—";
    const depth = summary.depthChartOrder ? `#${summary.depthChartOrder}` : "—";
    return `<section class="rookie-profile"><p class="control-title">ROOKIE SNAPSHOT</p><div class="metric-grid compact-metrics"><div class="metric"><span>DRAFTED</span><strong>${esc(summary.draftLabel)}</strong></div><div class="metric"><span>AGE</span><strong>${summary.age ?? "—"}</strong></div><div class="metric"><span>TYPICAL ROOKIE OUTPUT</span><strong>${summary.cohortP50 == null ? "—" : num(summary.cohortP50)}</strong></div><div class="metric"><span>HIGH-END ROOKIE UPSIDE</span><strong>${summary.cohortP90 == null ? "—" : num(summary.cohortP90)}</strong></div><div class="metric"><span>PAST HIT RATE</span><strong>${hit}</strong></div><div class="metric"><span>ATHLETIC RANK</span><strong>${athletic}</strong></div><div class="metric"><span>DEPTH CHART</span><strong>${depth}</strong></div></div><p class="fineprint">${esc(summary.college || "College unavailable")} · Rookie history helps set expectations, but current role and projection still matter more.</p></section>`;
  }

  function campLabel(signal) {
    if (!signal?.available) return "No strong camp signal";
    if (signal.direction === "up") return "Camp trending up";
    if (signal.direction === "down") return "Camp warning";
    if (signal.direction === "mixed") return "Mixed camp reports";
    return "Camp neutral";
  }
  function campClass(signal) {
    return signal?.direction === "up" ? "camp-up" : signal?.direction === "down" ? "camp-down" : signal?.direction === "mixed" ? "camp-mixed" : "camp-neutral";
  }
  function campMarkup(player, preseason = null) {
    const signal = campSignalFor(player);
    const share = Number.isFinite(Number(preseason?.positionOpportunityShare)) ? pct(preseason.positionOpportunityShare, 0) : null;
    const liveAdp = Number.isFinite(Number(player?.market?.averageDraftPosition)) ? Number(player.market.averageDraftPosition) : null;
    const adpChange = Number.isFinite(Number(player?.market?.averageDraftPositionPercentChange)) ? Number(player.market.averageDraftPositionPercentChange) : null;
    if (!signal?.available && !preseason && liveAdp === null) return "";
    const evidence = signal?.evidenceKeys?.map((key) => key.replace("role.", "").replace("performance.", "").replace("availability.", "").replaceAll("_", " ")).join(" · ") || "no classified report";
    return `<section class="camp-read"><div><p class="control-title">CAMP + PRESEASON READ</p><h3 class="${campClass(signal)}">${esc(campLabel(signal))}</h3><p>${signal?.available ? `${pct(signal.confidence, 0)} evidence confidence · ${esc(evidence)}` : "No strong classified camp report yet."}</p></div><div class="camp-facts">${preseason ? `<span><b>${num(preseason.opportunitiesPerGame)}</b> preseason opportunities/game</span>` : ""}${share ? `<span><b>${share}</b> of tracked team-position preseason opportunity</span>` : ""}${signal?.reportedFirstTeamSnaps ? `<span><b>${signal.reportedFirstTeamSnaps}</b> reporter-counted first-team snaps</span>` : ""}${liveAdp !== null ? `<span><b>${num(liveAdp)}</b> live ESPN ADP</span>` : ""}${adpChange !== null ? `<span><b>${adpChange > 0 ? "+" : ""}${num(adpChange, 2)}</b> ESPN-reported ADP change</span>` : ""}</div><small>Camp information is advisory. It is visible to you, but it cannot silently move the frozen projection mean or Draft policy until prospective validation shows a real edge.</small></section>`;
  }

  function renderPlayerIntelligence(player, result, forecast) {
    const summary = result.summary;
    const xfp = result.xfpSummary || { last3: {}, last5: {} };
    const preseason = state.preseasonByPlayer.get(String(player.id)) || null;
    const rookieProfile = rookieModel?.summary?.(player) || null;
    const outlook = intelligence.generateOutlook(player, forecast, summary);
    const health = outlook.health;
    const matchupPrior = priorDefenseEvidence(player, Number($("#player-week").value || 1))["matchup.position_grade"] || null;
    const healthParts = health.live ? [health.status, health.practice, health.bodyPart, health.notes].filter(Boolean) : [`Saved status: ${health.status}`];
    const games = [...result.gameLog].reverse().slice(0, 10);
    const directionClass = outlook.direction === "UP" ? "good" : outlook.direction === "DOWN" ? "warn" : "";
    const trendLabel = outlook.direction === "UP" ? "Looking better" : outlook.direction === "DOWN" ? "Trending down" : "Holding steady";
    const riskLabel = String(outlook.risk || "LOW").toLowerCase();
    const matchupLabel = !matchupPrior ? "Not loaded" : matchupPrior.value >= 0.35 ? "Good" : matchupPrior.value <= -0.35 ? "Tough" : "Average";
    const readText = rookieProfile
      ? "Rookie value is driven most by draft investment, current depth-chart role, preseason work, and how quickly the NFL role grows."
      : outlook.direction === "UP"
        ? "Recent usage and production are moving in the right direction."
        : outlook.direction === "DOWN"
          ? "Recent usage or production has slipped, so there is more downside than usual."
          : "Recent role and production have been fairly steady.";
    $("#intelligence-source").textContent = rookieProfile
      ? `${rookieProfile.draftLabel} · ${rookieProfile.college || "rookie"}`
      : `${result.season} recent-game data loaded`;
    $("#player-intelligence").className = "result-space";
    $("#player-intelligence").innerHTML = `
      <div class="intelligence-grid">
        <section class="outlook-card"><p class="control-title">OUR READ</p><h3 class="${directionClass}">${esc(trendLabel)} · ${esc(riskLabel)} risk</h3><p>SnapCount projects <strong>${num(forecast.distribution.mean)} points</strong> with a ${pct(forecast.availability.probability)} chance to play.</p><p>${esc(readText)}</p></section>
        ${rookieProfile ? `<section><p class="control-title">WHAT MATTERS MOST</p><div class="metric-grid compact-metrics"><div class="metric"><span>PROJECTION</span><strong>${num(forecast.distribution.mean)}</strong></div><div class="metric"><span>UPSIDE</span><strong>${num(forecast.distribution.p90)}</strong></div><div class="metric"><span>CHANCE TO PLAY</span><strong>${pct(forecast.availability.probability)}</strong></div><div class="metric"><span>ROLE CLARITY</span><strong>${pct(1 - forecast.uncertainty.role)}</strong></div>${preseason ? `<div class="metric"><span>PRESEASON WORK</span><strong>${num(preseason.opportunitiesPerGame)} / game</strong></div>` : ""}<div class="metric"><span>MATCHUP</span><strong>${esc(matchupLabel)}</strong></div></div><p class="fineprint">Current status: ${esc(healthParts.join(" · ") || "No structured limitation reported")}. Rookies naturally carry more uncertainty until their NFL role is proven.</p></section>` : `<section><p class="control-title">RECENT FORM</p><div class="metric-grid compact-metrics"><div class="metric"><span>LAST 3 FANTASY PTS</span><strong>${summary.last3.ppr === null ? "—" : num(summary.last3.ppr)}</strong></div><div class="metric"><span>OPPORTUNITIES / GAME</span><strong>${summary.last3.opportunities === null ? "—" : num(summary.last3.opportunities)}</strong></div><div class="metric"><span>TARGET SHARE</span><strong>${summary.last3.targetShare === null ? "—" : pct(summary.last3.targetShare, 1)}</strong></div>${["RB", "QB"].includes(player.position) ? `<div class="metric"><span>CARRY SHARE</span><strong>${summary.last3.carryShare === null ? "—" : pct(summary.last3.carryShare, 1)}</strong></div>` : ""}<div class="metric"><span>MATCHUP</span><strong>${esc(matchupLabel)}</strong></div><div class="metric"><span>CONSISTENCY</span><strong>${pct(summary.consistency, 0)}</strong></div></div><p class="fineprint">Current status: ${esc(healthParts.join(" · ") || "No structured limitation reported")}.${preseason ? ` Preseason usage is also included in the model.` : ""}</p></section>`}
      </div>
      ${campMarkup(player, preseason)}
      ${rookieProfileMarkup(player)}
      ${rookieProfile ? `<div class="rookie-history-note"><strong>No NFL game history yet.</strong><span>SnapCount uses draft position, comparable rookies, current depth chart, preseason work, and the market projection instead of pretending missing history is bad history.</span></div>` : `<details class="advanced-details game-log-details"><summary>Show game-by-game stats</summary><div class="table-wrap"><table><thead><tr><th>Week</th><th>Opp</th><th>Fantasy pts</th><th>Touches + targets</th><th>Targets</th><th>Carries</th><th>Receptions</th><th>Scrim yds</th><th>Pass yds</th><th>TD</th></tr></thead><tbody>${games.map((game) => `<tr><td>${game.week}</td><td>${esc(game.opponent)}</td><td><b>${num(game.fantasyPpr)}</b></td><td>${num(game.opportunities, 0)}</td><td>${num(game.targets, 0)}</td><td>${num(game.carries, 0)}</td><td>${num(game.receptions, 0)}</td><td>${num(game.scrimmageYards, 0)}</td><td>${num(game.passingYards, 0)}</td><td>${num(game.totalTds, 0)}</td></tr>`).join("")}</tbody></table></div></details>`}`;
  }

  function renderNewsPulse(player = playerById($("#player-select")?.value)) {
    const node = $("#news-pulse");
    if (!node) return;
    const relevant = state.newsPulse.filter((article) => !player || article.playerIds.includes(String(player.id)) || article.teams.includes(String(player.team || ""))).slice(0, 6);
    const rows = relevant.length ? relevant : state.newsPulse.slice(0, 6);
    node.innerHTML = rows.map((article) => {
      const camp = article.camp?.matches?.length ? `<em class="camp-pill ${article.camp.score > 0.17 ? "camp-up" : article.camp.score < -0.17 ? "camp-down" : "camp-mixed"}">CAMP ${article.camp.score > 0.17 ? "↑" : article.camp.score < -0.17 ? "↓" : "•"}</em>` : "";
      return `<article class="news-item"><span>${article.playerNames.length ? esc(article.playerNames.join(", ")) : esc(article.teams.join(", ") || "NFL")}${camp}</span><strong>${esc(article.headline)}</strong><small>${article.published ? new Date(article.published).toLocaleString() : "recent"}</small></article>`;
    }).join("");
  }

  async function syncLiveIntelligence() {
    const button = $("#sync-live-intelligence");
    button.disabled = true;
    $("#live-intelligence-status").textContent = "Syncing preseason + news…";
    try {
      const selected = playerById($("#player-select")?.value);
      if (selected && !state.sleeperLoaded && !state.sleeperPositions.has(selected.position)) {
        try { await syncSleeperPosition(selected.position); } catch (_) { /* news/preseason still work */ }
      }
      const playerRefs = state.players.map((player) => ({ id: String(player.id), name: player.name, team: player.team }));
      const [preseason, news] = await Promise.all([
        runWorker("preseason-sync", { options: { season: Number(state.dataset?.meta?.season || 2026), maxWeek: 5, maxGames: 20 } }),
        runWorker("news-pulse", { players: playerRefs }),
      ]);
      state.preseasonRows = preseason.rows || [];
      state.preseasonByPlayer = new Map();
      const rowIds = [...new Set(state.preseasonRows.map((row) => String(row.id)))];
      for (const id of rowIds) {
        const player = playerById(id);
        if (player) state.preseasonByPlayer.set(id, liveIntelligence.summarizePreseason(state.preseasonRows, player, state.players));
      }
      state.newsPulse = news.articles || [];
      state.trendingAdds = new Map((news.trendingAdds || []).map((row) => [String(row.player_id), Number(row.count || 0)]));
      state.trendingDrops = new Map((news.trendingDrops || []).map((row) => [String(row.player_id), Number(row.count || 0)]));
      renderNewsPulse();
      renderDraftBigBoard();
      const liveCampCount = state.players.filter((player) => campSignalFor(player)?.available).length;
      $("#live-intelligence-status").textContent = `${preseason.games || 0} preseason games · ${state.newsPulse.length} headlines · ${liveCampCount} camp reads`;
      status("News, preseason usage, camp signals, and player trends refreshed.", "good");
    } catch (error) {
      $("#live-intelligence-status").textContent = "Live intelligence unavailable";
      status(error.message, "error");
    } finally { button.disabled = false; }
  }

  async function loadPlayerIntelligence() {
    const selectedId = $("#player-select").value;
    let player = playerById(selectedId);
    if (!player) return;
    const season = Number($("#history-season").value || 2025);
    $("#load-intelligence").disabled = true;
    $("#intelligence-source").textContent = `Loading ${season} recent games…`;
    status("Loading recent games and player status…");
    try {
      if (!state.sleeperLoaded && !state.sleeperPositions.has(player.position)) {
        try { await syncSleeperPosition(player.position); } catch (_) { /* history remains usable if live status is unavailable */ }
      }
      player = playerById(selectedId) || player;
      const result = player.rookie
        ? rookieHistoryResult(player, season)
        : await runWorker("player-history", { player, season, targetSeason: Number(state.dataset?.meta?.season || 2026) });
      state.defenseProfiles = result.defenseProfiles || state.defenseProfiles;
      state.intelligenceHistory.set(historyKey(player, season), result);
      const week = Number($("#player-week").value || 1);
      await ensureMarketWeek(week);
      const forecast = engine.forecastPlayer(player, { week, evidence: temporaryEvidence(player) });
      renderPlayerIntelligence(player, result, forecast);
      status(player.rookie ? "Rookie outlook ready." : "Recent games and player outlook ready.", "good");
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
    const scoring = $("#draft-scoring").value || "ppr";
    const slots = scoring === "superflex" ? { SUPERFLEX: 1, BN: 6 } : { SUPERFLEX: 0, BN: 6 };
    return core.cloneSettings({
      teams: Number($("#draft-teams").value || 12),
      rounds: Number($("#draft-rounds").value || 16),
      draftPosition: Number($("#draft-position").value || 6),
      scoring,
      slots,
    });
  }

  function draftBoardPayload() {
    return state.draftBoard ? { byId: state.draftBoard.byId, byName: state.draftBoard.byName } : null;
  }

  function oracleDraftBoard(settings) {
    const room = draftSim.createRoomContext(state.players, settings, state.draftBoard);
    const rows = room.market.map((row) => ({
      ...row.player,
      marketRank: row.rank,
      oracleValue: row.asset + draftSim.rookieTailScore(row.player),
    })).sort((a, b) => b.oracleValue - a.oracleValue || a.marketRank - b.marketRank);
    const scoringPool = rows.slice(0, Math.min(220, rows.length));
    const best = scoringPool[0]?.oracleValue || 1;
    const floor = scoringPool.at(-1)?.oracleValue || 0;
    return rows.map((row, index) => ({
      ...row,
      oracleRank: index + 1,
      oracleScore: Math.round(clamp(50 + 50 * (row.oracleValue - floor) / Math.max(1e-6, best - floor), 1, 100)),
    }));
  }

  function renderDraftBigBoard() {
    const node = $("#draft-big-board");
    if (!node || !state.players.length) return;
    const position = $("#draft-board-position")?.value || "ALL";
    const rows = oracleDraftBoard(currentDraftSettings()).filter((row) => position === "ALL" || row.position === position).slice(0, 80);
    node.innerHTML = rows.map((row) => {
      const camp = campSignalFor(row);
      const campPill = camp?.available && ["up", "down", "mixed"].includes(camp.direction)
        ? `<em class="camp-pill ${campClass(camp)}" title="Advisory camp evidence; not included in the qualified Draft score">CAMP ${camp.direction === "up" ? "↑" : camp.direction === "down" ? "↓" : "•"}</em>` : "";
      return `<div class="big-board-row pos-${esc(String(row.position || '').toLowerCase())}"><span class="board-rank">${row.oracleRank}</span><div class="board-player"><strong>${esc(row.name)}${row.rookie ? ' <span class="rookie-pill compact">R</span>' : ''} ${campPill}</strong><small><span class="board-pos">${esc(row.position)}</span> · ${esc(row.team)}${Number.isFinite(row.marketRank) ? ` · usually drafted #${Math.round(row.marketRank)}` : ""}${Number.isFinite(Number(row.market?.averageDraftPosition)) ? ` · live ESPN ADP ${num(row.market.averageDraftPosition)}` : ""}</small></div><div class="board-score"><span>SNAP SCORE</span><strong>${row.oracleScore}</strong></div></div>`;
    }).join("");
  }

  function resetDraft() {
    const settings = currentDraftSettings();
    $("#draft-position").max = String(settings.teams);
    if (settings.draftPosition > settings.teams) $("#draft-position").value = String(settings.teams);
    state.draftState = core.createDraftState(settings);
    renderDraft();
  }

  function draftUserRoster(settings) {
    const ids = state.draftState?.rosters?.[String(settings.draftPosition)] || [];
    return ids.map((id) => playerById(id)).filter(Boolean);
  }
  function renderDraftTable(recommendations, summary, settings) {
    const mode = $("#draft-mode").value;
    $("#draft-table").innerHTML = recommendations.map((row, index) => {
      const canRecord = mode === "live" || summary.isUserPick;
      const camp = campSignalFor(row);
      const campPill = camp?.available && ["up", "down", "mixed"].includes(camp.direction)
        ? `<em class="camp-pill ${campClass(camp)}" title="Advisory only; does not change the qualified Draft ranking">CAMP ${camp.direction === "up" ? "↑" : camp.direction === "down" ? "↓" : "•"}</em>` : "";
      const take = row.returnChance <= 0.22 ? "Take him now — he probably won't make it back" : row.rookieTailScore >= 1.5 ? "High-upside rookie worth considering" : row.vona >= 8 ? "Strong value at this pick" : row.need > 0 ? `Fills a ${row.position} need` : (row.reasons?.[0] || "Good value for your roster");
      return `<tr><td class="board-rank-cell">${index + 1}</td><td class="player-cell"><strong>${esc(row.name)}${row.rookie ? ' <span class="rookie-pill compact">R</span>' : ''} ${campPill}</strong><span>${esc(row.position)} · ${esc(row.team)}</span></td><td class="draft-take">${esc(take)}</td><td><strong>${pct(row.returnChance)}</strong></td><td><button class="mini-button pick-button" data-draft-player="${esc(row.id)}" ${canRecord ? "" : "disabled"}>${mode === "live" ? "Record pick" : "Draft him"}</button></td></tr>`;
    }).join("");
    $$('[data-draft-player]').forEach((button) => button.addEventListener("click", () => {
      state.draftState = core.applyDraftPick(state.draftState, button.dataset.draftPlayer, settings);
      renderDraft();
    }));
  }

  function renderDraftPanels(settings) {
    const roster = draftUserRoster(settings);
    $("#draft-roster").className = "module result-space";
    $("#draft-roster").innerHTML = `<div class="table-header"><h3>Your roster</h3><span>${roster.length}/${settings.rounds}</span></div><div class="roster-strip">${roster.map((player) => `<div class="roster-chip"><span>${esc(player.position)}</span>${esc(player.name)}${player.rookie ? '<b class="rookie-chip">R</b>' : ''}</div>`).join("") || "<span class='fineprint'>No picks yet.</span>"}</div>`;
    const recent = [...(state.draftState?.picks || [])].slice(-18).reverse();
    $("#draft-history").className = "module result-space";
    $("#draft-history").innerHTML = `<div class="table-header"><h3>Recent picks</h3><span>${state.draftState?.picks?.length || 0} total</span></div><div class="pick-history">${recent.map((pick) => { const player = playerById(pick.playerId); return `<div class="lineup-row"><span>${pick.pick}</span><strong>T${pick.teamId} · ${player ? esc(player.name) : esc(pick.playerId)}</strong><b>${player ? esc(player.position) : ""}</b></div>`; }).join("") || "<p class='fineprint'>No picks yet.</p>"}</div>`;
  }
  function renderDraftManualOptions(settings = currentDraftSettings()) {
    const drafted = new Set((state.draftState?.picks || []).map((pick) => String(pick.playerId)));
    const query = $("#draft-pick-search")?.value || "";
    const available = state.players.filter((player) => !drafted.has(String(player.id)) && playerMatchesSearch(player, query))
      .sort((a, b) => draftSim.boardRank(a, settings, state.draftBoard) - draftSim.boardRank(b, settings, state.draftBoard));
    $("#draft-manual-player").innerHTML = available.slice(0, query ? 120 : 260).map((player) => `<option value="${esc(player.id)}">${esc(player.name)} · ${esc(player.position)} ${esc(player.team)} · usually drafted #${Math.round(draftSim.boardRank(player, settings, state.draftBoard))}</option>`).join("");
  }

  async function renderDraft() {
    const settings = currentDraftSettings();
    renderDraftBigBoard();
    if (!state.draftState) state.draftState = core.createDraftState(settings);
    const summary = core.draftPickSummary(state.draftState, settings);
    renderDraftManualOptions(settings);
    $("#draft-next").textContent = summary.remaining > 0 ? `P${summary.pickNumber} / T${summary.teamId}` : "COMPLETE";
    $("#draft-meta").textContent = `${state.draftState.picks.length} picks · ${summary.isUserPick ? "YOUR PICK" : `team ${summary.teamId}`}`;
    const initial = draftSim.qualifyRecommendations(
      core.advancedDraftRecommendations(state.players, state.draftState, settings, settings.draftPosition, 36),
      state.players, state.draftState, settings, settings.draftPosition, state.draftBoard, draftPolicyForSettings(settings), 18,
    );
    renderDraftTable(initial, summary, settings);
    renderDraftPanels(settings);
    const token = ++state.draftRenderToken;
    if (summary.remaining > 0) {
      try {
        const simulation = await runWorker("draft-room-window", { options: { players: state.players, state: state.draftState, settings, targetTeamId: settings.draftPosition, strategy: $("#draft-opponent-strategy").value || "mixed", board: draftBoardPayload(), simulations: 500, seed: `draft-window-${state.draftState.picks.length}` } });
        if (token !== state.draftRenderToken) return;
        const refined = draftSim.qualifyRecommendations(
          core.advancedDraftRecommendations(state.players, state.draftState, settings, settings.draftPosition, 36, simulation),
          state.players, state.draftState, settings, settings.draftPosition, state.draftBoard, draftPolicyForSettings(settings), 18,
        );
        renderDraftTable(refined, summary, settings);
      } catch (_) { /* analytical fallback is already rendered */ }
    }
  }

  async function advanceDraftToUser() {
    if ($("#draft-mode").value === "live") return status("Live Helper does not invent opponent picks. Record the actual picks instead.", "error");
    const settings = currentDraftSettings();
    const result = await runWorker("draft-room-advance", { options: { players: state.players, state: state.draftState, settings, userTeamId: settings.draftPosition, strategy: $("#draft-opponent-strategy").value || "mixed", board: draftBoardPayload(), seed: "oracle-room-2026" } });
    state.draftState = result.state;
    renderDraft();
    status(`Simulated ${result.cpuPicks} realistic room pick${result.cpuPicks === 1 ? "" : "s"}.`, "good");
  }
  function recordNextDraftPick() {
    const id = $("#draft-manual-player").value;
    if (!id) return;
    state.draftState = core.applyDraftPick(state.draftState, id, currentDraftSettings());
    $("#draft-pick-search").value = "";
    renderDraft();
  }

  function undoDraftPick() {
    state.draftState = core.undoDraftPick(state.draftState, currentDraftSettings());
    renderDraft();
  }

  async function importDraftBoard() {
    const parsed = draftSim.parseRankingBoard($("#draft-custom-board").value);
    if (!parsed.rows.length) return status("Paste a rank,name board before importing.", "error");
    state.draftBoard = parsed;
    await store.set("draft-custom-board", $("#draft-custom-board").value);
    $("#draft-board-status").textContent = `${parsed.rows.length} custom ranks active.`;
    renderDraft();
    status("Custom market board loaded. CPU opponents and return probabilities now use it.", "good");
  }

  async function clearDraftBoard() {
    state.draftBoard = null;
    $("#draft-custom-board").value = "";
    await store.remove("draft-custom-board");
    $("#draft-board-status").textContent = "Built-in ESPN-derived ADP/rank market is active.";
    renderDraft();
  }

  async function runDraftBenchmark() {
    const button = $("#draft-benchmark");
    button.disabled = true;
    $("#draft-benchmark-result").className = "result-space";
    $("#draft-benchmark-result").innerHTML = "<p>Running paired draft rooms in the worker…</p>";
    try {
      const settings = currentDraftSettings();
      const result = await runWorker("draft-benchmark", { options: { players: state.players, settings, userTeamId: settings.draftPosition, opponentStrategy: $("#draft-opponent-strategy").value || "mixed", baselineStrategy: $("#draft-baseline-strategy").value || "espn-market", board: draftBoardPayload(), simulations: Number($("#draft-benchmark-count").value || 100), seed: "draft-benchmark-2026" } });
      $("#draft-benchmark-result").innerHTML = `<div class="friendly-benchmark"><strong>SnapCount built the better projected roster in ${pct(result.oracleWinRate, 1)} of these mock drafts.</strong><p>Average projected season advantage: <b>${result.meanSeasonEdge >= 0 ? "+" : ""}${num(result.meanSeasonEdge)} points</b>.</p><small>This is a simulator comparison, not a guarantee of real-world results.</small></div>`;
      status(`Comparison finished across ${result.simulations} mock drafts.`, "good");
    } catch (error) {
      $("#draft-benchmark-result").innerHTML = `<p>${esc(error.message)}</p>`;
      status(error.message, "error");
    } finally { button.disabled = false; }
  }

  function rosterPlayers() {
    const ids = new Set(state.rosterIds.map(String));
    return state.players.filter((player) => ids.has(String(player.id)));
  }

  function populateTradeSelectors() {
    const giveIds = ["#trade-give-1", "#trade-give-2"];
    const getIds = ["#trade-get-1", "#trade-get-2"];
    if (!$(giveIds[0]) || !state.players.length) return;
    const roster = rosterPlayers();
    const rosterSet = new Set(roster.map((player) => String(player.id)));
    const giveOptions = [`<option value="">${roster.length ? "Choose a player" : "Add your roster first"}</option>`, ...roster.sort((a, b) => (a.pprRank || 9999) - (b.pprRank || 9999)).map((player) => `<option value="${esc(player.id)}">${esc(player.name)} · ${esc(player.position)} ${esc(player.team)}</option>`)].join("");
    const tradeQuery = $("#trade-search")?.value || "";
    const getPool = rankedPlayers().filter((player) => !rosterSet.has(String(player.id)) && playerMatchesSearch(player, tradeQuery)).slice(0, tradeQuery ? 120 : 320);
    const getOptions = [`<option value="">Choose a player</option>`, ...getPool.map((player) => { const owner = leagueTeamForPlayer(player.id); return `<option value="${esc(player.id)}">${esc(player.name)} · ${esc(player.position)} ${esc(player.team)}${owner ? ` · ${esc(owner.name)}` : ""}</option>`; })].join("");
    giveIds.forEach((selector) => { const previous = $(selector).value; $(selector).innerHTML = giveOptions; if ([...$(selector).options].some((option) => option.value === previous)) $(selector).value = previous; });
    getIds.forEach((selector) => { const previous = $(selector).value; $(selector).innerHTML = getOptions; if ([...$(selector).options].some((option) => option.value === previous)) $(selector).value = previous; });
  }

  async function persistRoster() {
    await store.set("roster-ids", state.rosterIds);
  }

  function renderRoster() {
    const roster = rosterPlayers();
    $("#roster-strip").innerHTML = roster.length ? roster.map((player) => `<div class="roster-chip"><span>${esc(player.position)}</span>${esc(player.name)}<button type="button" aria-label="Remove ${esc(player.name)}" data-remove-roster="${esc(player.id)}">×</button></div>`).join("") : `<span class="fineprint">Roster is empty.</span>`;
    populateTradeSelectors();
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
    $("#roster-search").value = "";
    fillPlayerPicker("#roster-add");
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
    let opponent = hasRealFantasySchedule() ? leagueOpponentForWeek(week) : null;
    const decisionPool = opponent ? [...roster, ...(opponent.roster || [])] : roster;
    status(opponent ? `Checking your Week ${week} matchup against ${opponent.name}…` : "Checking your roster and the latest player updates…");
    const contextState = await prepareDecisionContext(decisionPool, week);
    roster = refreshDecisionPlayers(roster);
    if (opponent) opponent = { ...opponent, roster: refreshDecisionPlayers(opponent.roster || []) };
    const forecasts = roster.map((player) => engine.forecastPlayer(player, { week, evidence: decisionEvidence(player, week), validatedMeanScale: servingMeanScale("startSit") }));
    const byId = new Map(forecasts.map((forecast) => [String(forecast.player.id), forecast]));
    const prepared = forecasts.map((forecast) => ({ ...forecast.player, weekProjection: forecast.distribution.mean }));
    const baselineLineup = core.optimizeLineup(prepared, core.DEFAULT_SETTINGS, "weekProjection");
    let lineup = baselineLineup;
    let matchup = null;
    $("#run-lineup").disabled = true;
    status(opponent ? "Simulating ways to beat this opponent…" : "Finding your best starting lineup…");
    try {
      if (opponent?.roster?.length && rosterStarterCoverage(opponent.roster) >= 0.88) {
        const allPlayers = [...new Map([...roster, ...opponent.roster].map((player) => [String(player.id), player])).values()];
        const evidenceByPlayer = Object.fromEntries(allPlayers.map((player) => [String(player.id), decisionEvidence(player, week)]));
        matchup = await runWorker("matchup-lineups", { options: {
          userRoster: roster,
          opponentRoster: opponent.roster,
          settings: core.DEFAULT_SETTINGS,
          week,
          schedule: state.schedule,
          evidenceByPlayer,
          validatedMeanScale: servingMeanScale("startSit"),
          scenarios: 5000,
          seed: `matchup-lineup-${connectedUserTeamId()}-${opponent.teamId}-${week}`,
        } });
        if (matchup.preferred?.starterIds?.length && matchup.winProbabilityGain95?.[0] > 0) {
          const preferredSet = new Set(matchup.preferred.starterIds.map(String));
          const preferredPlayers = prepared.filter((player) => preferredSet.has(String(player.id)));
          const assigned = core.optimizeLineup(preferredPlayers, core.DEFAULT_SETTINGS, "weekProjection");
          lineup = {
            ...assigned,
            bench: prepared.filter((player) => !preferredSet.has(String(player.id))).sort((a, b) => b.weekProjection - a.weekProjection),
          };
        }
      }      const starterIds = lineup.starters.filter((row) => row.player).map((row) => String(row.player.id));
      const portfolio = await runWorker("portfolio", {
        forecasts,
        portfolios: [{ id: "lineup", label: "Optimized lineup", playerIds: starterIds }],
        options: { week, scenarios: 4000, schedule: state.schedule, seed: `lineup-${week}` },
      });
      const summary = portfolio.decision.actions[0].summary;
      const starters = lineup.starters.map((row) => `<div class="lineup-row"><span>${esc(row.slot)}</span><strong>${row.player ? esc(row.player.name) : "EMPTY"}</strong><b>${row.player ? num(byId.get(String(row.player.id))?.distribution.mean) : "—"}</b></div>`).join("");
      const bench = lineup.bench.slice(0, 8).map((player) => `<div class="lineup-row"><span>BN</span><strong>${esc(player.name)}</strong><b>${num(byId.get(String(player.id))?.distribution.mean)}</b></div>`).join("");
      const matchupMetrics = matchup && opponent ? `<div class="metric"><span>WIN CHANCE VS ${esc(opponent.name).toUpperCase()}</span><strong class="good">${pct(matchup.preferred.winProbability, 1)}</strong></div><div class="metric"><span>VS POINT-MAX LINEUP</span><strong>${matchup.winProbabilityGain > 0 ? "+" : ""}${pct(matchup.winProbabilityGain, 1)}</strong></div>` : "";
      const heading = opponent ? `Start these players to beat ${esc(opponent.name)}` : "Start these players";
      $("#lineup-result").className = "result-space";
      $("#lineup-result").innerHTML = `<div class="friendly-result-head"><div><span class="result-kicker">RECOMMENDED LINEUP</span><h2>${heading}</h2></div><strong>${num(summary.mean)} projected points</strong></div><div class="metric-grid friendly-metrics lineup-summary"><div class="metric"><span>PROJECTED TOTAL</span><strong>${num(summary.mean)}</strong></div><div class="metric"><span>TYPICAL RANGE</span><strong>${num(summary.p25)}–${num(summary.p75)}</strong></div><div class="metric"><span>UPSIDE</span><strong class="good">${num(summary.p90)}</strong></div>${matchupMetrics}</div><div class="result-grid"><div><p class="control-title">START THESE</p><div class="lineup-list">${starters}</div></div><div><p class="control-title">BENCH THESE</p><div class="lineup-list">${bench || "<div class='lineup-row'><strong>No bench players</strong></div>"}</div></div></div><details class="advanced-details result-details"><summary>See projection range details</summary>${rangeMarkup(summary)}${matchup ? `<p class="fineprint">Opponent-aware choice evaluated ${matchup.candidatesEvaluated} legal lineup candidates on ${matchup.evaluationScenarios.toLocaleString()} held-out Monte Carlo scenarios. The point-max lineup remains the fallback unless the matchup win-probability gain clears Monte Carlo uncertainty.</p>` : ""}</details>`;
      status(opponent ? `Opponent-aware lineup ready for ${opponent.name}. ${decisionContextLabel(contextState)}.` : `Your best lineup is ready. ${decisionContextLabel(contextState)}.`, "good");
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

  function waiverPriorityLabel(row) {
    if (row.lineupGain >= 1 || row.score >= 16) return "HIGH CLAIM";
    if (row.lineupGain >= 0.35 || row.score >= 8) return "CLAIM";
    return "WATCH / FREE AGENT";
  }

  async function runWaivers() {
    let roster = rosterPlayers();
    if (!roster.length) return status("Build a roster in the Lineup tab first.", "error");
    const rosterSet = new Set(state.rosterIds.map(String));
    let freeAgents = state.players.filter((player) => !rosterSet.has(String(player.id)));
    const week = Number($("#waiver-week").value || 1);
    const mode = $("#waiver-mode").value || "priority";
    const budget = Math.max(0, Number($("#faab-budget").value || 0));
    $("#run-waivers").disabled = true;
    status("Checking available players against your roster…");
    let contextState = { live: { failed: [] }, history: {} };
    try {
      const intelligencePool = [...freeAgents].sort((a, b) => baselineWeekProjection(b, week) - baselineWeekProjection(a, week)).slice(0, 180);
      contextState = await prepareDecisionContext([...roster, ...intelligencePool], week);
      roster = refreshDecisionPlayers(roster);
      freeAgents = state.players.filter((player) => !rosterSet.has(String(player.id)));
      const intelligenceIds = new Set(intelligencePool.map((player) => String(player.id)));
      const decisionRoster = roster.map((player) => decisionPlayerForWeek(player, week, "waivers"));
      const decisionFreeAgents = freeAgents.map((player) => intelligenceIds.has(String(player.id)) ? decisionPlayerForWeek(player, week, "waivers") : player);
      status("Finding the pickups that help you most…");
      let suggestions = await runWorker("waivers", { roster: decisionRoster, freeAgents: decisionFreeAgents, settings: core.DEFAULT_SETTINGS, limit: 12, week, policy: { minimumScore: Number(servingPolicy("waivers").minimumScore || 0.25) } });
      if (suggestions.length && hasRealFantasySchedule() && connectedUserTeamId() && hasReliableLeagueRosterCoverage(currentLeagueTeamsForDecisions())) {
        const endWeek = futureWinRegularSeasonEnd(week);
        const preparedLeague = await prepareLeagueWinContext(week, endWeek, "waivers");
        if (preparedLeague) {
          const candidates = suggestions.slice(0, 8);
          for (const row of candidates) {
            const add = playerById(row.add.id) || row.add;
            preparedLeague.evidenceByPlayer[String(add.id)] = staticDecisionEvidence(add);
            for (let futureWeek = week; futureWeek <= endWeek; futureWeek += 1) {
              if (!preparedLeague.evidenceByPlayerWeek[futureWeek]) preparedLeague.evidenceByPlayerWeek[futureWeek] = {};
              preparedLeague.evidenceByPlayerWeek[futureWeek][String(add.id)] = context.mergeEvidence(priorDefenseEvidence(add, futureWeek), marketEvidenceFor(add, futureWeek), rookieEvidenceFor(add, futureWeek));
            }
          }
          const actions = candidates.map((row, index) => ({ id: `waiver-${index + 1}`, type: "waiver", label: `Add ${row.add.name}`, dropPlayerId: String(row.drop.id), addPlayer: playerById(row.add.id) || row.add }));
          const future = await runWorker("future-win-actions", { options: { teams: preparedLeague.teams, userTeamId: connectedUserTeamId(), actions, settings: core.DEFAULT_SETTINGS, schedule: state.schedule, fantasySchedule: fantasyScheduleForLeague(), startWeek: week, regularSeasonEnd: endWeek, evidenceByPlayer: preparedLeague.evidenceByPlayer, evidenceByPlayerWeek: preparedLeague.evidenceByPlayerWeek, validatedMeanScale: preparedLeague.validatedMeanScale, simulations: 1200, seed: `waiver-future-${week}` } });
          const futureById = new Map((future.actions || []).map((row) => [row.id, row]));
          suggestions = candidates.map((row, index) => ({ ...row, futureWin: futureById.get(`waiver-${index + 1}`) || null }))
            .filter((row) => Number(row.futureWin?.delta?.expectedFutureHeadToHeadWins || 0) > 0)
            .sort((a, b) => (a.futureWin?.rank || 999) - (b.futureWin?.rank || 999));
        }
      }
      $("#waiver-result").className = "result-space";
      $("#waiver-result").innerHTML = suggestions.length ? `<div class="decision-list">${suggestions.map((row) => {
        const bid = mode === "faab" ? faabRange(row, budget, week) : null;
        const claim = bid ? `Bid about $${bid.target}` : waiverPriorityLabel(row);
        const detail = bid ? `Reasonable range: ${bid.floor}–${bid.ceiling}` : row.lineupGain > 0 ? `Could improve your starters by ${num(row.lineupGain)} points` : `Adds ${num(row.depthGain)} points of bench depth`;
        const futureDetail = row.futureWin ? `<span>Future H2H win chance: <b>${pct(row.futureWin.outcome.averageMatchupWinProbability, 1)}</b> (${row.futureWin.delta.averageMatchupWinProbability >= 0 ? "+" : ""}${pct(row.futureWin.delta.averageMatchupWinProbability, 1)}) · expected wins ${row.futureWin.delta.expectedFutureHeadToHeadWins >= 0 ? "+" : ""}${num(row.futureWin.delta.expectedFutureHeadToHeadWins, 2)}</span>` : "";
        return `<article class="decision-card friendly-decision"><div class="decision-head"><div><span class="result-kicker">${esc(claim)}</span><strong>Add ${esc(row.add.name)}</strong></div><b>Drop ${esc(row.drop.name)}</b></div><p>${esc(row.reason)}</p><div class="decision-stats"><span>${esc(detail)}</span>${futureDetail}</div></article>`;
      }).join("")}</div>` : `<div class="empty-answer"><strong>No pickup is clearly worth it right now.</strong><p>Your current roster grades better than the available add/drop options for this week.</p></div>`;
      status(`Your waiver recommendations are ready. ${decisionContextLabel(contextState)}.`, "good");
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

  async function analyzeSelectedTrade() {
    let roster = rosterPlayers();
    if (!roster.length) return status("Add your roster in Start / Sit first.", "error");
    const giveIds = [$("#trade-give-1").value, $("#trade-give-2").value].filter(Boolean);
    const getIds = [$("#trade-get-1").value, $("#trade-get-2").value].filter(Boolean);
    if (!giveIds.length || !getIds.length) return status("Choose at least one player on each side of the trade.", "error");
    const week = Number($("#trade-week").value || 1);
    const selected = [...roster, ...getIds.map((id) => playerById(id)).filter(Boolean)];
    const button = $("#analyze-trade");
    button.disabled = true;
    status("Checking the trade against your lineup, future opponents, and current player context…");
    try {
      const contextState = await prepareDecisionContext(selected, week);
      roster = refreshDecisionPlayers(roster);
      const decisionRoster = roster.map((player) => decisionPlayerForWeek(player, week, "trades"));
      const give = giveIds.map((id) => playerById(id)).filter(Boolean).map((player) => decisionPlayerForWeek(player, week, "trades"));
      const receive = getIds.map((id) => playerById(id)).filter(Boolean).map((player) => decisionPlayerForWeek(player, week, "trades"));
      const analysis = core.analyzeTrade({ roster: decisionRoster, give, receive, players: state.players, settings: core.DEFAULT_SETTINGS, week });
      const tradePolicy = servingPolicy("trades");
      const acceptScore = Number(tradePolicy.acceptScore || 28), passScore = Number(tradePolicy.passScore || -28);
      const ownerIds = [...new Set(getIds.map((id) => leagueTeamForPlayer(id)?.teamId).filter(Boolean).map(String))]
        .filter((id) => id !== connectedUserTeamId());
      const opponentTeam = ownerIds.length === 1 ? (state.leagueTeams || []).find((team) => String(team.teamId) === ownerIds[0]) || null : null;
      let future = null, futureAction = null, opponentBefore = null;
      if (opponentTeam && hasRealFantasySchedule()) {
        future = await runFutureWinActions([{
          id: "selected-trade", type: "trade", label: "Proposed trade",
          opponentTeamId: String(opponentTeam.teamId), sendPlayerIds: giveIds, receivePlayerIds: getIds,
        }], "trades", week, 2200, `trade-future-${giveIds.sort().join("-")}-${getIds.sort().join("-")}-${week}`, 900);
        futureAction = future?.actions?.find((row) => row.id === "selected-trade") || null;
        opponentBefore = future?.actions?.find((row) => row.id === "hold")?.opponents?.[String(opponentTeam.teamId)] || null;
      }
      let verdict = analysis.score >= acceptScore ? "ACCEPT" : analysis.score <= passScore ? "PASS" : "CLOSE CALL";
      if (futureAction) {
        const expectedWinDelta = Number(futureAction.delta?.expectedFutureHeadToHeadWins || 0);
        const lower95 = Number(futureAction.delta?.expectedFutureHeadToHeadWins95?.[0] || 0);
        if (analysis.score <= passScore || expectedWinDelta <= 0) verdict = "PASS";
        else if (analysis.score >= acceptScore && lower95 > 0) verdict = "ACCEPT";
        else verdict = "CLOSE CALL";
      }
      const tone = verdict === "ACCEPT" ? "good" : verdict === "PASS" ? "bad" : "neutral";
      const longTerm = analysis.assetGain >= 5 ? "Better" : analysis.assetGain <= -5 ? "Worse" : "About even";
      const titleMetric = futureAction?.leagueEquity?.user && futureAction?.delta?.leagueEquity ? `<div class="metric"><span>CHAMPIONSHIP CHANCE</span><strong>${pct(futureAction.leagueEquity.user.championshipProbability, 1)} <small>${futureAction.delta.leagueEquity.championshipProbability >= 0 ? "+" : ""}${pct(futureAction.delta.leagueEquity.championshipProbability, 1)}</small></strong></div>` : "";
      const futureMetrics = futureAction ? `<div class="metric"><span>FUTURE GAME WIN CHANCE</span><strong class="${futureAction.delta.averageMatchupWinProbability >= 0 ? "good" : "warn"}">${pct(futureAction.outcome.averageMatchupWinProbability, 1)} <small>${futureAction.delta.averageMatchupWinProbability >= 0 ? "+" : ""}${pct(futureAction.delta.averageMatchupWinProbability, 1)}</small></strong></div><div class="metric"><span>EXPECTED REMAINING H2H WINS</span><strong>${num(futureAction.outcome.expectedFutureHeadToHeadWins, 2)} <small>${futureAction.delta.expectedFutureHeadToHeadWins >= 0 ? "+" : ""}${num(futureAction.delta.expectedFutureHeadToHeadWins, 2)}</small></strong></div>${titleMetric}${opponentBefore && futureAction.opponentOutcome ? `<div class="metric"><span>${esc(opponentTeam.name).toUpperCase()} FUTURE WIN CHANCE</span><strong>${pct(futureAction.opponentOutcome.averageMatchupWinProbability, 1)} <small>${futureAction.opponentOutcome.averageMatchupWinProbability - opponentBefore.averageMatchupWinProbability >= 0 ? "+" : ""}${pct(futureAction.opponentOutcome.averageMatchupWinProbability - opponentBefore.averageMatchupWinProbability, 1)}</small></strong></div>` : ""}` : "";
      const objectiveNote = futureAction
        ? `<p class="fineprint">Primary objective: maximize your expected wins across the remaining scheduled head-to-head games. Trade simulations transfer players on both rosters and use common random numbers. The historically qualified trade score remains a guardrail: the new layer can veto or rerank, but cannot turn a qualified rejection into an accept.</p>`
        : `<p class="fineprint">Connect a league with a recognized schedule and target players owned by one opponent to unlock opponent-aware future-win simulation.</p>`;
      $("#trade-check-result").className = "result-space";
      $("#trade-check-result").innerHTML = `<div class="trade-verdict ${tone}"><span>THE CALL</span><strong>${verdict}</strong><p>${esc(analysis.verdict)}. ${esc(analysis.summary)}</p></div><div class="metric-grid friendly-metrics">${futureMetrics}<div class="metric"><span>STARTING LINEUP CHANGE</span><strong class="${analysis.lineupGain >= 0 ? "good" : "warn"}">${analysis.lineupGain >= 0 ? "+" : ""}${num(analysis.lineupGain)} pts/week</strong></div><div class="metric"><span>LONG-TERM ROSTER VALUE</span><strong>${longTerm}</strong></div><div class="metric"><span>TRADE BALANCE</span><strong>${analysis.fairness}/100</strong></div></div><div class="trade-summary"><strong>You give:</strong> ${esc(give.map((player) => player.name).join(" + "))}<br><strong>You get:</strong> ${esc(receive.map((player) => player.name).join(" + "))}${opponentTeam ? `<br><strong>Trade partner:</strong> ${esc(opponentTeam.name)}` : ""}</div>${objectiveNote}`;
      status(`Trade checked${opponentTeam ? ` against ${opponentTeam.name} and your future schedule` : ""}. ${decisionContextLabel(contextState)}.`, "good");
    } catch (error) {
      status(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function runTrades() {
    let userRoster = rosterPlayers();
    if (!userRoster.length) return status("Build a roster in the Lineup tab first.", "error");
    const week = Number($("#trade-week").value || 1);
    $("#run-trades").disabled = true;
    status(hasRealFantasySchedule() ? "Searching every real opponent for trades that improve your future win probability…" : "Looking for realistic trade ideas that improve your team…");
    let contextState = { live: { failed: [] }, history: {} };
    try {
      const acceptScore = Number(servingPolicy("trades").acceptScore || 28);
      if (hasRealFantasySchedule() && connectedUserTeamId() && state.leagueTeams?.length > 1 && hasReliableLeagueRosterCoverage(currentLeagueTeamsForDecisions())) {
        const endWeek = futureWinRegularSeasonEnd(week);
        const preparedLeague = await prepareLeagueWinContext(week, endWeek, "trades");
        const userTeam = preparedLeague?.teams?.find((team) => String(team.teamId) === connectedUserTeamId());
        if (!userTeam) throw new Error("SnapCount could not resolve your connected league team");
        userRoster = userTeam.roster;
        const decisionUserRoster = userRoster.map((player) => decisionPlayerForWeek(player, week, "trades"));
        const candidateRows = [];
        for (const opponent of preparedLeague.teams.filter((team) => String(team.teamId) !== connectedUserTeamId())) {
          const decisionOpponentRoster = opponent.roster.map((player) => decisionPlayerForWeek(player, week, "trades"));
          const proposals = await runWorker("trade-proposals", { options: {
            userRoster: decisionUserRoster,
            opponentRoster: decisionOpponentRoster,
            players: state.players,
            settings: core.DEFAULT_SETTINGS,
            week,
            includeTwoForTwo: true,
            maxEvaluations: 450,
            limit: 4,
          } });
          for (const proposal of proposals) {
            if (Number(proposal.userAnalysis?.score) < acceptScore) continue;
            candidateRows.push({ ...proposal, opponentTeamId: String(opponent.teamId), opponentName: opponent.name });
          }
        }
        const candidates = candidateRows.sort((a, b) => Number(b.userAnalysis?.score || 0) - Number(a.userAnalysis?.score || 0) || Number(b.mutualScore || 0) - Number(a.mutualScore || 0)).slice(0, 12);
        if (!candidates.length) {
          $("#trade-result").className = "result-space";
          $("#trade-result").innerHTML = `<div class="empty-answer"><strong>No qualified trade idea found.</strong><p>No package against your real league opponents cleared the historically qualified trade gate.</p></div>`;
          status("Trade ideas are ready. No qualified package cleared the safety gate.", "good");
          return;
        }        const actions = candidates.map((row, index) => ({
          id: `trade-idea-${index + 1}`,
          type: "trade",
          label: `${row.give.map((player) => player.name).join(" + ")} for ${row.receive.map((player) => player.name).join(" + ")}`,
          opponentTeamId: row.opponentTeamId,
          sendPlayerIds: row.give.map((player) => String(player.id)),
          receivePlayerIds: row.receive.map((player) => String(player.id)),
        }));
        const future = await runWorker("future-win-actions", { options: {
          teams: preparedLeague.teams,
          userTeamId: connectedUserTeamId(),
          actions,
          settings: core.DEFAULT_SETTINGS,
          schedule: state.schedule,
          fantasySchedule: fantasyScheduleForLeague(),
          startWeek: week,
          regularSeasonEnd: endWeek,
          evidenceByPlayer: preparedLeague.evidenceByPlayer,
          evidenceByPlayerWeek: preparedLeague.evidenceByPlayerWeek,
          validatedMeanScale: preparedLeague.validatedMeanScale,
          simulations: 1400,
          seed: `trade-ideas-future-${week}`,
        } });
        const futureById = new Map((future.actions || []).map((row) => [row.id, row]));
        const ranked = candidates.map((row, index) => ({ ...row, future: futureById.get(`trade-idea-${index + 1}`) }))
          .filter((row) => row.future && row.future.delta.expectedFutureHeadToHeadWins > 0)
          .sort((a, b) => a.future.rank - b.future.rank)
          .slice(0, 10);
        $("#trade-result").className = "result-space";
        $("#trade-result").innerHTML = ranked.length ? `<div class="decision-list">${ranked.map((row) => `<article class="decision-card friendly-decision"><div class="decision-head"><div><span class="result-kicker">FUTURE-WIN TRADE · ${esc(row.opponentName)}</span><strong>Give ${esc(row.give.map((p) => p.name).join(" + "))}</strong></div><b>Get ${esc(row.receive.map((p) => p.name).join(" + "))}</b></div><p>${esc(row.summary)}</p><div class="decision-stats"><span>Future H2H win chance: <b>${pct(row.future.outcome.averageMatchupWinProbability, 1)}</b> (${row.future.delta.averageMatchupWinProbability >= 0 ? "+" : ""}${pct(row.future.delta.averageMatchupWinProbability, 1)})</span><span>Expected remaining wins: <b>${num(row.future.outcome.expectedFutureHeadToHeadWins, 2)}</b> (${row.future.delta.expectedFutureHeadToHeadWins >= 0 ? "+" : ""}${num(row.future.delta.expectedFutureHeadToHeadWins, 2)})</span><span>Qualified trade score: ${num(row.userAnalysis.score, 1)}</span></div></article>`).join("")}</div>` : `<div class="empty-answer"><strong>No trade clearly improves future wins.</strong><p>Some packages passed the historical trade gate, but none increased your expected remaining head-to-head wins in the opponent-aware simulation.</p></div>`;
        status("Opponent-aware trade ideas are ready. Real league rosters and your remaining schedule were used.", "good");
        return;
      }
      let opponentRoster = counterpartyRoster();
      contextState = await prepareDecisionContext([...userRoster, ...opponentRoster], week);
      userRoster = refreshDecisionPlayers(userRoster);
      opponentRoster = refreshDecisionPlayers(opponentRoster);
      const decisionUserRoster = userRoster.map((player) => decisionPlayerForWeek(player, week, "trades"));
      const decisionOpponentRoster = opponentRoster.map((player) => decisionPlayerForWeek(player, week, "trades"));
      const rawProposals = await runWorker("trade-proposals", { options: {
        userRoster: decisionUserRoster,
        opponentRoster: decisionOpponentRoster,
        players: state.players,
        settings: core.DEFAULT_SETTINGS,
        week,
        includeTwoForTwo: true,
        maxEvaluations: 700,
        limit: 10,
      } });
      const proposals = rawProposals.filter((row) => Number(row.userAnalysis?.score) >= acceptScore);
      $("#trade-result").className = "result-space";
      $("#trade-result").innerHTML = proposals.length ? `<div class="decision-list">${proposals.map((row) => `<article class="decision-card friendly-decision"><div class="decision-head"><div><span class="result-kicker">TRADE IDEA</span><strong>Give ${esc(row.give.map((p) => p.name).join(" + "))}</strong></div><b>Get ${esc(row.receive.map((p) => p.name).join(" + "))}</b></div><p>${esc(row.summary)}</p><div class="decision-stats"><span>Your lineup: ${row.userAnalysis.lineupGain >= 0 ? "+" : ""}${num(row.userAnalysis.lineupGain)} pts</span><span>Trade balance: ${row.fairness}/100</span></div></article>`).join("")}</div>` : `<div class="empty-answer"><strong>No strong trade idea found right now.</strong><p>SnapCount did not find a package that clearly helps you without becoming unrealistic for the other side.</p></div>`;
      status(`Trade ideas are ready. ${decisionContextLabel(contextState)}. Connect a league schedule for future-win reranking.`, "good");
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
    state.leagueMeta = { playoffTeams: Math.min(6, teamCount), playoffByes: teamCount >= 6 ? 2 : 0, scheduleSource: "synthetic", fantasySchedule: null, regularSeasonEnd: 14, championshipWeek: 17 };
    $("#league-source-status").textContent = `Balanced ${teamCount}-team local league loaded.`;
    return teams;
  }

  async function syncSleeperPosition(position) {
    const selectedPlayerId = $("#player-select").value;
    const sleeperPlayers = await sources.loadSleeperPlayers(position);
    state.players = sources.enrichLocalPlayers(state.players, sleeperPlayers);
    reindexPlayers();
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
      reindexPlayers();
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
        scheduleSource: "sleeper-no-matchups", fantasySchedule: null, regularSeasonEnd: 14, championshipWeek: 17,
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
    const startWeek = hasRealFantasySchedule() ? Math.max(1, Number(state.espnLeague?.currentWeek || 1)) : 1;
    $("#run-league").disabled = true;
    let leaguePlayers = [...new Map(state.leagueTeams.flatMap((team) => team.roster).map((player) => [String(player.id), player])).values()];
    $("#league-source-status").textContent = `Checking ${leaguePlayers.length} players and current team context…`;
    let contextState = { live: { failed: [] }, history: {} };
    try {
      contextState = await prepareDecisionContext(leaguePlayers);
      state.leagueTeams = state.leagueTeams.map((team) => ({ ...team, roster: refreshDecisionPlayers(team.roster) }));
      leaguePlayers = [...new Map(state.leagueTeams.flatMap((team) => team.roster).map((player) => [String(player.id), player])).values()];
      const evidenceByPlayer = Object.fromEntries(leaguePlayers.map((player) => [String(player.id), staticDecisionEvidence(player)]));
      const evidenceByPlayerWeek = {};
      for (let week = startWeek; week <= championshipWeek; week += 1) {
        const rows = leaguePlayers.map((player) => [String(player.id), context.mergeEvidence(priorDefenseEvidence(player, week), marketEvidenceFor(player, week), rookieEvidenceFor(player, week))]).filter(([, evidence]) => Object.keys(evidence).length);
        if (rows.length) evidenceByPlayerWeek[week] = Object.fromEntries(rows);
      }
      $("#league-source-status").textContent = `Testing ${scenarios.toLocaleString()} possible seasons…`;
      const result = await runWorker("league", { options: {
        teams: state.leagueTeams,
        settings: core.DEFAULT_SETTINGS,
        schedule: state.schedule,
        fantasySchedule: fantasyScheduleForLeague(),
        startWeek,
        regularSeasonEnd,
        championshipWeek,
        playoffTeams: state.leagueMeta?.playoffTeams || Math.min(6, state.leagueTeams.length),
        playoffByes: state.leagueMeta?.playoffByes || 0,
        medianGame: $("#median-game").checked,
        evidenceByPlayer,
        evidenceByPlayerWeek,
        simulations: scenarios,
        seed: `league-${state.leagueTeams.length}-${regularSeasonEnd}-${championshipWeek}`,
      } });
      $("#league-result").className = "result-space";
      $("#league-result").innerHTML = `<div class="table-header"><h2>Season outlook</h2><span>${result.simulations.toLocaleString()} possible seasons${hasRealFantasySchedule() ? " · real H2H schedule" : ""}</span></div><div class="table-wrap"><table><thead><tr><th>Team</th><th>Future H2H win %</th><th>Expected future H2H wins</th><th>Make playoffs</th><th>Win league</th><th>Expected total wins</th></tr></thead><tbody>${result.teams.map((team) => `<tr><td class="player-cell"><strong>${esc(team.name)}</strong></td><td><b>${pct(team.averageMatchupWinProbability, 1)}</b></td><td>${num(team.expectedFutureHeadToHeadWins, 2)}</td><td>${pct(team.playoffProbability, 1)}</td><td><b>${pct(team.championshipProbability, 1)}</b></td><td>${num(team.expectedWins, 1)}</td></tr>`).join("")}</tbody></table></div>`;
      $("#league-source-status").textContent = `Season outlook ready. ${decisionContextLabel(contextState)}.`;
      status(`Season outlook ready. ${decisionContextLabel(contextState)}.`, "good");
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
    await Promise.all([store.remove("roster-ids"), store.remove("evidence-ledger"), store.remove("ensemble-weights"), store.remove("draft-custom-board"), store.remove("espn-connection"), store.remove("espn-snapshot")]);
    state.rosterIds = [];
    state.ledger = new evidenceApi.EvidenceLedger();
    state.ensembleWeights = { market: 0.55, opportunity: 0.45 };
    state.leagueTeams = null;
    state.leagueMeta = null;
    state.espnLeague = null;
    state.espnConnection = null;
    state.espnNeedsSession = false;
    state.draftBoard = null;
    $("#draft-custom-board").value = "";
    resetDraft();
    renderRoster();
    renderEspnConnection();
    renderEvidenceStatus();
    renderWeights();
    $("#chain-status").textContent = "Not checked";
    status("Local roster, evidence, and calibration state cleared.", "good");
  }

  function bindEvents() {
    $$(".tab").forEach((tab) => tab.addEventListener("click", () => activatePanel(tab.dataset.panelTarget)));
    $$('[data-jump]').forEach((button) => button.addEventListener("click", () => activatePanel(button.dataset.jump)));
    $("#connect-espn").addEventListener("click", () => connectEspnLeague().catch(() => {}));
    $("#connect-espn-session").addEventListener("click", () => connectEspnLeague({ browserSession: true }).catch(() => {}));
    $("#cancel-espn-session").addEventListener("click", () => { state.espnNeedsSession = false; renderEspnConnection(); status(""); });
    $("#use-espn-team").addEventListener("click", async () => {
      try {
        const team = await applyEspnTeam($("#espn-team-select").value);
        status(`${team.name} is connected. Your roster and season view are ready.`, "good");
      } catch (error) { status(error.message, "error"); }
    });
    $("#refresh-espn").addEventListener("click", refreshEspnLeague);
    $("#disconnect-espn").addEventListener("click", disconnectEspnLeague);
    $("#espn-league-input").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); connectEspnLeague().catch(() => {}); } });
    $("#player-search").addEventListener("input", () => { const rows = fillPlayerPicker("#player-select", $("#player-search").value); if (rows[0]) { $("#player-select").value = String(rows[0].id); renderNewsPulse(); } });
    $("#roster-search").addEventListener("input", () => fillPlayerPicker("#roster-add", $("#roster-search").value));
    $("#trade-search").addEventListener("input", populateTradeSelectors);
    $("#draft-pick-search").addEventListener("input", () => renderDraftManualOptions());
    $("#run-player").addEventListener("click", runPlayerLab);
    $("#load-intelligence").addEventListener("click", loadPlayerIntelligence);
    $("#sync-live-intelligence").addEventListener("click", syncLiveIntelligence);
    $("#player-select").addEventListener("change", () => renderNewsPulse());
    $("#save-evidence").addEventListener("click", saveEvidence);
    $("#draft-reset").addEventListener("click", resetDraft);
    $("#draft-advance").addEventListener("click", advanceDraftToUser);
    $("#draft-undo").addEventListener("click", undoDraftPick);
    $("#draft-record-pick").addEventListener("click", recordNextDraftPick);
    $("#draft-import-board").addEventListener("click", importDraftBoard);
    $("#draft-clear-board").addEventListener("click", clearDraftBoard);
    $("#draft-benchmark").addEventListener("click", runDraftBenchmark);
    $("#draft-board-position").addEventListener("change", renderDraftBigBoard);
    $("#draft-mode").addEventListener("change", () => { $("#draft-advance").textContent = $("#draft-mode").value === "live" ? "Live Draft Helper" : "Sim to my pick"; renderDraft(); });
    $("#draft-teams").addEventListener("change", resetDraft);
    $("#draft-position").addEventListener("change", resetDraft);
    $("#draft-rounds").addEventListener("change", resetDraft);
    $("#draft-scoring").addEventListener("change", resetDraft);
    $("#roster-add-button").addEventListener("click", () => addRosterPlayer($("#roster-add").value));
    $("#roster-demo").addEventListener("click", loadDemoRoster);
    $("#roster-clear").addEventListener("click", async () => { state.rosterIds = []; await persistRoster(); renderRoster(); });
    $("#run-lineup").addEventListener("click", analyzeLineup);
    $("#run-waivers").addEventListener("click", runWaivers);
    $("#waiver-mode").addEventListener("change", () => $("#faab-budget-label").classList.toggle("hidden", $("#waiver-mode").value !== "faab"));
    $("#analyze-trade").addEventListener("click", analyzeSelectedTrade);
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
    const strategyOptions = draftSim.strategyCatalog().map((row) => `<option value="${esc(row.id)}" ${row.id === "mixed" ? "selected" : ""}>${esc(row.label)}</option>`).join("");
    $("#draft-opponent-strategy").innerHTML = strategyOptions;
    $("#engine-version").textContent = engine.VERSION.replace("oracle-browser-", "v");
    $("#worker-status").textContent = "Web Worker online";
    try {
      const [response, coachResponse, healthResponse, rookieResponse, campResponse, profileResponse] = await Promise.all([
        fetch("./data/players-lite.json"),
        fetch("./data/coaches-2026.json"),
        fetch("./data/health-calibration-2026.json"),
        fetch("./data/rookies-2026.json"),
        fetch("./data/camp-2026.json"),
        fetch("./data/analytics-runtime-profile.json"),
      ]);
      if (!response.ok || !coachResponse.ok || !healthResponse.ok || !rookieResponse.ok || !campResponse.ok || !profileResponse.ok) throw new Error("one or more qualified runtime artifacts failed to load");
      state.dataset = await response.json();
      state.analyticsProfile = await profileResponse.json();
      if (state.analyticsProfile?.mode !== "serve-frozen-qualified-analytics") throw new Error("qualified analytics profile is invalid");
      state.coaches = await coachResponse.json();
      state.healthCalibration = await healthResponse.json();
      state.rookieArtifact = await rookieResponse.json();
      state.rookieIndex = rookieModel.indexArtifact(state.rookieArtifact);
      state.campArtifact = await campResponse.json();
      state.campIndex = new Map((state.campArtifact?.players || []).map((row) => [String(row.id), row]));
      const season = Number(state.dataset.meta?.season || 2026);
      let baselinePlayers = state.dataset.players || [];
      let livePpr = false;
      try {
        const snapshot = await sources.espnPprPlayerSnapshot(season);
        baselinePlayers = sources.enrichPprProjectionBaseline(baselinePlayers, snapshot, season);
        livePpr = baselinePlayers.some((player) => player.projectionSource === "espn-live-ppr");
      } catch (error) {
        console.warn("Live ESPN PPR projection refresh unavailable; using committed PPR fallback.", error);
      }
      state.players = rookieModel.enrichPlayers(baselinePlayers, state.rookieIndex);
      reindexPlayers();
      state.schedule = state.dataset.schedule || {};
      $("#player-count").textContent = state.players.length.toLocaleString();
      const qualified = state.analyticsProfile?.mode === "serve-frozen-qualified-analytics" ? "qualified profile" : state.analyticsProfile?.version || "qualified";
      $("#bootstrap-status").textContent = livePpr
        ? `${season} live ESPN PPR · ${qualified} · ${state.rookieArtifact?.players?.length || 0} rookie priors`
        : `${season} committed PPR fallback · ${qualified} · ${state.rookieArtifact?.players?.length || 0} rookie priors`;
      fillPlayerSelects();

      const [savedLedger, savedRoster, savedWeights, savedBoard, savedEspnConnection, savedEspnSnapshot] = await Promise.all([
        store.get("evidence-ledger", []),
        store.get("roster-ids", []),
        store.get("ensemble-weights", null),
        store.get("draft-custom-board", ""),
        store.get("espn-connection", null),
        store.get("espn-snapshot", null),
      ]);
      state.ledger = new evidenceApi.EvidenceLedger(Array.isArray(savedLedger) ? savedLedger : []);
      state.rosterIds = Array.isArray(savedRoster) ? savedRoster.map(String).filter((id) => playerById(id)) : [];
      if (savedWeights && typeof savedWeights === "object") state.ensembleWeights = savedWeights;
      if (savedBoard) {
        $("#draft-custom-board").value = savedBoard;
        const parsed = draftSim.parseRankingBoard(savedBoard);
        if (parsed.rows.length) { state.draftBoard = parsed; $("#draft-board-status").textContent = `${parsed.rows.length} custom ranks restored.`; }
      }
      if (savedEspnConnection?.leagueId) {
        state.espnConnection = savedEspnConnection;
        $("#espn-league-input").value = String(savedEspnConnection.leagueId);
        $("#espn-season").value = String(savedEspnConnection.season || 2026);
      }
      if (savedEspnSnapshot?.provider === "espn" && Array.isArray(savedEspnSnapshot.teams)) {
        state.espnLeague = savedEspnSnapshot;
        if (state.espnConnection?.teamId && espnTeamById(state.espnConnection.teamId)) await applyEspnTeam(state.espnConnection.teamId, false);
        else renderEspnConnection();
      } else renderEspnConnection();
      renderRoster();
      renderEvidenceStatus();
      renderWeights();
      resetDraft();
      bindEvents();
      $("#cache-status").textContent = globalThis.indexedDB ? "IndexedDB enabled" : "localStorage fallback";
      status("");
      const requested = location.hash.replace("#", "");
      if ($(`[data-panel-target="${CSS.escape(requested)}"]`)) activatePanel(requested);
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    } catch (error) {
      $("#bootstrap-status").textContent = "Load failed";
      status(`Startup failed: ${error.message}`, "error");
      console.error(error);
    }
  }

  initialize();
})();

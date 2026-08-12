(function startOracleApp() {
  "use strict";

  const core = window.FantasyOracleCore;
  const leagueApi = window.SnapCountLeague;
  const engine = window.OracleBrowserEngine;
  const rookieModel = window.OracleRookies;
  const evidenceApi = window.OracleEvidence;
  const sources = window.OracleSources;
  const espnFantasy = window.OracleEspnFantasy;
  const context = window.OracleContext;
  const intelligence = window.OraclePlayerIntelligence;
  const liveIntelligence = window.OracleLiveIntelligence;
  const footballContext = window.SnapCountFootballContext;
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
    specialTeams: null,
    footballContextArtifact: null,
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
    draftBusy: false,
    draftStarted: false,
    draftContext: "public",
    publicDraftSettings: null,
    publicDraftPreset: null,
    publicDraftPresetSettings: null,
    tradeAnalysisMode: "basic",
    playerOutlooks: {},
    playerPasses: {},
    outlookRoundLock: false,
    playerRunToken: 0,
    ledger: new evidenceApi.EvidenceLedger(),
    rosterIds: [],
    draftState: null,
    leagueTeams: null,
    leagueMeta: null,
    leagueProfile: null,
    tradePartnerTeamId: null,
    tradeActorTeamId: null,
    leagueState: null,
    connectedTeamId: null,
    pendingLeagueImport: null,
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
    syncRuntimeReadouts();
    console.error(event.error || event.message);
  });

  function runWorker(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `job-${++requestSequence}`;
      pending.set(requestId, { resolve, reject });
      worker.postMessage({ type, requestId, ...payload });
    });
  }

  function syncRuntimeReadouts() {
    [["#player-count", "#system-player-count"], ["#engine-version", "#system-engine-version"], ["#bootstrap-status", "#system-bootstrap-status"], ["#worker-status", "#system-worker-status"]].forEach(([source, target]) => {
      const sourceNode = $(source); const targetNode = $(target);
      if (sourceNode && targetNode) targetNode.textContent = sourceNode.textContent;
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

  const PLAYER_OUTLOOKS = {
    unknown: { label: "Unknown", direction: 0, strength: 0, reviewed: false, tone: "unknown", targetRoundMove: 0, trust: 0, maxRoundMove: 0, windowRounds: 0 },
    "very-positive": { label: "Very positive", direction: 1, strength: 4, reviewed: true, tone: "very-positive", targetRoundMove: 1.25, trust: 0.55, maxRoundMove: 0.7, windowRounds: 1.4 },
    positive: { label: "Positive", direction: 1, strength: 3, reviewed: true, tone: "positive", targetRoundMove: 0.75, trust: 0.45, maxRoundMove: 0.4, windowRounds: 1.1 },
    "somewhat-positive": { label: "Somewhat positive", direction: 1, strength: 2, reviewed: true, tone: "somewhat-positive", targetRoundMove: 0.35, trust: 0.35, maxRoundMove: 0.2, windowRounds: 0.8 },
    "slightly-positive": { label: "Slightly positive", direction: 1, strength: 1, reviewed: true, tone: "slightly-positive", targetRoundMove: 0.15, trust: 0.25, maxRoundMove: 0.1, windowRounds: 0.55 },
    neutral: { label: "Neutral", direction: 0, strength: 0, reviewed: true, tone: "neutral", targetRoundMove: 0, trust: 0, maxRoundMove: 0, windowRounds: 0 },
    "slightly-negative": { label: "Slightly negative", direction: -1, strength: 1, reviewed: true, tone: "slightly-negative", targetRoundMove: 0.15, trust: 0.25, maxRoundMove: 0.1, windowRounds: 0.55 },
    "somewhat-negative": { label: "Somewhat negative", direction: -1, strength: 2, reviewed: true, tone: "somewhat-negative", targetRoundMove: 0.35, trust: 0.35, maxRoundMove: 0.2, windowRounds: 0.8 },
    negative: { label: "Negative", direction: -1, strength: 3, reviewed: true, tone: "negative", targetRoundMove: 0.75, trust: 0.45, maxRoundMove: 0.4, windowRounds: 1.1 },
    "very-negative": { label: "Very negative", direction: -1, strength: 4, reviewed: true, tone: "very-negative", targetRoundMove: 1.25, trust: 0.55, maxRoundMove: 0.7, windowRounds: 1.4 },
  };
  const OUTLOOK_ALIASES = Object.freeze({ "super-high": "very-positive", "super-positive": "very-positive", "super-negative": "very-negative" });

  const ESPN_TEAM_LOGO_SLUGS = Object.freeze({ ARI: "ari", ATL: "atl", BAL: "bal", BUF: "buf", CAR: "car", CHI: "chi", CIN: "cin", CLE: "cle", DAL: "dal", DEN: "den", DET: "det", GB: "gb", HOU: "hou", IND: "ind", JAX: "jax", KC: "kc", LV: "lv", LAC: "lac", LAR: "lar", MIA: "mia", MIN: "min", NE: "ne", NO: "no", NYG: "nyg", NYJ: "nyj", PHI: "phi", PIT: "pit", SEA: "sea", SF: "sf", TB: "tb", TEN: "ten", WAS: "wsh", WSH: "wsh" });

  function espnTeamLogoUrl(team) {
    const slug = ESPN_TEAM_LOGO_SLUGS[String(team || "").toUpperCase()];
    return slug ? `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png` : "";
  }

  function espnPlayerHeadshotUrl(player) {
    const id = String(player?.espnPlayerId || player?.id || "");
    if (player?.position === "DST" || !/^\d+$/.test(id)) return "";
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${encodeURIComponent(id)}.png`;
  }

  function playerIdentityMarkup(player, primaryExtras = "", secondary = "") {
    const logo = espnTeamLogoUrl(player?.team);
    const headshot = espnPlayerHeadshotUrl(player);
    const media = headshot
      ? `<span class="player-media"><img class="player-headshot" src="${headshot}" alt="" loading="lazy" decoding="async" onerror="this.hidden=true;this.parentElement.classList.add('team-only')">${logo ? `<img class="player-team-logo" src="${logo}" alt="${esc(player.team)} logo" loading="lazy" decoding="async" onerror="this.hidden=true">` : ""}</span>`
      : logo ? `<span class="player-media team-only"><img class="player-team-logo" src="${logo}" alt="${esc(player.team)} logo" loading="lazy" decoding="async" onerror="this.hidden=true"></span>` : "";
    const meta = secondary || `${esc(player?.position || "")} · ${esc(player?.team || "FA")}`;
    return `<span class="player-identity">${media}<span class="player-identity-copy"><strong>${esc(player?.name || "Unknown")}${primaryExtras}</strong><small>${meta}</small></span></span>`;
  }

  function playerOutlook(playerId) {
    const stored = state.playerOutlooks?.[String(playerId)] || "unknown";
    const key = OUTLOOK_ALIASES[stored] || stored;
    return { key, ...(PLAYER_OUTLOOKS[key] || PLAYER_OUTLOOKS.unknown) };
  }

  function playerPassed(playerId) {
    return Boolean(state.playerPasses?.[String(playerId)]);
  }

  function outlookTeamCount() {
    if (hasEspnMyLeagueAccess()) return Math.round(clamp(Number(currentLeagueSettings()?.teams || 12), 4, 20));
    return Math.round(clamp(Number($("#outlook-teams")?.value || 12), 4, 20));
  }

  function outlookBoardSettings() {
    const settings = currentDraftSettings();
    settings.teams = outlookTeamCount();
    return settings;
  }

  function syncOutlookTeamControl() {
    const select = $("#outlook-teams");
    if (!select) return;
    const synced = hasEspnMyLeagueAccess();
    const teams = outlookTeamCount();
    if (![...select.options].some((option) => Number(option.value) === teams)) select.add(new Option(String(teams), String(teams)));
    select.value = String(teams);
    select.disabled = synced;
    const source = $("#outlook-team-source");
    if (source) source.textContent = synced ? `${teams}-team league · synced` : `${teams}-team board · manual`;
    const guide = $("#outlook-round-guide");
    if (guide) guide.textContent = `${teams} teams · Round 1 = picks 1–${teams} · Round 2 = picks ${teams + 1}–${teams * 2}`;
  }

  async function savePlayerOutlook(playerId, key) {
    const id = String(playerId);
    const normalized = PLAYER_OUTLOOKS[key] ? key : "unknown";
    if (normalized === "unknown") delete state.playerOutlooks[id];
    else state.playerOutlooks[id] = normalized;
    await store.set("player-outlooks", state.playerOutlooks);
    renderPlayerOutlooks();
    if ($("#draft")?.classList.contains("active")) renderDraft();
  }

  async function savePlayerPass(playerId, passed) {
    const id = String(playerId);
    if (passed) state.playerPasses[id] = true;
    else delete state.playerPasses[id];
    await store.set("player-passes", state.playerPasses);
    renderPlayerOutlooks();
    if ($("#draft")?.classList.contains("active")) renderDraft();
  }

  async function saveOutlookRoundLock(locked) {
    state.outlookRoundLock = Boolean(locked);
    await store.set("outlook-round-lock", state.outlookRoundLock);
    renderPlayerOutlooks();
  }

  function espnOverallRank(player) {
    // ESPN ADP is an overall market number; consensus averageRank may be positional.
    const candidates = [player?.market?.averageDraftPosition, player?.adp, player?.pprRank, player?.market?.consensusPprRank];
    const value = candidates.map(Number).find((rank) => Number.isFinite(rank) && rank > 0);
    return value ?? 9999;
  }

  function buildOutlookRankContext(settings = outlookBoardSettings()) {
    const espnOverall = [...state.players].sort((a, b) => espnOverallRank(a) - espnOverallRank(b) || String(a.name).localeCompare(String(b.name)));
    const espnOverallRankMap = new Map(espnOverall.map((player, index) => [String(player.id), index + 1]));
    const espnPositionRank = new Map();
    const positions = [...new Set(state.players.map((player) => player.position).filter(Boolean))];
    for (const position of positions) {
      const pool = espnOverall.filter((player) => player.position === position);
      pool.forEach((player, index) => espnPositionRank.set(String(player.id), index + 1));
    }
    const modelBoard = oracleDraftBoard(settings);
    const modelOverallRank = new Map(modelBoard.map((player, index) => [String(player.id), index + 1]));
    const modelPositionRank = new Map();
    for (const position of positions) {
      modelBoard.filter((player) => player.position === position).forEach((player, index) => modelPositionRank.set(String(player.id), index + 1));
    }
    return { espnOverallRankMap, espnPositionRank, modelBoard, modelOverallRank, modelPositionRank, maxRank: modelBoard.length, teams: Math.max(4, Math.min(20, Number(settings?.teams || 12))) };
  }

  function outlookResidualContext(player, outlook, rankContext) {
    const id = String(player?.id || "");
    const espnOverall = Number(rankContext.espnOverallRankMap.get(id));
    const snapOverall = Number(rankContext.modelOverallRank.get(id));
    const espnPositionRank = Number(rankContext.espnPositionRank.get(id));
    const snapPositionRank = Number(rankContext.modelPositionRank.get(id));
    const targetDelta = rankContext.teams * Number(outlook.targetRoundMove || 0);
    const targetOverall = outlook.reviewed && outlook.direction !== 0 && Number.isFinite(espnOverall)
      ? clamp(espnOverall - outlook.direction * targetDelta, 1, rankContext.maxRank)
      : espnOverall;
    const rawResidual = Number.isFinite(targetOverall) && Number.isFinite(snapOverall) ? targetOverall - snapOverall : 0;
    const residualPicks = outlook.direction > 0 ? Math.min(0, rawResidual) : outlook.direction < 0 ? Math.max(0, rawResidual) : 0;
    const maxBoardMove = rankContext.teams * Number(outlook.maxRoundMove || 0);
    const boardDelta = clamp(residualPicks * Number(outlook.trust || 0), -maxBoardMove, maxBoardMove);
    const alreadyReflected = Boolean(outlook.reviewed && outlook.direction !== 0 && Math.abs(residualPicks) < 0.75);
    return { espnOverall, snapOverall, espnPositionRank, snapPositionRank, targetOverall, residualPicks, boardDelta, alreadyReflected };
  }

  function buildPersonalizedOutlookBoard(settings = outlookBoardSettings()) {
    const rankContext = buildOutlookRankContext(settings);
    const rows = rankContext.modelBoard.map((player) => {
      const outlook = playerOutlook(player.id);
      const residual = outlookResidualContext(player, outlook, rankContext);
      const personalizedScore = residual.snapOverall + residual.boardDelta;
      const espnRound = Math.ceil(Number(residual.espnOverall || 9999) / rankContext.teams);
      return { ...player, outlook, residual, personalizedScore, espnRound, passed: playerPassed(player.id) };
    });
    const freeRows = [...rows].sort((a, b) => a.personalizedScore - b.personalizedScore || a.residual.snapOverall - b.residual.snapOverall);
    const freeRank = new Map(freeRows.map((row, index) => [String(row.id), index + 1]));
    const ordered = state.outlookRoundLock
      ? [...rows].sort((a, b) => a.espnRound - b.espnRound || a.personalizedScore - b.personalizedScore || a.residual.snapOverall - b.residual.snapOverall)
      : freeRows;
    return ordered.map((row, index) => {
      const rawPersonalRank = Number(freeRank.get(String(row.id)) || index + 1);
      return { ...row, personalRank: index + 1, rawPersonalRank, boardChange: row.residual.snapOverall - (index + 1), freeBoardChange: row.residual.snapOverall - rawPersonalRank };
    });
  }

  function applyPlayerOutlookOverlay(rows = [], settings = {}, limit = rows.length) {
    const teams = Math.max(4, Math.min(20, Number(settings?.teams || 12)));
    const currentPick = Math.max(1, Number(state.draftState?.picks?.length || 0) + 1);
    const rankContext = buildOutlookRankContext({ ...settings, teams });
    return rows.filter((row) => !playerPassed(row.id)).map((row, index) => {
      const outlook = playerOutlook(row.id);
      const qualifiedRank = index + 1;
      const residual = outlookResidualContext(row, outlook, rankContext);
      const marketRank = residual.espnOverall;
      const windowPicks = Math.max(1, teams * Number(outlook.windowRounds || 0));
      const distanceToMarket = Number.isFinite(marketRank) ? Math.max(0, marketRank - currentPick) : 0;
      const readiness = outlook.reviewed && outlook.direction !== 0 && windowPicks > 0 ? clamp(1 - distanceToMarket / windowPicks, 0, 1) : 0;
      const returnChance = Number.isFinite(Number(row.returnChance)) ? Number(row.returnChance) : 0.5;
      const urgency = 0.82 + (1 - clamp(returnChance, 0, 1)) * 0.18;
      const maxMovePicks = teams * Number(outlook.maxRoundMove || 0);
      const outlookMovePicks = clamp(-residual.residualPicks * Number(outlook.trust || 0) * readiness * urgency, -maxMovePicks, maxMovePicks);
      const personalizedOrder = qualifiedRank - outlookMovePicks;
      const outlookTimingLabel = !outlook.reviewed || outlook.direction === 0 ? "No draft nudge"
        : residual.alreadyReflected ? "Already reflected by SnapCount"
          : readiness < 0.08 ? "Saved — waiting for market range"
            : Math.abs(outlookMovePicks) < 0.1 ? "Model and outlook nearly agree"
              : readiness < 0.55 ? "Residual view starting to matter" : "Residual view active";
      const basis = Number.isFinite(residual.espnOverall) && Number.isFinite(residual.snapOverall)
        ? `ESPN #${Math.round(residual.espnOverall)} → your view about #${Math.round(residual.targetOverall)}; SnapCount #${Math.round(residual.snapOverall)}` : "ESPN comparison unavailable";
      return { ...row, qualifiedRank, personalOutlook: outlook.key, outlookLabel: outlook.label, outlookReviewed: outlook.reviewed,
        outlookAdjustment: Number(outlookMovePicks.toFixed(2)), outlookReadiness: Number(readiness.toFixed(3)), outlookTimingLabel,
        outlookBasisLabel: basis, espnOverallRank: residual.espnOverall, snapOverallRank: residual.snapOverall,
        espnPositionRank: residual.espnPositionRank, snapPositionRank: residual.snapPositionRank,
        outlookTargetOverallRank: residual.targetOverall, personalizedOrder };
    }).sort((a, b) => a.personalizedOrder - b.personalizedOrder || a.qualifiedRank - b.qualifiedRank)
      .map((row, index) => ({ ...row, personalRank: index + 1 })).slice(0, Math.max(1, Number(limit || rows.length)));
  }

  function outlookChangeMarkup(change) {
    const delta = Math.round(Number(change || 0));
    if (!delta) return '<span class="outlook-change unchanged">—</span>';
    return `<span class="outlook-change ${delta > 0 ? "up" : "down"}">${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)}</span>`;
  }

  function outlookMarketValueSignal(espnRank, adjustedRank, teams) {
    const market = Number(espnRank);
    const truth = Number(adjustedRank);
    const threshold = Math.max(2, Math.round(Number(teams || 12) * 0.18));
    if (!Number.isFinite(market) || !Number.isFinite(truth)) return { key: "unknown", label: "—", edge: 0, threshold };
    const edge = Math.round(market - truth);
    if (edge >= threshold) return { key: "undervalued", label: `Undervalued +${edge}`, edge, threshold };
    if (edge <= -threshold) return { key: "overvalued", label: `Overvalued ${edge}`, edge, threshold };
    return { key: "fair", label: `Fair ${edge > 0 ? "+" : ""}${edge}`, edge, threshold };
  }

  function renderPlayerOutlooks() {
    const table = $("#outlook-table");
    if (!table || !state.players.length) return;
    syncOutlookTeamControl();
    const lock = $("#outlook-round-lock");
    if (lock) lock.checked = Boolean(state.outlookRoundLock);
    const settings = outlookBoardSettings();
    const teams = outlookTeamCount();
    const query = $("#outlook-search")?.value || "";
    const position = $("#outlook-position")?.value || "ALL";
    const filter = $("#outlook-filter")?.value || "all";
    let rows = buildPersonalizedOutlookBoard(settings).filter((row) => (position === "ALL" || row.position === position) && playerMatchesSearch(row, query));
    if (filter === "rated") rows = rows.filter((row) => row.outlook.reviewed);
    if (filter === "unknown") rows = rows.filter((row) => !row.outlook.reviewed);
    if (filter === "passed") rows = rows.filter((row) => row.passed);
    rows = rows.slice(0, 180);
    const options = Object.entries(PLAYER_OUTLOOKS).map(([key, row]) => `<option value="${key}">${esc(row.label)}</option>`).join("");
    let previousRound = null;
    table.innerHTML = rows.map((row) => {
      const outlook = row.outlook;
      const ranks = row.residual;
      const round = Math.ceil(row.personalRank / teams);
      const roundStart = (round - 1) * teams + 1;
      const roundEnd = round * teams;
      const separator = round !== previousRound ? `<tr class="outlook-round-row"><td colspan="8"><span>ROUND ${round}</span><small>Picks ${roundStart}–${roundEnd}</small></td></tr>` : "";
      previousRound = round;
      const basis = row.passed ? "PASS — excluded from your personalized draft recommendations."
        : !outlook.reviewed ? "No personal view yet — My Board matches SnapCount."
          : outlook.direction === 0 ? `Reviewed neutral · no personal adjustment from SnapCount #${ranks.snapOverall}.`
            : ranks.alreadyReflected ? `Already reflected — SnapCount #${ranks.snapOverall} is already at least as ${outlook.direction > 0 ? "bullish" : "bearish"} as your view.`
              : `ESPN #${ranks.espnOverall} → your view about #${Math.round(ranks.targetOverall)} · SnapCount #${ranks.snapOverall} · My Board #${row.personalRank}.`;
      const adjustedLabel = state.outlookRoundLock && row.rawPersonalRank !== row.personalRank ? `#${row.rawPersonalRank}<small>free sort</small>` : `#${row.rawPersonalRank}`;
      const valueSignal = outlookMarketValueSignal(ranks.espnOverall, row.rawPersonalRank, teams);
      return `${separator}<tr class="${row.passed ? "outlook-pass-row" : ""}" data-outlook-tone="${esc(outlook.tone)}" data-personal-rank="${row.personalRank}" data-free-rank="${row.rawPersonalRank}" data-espn-rank="${ranks.espnOverall}" data-snap-rank="${ranks.snapOverall}" data-value-signal="${valueSignal.key}" data-value-edge="${valueSignal.edge}" data-value-threshold="${valueSignal.threshold}" data-board-change="${row.boardChange}" data-player-passed="${row.passed ? "true" : "false"}"><td class="board-rank-cell"><strong>${row.personalRank}</strong><small>R${round}</small></td><td class="player-cell player-cell-visual">${playerIdentityMarkup(row)}${row.passed ? '<span class="outlook-pass-badge">PASS</span>' : ""}</td><td><span class="rank-source-chip espn">ESPN #${Math.round(ranks.espnOverall)}</span></td><td><span class="rank-source-chip snap">SNAP #${Math.round(ranks.snapOverall)}</span></td><td><span class="outlook-adjusted-rank">${adjustedLabel}</span></td><td><span class="outlook-value-signal ${valueSignal.key}" title="ESPN #${Math.round(ranks.espnOverall)} vs adjusted #${row.rawPersonalRank}">${esc(valueSignal.label)}</span></td><td>${outlookChangeMarkup(row.boardChange)}</td><td class="outlook-control-cell"><div><select class="outlook-select ${esc(outlook.tone)}" data-player-outlook="${esc(row.id)}" aria-label="Outlook for ${esc(row.name)}">${options}</select><button type="button" class="outlook-pass-toggle ${row.passed ? "active" : ""}" data-player-pass="${esc(row.id)}" aria-pressed="${row.passed ? "true" : "false"}">${row.passed ? "Passed" : "Pass"}</button><span class="outlook-chip ${esc(outlook.tone)}">${esc(outlook.reviewed ? outlook.label : "No opinion yet")}</span></div><small class="outlook-basis">${esc(basis)}</small></td></tr>`;
    }).join("");
    $$('[data-player-outlook]').forEach((select) => { select.value = playerOutlook(select.dataset.playerOutlook).key; select.addEventListener("change", () => savePlayerOutlook(select.dataset.playerOutlook, select.value).catch((error) => status(error.message, "error"))); });
    $$('[data-player-pass]').forEach((button) => button.addEventListener("click", () => savePlayerPass(button.dataset.playerPass, !playerPassed(button.dataset.playerPass)).catch((error) => status(error.message, "error"))));
    const rated = Object.keys(state.playerOutlooks || {}).length;
    const passed = Object.keys(state.playerPasses || {}).length;
    $("#outlook-count").textContent = `${rows.length} shown · ${rated} rated · ${passed} passed · ${state.outlookRoundLock ? "round-locked" : "free sort"}`;
  }

  function historyKey(player, season = Number($("#history-season")?.value || 2025)) {
    return `${player?.id || "unknown"}:${season}`;
  }

  function fillWeeks() {
    const options = Array.from({ length: 18 }, (_, index) => `<option value="${index + 1}">Week ${index + 1}</option>`).join("");
    ["#player-week", "#lineup-week", "#waiver-week", "#trade-week", "#rankings-week"].forEach((selector) => { $(selector).innerHTML = options; });
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

  function openRankedPlayer(id) {
    const player = playerById(id);
    if (!player) return;
    $("#player-search").value = "";
    fillPlayerPicker("#player-select", "");
    $("#player-select").value = String(player.id);
    renderNewsPulse();
    activatePanel("player");
  }

  function renderPublicRankings() {
    const table = $("#rankings-table");
    if (!table || !state.players.length) return;
    const query = $("#rankings-search")?.value || "";
    const position = $("#rankings-position")?.value || "ALL";
    const view = $("#rankings-view")?.value || "overall";
    const week = Number($("#rankings-week")?.value || 1);
    let rows = rankedPlayers().filter((player) => (position === "ALL" || player.position === position) && playerMatchesSearch(player, query));
    if (view === "week") rows.sort((a, b) => baselineWeekProjection(b, week) - baselineWeekProjection(a, week) || (a.pprRank || 9999) - (b.pprRank || 9999));
    rows = rows.slice(0, 120);
    table.innerHTML = rows.map((player, index) => {
      const overall = Number(player.pprRank || player.adp || 0);
      const adp = Number(player.adp || 0);
      return `<tr><td class="board-rank-cell">${index + 1}</td><td class="player-cell player-cell-visual">${playerIdentityMarkup(player)}</td><td><span class="pos-pill pos-${esc(String(player.position || "").toLowerCase())}">${esc(player.position)}</span></td><td><b>${num(baselineWeekProjection(player, week))}</b></td><td>${overall ? "#" + Math.round(overall) : "—"}</td><td>${adp ? num(adp, 1) : "—"}</td><td><button class="mini-button" data-rank-player="${esc(player.id)}">View player</button></td></tr>`;
    }).join("");
    $("#rankings-count").textContent = `${rows.length} players · Week ${week}`;
    const top = rankedPlayers().slice(0, 5);
    if ($("#home-top-players")) $("#home-top-players").innerHTML = top.map((player, index) => `<button class="home-player-row" data-rank-player="${esc(player.id)}"><span>${index + 1}</span><strong>${esc(player.name)}</strong><small>${esc(player.position)} · ${esc(player.team || "FA")}</small></button>`).join("");
    $$('[data-rank-player]').forEach((button) => button.addEventListener("click", () => openRankedPlayer(button.dataset.rankPlayer)));
  }

  async function renderHomeBenchmark() {
    const node = $("#home-benchmark-chart");
    if (!node) return;
    try {
      const report = await fetch("./data/validation/site-benchmark-2018.json", { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); });
      const rows = Array.isArray(report.rows) ? report.rows : [];
      const max = Math.max(1, ...rows.map((row) => Number(row.meanRealizedStarterPoints || 0)));
      node.innerHTML = rows.map((row) => {
        const value = Number(row.meanRealizedStarterPoints || 0); const width = Math.max(2, value / max * 100); const baseline = row.name !== "SnapCount";
        return `<div class="benchmark-row ${baseline ? "baseline" : "snapcount"}"><span class="benchmark-label"><b>${esc(row.name)}</b><small>${esc(row.sourceNote || "Historical draft board")}</small></span><div class="benchmark-track"><div class="benchmark-fill" style="width:${width.toFixed(1)}%"></div></div><strong class="benchmark-value">${Math.round(value).toLocaleString()} pts</strong></div>`;
      }).join("");
      if ($("#benchmark-season-label")) $("#benchmark-season-label").textContent = `${report.season} frozen holdout · ${rows[0]?.drafts || 0} paired drafts`;
      if ($("#home-benchmark-note")) $("#home-benchmark-note").textContent = `ESPN uses its historical 2018 PPR ADP. Yahoo, CBS, NFL.com, and FantasyPros use archived 2018 draft boards on the dates shown above. ${report.disclaimer}`;
    } catch (error) {
      node.innerHTML = `<p class="fineprint">Benchmark evidence is unavailable in this build.</p>`;
      if ($("#home-benchmark-note")) $("#home-benchmark-note").textContent = error.message;
    }
  }

  function hasEspnMyLeagueAccess() {
    const team = espnTeamById(state.espnConnection?.teamId);
    return Boolean(team && state.espnLeague && state.leagueState?.provider === "espn");
  }

  function setMyLeagueMenuOpen(open) {
    const menu = $("#my-league-menu");
    const button = $("#my-league-menu-button");
    if (!menu || !button) return;
    menu.classList.toggle("hidden", !open);
    button.setAttribute("aria-expanded", String(Boolean(open)));
  }

  function syncMyLeagueMenuAccess() {
    const enabled = hasEspnMyLeagueAccess();
    $(".app-shell")?.classList.toggle("league-connected", enabled);
    $$(".league-only").forEach((node) => node.classList.toggle("hidden", !enabled));
    const draftButtons = $$('[data-nav-key="draft"], [data-global-route="draft"]');
    draftButtons.forEach((button) => { button.dataset.draftContext = enabled ? "league" : "public"; });
    const tradeButton = $('[data-nav-key="trades"]');
    if (tradeButton) tradeButton.dataset.tradeMode = enabled ? "league" : "basic";
    $("#trade-mode-switch")?.classList.toggle("hidden", !enabled);
  }

  function renderMyLeagueAccess() {
    const enabled = hasEspnMyLeagueAccess();
    const team = enabled ? espnTeamById(state.espnConnection?.teamId) : null;
    $("#league-tools-panel")?.classList.toggle("hidden", !enabled);
    $("#show-espn-connect")?.classList.toggle("hidden", enabled);
    $("#use-any-league")?.classList.toggle("hidden", !enabled);
    $("#manual-league-card")?.classList.toggle("hidden", !enabled);
    syncMyLeagueMenuAccess();
    const switcher = $("#sidebar-sync-button");
    switcher?.classList.toggle("connected", enabled);
    if ($("#sidebar-sync-title")) $("#sidebar-sync-title").textContent = team ? team.name : "Sync a League";
    if ($("#sidebar-sync-copy")) $("#sidebar-sync-copy").textContent = team ? (state.espnLeague?.name || "ESPN Fantasy") : "Unlock lineup, waivers & more";
    if ($("#mobile-sync-button")) $("#mobile-sync-button").textContent = enabled ? "League" : "Sync League";
    const homeSync = $("#home-sync-cta");
    homeSync?.classList.toggle("connected", enabled);
    if (homeSync) homeSync.innerHTML = team ? `<strong>Open ${esc(team.name)}</strong><span>view your personalized league tools →</span>` : `<strong>Sync your league</strong><span>for roster, opponent, schedule, waiver, and season context →</span>`;
    if ($("#use-any-league")) $("#use-any-league").textContent = "League settings";
    if ($("#my-league-settings")) $("#my-league-settings").open = !enabled;
    if ($("#open-league-settings")) $("#open-league-settings").textContent = enabled ? "League settings" : "Connect ESPN";
    if (team) {
      $("#my-league-title").textContent = team.name;
      return;
    }
    $("#my-league-title").textContent = "Connect ESPN to unlock My League.";
    $("#rail-context-kicker").textContent = "ESPN REQUIRED";
    $("#rail-context-team").textContent = "Connect your ESPN league";
    $("#rail-context-week").textContent = "Paste your ESPN league link or ID, then choose your team.";
    $("#hero-lede").textContent = "Link your ESPN fantasy league and choose your team first. SnapCount will then unlock your league-specific draft, lineup, waivers, season, and trade ideas.";
  }

  function openMyLeagueDestination(target) {
    setMyLeagueMenuOpen(false);
    if (target === "myleague") return activatePanel("myleague");
    if (!hasEspnMyLeagueAccess()) {
      activatePanel("myleague");
      return focusEspnSetup();
    }
    if (target === "trade-ideas") return activatePanel("trade-ideas", { leagueContext: true });
    if (target === "draft") return activatePanel("draft", { draftContext: "league" });
    return activatePanel(target, { leagueContext: true });
  }

  function activatePanel(name, options = {}) {
    const leaguePanels = new Set(["lineup", "trade-ideas", "waivers", "league"]);
    const requestedDraftContext = name === "draft" ? (options.draftContext || "public") : null;
    const leagueDraft = name === "draft" && requestedDraftContext === "league";
    const blocked = (leaguePanels.has(name) || leagueDraft) && !hasEspnMyLeagueAccess();
    if (blocked) name = "myleague";
    if (name === "draft") setDraftContext(leagueDraft && !blocked ? "league" : "public");
    const navKey = name === "overview" ? "home" : name === "myleague" ? "team" : name;
    $$(".context-nav-item").forEach((item) => item.classList.toggle("active", item.dataset.navKey === navKey));
    const globalKey = name === "draft" ? "draft"
      : name === "rankings" ? "rankings"
      : (name === "player" || name === "outlooks") ? "player"
      : (name === "myleague" || leaguePanels.has(name) || (name === "trades" && state.tradeAnalysisMode === "league")) ? "myleague"
      : "overview";
    $$(".global-nav-item").forEach((item) => item.classList.toggle("active", item.dataset.globalRoute === globalKey));
    $("#sidebar-sync-button")?.classList.toggle("active", name === "myleague");
    $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
    setMyLeagueMenuOpen(false);
    if (name === "rankings") renderPublicRankings();
    if (name === "overview") renderHomeBenchmark();
    if (name === "outlooks") renderPlayerOutlooks();
    if (name === "draft") renderDraft();
    $(".app-shell")?.classList.remove("nav-open");
    status(blocked ? "Connect ESPN and choose your team to unlock this My League tool." : "");
    const hash = name === "draft" && state.draftContext === "league" ? "league-draft" : name;
    history.replaceState(null, "", `#${hash}`);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function currentLeagueProfile() {
    if (state.leagueProfile) return state.leagueProfile;
    return leagueApi.normalizeProfile({ source: "manual", teams: 12, scoring: "ppr", slots: { ...core.DEFAULT_SETTINGS.slots, BN: 7 } });
  }

  function currentLeagueSettings() {
    return core.cloneSettings(currentLeagueProfile().settings);
  }

  function scoringLabel(scoring) {
    if (scoring === "half-ppr") return "Half PPR";
    if (scoring === "standard") return "Standard";
    if (scoring === "superflex") return "PPR Superflex";
    if (scoring === "custom") return "Custom scoring";
    return "PPR";
  }

  function leagueProfileSummary(profile = currentLeagueProfile()) {
    const settings = core.cloneSettings(profile.settings);
    const slots = settings.slots;
    const starters = [
      slots.QB ? `${slots.QB} QB` : null,
      slots.RB ? `${slots.RB} RB` : null,
      slots.WR ? `${slots.WR} WR` : null,
      slots.TE ? `${slots.TE} TE` : null,
      slots.FLEX ? `${slots.FLEX} FLEX` : null,
      slots.SUPERFLEX ? `${slots.SUPERFLEX} SF` : null,
      slots.DST ? `${slots.DST} D/ST` : null,
      slots.K ? `${slots.K} K` : null,
    ].filter(Boolean).join(" · ");
    return `${settings.teams}-team ${scoringLabel(settings.scoring)} · ${starters || "custom starters"}`;
  }

  function leagueProfileFromForm(source = "manual") {
    const scoring = $("#manual-league-scoring")?.value || "ppr";
    let customScoring = null;
    if (scoring === "custom") {
      const text = String($("#manual-custom-scoring")?.value || "").trim();
      if (!text) throw new Error("Custom scoring needs an exact scoring-rules JSON definition.");
      try { customScoring = JSON.parse(text); } catch (_) { throw new Error("Custom scoring rules must be valid JSON."); }
    }
    return leagueApi.normalizeProfile({
      source,
      teams: Number($("#manual-league-teams")?.value || 12),
      scoring,
      customScoring,
      slots: {
        QB: Number($("#manual-slot-qb")?.value || 0), RB: Number($("#manual-slot-rb")?.value || 0),
        WR: Number($("#manual-slot-wr")?.value || 0), TE: Number($("#manual-slot-te")?.value || 0),
        FLEX: Number($("#manual-slot-flex")?.value || 0), SUPERFLEX: Number($("#manual-slot-superflex")?.value || 0),
        DST: Number($("#manual-slot-dst")?.value || 0), K: Number($("#manual-slot-k")?.value || 0), BN: Number($("#manual-slot-bn")?.value || 0),
      },
    });
  }

  function populateLeagueProfileForm(profile = currentLeagueProfile()) {
    const settings = core.cloneSettings(profile.settings);
    if (!$("#manual-league-teams")) return;
    $("#manual-league-teams").value = String(settings.teams);
    $("#manual-league-scoring").value = ["ppr", "half-ppr", "standard", "custom"].includes(settings.scoring) ? settings.scoring : "ppr";
    if ($("#manual-custom-scoring")) $("#manual-custom-scoring").value = settings.customScoring ? JSON.stringify(settings.customScoring, null, 2) : "";
    if ($("#manual-custom-scoring-wrap")) $("#manual-custom-scoring-wrap").classList.toggle("hidden", settings.scoring !== "custom");
    const ids = { QB: "qb", RB: "rb", WR: "wr", TE: "te", FLEX: "flex", SUPERFLEX: "superflex", DST: "dst", K: "k", BN: "bn" };
    for (const [slot, id] of Object.entries(ids)) $("#manual-slot-" + id).value = String(settings.slots[slot] || 0);
    $("#manual-profile-summary").textContent = leagueProfileSummary(profile);
    $("#manual-profile-state").textContent = profile.source === "espn" ? "Autofilled from ESPN" : profile.source === "manual-override" ? "Manual override" : hasEspnMyLeagueAccess() ? "ESPN connected" : "Connect ESPN first";
  }

  function syncDraftControlsToLeagueProfile() {
    if (state.draftContext !== "league" || state.draftState?.picks?.length) return;
    const settings = currentLeagueSettings();
    $("#draft-teams").value = String(settings.teams);
    if (["ppr", "half-ppr", "standard", "custom"].includes(settings.scoring)) $("#draft-scoring").value = settings.scoring;
    $("#draft-qb-format").value = Number(settings.slots.QB) >= 2 ? "two-qb" : Number(settings.slots.SUPERFLEX) > 0 ? "superflex" : "one-qb";
    const rosterSize = Object.values(settings.slots).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
    if (rosterSize >= 6 && rosterSize <= 24) $("#draft-rounds").value = String(rosterSize);
  }

  async function saveManualLeagueProfile() {
    if (!hasEspnMyLeagueAccess()) return status("Connect ESPN and choose your team before changing My League settings.", "error");
    state.leagueProfile = leagueProfileFromForm("manual-override");
    if (state.leagueMeta) state.leagueMeta.settings = currentLeagueSettings();
    await store.set("league-profile", state.leagueProfile);
    populateLeagueProfileForm();
    syncDraftControlsToLeagueProfile();
    if (!state.draftState?.picks?.length) resetDraft();
    renderEspnConnection();
    status(`League rules saved: ${leagueProfileSummary()}.`, "good");
  }

  async function resetManualLeagueProfile() {
    if (!hasEspnMyLeagueAccess()) return status("Connect ESPN and choose your team before changing My League settings.", "error");
    const espnSettings = state.espnLeague?.settings || null;
    state.leagueProfile = espnSettings?.supported
      ? leagueApi.normalizeProfile({ ...espnSettings, source: "espn", provider: "espn" })
      : leagueApi.normalizeProfile({ source: "manual-override", teams: state.espnLeague?.teams?.length || 12, scoring: "ppr", slots: { ...core.DEFAULT_SETTINGS.slots, BN: 7 } });
    await store.set("league-profile", state.leagueProfile);
    populateLeagueProfileForm();
    syncDraftControlsToLeagueProfile();
    if (!state.draftState?.picks?.length) resetDraft();
    renderEspnConnection();
    status("ESPN league rules restored.", "good");
  }

  function focusManualLeagueSetup() {
    if (!hasEspnMyLeagueAccess()) return focusEspnSetup();
    activatePanel("myleague");
    if ($("#my-league-settings")) $("#my-league-settings").open = true;
    $("#manual-league-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => $("#manual-league-teams")?.focus(), 250);
  }

  function focusEspnSetup() {
    activatePanel("myleague");
    if ($("#my-league-settings")) $("#my-league-settings").open = true;
    $(".league-connect-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => $("#espn-league-input")?.focus(), 250);
  }


  async function readLeagueImport() {
    const file = $("#league-import-file")?.files?.[0] || null;
    let text = String($("#league-import-text")?.value || "").trim();
    if (file) text = await file.text();
    const league = leagueApi.parseLeagueImport(text, state.players);
    state.pendingLeagueImport = league;
    const select = $("#league-import-team-select");
    select.innerHTML = league.teams.map((team) => '<option value="' + esc(team.teamId) + '">' + esc(team.name) + (team.ownerName ? ' · ' + esc(team.ownerName) : '') + '</option>').join("");
    if (league.userTeamId && league.teams.some((team) => String(team.teamId) === String(league.userTeamId))) select.value = String(league.userTeamId);
    $("#league-import-team-step").classList.remove("hidden");
    const weeks = Object.keys(league.fantasySchedule || {}).length;
    $("#league-import-status").textContent = league.name + " · " + league.teams.length + " teams · " + league.recognizedPlayers + " players recognized" + (league.unmatchedPlayers ? " · " + league.unmatchedPlayers + " unmatched" : "") + " · " + weeks + " schedule weeks";
    return league;
  }

  async function useLeagueImport() {
    const league = state.pendingLeagueImport;
    if (!league) throw new Error("Read a league JSON or CSV file first.");
    const teamId = $("#league-import-team-select")?.value;
    const team = await applyLeagueState(league, teamId, true);
    $("#league-import-status").textContent = league.name + " · " + team.name + " is active.";
    status("Imported league is active. Roster, schedule, lineup locks, and known transaction rules will now constrain decisions.", "good");
  }

  function loadLeagueImportExample() {
    $("#league-import-text").value = JSON.stringify(leagueApi.leagueImportTemplate(), null, 2);
    $("#league-import-file").value = "";
    $("#league-import-status").textContent = "Example loaded. Replace the sample teams and players with your league data, then read it.";
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


  function activeLeagueState() {
    return state.leagueState || null;
  }

  function connectedLeagueTeam(teamId = state.connectedTeamId || activeLeagueState()?.userTeamId || state.espnConnection?.teamId) {
    if (!teamId) return null;
    return activeLeagueState()?.teams?.find((team) => String(team.teamId) === String(teamId)) || null;
  }

  function hydratedLeagueTeams(league = activeLeagueState()) {
    return (league?.teams || []).map((team) => ({
      ...team,
      roster: (team.rosterIds || []).map((id) => playerById(id)).filter(Boolean),
    }));
  }

  function connectedUserTeamId() {
    const value = state.connectedTeamId || activeLeagueState()?.userTeamId || state.espnConnection?.teamId;
    return value ? String(value) : null;
  }

  function liveLineupConstraintsForTeam(teamId, week) {
    const league = activeLeagueState();
    if (!league || Number(week) !== Number(league.currentWeek || 1)) return {};
    const team = league.teams?.find((row) => String(row.teamId) === String(teamId));
    if (!team) return {};
    const constraints = leagueApi.lineupConstraintsForTeam(team, state.players, state.schedule, week, {
      lineupLockType: league.settings?.lineupLockType || currentLeagueProfile().lineupLockType,
    });
    return constraints.available ? constraints : {};
  }

  function currentWeekLeagueConstraintsByTeam(week) {
    const league = activeLeagueState();
    if (!league || Number(week) !== Number(league.currentWeek || 1)) return {};
    return Object.fromEntries((league.teams || []).map((team) => [String(team.teamId), liveLineupConstraintsForTeam(team.teamId, week)]));
  }

  function currentWeekLeagueFinalScoresByTeam(week) {
    const constraints = currentWeekLeagueConstraintsByTeam(week);
    return Object.fromEntries(Object.entries(constraints).map(([teamId, state]) => [teamId, Object.fromEntries((state.entries || [])
      .filter((entry) => entry.final === true && Number.isFinite(Number(entry.currentPoints)))
      .map((entry) => [String(entry.playerId), Number(entry.currentPoints)]))]));
  }

  function currentLockedPlayerIds(teamId, week) {
    return liveLineupConstraintsForTeam(teamId, week).lockedPlayerIds || [];
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
    return leagueApi.starterCoverage(roster || [], currentLeagueSettings());
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

  function transactionRosterUsage(teamId = connectedUserTeamId()) {
    const team = connectedLeagueTeam(teamId);
    if (!team) return { active: rosterPlayers().length, ir: 0, entryByPlayer: new Map() };
    const entries = Array.isArray(team.rosterEntries) ? team.rosterEntries : [];
    const entryByPlayer = new Map(entries.map((entry) => [String(entry.playerId), entry]));
    if (!entries.length || (team.unmatchedPlayers || []).length) return { active: null, ir: team.transactions?.irUsed ?? null, entryByPlayer };
    const ir = entries.filter((entry) => leagueApi.normalizeLineupSlot(entry.lineupSlot) === "IR").length;
    return { active: entries.length - ir, ir, entryByPlayer };
  }

  function transactionContextLabel() {
    const league = activeLeagueState();
    const teamId = connectedUserTeamId();
    if (!league || !teamId) return "";
    const stateForTeam = leagueApi.transactionStateForTeam(league, teamId);
    const parts = [];
    if (stateForTeam.faabRemaining !== null) parts.push("FAAB $" + Math.floor(stateForTeam.faabRemaining) + " remaining");
    if (stateForTeam.usage.waiverPriority !== null) parts.push("waiver priority #" + Math.max(1, Math.round(stateForTeam.usage.waiverPriority)));
    if (stateForTeam.rules.acquisitionLimit !== null && stateForTeam.rules.acquisitionLimit >= 0 && stateForTeam.usage.acquisitions !== null) parts.push(stateForTeam.usage.acquisitions + "/" + stateForTeam.rules.acquisitionLimit + " acquisitions used");
    if (stateForTeam.rules.tradeDeadline !== null) parts.push("trade deadline " + new Date(stateForTeam.rules.tradeDeadline).toLocaleDateString());
    if (stateForTeam.rules.rosterLimit !== null) parts.push("roster limit " + stateForTeam.rules.rosterLimit);
    if (stateForTeam.rules.irSlots !== null && stateForTeam.usage.irUsed !== null) parts.push("IR " + stateForTeam.usage.irUsed + "/" + stateForTeam.rules.irSlots);
    if (stateForTeam.rules.known && stateForTeam.rules.complete !== true) parts.push("known restrictions enforced; unimported platform rules remain conditional");
    return parts.join(" · ");
  }

  function syncTransactionControls() {
    const league = activeLeagueState();
    const teamId = connectedUserTeamId();
    if (!league || !teamId || !$("#waiver-mode")) return;
    const transaction = leagueApi.transactionStateForTeam(league, teamId);
    if (transaction.usage.waiverPriority !== null) {
      $("#waiver-mode").value = "priority";
      $("#faab-budget-label").classList.add("hidden");
    } else if (transaction.faabRemaining !== null) {
      $("#waiver-mode").value = "faab";
      $("#faab-budget").value = String(Math.max(0, Math.floor(transaction.faabRemaining)));
      $("#faab-budget-label").classList.remove("hidden");
    }
  }

  function renderMyTeamDashboard(league = activeLeagueState(), team = connectedLeagueTeam()) {
    const dashboard = $("#team-dashboard");
    if (!dashboard) return;
    const connected = Boolean(league && team);
    dashboard.classList.toggle("hidden", !connected);
    if (!connected) return;
    const week = Math.max(1, Number(league.currentWeek || 1));
    const opponent = leagueOpponentForWeek(week, team.teamId);
    const transaction = leagueApi.transactionStateForTeam(league, team.teamId);
    const waiverLabel = transaction.usage.waiverPriority !== null
      ? `Priority #${Math.max(1, Math.round(transaction.usage.waiverPriority))}`
      : transaction.faabRemaining !== null ? `$${Math.max(0, Math.floor(transaction.faabRemaining))} FAAB` : "League default";
    const roster = ((team.roster || []).length ? team.roster : (team.rosterIds || []).map((id) => playerById(id)).filter(Boolean))
      .slice().sort((a, b) => (a.pprRank || 9999) - (b.pprRank || 9999));
    $("#team-dashboard-matchup").textContent = opponent ? `vs ${opponent.name}` : `Week ${week}`;
    $("#team-dashboard-matchup-meta").textContent = opponent ? `${team.recordLabel || "Your team"} · ${opponent.recordLabel || "Opponent"}` : "No opponent is available in the imported schedule.";
    $("#team-dashboard-record").textContent = team.recordLabel || "—";
    $("#team-dashboard-league").textContent = league.name || leagueProfileSummary();
    $("#team-dashboard-waivers").textContent = waiverLabel;
    $("#team-dashboard-roster-count").textContent = `${roster.length} recognized player${roster.length === 1 ? "" : "s"}`;
    $("#team-dashboard-roster").innerHTML = roster.length ? roster.map((player) => `<div class="team-roster-row">${playerIdentityMarkup(player)}<span class="team-roster-projection"><b>${num(baselineWeekProjection(player, week))}</b><small>W${week} pts</small></span></div>`).join("") : `<p class="fineprint">No recognized roster players are available yet.</p>`;
  }

  function renderConnectedLeagueContext() {
    const league = activeLeagueState();
    const team = connectedLeagueTeam();
    renderMyTeamDashboard(league, team);
    if (!league || !team) return;
    const rosterNote = (team.rosterIds || []).length + " players recognized" + ((team.unmatchedPlayers || []).length ? " · " + team.unmatchedPlayers.length + " unmatched" : "");
    $("#myleague").classList.add("league-connected");
    $("#masthead-team").textContent = team.name;
    $("#masthead-week").textContent = (team.recordLabel || league.name) + " · Week " + league.currentWeek;
    $("#rail-context-kicker").textContent = "WEEK " + league.currentWeek;
    $("#rail-context-team").textContent = team.name;
    $("#rail-context-week").textContent = (team.recordLabel || "League imported") + " · " + league.name;
    $("#hero-lede").textContent = team.name + " is loaded. SnapCount can use the imported roster, opponent schedule, live lineup state, and transaction rules that are available.";
    $("#league-command-strip").classList.remove("hidden");
    $("#season-connection-summary").classList.remove("hidden");
    $("#home-league-label").textContent = league.name;
    $("#home-team-name").textContent = team.name;
    $("#home-team-record").textContent = (team.recordLabel || "Imported") + " · Week " + league.currentWeek + " · " + rosterNote;
    $("#season-connected-team").textContent = team.name;
    $("#season-connected-league").textContent = league.name + " · " + (team.recordLabel || "Imported") + " · Week " + league.currentWeek;
    if ($("#season-provider-badge")) $("#season-provider-badge").textContent = String(league.provider || league.source || "IMPORT").toUpperCase();
  }

  function renderEspnConnection() {
    const league = state.espnLeague;
    const team = espnTeamById(state.espnConnection?.teamId);
    const authNeeded = state.espnNeedsSession && !league;
    $("#myleague").classList.toggle("league-connected", Boolean(team));
    populateLeagueProfileForm();
    $("#masthead-team").textContent = team ? team.name : league ? league.name : "Any fantasy league";
    $("#masthead-week").textContent = team && league ? `${team.recordLabel} · Week ${league.currentWeek}` : league ? `${league.teams.length} teams · ${league.scoringLabel}` : leagueProfileSummary();
    $("#rail-context-kicker").textContent = team && league ? `WEEK ${league.currentWeek}` : league ? "CHOOSE YOUR TEAM" : "ESPN REQUIRED";
    $("#rail-context-team").textContent = team ? team.name : league ? league.name : "Connect your ESPN league";
    $("#rail-context-week").textContent = team && league ? `${team.recordLabel} · ${league.name}` : league ? `${league.teams.length} teams · choose your team` : "Paste your ESPN league link or ID, then choose your team.";
    $("#hero-lede").textContent = team
      ? `${team.name} is synced. Start with your lineup, the waiver wire, a trade, or your season outlook.`
      : league ? "Your ESPN league is loaded. Choose your team to unlock My League." : "Link your ESPN fantasy league and choose your team first. SnapCount will then unlock your personalized league tools.";
    $("#espn-connect-empty").classList.toggle("hidden", Boolean(league) || authNeeded);
    $("#espn-team-step").classList.toggle("hidden", !league || Boolean(team));
    $("#espn-auth-step").classList.toggle("hidden", !authNeeded);
    $("#espn-connected").classList.toggle("hidden", !team);
    $("#league-command-strip").classList.toggle("hidden", !team);
    $("#season-connection-summary").classList.toggle("hidden", !team);
    $("#espn-connection-state").textContent = team ? "Connected" : league ? "Choose your team" : authNeeded ? "Sign-in needed" : "Not connected";
    $("#espn-connection-state").classList.toggle("connected", Boolean(team));
    renderMyLeagueAccess();
    renderConnectedLeagueContext();
    if (!league) return;
    populateEspnTeams();
    $("#espn-league-found").textContent = `${league.name} · ${league.teams.length} teams · ${league.scoringLabel}`;
    if (!team) return;
    const rosterNote = `${team.rosterIds.length} players recognized${team.unmatchedPlayers.length ? ` · ${team.unmatchedPlayers.length} unmatched` : ""}`;
    $("#espn-connected-team").textContent = team.name;
    $("#espn-connected-meta").textContent = `${league.name} · ${team.recordLabel} · ${rosterNote}${state.leagueMeta?.settingsWarning ? ` · ${state.leagueMeta.settingsWarning}` : ""}`;
    $("#home-league-label").textContent = league.name;
    $("#home-team-name").textContent = team.name;
    $("#home-team-record").textContent = `${team.recordLabel} · Week ${league.currentWeek} · ${rosterNote}`;
    $("#season-connected-team").textContent = team.name;
    $("#season-connected-league").textContent = `${league.name} · ${team.recordLabel} · Week ${league.currentWeek}`;
  }

  function clearImportedProjectionOverrides() {
    let changed = false;
    state.players = state.players.map((player) => {
      if (!player?._snapCountImportedProjection) return player;
      changed = true;
      const { projectionStats, weeklyProjectionStats, _snapCountImportedProjection, ...rest } = player;
      return rest;
    });
    if (changed) {
      reindexPlayers();
      fillPlayerSelects();
    }
  }

  async function applyLeagueState(league, teamId, persist = true) {
    if (String(league?.provider || league?.source || "").toLowerCase() !== "espn") throw new Error("My League now requires an ESPN league connection.");
    const selectedId = String(teamId || league?.userTeamId || "");
    const team = league?.teams?.find((row) => String(row.teamId) === selectedId);
    if (!league || !team) throw new Error("Choose a valid imported team");
    clearImportedProjectionOverrides();
    state.leagueState = { ...league, userTeamId: selectedId };
    state.connectedTeamId = selectedId;
    const projectionRows = state.leagueState.playerProjections || {};
    if (Object.keys(projectionRows).length) {
      state.players = state.players.map((player) => {
        const row = projectionRows[String(player.id)];
        return row ? { ...player, _snapCountImportedProjection: true, ...(row.projectionStats ? { projectionStats: row.projectionStats } : {}), ...(row.weeklyProjectionStats ? { weeklyProjectionStats: row.weeklyProjectionStats } : {}) } : player;
      });
      reindexPlayers();
      fillPlayerSelects();
    }
    state.rosterIds = (team.rosterIds || []).map(String).filter((id) => playerById(id));
    state.leagueTeams = hydratedLeagueTeams(state.leagueState);
    const importedSettings = state.leagueState.settings || {};
    if (importedSettings.supported !== false && state.leagueProfile?.source !== "manual-override") {
      state.leagueProfile = leagueApi.normalizeProfile({ ...importedSettings, source: state.leagueState.source || "import", provider: state.leagueState.provider || "import", supported: true, irSlots: importedSettings.irSlots, lineupLockType: importedSettings.lineupLockType, customScoring: importedSettings.customScoring });
    }
    state.leagueMeta = {
      playoffTeams: state.leagueState.playoffTeams || Math.min(6, state.leagueTeams.length),
      playoffByes: (state.leagueState.playoffTeams || 6) === 6 ? 2 : 0,
      regularSeasonEnd: state.leagueState.regularSeasonEnd || 14,
      championshipWeek: state.leagueState.championshipWeek || 17,
      fantasySchedule: state.leagueState.fantasySchedule || null,
      scheduleSource: Object.keys(state.leagueState.fantasySchedule || {}).length ? String(state.leagueState.provider || state.leagueState.source || "import") : "fallback",
      settings: currentLeagueSettings(),
      settingsSource: state.leagueProfile?.source || "manual",
      transactions: state.leagueState.transactions || null,
      settingsWarning: importedSettings.supported === false ? "Imported scoring or lineup rules are not fully representable; manual SnapCount rules remain active." : null,
    };
    setDecisionWeek(state.leagueState.currentWeek);
    if ($("#regular-season-end")) $("#regular-season-end").value = String(state.leagueMeta.regularSeasonEnd);
    if ($("#championship-week")) $("#championship-week").value = String(state.leagueMeta.championshipWeek);
    if (persist) await Promise.all([store.set("roster-ids", state.rosterIds), store.set("league-state", state.leagueState), store.set("league-profile", state.leagueProfile)]);
    populateLeagueProfileForm();
    syncDraftControlsToLeagueProfile();
    renderRoster();
    syncTransactionControls();
    renderEspnConnection();
    $("#league-source-status").textContent = state.leagueState.name + " · " + team.name + " loaded from " + String(state.leagueState.provider || state.leagueState.source || "import") + ".";
    return team;
  }

  async function disconnectImportedLeague() {
    if (state.leagueState?.provider === "espn") return disconnectEspnLeague();
    clearImportedProjectionOverrides();
    state.leagueState = null;
    state.connectedTeamId = null;
    state.leagueTeams = null;
    state.leagueMeta = null;
    state.pendingLeagueImport = null;
    state.leagueProfile = leagueApi.normalizeProfile({ ...currentLeagueProfile(), ...currentLeagueProfile().settings, source: "manual", provider: null });
    await Promise.all([store.remove("league-state"), store.set("league-profile", state.leagueProfile)]);
    renderEspnConnection();
    $("#league-source-status").textContent = "No league loaded.";
    status("Imported league disconnected. Your current roster remains saved locally.", "good");
  }

  async function applyEspnTeam(teamId, persist = true) {
    clearImportedProjectionOverrides();
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
    state.leagueState = { ...state.espnLeague, userTeamId: String(team.teamId) };
    state.connectedTeamId = String(team.teamId);
    state.rosterIds = (team.rosterIds || []).map(String).filter((id) => playerById(id));
    state.leagueTeams = hydratedEspnTeams();
    const espnSettings = state.espnLeague.settings || null;
    if (espnSettings?.supported && state.leagueProfile?.source !== "manual-override") {
      state.leagueProfile = leagueApi.normalizeProfile({ ...espnSettings, source: "espn", provider: "espn" });
    } else if (!state.leagueProfile) {
      state.leagueProfile = leagueApi.normalizeProfile({ source: "manual", teams: state.leagueTeams.length || 12, scoring: "ppr", slots: { ...core.DEFAULT_SETTINGS.slots, BN: 7 } });
    }
    const settingsProblems = [];
    if (espnSettings?.unsupportedStarterSlotIds?.length) settingsProblems.push(`starter slots ${espnSettings.unsupportedStarterSlotIds.join(", ")}`);
    if (espnSettings?.unsupportedScoringStatIds?.length) settingsProblems.push(`custom scoring stats ${espnSettings.unsupportedScoringStatIds.join(", ")}`);
    state.leagueMeta = {
      playoffTeams: state.espnLeague.playoffTeams || Math.min(6, state.leagueTeams.length),
      playoffByes: (state.espnLeague.playoffTeams || 6) === 6 ? 2 : 0,
      regularSeasonEnd: state.espnLeague.regularSeasonEnd || 14,
      championshipWeek: state.espnLeague.championshipWeek || 17,
      fantasySchedule: state.espnLeague.fantasySchedule || null,
      scheduleSource: Object.keys(state.espnLeague.fantasySchedule || {}).length ? "espn" : "fallback",
      settings: currentLeagueSettings(),
      settingsSource: state.leagueProfile?.source || "manual",
      settingsWarning: settingsProblems.length ? `ESPN uses ${settingsProblems.join(" and ")}; manual SnapCount rules remain active.` : null,
    };
    setDecisionWeek(state.espnLeague.currentWeek);
    if ($("#regular-season-end")) $("#regular-season-end").value = String(state.leagueMeta.regularSeasonEnd);
    if ($("#championship-week")) $("#championship-week").value = String(state.leagueMeta.championshipWeek);
    if (persist) await Promise.all([
      store.set("roster-ids", state.rosterIds),
      store.set("espn-connection", state.espnConnection),
      store.set("espn-snapshot", state.espnLeague),
      store.set("league-state", state.leagueState),
      store.set("league-profile", state.leagueProfile),
    ]);
    populateLeagueProfileForm();
    syncDraftControlsToLeagueProfile();
    renderRoster();
    syncTransactionControls();
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
    state.leagueState = null;
    state.connectedTeamId = null;
    state.leagueTeams = null;
    state.leagueMeta = null;
    state.tradePartnerTeamId = null;
    state.leagueProfile = leagueApi.normalizeProfile({ ...currentLeagueProfile(), ...currentLeagueProfile().settings, source: "manual", provider: null });
    await Promise.all([store.remove("espn-connection"), store.remove("espn-snapshot"), store.remove("league-state"), store.remove("my-league-enabled"), store.set("league-profile", state.leagueProfile)]);
    populateLeagueProfileForm();
    renderRoster();
    renderEspnConnection();
    $("#league-source-status").textContent = "No league loaded.";
    status("ESPN league disconnected. My League is locked until you reconnect.", "good");
  }

  function savedEvidence(player, week = 1) {
    if (!state.contextByWeek.has(week)) state.contextByWeek.set(week, context.buildTeamContext(state.players, state.schedule, week));
    return context.mergeEvidence(
      context.coachingEvidence(player, state.coaches?.teams?.[player.team]),
      context.healthEvidence(player, state.healthCalibration),
      context.baselineRoleEvidence(player),
      context.targetEcosystemEvidence?.(player, state.players, week),
      footballContext?.contextEvidence?.(player, state.footballContextArtifact, state.schedule, week),
      context.absenceRedistributionEvidence(player, state.players),
      context.quarterbackContextEvidence(player, state.players, week),
      context.matchupEvidence(player, state.contextByWeek.get(week)),
      specialTeamsEvidence(player, week),
      state.ledger.evidenceFor("player", String(player.id)),
    );
  }

  function historyEvidenceFor(player, season = state.decisionHistorySeason) {
    return state.intelligenceHistory.get(historyKey(player, season))?.evidence || {};
  }

  function scheduledOpponent(player, week = 1) {
    return state.schedule?.[String(player?.team || "")]?.weeks?.[Math.max(0, Number(week || 1) - 1)]?.opponent || null;
  }

  function specialTeamsEvidence(player, week = 1) {
    const position = String(player?.position || "").toUpperCase();
    if (!state.specialTeams || !["K", "DST"].includes(position)) return {};
    const team = String(player?.team || "").toUpperCase();
    if (position === "K") {
      const teamProfile = state.specialTeams.teams?.[team] || null;
      const surname = String(player?.name || "").trim().split(/\s+/).pop()?.toLowerCase();
      const kicker = Object.values(state.specialTeams.kickers || {}).find((entry) => Object.values(entry.seasons || {}).some((row) => row.team === team && String(row.name || "").toLowerCase().includes(surname))) || null;
      return { "special.kicker_context": { available: Boolean(teamProfile || kicker), value: 0, confidence: 0.78, conflict: 0, model: "pbp-special-teams-context", scoringEffect: "context-only", team: teamProfile?.weighted || null, coach: teamProfile?.currentCoachHistory?.weighted || null, kicker: kicker?.seasons?.["2025"] || null } };
    }
    const opponent = scheduledOpponent(player, week);
    return { "special.dst_context": { available: Boolean(state.specialTeams.defenses?.[team]), value: 0, confidence: 0.76, conflict: 0, model: "pbp-defense-offense-interaction-context", scoringEffect: "context-only", defense: state.specialTeams.defenses?.[team]?.weighted || null, opponent, opponentVulnerability: opponent ? state.specialTeams.offenses?.[opponent]?.weighted || null : null } };
  }

  function specialTeamsContextMarkup(player, week = 1) {
    const special = specialTeamsEvidence(player, week);
    const kickerContext = special["special.kicker_context"] || null;
    const dstContext = special["special.dst_context"] || null;
    if (kickerContext?.available) return `<section class="special-teams-strip"><div><span>KICKING ENVIRONMENT</span><strong>${num(kickerContext.team?.fgAttemptsPerGame || 0, 2)} FG attempts/game</strong></div><p>${kickerContext.team?.fourthDownGoRate !== null ? `Team goes on ${pct(kickerContext.team.fourthDownGoRate, 0)} of tracked kickable 4th-down decisions · ` : ""}${kickerContext.team?.fg50AttemptsPerGame !== null ? `${num(kickerContext.team.fg50AttemptsPerGame, 2)} attempts/game from 50+ · ` : ""}${kickerContext.kicker?.byDistance?.["50-59"] ? `${pct(kickerContext.kicker.byDistance["50-59"].accuracy, 0)} on 50–59 last season` : "distance profile unavailable"}</p><small>Measured from 2023–2025 nflverse play-by-play. This is tracked context; it does not move the frozen projection mean until the special-teams admission audit clears it.</small></section>`;
    if (dstContext?.available) return `<section class="special-teams-strip"><div><span>D/ST INTERACTION</span><strong>${num(dstContext.defense?.sacksPerGame || 0, 2)} sacks · ${num(dstContext.defense?.takeawaysPerGame || 0, 2)} takeaways/game</strong></div><p>${dstContext.opponent ? `Opponent ${esc(dstContext.opponent)} historically allows ${num(dstContext.opponentVulnerability?.sacksPerGame || 0, 2)} sacks and ${num(dstContext.opponentVulnerability?.takeawaysPerGame || 0, 2)} giveaways/game.` : "Opponent interaction will populate when the schedule supplies a matchup."}</p><small>Defense pressure/takeaway ability and opponent vulnerability are measured separately so the matchup can be tracked without inventing an unvalidated scoring coefficient.</small></section>`;
    return "";
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
    const signal = campSignalFor(player);
    return context.mergeEvidence(
      liveIntelligence.campEvidence(signal),
      footballContext?.campRoleEvidence?.(signal),
    );
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
      footballContext?.contextEvidence?.(player, state.footballContextArtifact, state.schedule, 1),
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
    if (!leagueApi.isQualifiedPprDraftScope(settings) || !(profile.supportedTeamCounts || []).includes(Number(settings.teams))) return profile.fallbackPolicy || null;
    const anchors = [
      { bucket: "early", pick: 1 },
      { bucket: "middle", pick: Math.ceil(settings.teams / 2) },
      { bucket: "late", pick: settings.teams },
    ];
    anchors.sort((left, right) => Math.abs(left.pick - settings.draftPosition) - Math.abs(right.pick - settings.draftPosition));
    return profile.segments[`${settings.teams}-${anchors[0].bucket}`] || profile.fallbackPolicy || null;
  }

  function baselineWeekProjection(player, week) {
    const adapted = leagueApi.playerForScoring(player, currentLeagueSettings());
    const value = Number(adapted?.weeklyProjections?.[Math.max(0, week - 1)]);
    if (Number.isFinite(value)) return value;
    return Number(adapted?.weeklyProjection || 0);
  }

  function decisionPlayerForWeek(player, week, surface = "startSit") {
    const scoringPlayer = leagueApi.playerForScoring(player, currentLeagueSettings());
    const forecast = engine.forecastPlayer(scoringPlayer, { week, evidence: decisionEvidence(player, week), validatedMeanScale: servingMeanScale(surface) });
    const weekly = Array.isArray(scoringPlayer.weeklyProjections)
      ? [...scoringPlayer.weeklyProjections]
      : Array.from({ length: 18 }, () => Number(scoringPlayer.weeklyProjection || 0));
    weekly[Math.max(0, Math.min(17, week - 1))] = forecast.distribution.mean;
    return {
      ...scoringPlayer,
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
    const settings = currentLeagueSettings();
    teams = teams.map((team) => ({
      ...team,
      roster: refreshDecisionPlayers(team.roster || []).map((player) => leagueApi.playerForScoring(player, settings)),
    }));
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
      settings,
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
      settings: prepared.settings,
      schedule: state.schedule,
      fantasySchedule: fantasyScheduleForLeague(),
      startWeek,
      regularSeasonEnd: endWeek,
      evidenceByPlayer: prepared.evidenceByPlayer,
      evidenceByPlayerWeek: prepared.evidenceByPlayerWeek,
      validatedMeanScale: prepared.validatedMeanScale,
      lineupConstraintsByTeamWeek: { [startWeek]: currentWeekLeagueConstraintsByTeam(startWeek) },
      finalScoresByTeamWeek: { [startWeek]: currentWeekLeagueFinalScoresByTeam(startWeek) },
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
    const staff = state.coaches?.teams?.[forecast.player.team] || null;
    const playCaller = staff?.offensivePlayCaller || staff?.offensiveCoordinator || staff?.headCoach || null;
    const playCallerLine = playCaller ? `<div class="playcaller-context"><b>PLAY CALLER</b><span>${esc(playCaller)}${staff?.schemeLabel ? ` · ${esc(staff.schemeLabel)}` : ""}</span><small>context only until a direct mean effect earns validation</small></div>` : "";
    $("#player-result").className = "result-space";
    $("#player-result").innerHTML = `
      <div class="friendly-verdict"><div><span class="pos-pill pos-${esc(String(forecast.player.position || '').toLowerCase())}">${esc(forecast.player.position)}</span>${forecast.player.rookie ? '<span class="rookie-pill">ROOKIE</span>' : ''}<h2>${esc(forecast.player.name)}</h2><p>${esc(forecast.player.team)} · Week ${forecast.week}</p></div><strong>${esc(verdict)}</strong></div>
      ${playCallerLine}
      ${specialTeamsContextMarkup(forecast.player, forecast.week)}
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
    const token = ++state.playerRunToken;
    const marketPromise = ensureMarketWeek(week).catch(() => null);
    await Promise.race([marketPromise, new Promise((resolve) => setTimeout(resolve, 350))]);
    const scenarios = Number($("#player-scenarios").value);
    const renderCurrent = async () => {
      const forecast = engine.forecastPlayer(player, { week, evidence: temporaryEvidence(player) });
      const simulation = await runWorker("scenario", { forecasts: [forecast], options: { week, scenarios, schedule: state.schedule, seed: `player-${player.id}-${week}` } });
      if (token !== state.playerRunToken || String($("#player-select").value) !== String(player.id)) return false;
      renderPlayerResult(forecast, simulation.playerSummaries[String(player.id)]);
      return true;
    };
    $("#run-player").disabled = true;
    status("Checking this player…");
    try {
      const rendered = await renderCurrent();
      if (rendered) status("Player check ready. Live context can refresh in the background.", "good");
    } catch (error) {
      status(error.message, "error");
    } finally {
      $("#run-player").disabled = false;
    }
    marketPromise.then(async (market) => {
      if (!market || token !== state.playerRunToken || String($("#player-select").value) !== String(player.id)) return;
      try {
        const rendered = await renderCurrent();
        if (rendered) status("Player check updated with live market context.", "good");
      } catch (_) { /* local-first result remains valid */ }
    });
  }

  function rookieProfileMarkup(player) {
    const summary = rookieModel?.summary?.(player);
    if (!summary) return "";
    const athletic = Number.isFinite(summary.athleticPercentile) ? pct(summary.athleticPercentile, 0) : "—";
    const hit = Number.isFinite(summary.hitRate) ? pct(summary.hitRate, 0) : "—";
    const depth = summary.depthChartOrder ? `#${summary.depthChartOrder}` : "—";
    return `<section class="rookie-profile"><p class="control-title">ROOKIE SNAPSHOT</p><div class="metric-grid compact-metrics"><div class="metric"><span>DRAFTED</span><strong>${esc(summary.draftLabel)}</strong></div><div class="metric"><span>AGE</span><strong>${summary.age ?? "—"}</strong></div><div class="metric"><span>TYPICAL ROOKIE OUTPUT</span><strong>${summary.cohortP50 == null ? "—" : num(summary.cohortP50)}</strong></div><div class="metric"><span>HIGH-END ROOKIE UPSIDE</span><strong>${summary.cohortP90 == null ? "—" : num(summary.cohortP90)}</strong></div><div class="metric"><span>PAST HIT RATE</span><strong>${hit}</strong></div><div class="metric"><span>ATHLETIC RANK</span><strong>${athletic}</strong></div><div class="metric"><span>DEPTH CHART</span><strong>${depth}</strong></div></div><p class="fineprint">${esc(summary.college || "College unavailable")} · Rookie history helps set expectations, but current role and projection still matter more.</p></section>`;
  }

  function renderPlayerIntelligence(player, result, forecast) {
    const summary = result.summary;
    const xfp = result.xfpSummary || { last3: {}, last5: {} };
    const preseason = state.preseasonByPlayer.get(String(player.id)) || null;
    const rookieProfile = rookieModel?.summary?.(player) || null;
    const outlook = intelligence.generateOutlook(player, forecast, summary);
    const health = outlook.health;
    const selectedWeek = Number($("#player-week").value || 1);
    const matchupPrior = priorDefenseEvidence(player, selectedWeek)["matchup.position_grade"] || null;
    const targetEcosystem = context.targetEcosystemEvidence?.(player, state.players, selectedWeek)?.["interaction.target_ecosystem"] || null;
    const targetEcosystemMarkup = targetEcosystem?.available ? `<section class="target-ecosystem-strip"><div><span>PASSING ECOSYSTEM</span><strong>${targetEcosystem.quarterback ? `QB · ${esc(targetEcosystem.quarterback.name)}` : "QB context unavailable"}</strong></div><p>${targetEcosystem.passCatchers?.length ? targetEcosystem.passCatchers.slice(0, 5).map((row) => `${esc(row.name)} ${row.targetShare > 0 ? pct(row.targetShare, 1) : "—"}`).join(" · ") : "Target-share relationships will populate as opportunity data becomes available."}</p><small>Tracked as interaction context. Direct QB→receiver pair effects remain disabled until they pass a separate validation gate.</small></section>` : "";
    const specialTeamsMarkup = specialTeamsContextMarkup(player, selectedWeek);
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
      ${targetEcosystemMarkup}
      ${specialTeamsMarkup}
      ${rookieProfileMarkup(player)}
      ${rookieProfile ? `<div class="rookie-history-note"><strong>No NFL game history yet.</strong><span>SnapCount uses draft position, comparable rookies, current depth chart, preseason work, and the market projection instead of pretending missing history is bad history.</span></div>` : `<details class="advanced-details game-log-details"><summary>Show game-by-game stats</summary><div class="table-wrap"><table><thead><tr><th>Week</th><th>Opp</th><th>Fantasy pts</th><th>Touches + targets</th><th>Targets</th><th>Carries</th><th>Receptions</th><th>Scrim yds</th><th>Pass yds</th><th>TD</th></tr></thead><tbody>${games.map((game) => `<tr><td>${game.week}</td><td>${esc(game.opponent)}</td><td><b>${num(game.fantasyPpr)}</b></td><td>${num(game.opportunities, 0)}</td><td>${num(game.targets, 0)}</td><td>${num(game.carries, 0)}</td><td>${num(game.receptions, 0)}</td><td>${num(game.scrimmageYards, 0)}</td><td>${num(game.passingYards, 0)}</td><td>${num(game.totalTds, 0)}</td></tr>`).join("")}</tbody></table></div></details>`}`;
  }

  function renderNewsPulse(player = playerById($("#player-select")?.value)) {
    const node = $("#news-pulse");
    if (!node) return;
    const relevant = state.newsPulse.filter((article) => !player || article.playerIds.includes(String(player.id)) || article.teams.includes(String(player.team || ""))).slice(0, 6);
    const rows = relevant.length ? relevant : state.newsPulse.slice(0, 6);
    node.innerHTML = rows.map((article) => {
      return `<article class="news-item"><span>${article.playerNames.length ? esc(article.playerNames.join(", ")) : esc(article.teams.join(", ") || "NFL")}</span><strong>${esc(article.headline)}</strong><small>${article.published ? new Date(article.published).toLocaleString() : "recent"}</small></article>`;
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
      $("#live-intelligence-status").textContent = `${preseason.games || 0} preseason games · ${state.newsPulse.length} headlines · ${liveCampCount} role/context reads`;
      status("News, preseason usage, role context, and player trends refreshed.", "good");
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

  function draftUiSnapshot() {
    return {
      teams: Number($("#draft-teams")?.value || 12),
      draftPosition: Number($("#draft-position")?.value || 6),
      rounds: Number($("#draft-rounds")?.value || 16),
      scoring: $("#draft-scoring")?.value || "ppr",
      qbFormat: $("#draft-qb-format")?.value || "one-qb",
    };
  }

  function restoreDraftUi(snapshot) {
    if (!snapshot) return;
    $("#draft-teams").value = String(snapshot.teams || 12);
    $("#draft-position").value = String(snapshot.draftPosition || 6);
    $("#draft-rounds").value = String(snapshot.rounds || 16);
    $("#draft-scoring").value = ["ppr", "half-ppr", "standard", "custom"].includes(snapshot.scoring) ? snapshot.scoring : "ppr";
    $("#draft-qb-format").value = snapshot.qbFormat || "one-qb";
  }

  function syncDraftModeSurface() {
    const leagueContext = state.draftContext === "league" && hasEspnMyLeagueAccess();
    const live = leagueContext && $("#draft-mode")?.value === "live";
    const leagueHub = leagueContext && !state.draftStarted;
    $("#draft-mode-wrap")?.classList.add("hidden");
    $("#draft-teams-wrap")?.classList.toggle("hidden", leagueContext);
    $("#draft-scoring-wrap")?.classList.toggle("hidden", leagueContext);
    $("#draft-qb-format-wrap")?.classList.toggle("hidden", leagueContext);
    $("#draft-league-context")?.classList.toggle("hidden", !leagueContext);
    $("#draft-public-preset")?.classList.toggle("hidden", state.draftContext !== "public" || !state.publicDraftPreset);
    $("#draft-league-hub")?.classList.toggle("hidden", !leagueHub);
    ["#draft-launch-card", "#draft-strategy", "#draft-focus-grid", "#draft-room-section", "#draft-board-details"].forEach((selector) => {
      $(selector)?.classList.toggle("hidden", leagueHub);
    });
    $("#draft-benchmark-details")?.classList.toggle("hidden", leagueHub || live);
    $("#draft-live-controls")?.classList.toggle("hidden", !live || leagueHub);
    if (live && !leagueHub && $("#draft-live-controls")) $("#draft-live-controls").open = true;
    if (!live && $("#draft-live-controls")) $("#draft-live-controls").open = false;
  }

  function setDraftContext(context = "public") {
    const next = context === "league" && hasEspnMyLeagueAccess() ? "league" : "public";
    const changed = state.draftContext !== next;
    if (changed && state.draftContext === "public") state.publicDraftSettings = draftUiSnapshot();
    state.draftContext = next;
    $("#draft")?.classList.toggle("league-draft-context-active", next === "league");
    if (changed) {
      state.draftState = null;
      state.draftStarted = false;
    }
    if (next === "league") {
      syncDraftControlsToLeagueProfile();
      $("#draft-mode").value = "live";
      const team = espnTeamById(state.espnConnection?.teamId);
      const summary = team ? `${team.name} · ${leagueProfileSummary()}` : leagueProfileSummary();
      $("#draft-league-context-name").textContent = summary;
      if ($("#league-draft-position")) {
        $("#league-draft-position").max = String(currentLeagueSettings().teams);
        $("#league-draft-position").value = String(clamp(Number($("#draft-position").value || 1), 1, currentLeagueSettings().teams));
      }
      $("#draft-eyebrow").textContent = "MY LEAGUE DRAFT";
      $("#draft-title").textContent = team ? `${team.name} Draft Center` : "My League Draft Center";
      $("#draft-description").textContent = "Use Live Draft Assistant on draft night, or launch a separate mock with this league's settings already filled in.";
    } else {
      if (changed && state.publicDraftSettings) restoreDraftUi(state.publicDraftSettings);
      $("#draft-mode").value = "sim";
      if ($("#draft-scoring").value === "custom" && !state.publicDraftPresetSettings) $("#draft-scoring").value = "ppr";
      $("#draft-eyebrow").textContent = "MOCK DRAFT";
      $("#draft-title").textContent = "Run a mock draft.";
      $("#draft-description").textContent = "Practice against a full CPU room, see every team's picks, and get strategy-aware recommendations on every turn.";
      if ($("#draft-public-preset-name") && state.publicDraftPreset) $("#draft-public-preset-name").textContent = state.publicDraftPreset;
    }
    const customOption = $("#draft-scoring option[value=\"custom\"]");
    if (customOption) customOption.disabled = next !== "league" && !state.publicDraftPresetSettings;
    syncDraftModeSurface();
  }

  function leagueMockPreset(position = null) {
    const settings = currentLeagueSettings();
    const rosterSize = Object.values(settings.slots || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
    const rounds = rosterSize >= 6 && rosterSize <= 24 ? rosterSize : clamp(Number(settings.rounds || 16), 6, 24);
    const draftPosition = clamp(Number(position || $("#draft-position")?.value || 1), 1, settings.teams);
    const qbFormat = Number(settings.slots?.QB) >= 2 ? "two-qb" : Number(settings.slots?.SUPERFLEX) > 0 ? "superflex" : "one-qb";
    return {
      ui: { teams: settings.teams, draftPosition, rounds, scoring: settings.scoring, qbFormat },
      settings: core.cloneSettings({ ...settings, draftPosition, rounds, qbFormat }),
    };
  }

  async function launchLeagueMockDraft() {
    if (!hasEspnMyLeagueAccess()) return status("Connect ESPN and choose your team first.", "error");
    const preset = leagueMockPreset($("#league-draft-position")?.value);
    const team = espnTeamById(state.espnConnection?.teamId);
    state.publicDraftSettings = preset.ui;
    state.publicDraftPresetSettings = preset.settings;
    state.publicDraftPreset = `${team?.name || "My League"} · ${leagueProfileSummary()}`;
    activatePanel("draft", { draftContext: "public" });
    await resetDraft({ refine: false });
    status(`Mock Draft loaded with ${team?.name || "your league"} settings.`, "good");
  }

  async function startLeagueLiveAssistant() {
    if (!hasEspnMyLeagueAccess()) return status("Connect ESPN and choose your team first.", "error");
    const teams = currentLeagueSettings().teams;
    $("#draft-position").value = String(clamp(Number($("#league-draft-position")?.value || 1), 1, teams));
    $("#draft-mode").value = "live";
    state.draftState = core.createDraftState(currentDraftSettings());
    state.draftStarted = true;
    await renderDraft({ refine: false });
    status("Live Draft Assistant ready. Enter each real pick as it happens.", "good");
  }

  function currentDraftSettings() {
    const baseSettings = state.draftContext === "league" && hasEspnMyLeagueAccess()
      ? currentLeagueSettings()
      : state.draftContext === "public" && state.publicDraftPresetSettings
        ? core.cloneSettings(state.publicDraftPresetSettings)
        : core.cloneSettings({ teams: 12, scoring: "ppr", slots: { ...core.DEFAULT_SETTINGS.slots, BN: 7 } });
    const scoring = $("#draft-scoring").value || "ppr";
    const qbFormat = $("#draft-qb-format")?.value || "one-qb";
    const profileSlots = { ...baseSettings.slots };
    if (qbFormat === "two-qb") { profileSlots.QB = 2; profileSlots.SUPERFLEX = 0; }
    else if (qbFormat === "superflex") { profileSlots.QB = Math.max(1, Number(profileSlots.QB || 0)); profileSlots.SUPERFLEX = Math.max(1, Number(profileSlots.SUPERFLEX || 0)); }
    else { profileSlots.QB = Math.max(1, Number(profileSlots.QB || 0)); profileSlots.SUPERFLEX = 0; }
    return core.cloneSettings({
      teams: Number($("#draft-teams").value || 12),
      rounds: Number($("#draft-rounds").value || 16),
      draftPosition: Number($("#draft-position").value || 6),
      scoring, qbFormat, slots: profileSlots,
      customScoring: scoring === "custom" ? baseSettings.customScoring : null,
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
      const outlook = playerOutlook(row.id);
      const passed = playerPassed(row.id);
      const outlookPill = outlook.reviewed ? ` <span class="outlook-chip draft-user-outlook ${esc(outlook.tone)}">${esc(outlook.label)}</span>` : "";
      const passPill = passed ? ' <span class="outlook-pass-badge">PASS</span>' : "";
      const extras = `${row.rookie ? ' <span class="rookie-pill compact">R</span>' : ''} ${outlookPill}${passPill}`;
      const secondary = `<span class="board-pos">${esc(row.position)}</span> · ${esc(row.team)}${Number.isFinite(row.marketRank) ? ` · usually drafted #${Math.round(row.marketRank)}` : ""}${Number.isFinite(Number(row.market?.averageDraftPosition)) ? ` · live ESPN ADP ${num(row.market.averageDraftPosition)}` : ""}`;
      return `<div class="big-board-row pos-${esc(String(row.position || '').toLowerCase())}${passed ? " is-pass" : ""}"><span class="board-rank">${row.oracleRank}</span><div class="board-player">${playerIdentityMarkup(row, extras, secondary)}</div><div class="board-score"><span>SNAP SCORE</span><strong>${row.oracleScore}</strong></div></div>`;
    }).join("");
  }

  async function resetDraft(options = {}) {
    const settings = currentDraftSettings();
    $("#draft-position").max = String(settings.teams);
    $("#draft-position").value = String(settings.draftPosition);
    state.draftState = core.createDraftState(settings);
    state.draftStarted = false;
    await renderDraft({ refine: options.refine !== false });
  }

  function draftUserRoster(settings) {
    const ids = state.draftState?.rosters?.[String(settings.draftPosition)] || [];
    return ids.map((id) => playerById(id)).filter(Boolean);
  }

  function draftTeamLabel(teamId, settings) {
    if (Number(teamId) !== Number(settings.draftPosition)) return `Team ${teamId}`;
    const team = espnTeamById(state.espnConnection?.teamId);
    const named = state.draftContext === "league" || state.publicDraftPreset;
    return team && named ? `YOU · ${team.name}` : "YOU";
  }

  function draftRosterNeeds(settings) {
    const roster = draftUserRoster(settings);
    const counts = roster.reduce((result, player) => {
      result[player.position] = Number(result[player.position] || 0) + 1;
      return result;
    }, {});
    const needs = [];
    ["QB", "RB", "WR", "TE"].forEach((position) => {
      const missing = Math.max(0, Number(settings.slots?.[position] || 0) - Number(counts[position] || 0));
      if (missing) needs.push(`${position}${missing > 1 ? ` ×${missing}` : ""}`);
    });
    const skillOwned = Number(counts.RB || 0) + Number(counts.WR || 0) + Number(counts.TE || 0);
    const skillStarters = Number(settings.slots?.RB || 0) + Number(settings.slots?.WR || 0) + Number(settings.slots?.TE || 0) + Number(settings.slots?.FLEX || 0);
    if (skillOwned < skillStarters && !needs.some((need) => /RB|WR|TE/.test(need))) needs.push("FLEX skill");
    if (Number(settings.slots?.SUPERFLEX || 0) > 0 && Number(counts.QB || 0) < 2) needs.unshift("2nd QB / SF");
    return { roster, counts, needs };
  }

  function observedDraftRun(position, settings) {
    const windowSize = Math.max(6, Math.min(12, Number(settings.teams || 12)));
    const recent = [...(state.draftState?.picks || [])].slice(-windowSize);
    if (!recent.length) return { rate: 0, count: 0, total: 0 };
    const count = recent.reduce((sum, pick) => sum + (playerById(pick.playerId)?.position === position ? 1 : 0), 0);
    return { rate: count / recent.length, count, total: recent.length };
  }

  function strategicDraftTake(row, settings) {
    const live = $("#draft-mode")?.value === "live";
    const observed = live ? observedDraftRun(row.position, settings) : { rate: 0, count: 0, total: 0 };
    const runRisk = Math.max(Number(row.runRisk || 0), observed.rate);
    if (row.need > 0 && runRisk >= 0.4) return `${row.position} is a roster need and the room is taking the position quickly`;
    if (row.returnChance <= 0.22) return "Take him now — he probably won't make it back";
    if (row.vona >= 8) return `Waiting costs about ${num(row.vona)} points of draft value`;
    if (row.need > 0) return `Fills a ${row.position} starter need without abandoning value`;
    if (row.rookieTailScore >= 1.5) return "High-upside rookie who still fits the draft plan";
    if (runRisk >= 0.45) return `${row.position} pressure is building in this room`;
    return row.reasons?.[0] || "Strong mix of market price, value, and roster construction";
  }

  function renderDraftTable(recommendations, summary, settings) {
    const mode = $("#draft-mode").value;
    $("#draft-table").innerHTML = recommendations.map((row, index) => {
      const canPick = state.draftStarted && summary.isUserPick;
      const observed = mode === "live" ? observedDraftRun(row.position, settings) : { rate: 0, count: 0, total: 0 };
      const runRisk = Math.max(Number(row.runRisk || 0), observed.rate);
      const signals = [
        row.need > 0 ? `<span class="draft-signal need">ROSTER NEED</span>` : "",
        row.vona >= 5 ? `<span class="draft-signal">WAIT COST +${esc(num(row.vona))}</span>` : "",
        runRisk >= 0.4 ? `<span class="draft-signal run">${esc(row.position)} RUN ${Math.round(runRisk * 100)}%</span>` : "",
      ].filter(Boolean).join("");
      const take = strategicDraftTake(row, settings);
      const action = mode === "live" ? (summary.isUserPick ? "I drafted him" : "Your target") : "Draft him";
      const outlook = playerOutlook(row.id);
      const outlookTitle = [row.outlookTimingLabel, row.outlookBasisLabel].filter(Boolean).join(" · ");
      const outlookPill = outlook.reviewed ? ` <span class="outlook-chip draft-user-outlook ${esc(outlook.tone)}" title="${esc(outlookTitle || "Saved personal outlook")}">${esc(outlook.label)}</span>` : "";
      const extras = `${row.rookie ? ' <span class="rookie-pill compact">R</span>' : ''} ${outlookPill}`;
      const rankCompare = outlook.reviewed && Number.isFinite(row.espnPositionRank) && Number.isFinite(row.snapPositionRank) ? ` · ESPN ${esc(row.position)}${row.espnPositionRank} · SNAP ${esc(row.position)}${row.snapPositionRank}` : "";
      const secondary = `${esc(row.position)} · ${esc(row.team)}${Number.isFinite(row.marketRank) ? ` · market #${Math.round(row.marketRank)}` : ""}${rankCompare}`;
      return `<tr data-qualified-rank="${row.qualifiedRank || index + 1}" data-personal-rank="${row.personalRank || index + 1}" data-outlook-shift="${Number(row.outlookAdjustment || 0).toFixed(2)}"><td class="board-rank-cell">${index + 1}</td><td class="player-cell player-cell-visual">${playerIdentityMarkup(row, extras, secondary)}</td><td class="draft-take"><strong>${esc(row.decision || "Target")}</strong><span>${esc(take)}</span><div class="draft-signal-row">${signals}</div></td><td class="draft-return"><strong>${pct(row.returnChance)}</strong><small>${row.nextTeamPick ? `next turn P${row.nextTeamPick}` : ""}</small></td><td><button class="mini-button pick-button" data-draft-player="${esc(row.id)}" ${canPick ? "" : "disabled"}>${action}</button></td></tr>`;
    }).join("");
    $$('[data-draft-player]').forEach((button) => button.addEventListener("click", () => draftPlayerChoice(button.dataset.draftPlayer).catch((error) => status(error.message, "error"))));
  }

  function renderDraftStrategy(recommendations, summary, settings) {
    const body = $("#draft-strategy-body");
    const statusNode = $("#draft-strategy-status");
    if (!body || !statusNode) return;
    const top = recommendations?.[0];
    const needs = draftRosterNeeds(settings);
    if (!top) {
      statusNode.textContent = "No targets available";
      body.innerHTML = `<p class="fineprint">No strategy targets are available for this draft state.</p>`;
      return;
    }
    const run = observedDraftRun(top.position, settings);
    const needsText = needs.needs.length ? needs.needs.join(" · ") : "Starter core filled — prioritize value and depth";
    const phase = !state.draftStarted ? "STRATEGY PREVIEW" : summary.isUserPick ? "YOU'RE ON THE CLOCK" : `PLANNING FOR PICK ${top.nextTeamPick || "—"}`;
    statusNode.textContent = phase;
    const alternatives = recommendations.slice(1, 4).map((row) => `<div class="draft-alt"><span>${esc(row.position)}</span><strong>${esc(row.name)}</strong><small>${esc(strategicDraftTake(row, settings))}</small></div>`).join("");
    const outlook = playerOutlook(top.id);
    const outlookNote = outlook.reviewed ? `<p class="fineprint outlook-draft-note"><b>Your outlook:</b> <span class="outlook-chip ${esc(outlook.tone)}">${esc(outlook.label)}</span> · ${esc(top.outlookTimingLabel || "saved")}. ${esc(top.outlookBasisLabel || "")}. ${outlook.direction === 0 ? "Neutral records that you reviewed the player without changing the qualified order." : top.outlookTimingLabel === "Already reflected by SnapCount" ? "SnapCount is already at least as bullish or bearish as your ESPN-relative view, so no extra movement is added." : Math.abs(Number(top.outlookAdjustment || 0)) < 0.1 ? "There is still a residual disagreement, but it is not large or timely enough to move the draft order right now." : `Only the residual difference is moving the personalized order: about ${Math.abs(Number(top.outlookAdjustment)).toFixed(1)} spots ${Number(top.outlookAdjustment) > 0 ? "up" : "down"} at this pick.`}</p>` : "";
    body.innerHTML = `<div class="draft-strategy-call"><span class="strategy-kicker">TOP STRATEGY CALL</span><h3>${esc(top.name)} <small>${esc(top.position)} · ${esc(top.team)}</small></h3><p>${esc(strategicDraftTake(top, settings))}</p>${outlookNote}<div class="draft-strategy-metrics"><div><span>Roster needs</span><strong>${esc(needsText)}</strong></div><div><span>Market price</span><strong>${Number.isFinite(top.marketRank) ? `#${Math.round(top.marketRank)}` : "—"}</strong></div><div><span>Wait cost</span><strong>${top.vona > 0 ? `+${num(top.vona)}` : "Low"}</strong></div><div><span>Back next turn</span><strong>${pct(top.returnChance)}</strong></div><div><span>${top.position} room trend</span><strong>${run.total ? `${run.count} of last ${run.total}` : "No run yet"}</strong></div></div></div><div class="draft-strategy-context"><div><span>HOW SNAPCOUNT IS DRAFTING</span><p>This is not best-player-available alone. The qualified strategy balances market cost, value over replacement, your roster construction, positional scarcity, injury risk, and timing to your next pick.</p></div><div class="draft-alternatives"><span>OTHER GOOD PATHS</span>${alternatives || "<p class='fineprint'>No alternatives yet.</p>"}</div></div>`;
  }

  function renderDraftRoomBoard(settings, summary) {
    const board = $("#draft-room-board");
    const recentNode = $("#draft-history");
    if (!board || !recentNode) return;
    const picks = [...(state.draftState?.picks || [])];
    const recent = picks.slice(-10).reverse();
    $("#draft-room-status").textContent = summary.remaining > 0 ? `Round ${summary.round} · Pick ${summary.pickNumber} · ${draftTeamLabel(summary.teamId, settings)} on clock` : "Draft complete";
    recentNode.innerHTML = recent.length ? recent.map((pick) => {
      const player = playerById(pick.playerId);
      return `<div class="draft-recent-pick pos-${esc(String(player?.position || "").toLowerCase())}"><span>P${pick.pick}</span><strong>${esc(draftTeamLabel(pick.teamId, settings))}</strong><b>${player ? esc(player.name) : esc(pick.playerId)}</b><small>${player ? esc(player.position) : ""}</small></div>`;
    }).join("") : `<p class="fineprint">No picks yet. Start the mock or enter the first live pick.</p>`;
    board.style.setProperty("--draft-team-count", String(settings.teams));
    board.innerHTML = Array.from({ length: settings.teams }, (_, index) => index + 1).map((teamId) => {
      const teamPicks = picks.filter((pick) => Number(pick.teamId) === teamId);
      const counts = teamPicks.reduce((result, pick) => {
        const position = playerById(pick.playerId)?.position;
        if (position) result[position] = Number(result[position] || 0) + 1;
        return result;
      }, {});
      const composition = ["QB", "RB", "WR", "TE"].filter((position) => counts[position]).map((position) => `${counts[position]} ${position}`).join(" · ");
      const pickRows = teamPicks.map((pick) => {
        const player = playerById(pick.playerId);
        return `<div class="draft-room-pick pos-${esc(String(player?.position || "").toLowerCase())}"><span>R${pick.round} · P${pick.pick}</span><strong>${player ? esc(player.name) : esc(pick.playerId)}</strong><small>${player ? `${esc(player.position)} · ${esc(player.team || "FA")}` : ""}</small></div>`;
      }).join("");
      const classes = ["draft-team-column", Number(teamId) === Number(settings.draftPosition) ? "user-team" : "", state.draftStarted && summary.remaining > 0 && Number(summary.teamId) === teamId ? "on-clock" : ""].filter(Boolean).join(" ");
      return `<section class="${classes}"><header><span>${Number(teamId) === Number(settings.draftPosition) ? "YOUR TEAM" : `TEAM ${teamId}`}</span><strong>${esc(draftTeamLabel(teamId, settings))}</strong><small>${composition || "No picks yet"}</small></header><div class="draft-team-picks">${pickRows || '<div class="draft-room-empty">Waiting</div>'}</div></section>`;
    }).join("");
  }

  function renderDraftPanels(settings, summary, recommendations) {
    const roster = draftUserRoster(settings);
    $("#draft-roster").className = "module result-space draft-roster-card";
    $("#draft-roster").innerHTML = `<div class="table-header"><h3>Your roster</h3><span>${roster.length}/${settings.rounds}</span></div><div class="roster-strip">${roster.map((player) => `<div class="roster-chip"><span>${esc(player.position)}</span>${esc(player.name)}${player.rookie ? '<b class="rookie-chip">R</b>' : ''}</div>`).join("") || "<span class='fineprint'>No picks yet.</span>"}</div>`;
    renderDraftStrategy(recommendations, summary, settings);
    renderDraftRoomBoard(settings, summary);
  }
  function renderDraftManualOptions(settings = currentDraftSettings()) {
    const drafted = new Set((state.draftState?.picks || []).map((pick) => String(pick.playerId)));
    const query = $("#draft-pick-search")?.value || "";
    const available = state.players.filter((player) => !drafted.has(String(player.id)) && playerMatchesSearch(player, query))
      .sort((a, b) => draftSim.boardRank(a, settings, state.draftBoard) - draftSim.boardRank(b, settings, state.draftBoard));
    $("#draft-manual-player").innerHTML = available.slice(0, query ? 120 : 260).map((player) => `<option value="${esc(player.id)}">${esc(player.name)} · ${esc(player.position)} ${esc(player.team)} · usually drafted #${Math.round(draftSim.boardRank(player, settings, state.draftBoard))}</option>`).join("");
  }

  async function renderDraft(options = {}) {
    const settings = currentDraftSettings();
    syncDraftModeSurface();
    renderDraftBigBoard();
    if (!state.draftState) state.draftState = core.createDraftState(settings);
    const summary = core.draftPickSummary(state.draftState, settings);
    renderDraftManualOptions(settings);
    $("#draft-next").textContent = summary.remaining > 0 ? `P${summary.pickNumber} / T${summary.teamId}` : "COMPLETE";
    const qualification = leagueApi.isQualifiedPprDraftScope(settings) ? "A+ QUALIFIED PPR" : "CUSTOM FORMAT · TRANSFER POLICY";
    const phase = !state.draftStarted ? "READY" : summary.remaining <= 0 ? "DRAFT COMPLETE" : summary.isUserPick ? "YOUR PICK" : `${draftTeamLabel(summary.teamId, settings)} PICK`;
    $("#draft-meta").textContent = `${state.draftState.picks.length} picks · ${phase} · ${qualification}`;
    const mode = $("#draft-mode").value;
    if ($("#draft-live-turn")) $("#draft-live-turn").textContent = summary.remaining > 0 ? `Pick ${summary.pickNumber} · ${draftTeamLabel(summary.teamId, settings)}` : "Draft complete";
    if ($("#draft-live-room-note")) $("#draft-live-room-note").textContent = summary.remaining <= 0
      ? "The live draft is complete."
      : summary.isUserPick
        ? "You are on the clock. Use the strategy table below, then record the player you actually draft."
        : `${draftTeamLabel(summary.teamId, settings)} is on the clock. Record that team's actual pick; your recommendations will update immediately.`;
    const startButton = $("#draft-reset");
    if (startButton) {
      startButton.disabled = state.draftBusy;
      startButton.textContent = mode === "live"
        ? (state.draftStarted ? "Reset live room" : "Start live assistant")
        : (state.draftStarted ? "Restart mock" : "Start mock");
    }
    if ($("#draft-undo")) $("#draft-undo").disabled = state.draftBusy || !state.draftState.picks.length;
    if ($("#draft-record-pick")) $("#draft-record-pick").disabled = state.draftBusy || !state.draftStarted || mode !== "live";
    const initial = applyPlayerOutlookOverlay(draftSim.qualifyRecommendations(
      core.advancedDraftRecommendations(state.players, state.draftState, settings, settings.draftPosition, 48),
      state.players, state.draftState, settings, settings.draftPosition, state.draftBoard, draftPolicyForSettings(settings), 36,
    ), settings, 18);
    renderDraftTable(initial, summary, settings);
    renderDraftPanels(settings, summary, initial);
    const token = ++state.draftRenderToken;
    if (options.refine !== false && state.draftStarted && summary.remaining > 0) {
      try {
        const simulation = await runWorker("draft-room-window", { options: { players: state.players, state: state.draftState, settings, targetTeamId: settings.draftPosition, strategy: $("#draft-opponent-strategy").value || "mixed", board: draftBoardPayload(), simulations: 500, seed: `draft-window-${state.draftState.picks.length}` } });
        if (token !== state.draftRenderToken) return;
        const refined = applyPlayerOutlookOverlay(draftSim.qualifyRecommendations(
          core.advancedDraftRecommendations(state.players, state.draftState, settings, settings.draftPosition, 48, simulation),
          state.players, state.draftState, settings, settings.draftPosition, state.draftBoard, draftPolicyForSettings(settings), 36,
        ), settings, 18);
        renderDraftTable(refined, summary, settings);
        renderDraftStrategy(refined, summary, settings);
      } catch (_) { /* analytical fallback is already rendered */ }
    }
  }

  async function animateDraftRoom(previousState, finalState, settings) {
    const start = previousState?.picks?.length || 0;
    const added = [...(finalState?.picks || [])].slice(start);
    if (!added.length) return;
    let animated = {
      picks: [...(previousState?.picks || [])],
      rosters: Object.fromEntries(Object.entries(previousState?.rosters || {}).map(([teamId, ids]) => [teamId, [...ids]])),
    };
    for (const pick of added) {
      animated = core.applyDraftPick(animated, pick.playerId, settings, pick.teamId);
      state.draftState = animated;
      const summary = core.draftPickSummary(animated, settings);
      renderDraftRoomBoard(settings, summary);
      $("#draft-next").textContent = summary.remaining > 0 ? `P${summary.pickNumber} / T${summary.teamId}` : "COMPLETE";
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
  }

  async function advanceDraftToUser(options = {}) {
    if ($("#draft-mode").value === "live") {
      if (!options.quiet) status("Live Draft Assistant never invents picks. Record the real room below.", "good");
      return { cpuPicks: 0, state: state.draftState };
    }
    if (state.draftBusy) return null;
    if (!state.draftStarted) return restartDraft();
    const settings = currentDraftSettings();
    state.draftBusy = true;
    if ($("#draft-reset")) $("#draft-reset").disabled = true;
    if ($("#draft-undo")) $("#draft-undo").disabled = true;
    if (!options.quiet) status("Simulating the room to your next pick…");
    try {
      const previousState = state.draftState;
      const result = await runWorker("draft-room-advance", { options: { players: state.players, state: previousState, settings, userTeamId: settings.draftPosition, strategy: $("#draft-opponent-strategy").value || "mixed", board: draftBoardPayload(), seed: "oracle-room-2026" } });
      await animateDraftRoom(previousState, result.state, settings);
      state.draftState = result.state;
      return result;
    } catch (error) {
      status(`Mock draft stopped: ${error.message}`, "error");
      throw error;
    } finally {
      state.draftBusy = false;
      await renderDraft();
    }
  }

  async function draftPlayerChoice(id) {
    if (!id || state.draftBusy) return;
    const settings = currentDraftSettings();
    const mode = $("#draft-mode").value;
    if (!state.draftStarted) return status(mode === "sim" ? "Start the mock first." : "Start the live draft assistant first.", "error");
    const before = core.draftPickSummary(state.draftState, settings);
    if (mode === "sim" && !before.isUserPick) return status("CPU teams are still ahead of your pick. Restart the mock if the room is stuck.", "error");
    state.draftState = core.applyDraftPick(state.draftState, id, settings);
    $("#draft-pick-search").value = "";
    await renderDraft({ refine: false });
    const after = core.draftPickSummary(state.draftState, settings);
    const picked = playerById(id);
    if (after.remaining <= 0) return status(mode === "sim" ? "Mock draft complete. Your final roster is ready." : "Live draft complete. The full room and your final roster are recorded.", "good");
    if (mode === "sim") {
      status("Pick locked. Other teams are drafting…");
      const result = await advanceDraftToUser({ quiet: true });
      const next = core.draftPickSummary(state.draftState, settings);
      if (next.remaining <= 0) status("Mock draft complete. Your final roster is ready.", "good");
      else if ((result?.cpuPicks || 0) === 0) status(`Back-to-back pick — you’re still on the clock at pick ${next.pickNumber}.`, "good");
      else status(`You’re on the clock at pick ${next.pickNumber}. ${result.cpuPicks} opponent pick${result.cpuPicks === 1 ? "" : "s"} simulated.`, "good");
    } else {
      status(`P${after.pickNumber - 1}: ${draftTeamLabel(before.teamId, settings)} took ${picked?.name || "that player"}. ${draftTeamLabel(after.teamId, settings)} is next.`, "good");
      renderDraft();
    }
  }

  async function recordNextDraftPick() {
    const id = $("#draft-manual-player").value;
    if (!id) return;
    await draftPlayerChoice(id);
  }

  async function restartDraft() {
    if (state.draftBusy) return;
    const settings = currentDraftSettings();
    $("#draft-position").max = String(settings.teams);
    $("#draft-position").value = String(settings.draftPosition);
    state.draftState = core.createDraftState(settings);
    state.draftStarted = true;
    await renderDraft({ refine: false });
    if ($("#draft-mode").value === "sim") {
      const summary = core.draftPickSummary(state.draftState, settings);
      if (!summary.isUserPick) {
        const result = await advanceDraftToUser({ quiet: true });
        const next = core.draftPickSummary(state.draftState, settings);
        status(`Mock started. You’re on the clock at pick ${next.pickNumber}${result?.cpuPicks ? ` after ${result.cpuPicks} CPU picks` : ""}.`, "good");
      } else {
        status("Mock started. You have the first pick.", "good");
        renderDraft();
      }
    } else {
      $("#draft-live-controls").open = true;
      status("Live Draft Assistant reset. Enter the real room from pick 1.", "good");
    }
  }

  async function changeDraftMode() {
    if (state.draftContext !== "league" && $("#draft-mode").value === "live") $("#draft-mode").value = "sim";
    await resetDraft({ refine: false });
    syncDraftModeSurface();
    $("#draft-flow-help").textContent = $("#draft-mode").value === "live"
      ? "Live Draft Assistant records the real picks from ESPN, Yahoo, Sleeper, NFL, CBS, or any other room and updates your strategy after every selection. SnapCount never invents opponent picks."
      : "Mock Draft runs the opponent picks automatically and returns the room to you every time you are on the clock.";
    status($("#draft-mode").value === "live" ? "Live Draft Assistant ready to start." : "Mock draft ready to start.", "good");
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

  function tradeRows(side) {
    return [...$$(`[data-trade-list="${side}"] .trade-player-row`)];
  }

  function tradeSelectedIds(side) {
    return tradeRows(side).map((row) => row.querySelector("[data-trade-player-input]")?.dataset.playerId || "").filter(Boolean);
  }

  function setTradeAnalysisMode(mode = "basic") {
    const requested = mode === "league" ? "league" : "basic";
    if (requested === "league" && !hasEspnMyLeagueAccess()) {
      state.tradeAnalysisMode = "basic";
      activatePanel("myleague");
      focusEspnSetup();
      status("Sync your league to unlock Advanced Trade Lab.", "error");
      return false;
    }
    state.tradeAnalysisMode = requested;
    const league = requested === "league";
    state.tradeActorTeamId = league ? (state.tradeActorTeamId || connectedUserTeamId()) : null;
    if ($("#trade-eyebrow")) $("#trade-eyebrow").textContent = league ? "ADVANCED TRADE LAB" : "TRADE VALUE";
    if ($("#trade-title")) $("#trade-title").textContent = league ? "Model the trade inside your league." : "Compare player value.";
    if ($("#trade-description")) $("#trade-description").textContent = league ? "Use real ownership, both rosters, league rules, future matchups, and season impact." : "A clean, league-independent value check. It stays available even after you sync a league.";
    const note = $("#trade-mode-note");
    note?.classList.toggle("league", league);
    if (note) note.innerHTML = league ? `<strong>League Impact</strong><span>Roster fit, opponent impact, future matchups, and league equity.</span>` : `<strong>Basic Value</strong><span>Compares worth to worth with no roster or league assumptions.</span>`;
    $("#trade-mode-switch")?.classList.toggle("hidden", !hasEspnMyLeagueAccess());
    $$('[data-set-trade-mode]').forEach((button) => button.classList.toggle("active", button.dataset.setTradeMode === requested));
    state.tradePartnerTeamId = league ? state.tradePartnerTeamId : null;
    if (state.players.length) populateTradeSelectors();
    return true;
  }

  function selectedTradeActorTeam() {
    if (state.tradeAnalysisMode !== "league" || !state.leagueTeams?.length) return null;
    const actorId = state.tradeActorTeamId || connectedUserTeamId();
    return state.leagueTeams.find((team) => String(team.teamId) === String(actorId)) || null;
  }

  function tradePartnerTeams() {
    if (state.tradeAnalysisMode !== "league") return [];
    const actor = selectedTradeActorTeam();
    if (!actor) return [];
    return state.leagueTeams.filter((team) => String(team.teamId) !== String(actor.teamId) && (team.roster || []).length);
  }

  function selectedTradePartnerTeam() {
    if (!state.tradePartnerTeamId) return null;
    return tradePartnerTeams().find((team) => String(team.teamId) === String(state.tradePartnerTeamId)) || null;
  }

  function tradePartnerMode() {
    return tradePartnerTeams().length > 0;
  }

  function tradePlayerLabel(player) {
    return `${player.name} · ${player.position} ${player.team || "FA"}`;
  }

  function tradePlayerPool(side) {
    const roster = rosterPlayers();
    const ranked = rankedPlayers();
    if (tradePartnerMode()) {
      if (side === "give") return [...(selectedTradeActorTeam()?.roster || [])].sort((a, b) => (a.pprRank || 9999) - (b.pprRank || 9999));
      return [...(selectedTradePartnerTeam()?.roster || [])].sort((a, b) => (a.pprRank || 9999) - (b.pprRank || 9999));
    }
    if (hasEspnMyLeagueAccess() && roster.length) {
      if (side === "give") return [...roster].sort((a, b) => (a.pprRank || 9999) - (b.pprRank || 9999));
      const rosterSet = new Set(roster.map((player) => String(player.id)));
      return ranked.filter((player) => !rosterSet.has(String(player.id)));
    }
    return ranked;
  }

  function closeTradeSuggestions(input) {
    const list = input.closest(".trade-typeahead")?.querySelector(".trade-suggestions");
    if (!list) return;
    list.classList.add("hidden");
    input.setAttribute("aria-expanded", "false");
  }

  function closeAllTradeSuggestions(except = null) {
    $$('[data-trade-player-input]').forEach((input) => { if (input !== except) closeTradeSuggestions(input); });
  }

  function renderTradeSuggestions(input) {
    const list = input.closest(".trade-typeahead")?.querySelector(".trade-suggestions");
    if (!list) return;
    const side = input.dataset.tradeSide;
    if (side === "get" && tradePartnerMode() && !selectedTradePartnerTeam()) {
      list.innerHTML = `<div class="trade-no-suggestions">Choose a trade partner first.</div>`;
      list.classList.remove("hidden");
      input.setAttribute("aria-expanded", "true");
      return;
    }
    const selectedElsewhere = new Set($$('[data-trade-player-input]').filter((row) => row !== input).map((row) => row.dataset.playerId).filter(Boolean));
    const query = input.value.trim();
    const rows = tradePlayerPool(side)
      .filter((player) => !selectedElsewhere.has(String(player.id)) && playerMatchesSearch(player, query))
      .slice(0, 10);
    if (!rows.length) {
      list.innerHTML = `<div class="trade-no-suggestions">No matching players.</div>`;
      list.classList.remove("hidden");
      input.setAttribute("aria-expanded", "true");
      return;
    }
    list.innerHTML = rows.map((player) => `<button type="button" class="trade-suggestion" role="option" data-trade-option="${esc(player.id)}"><strong>${esc(player.name)}</strong><span>${esc(player.position)} · ${esc(player.team || "FA")}</span></button>`).join("");
    list.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
  }

  function selectTradePlayer(input, playerId) {
    const player = playerById(playerId);
    if (!player) return;
    input.value = tradePlayerLabel(player);
    input.dataset.playerId = String(player.id);
    input.classList.add("has-selection");
    closeTradeSuggestions(input);
    normalizeTradeRows(input.dataset.tradeSide);
  }

  function handleTradeInputKeydown(event) {
    const input = event.currentTarget;
    const list = input.closest(".trade-typeahead")?.querySelector(".trade-suggestions");
    const options = list ? [...list.querySelectorAll("[data-trade-option]")] : [];
    if (event.key === "Escape") { closeTradeSuggestions(input); return; }
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key) || !options.length) return;
    event.preventDefault();
    let index = options.findIndex((option) => option.classList.contains("active"));
    if (event.key === "ArrowDown") index = index < options.length - 1 ? index + 1 : 0;
    if (event.key === "ArrowUp") index = index > 0 ? index - 1 : options.length - 1;
    if (event.key === "Enter") {
      const choice = options[Math.max(0, index)];
      if (choice) selectTradePlayer(input, choice.dataset.tradeOption);
      return;
    }
    options.forEach((option, optionIndex) => option.classList.toggle("active", optionIndex === index));
    options[index]?.scrollIntoView({ block: "nearest" });
  }

  function appendTradeRow(side, playerId = "") {
    const list = $(`#trade-${side}-list`);
    if (!list) return null;
    const row = document.createElement("div");
    row.className = "trade-player-row";
    row.innerHTML = `<span class="trade-player-number"></span><div class="trade-typeahead"><input type="text" data-trade-player-input data-trade-side="${side}" placeholder="Type a player name…" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false"><div class="trade-suggestions hidden" role="listbox"></div></div>`;
    list.appendChild(row);
    const input = row.querySelector("[data-trade-player-input]");
    input.addEventListener("focus", () => { closeAllTradeSuggestions(input); if (input.dataset.playerId) input.select(); else renderTradeSuggestions(input); });
    input.addEventListener("input", () => {
      if (input.dataset.playerId) { delete input.dataset.playerId; input.classList.remove("has-selection"); }
      renderTradeSuggestions(input);
      normalizeTradeRows(side);
    });
    input.addEventListener("keydown", handleTradeInputKeydown);
    row.querySelector(".trade-suggestions").addEventListener("mousedown", (event) => {
      const option = event.target.closest("[data-trade-option]");
      if (!option) return;
      event.preventDefault();
      selectTradePlayer(input, option.dataset.tradeOption);
    });
    if (playerId) { const player = playerById(playerId); if (player) { input.value = tradePlayerLabel(player); input.dataset.playerId = String(player.id); input.classList.add("has-selection"); } }
    return row;
  }

  function normalizeTradeRows(side) {
    let rows = tradeRows(side);
    while (rows.length < 2) { appendTradeRow(side); rows = tradeRows(side); }
    while (rows.length > 2) {
      const last = rows[rows.length - 1].querySelector("[data-trade-player-input]")?.dataset.playerId;
      const previous = rows[rows.length - 2].querySelector("[data-trade-player-input]")?.dataset.playerId;
      if (last || previous) break;
      rows[rows.length - 1].remove();
      rows = tradeRows(side);
    }
    if (rows.length && rows.every((row) => row.querySelector("[data-trade-player-input]")?.dataset.playerId)) appendTradeRow(side);
    tradeRows(side).forEach((row, index) => {
      row.querySelector(".trade-player-number").textContent = `Player ${index + 1}${index > 0 ? " (optional)" : ""}`;
    });
  }

  function renderTradeSide(side, selectedIds = []) {
    const list = $(`#trade-${side}-list`);
    if (!list) return;
    list.innerHTML = "";
    const allowed = new Set(tradePlayerPool(side).map((player) => String(player.id)));
    selectedIds.filter((id) => allowed.has(String(id))).forEach((id) => appendTradeRow(side, id));
    normalizeTradeRows(side);
  }

  function syncTradePartnerControl() {
    const partyBLabel = $("#trade-partner-label");
    const partyBSelect = $("#trade-partner");
    const partyASelect = $("#trade-actor-team");
    const leagueMode = state.tradeAnalysisMode === "league" && hasEspnMyLeagueAccess();
    $("#trade-league-controls")?.classList.toggle("hidden", !leagueMode);
    partyBLabel?.classList.toggle("hidden", !leagueMode);
    if (leagueMode && partyASelect) {
      const validPartyA = (state.leagueTeams || []).some((team) => String(team.teamId) === String(state.tradeActorTeamId));
      if (!validPartyA) state.tradeActorTeamId = connectedUserTeamId();
      partyASelect.innerHTML = (state.leagueTeams || []).map((team) => `<option value="${esc(team.teamId)}">${String(team.teamId) === connectedUserTeamId() ? "Your team · " : ""}${esc(team.name)}</option>`).join("");
      partyASelect.value = state.tradeActorTeamId || connectedUserTeamId() || "";
    }
    const partners = tradePartnerTeams();
    if (!leagueMode) {
      state.tradePartnerTeamId = null;
      if (partyBSelect) partyBSelect.innerHTML = `<option value="">Choose Party B</option>`;
    } else if (partyBSelect) {
      const validPartyB = partners.some((team) => String(team.teamId) === String(state.tradePartnerTeamId));
      if (!validPartyB) state.tradePartnerTeamId = null;
      partyBSelect.innerHTML = `<option value="">Choose Party B</option>${partners.map((team) => `<option value="${esc(team.teamId)}">${String(team.teamId) === connectedUserTeamId() ? "Your team · " : ""}${esc(team.name)}</option>`).join("")}`;
      partyBSelect.value = state.tradePartnerTeamId || "";
    }
    const partyA = selectedTradeActorTeam();
    const partyB = selectedTradePartnerTeam();
    $("#trade-give-scope").textContent = leagueMode ? (partyA ? `${partyA.name} roster` : "Choose Party A") : "Any player";
    $("#trade-get-scope").textContent = leagueMode ? (partyB ? `${partyB.name} roster` : "Choose Party B") : "Any player";
    const giveHeading = $('[data-trade-side="give"] .trade-side-head > strong');
    const getHeading = $('[data-trade-side="get"] .trade-side-head > strong');
    if (giveHeading) giveHeading.textContent = leagueMode ? (partyA ? `${partyA.name} SENDS` : "PARTY A SENDS") : "SIDE A SENDS";
    if (getHeading) getHeading.textContent = leagueMode ? (partyB ? `${partyB.name} SENDS` : "PARTY B SENDS") : "SIDE B SENDS";
  }

  function populateTradeSelectors() {
    if (!$("#trade-give-list") || !state.players.length) return;
    const giveIds = tradeSelectedIds("give");
    const getIds = tradeSelectedIds("get");
    syncTradePartnerControl();
    renderTradeSide("give", giveIds);
    renderTradeSide("get", getIds);
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
    const settings = currentLeagueSettings();
    const userConstraints = connectedUserTeamId() ? liveLineupConstraintsForTeam(connectedUserTeamId(), week) : {};
    const opponentConstraints = opponent ? liveLineupConstraintsForTeam(opponent.teamId, week) : {};
    if (userConstraints.available && userConstraints.complete === false) throw new Error("Current lineup state contains a locked player in an unsupported slot. SnapCount will not invent a legal lineup.");
    roster = refreshDecisionPlayers(roster).map((player) => leagueApi.playerForScoring(player, settings));
    if (opponent) opponent = { ...opponent, roster: refreshDecisionPlayers(opponent.roster || []).map((player) => leagueApi.playerForScoring(player, settings)) };
    const userFinalScores = currentWeekLeagueFinalScoresByTeam(week)?.[String(connectedUserTeamId())] || {};
    const forecasts = engine.applyFinalScores(roster.map((player) => engine.forecastPlayer(player, { week, evidence: decisionEvidence(player, week), validatedMeanScale: servingMeanScale("startSit") })), userFinalScores);
    const byId = new Map(forecasts.map((forecast) => [String(forecast.player.id), forecast]));
    const prepared = forecasts.map((forecast) => ({ ...forecast.player, weekProjection: forecast.distribution.mean }));
    const baselineLineup = core.optimizeLineup(prepared, settings, "weekProjection", userConstraints);
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
          settings,
          week,
          schedule: state.schedule,
          evidenceByPlayer,
          validatedMeanScale: servingMeanScale("startSit"),
          userLineupConstraints: userConstraints,
          opponentLineupConstraints: opponentConstraints.complete === false ? {} : opponentConstraints,
          finalScoresByTeamWeek: currentWeekLeagueFinalScoresByTeam(week),
          scenarios: 5000,
          seed: `matchup-lineup-${connectedUserTeamId()}-${opponent.teamId}-${week}`,
        } });
        if (matchup.preferred?.starterIds?.length && matchup.winProbabilityGain95?.[0] > 0) {
          const preferredSet = new Set(matchup.preferred.starterIds.map(String));
          const preferredPlayers = prepared.filter((player) => preferredSet.has(String(player.id)));
          const assigned = core.optimizeLineup(preferredPlayers, settings, "weekProjection", userConstraints);
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
      const starters = lineup.starters.map((row) => `<div class="lineup-row"><span>${esc(row.slot)}${row.locked ? " · LOCKED" : ""}</span><strong>${row.player ? esc(row.player.name) : "EMPTY"}</strong><b>${row.player ? num(byId.get(String(row.player.id))?.distribution.mean) : "—"}</b></div>`).join("");
      const lockedBench = new Set((userConstraints.lockedBenchPlayerIds || []).map(String));
      const bench = lineup.bench.slice(0, 8).map((player) => `<div class="lineup-row"><span>BN${lockedBench.has(String(player.id)) ? " · LOCKED" : ""}</span><strong>${esc(player.name)}</strong><b>${num(byId.get(String(player.id))?.distribution.mean)}</b></div>`).join("");
      const matchupMetrics = matchup && opponent ? `<div class="metric"><span>WIN CHANCE VS ${esc(opponent.name).toUpperCase()}</span><strong class="good">${pct(matchup.preferred.winProbability, 1)}</strong></div><div class="metric"><span>VS POINT-MAX LINEUP</span><strong>${matchup.winProbabilityGain > 0 ? "+" : ""}${pct(matchup.winProbabilityGain, 1)}</strong></div>` : "";
      const heading = opponent ? `Start these players to beat ${esc(opponent.name)}` : "Start these players";
      $("#lineup-result").className = "result-space";
      $("#lineup-result").innerHTML = `<div class="friendly-result-head"><div><span class="result-kicker">RECOMMENDED LINEUP</span><h2>${heading}</h2></div><strong>${num(summary.mean)} projected points</strong></div><div class="metric-grid friendly-metrics lineup-summary"><div class="metric"><span>PROJECTED TOTAL</span><strong>${num(summary.mean)}</strong></div><div class="metric"><span>TYPICAL RANGE</span><strong>${num(summary.p25)}–${num(summary.p75)}</strong></div><div class="metric"><span>UPSIDE</span><strong class="good">${num(summary.p90)}</strong></div>${matchupMetrics}</div><div class="result-grid"><div><p class="control-title">START THESE</p><div class="lineup-list">${starters}</div></div><div><p class="control-title">BENCH THESE</p><div class="lineup-list">${bench || "<div class='lineup-row'><strong>No bench players</strong></div>"}</div></div></div><details class="advanced-details result-details"><summary>See projection range details</summary>${rangeMarkup(summary)}${userConstraints.lockedCount ? `<p class="fineprint">Live lineup state: ${userConstraints.lockedCount} player${userConstraints.lockedCount === 1 ? " is" : "s are"} locked. SnapCount optimized only the remaining legal slots.${userConstraints.knownPoints ? ` ${num(userConstraints.knownPoints)} points are already recorded in imported live state.` : ""}</p>` : ""}${matchup ? `<p class="fineprint">Opponent-aware choice evaluated ${matchup.candidatesEvaluated} legal lineup candidates on ${matchup.evaluationScenarios.toLocaleString()} held-out Monte Carlo scenarios. The point-max lineup remains the fallback unless the matchup win-probability gain clears Monte Carlo uncertainty.</p>` : ""}</details>`;
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
    let freeAgents = leagueApi.availablePlayers(state.players, state.leagueTeams, state.rosterIds);
    const week = Number($("#waiver-week").value || 1);
    const mode = $("#waiver-mode").value || "priority";
    const requestedBudget = Math.max(0, Number($("#faab-budget").value || 0));
    const transactionState = leagueApi.transactionFeasibility({ league: activeLeagueState(), teamId: connectedUserTeamId(), type: "waiver" });
    if (!transactionState.allowed) return status(`Waiver move is not legal: ${transactionState.reasons.join("; ")}.`, "error");
    const budget = transactionState.faabRemaining !== null ? Math.min(requestedBudget, transactionState.faabRemaining) : requestedBudget;
    $("#run-waivers").disabled = true;
    status("Checking available players against your roster…");
    let contextState = { live: { failed: [] }, history: {} };
    try {
      const intelligencePool = [...freeAgents].sort((a, b) => baselineWeekProjection(b, week) - baselineWeekProjection(a, week)).slice(0, 180);
      contextState = await prepareDecisionContext([...roster, ...intelligencePool], week);
      roster = refreshDecisionPlayers(roster);
      freeAgents = leagueApi.availablePlayers(state.players, state.leagueTeams, state.rosterIds);
      const intelligenceIds = new Set(intelligencePool.map((player) => String(player.id)));
      const settings = currentLeagueSettings();
      const decisionRoster = roster.map((player) => decisionPlayerForWeek(player, week, "waivers"));
      const decisionFreeAgents = freeAgents.map((player) => intelligenceIds.has(String(player.id)) ? decisionPlayerForWeek(player, week, "waivers") : leagueApi.playerForScoring(player, settings));
      status("Finding the pickups that help you most…");
      let suggestions = await runWorker("waivers", { roster: decisionRoster, freeAgents: decisionFreeAgents, settings, limit: 12, week, policy: { minimumScore: Number(servingPolicy("waivers").minimumScore || 0.25) } });
      const lockedIds = currentLockedPlayerIds(connectedUserTeamId(), week);
      const rosterUsage = transactionRosterUsage();
      suggestions = suggestions.filter((row) => {
        const dropSlot = leagueApi.normalizeLineupSlot(rosterUsage.entryByPlayer.get(String(row.drop.id))?.lineupSlot);
        const droppingIr = dropSlot === "IR";
        return leagueApi.transactionFeasibility({ league: activeLeagueState(), teamId: connectedUserTeamId(), type: "waiver", rosterCountAfter: rosterUsage.active === null ? null : rosterUsage.active + (droppingIr ? 1 : 0), irCountAfter: rosterUsage.ir === null ? null : Math.max(0, rosterUsage.ir - (droppingIr ? 1 : 0)), involvedPlayerIds: [String(row.drop.id)], lockedPlayerIds: lockedIds }).allowed;
      });
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
          const future = await runWorker("future-win-actions", { options: { teams: preparedLeague.teams, userTeamId: connectedUserTeamId(), actions, settings: preparedLeague.settings, schedule: state.schedule, fantasySchedule: fantasyScheduleForLeague(), startWeek: week, regularSeasonEnd: endWeek, evidenceByPlayer: preparedLeague.evidenceByPlayer, evidenceByPlayerWeek: preparedLeague.evidenceByPlayerWeek, validatedMeanScale: preparedLeague.validatedMeanScale, lineupConstraintsByTeamWeek: { [week]: currentWeekLeagueConstraintsByTeam(week) }, finalScoresByTeamWeek: { [week]: currentWeekLeagueFinalScoresByTeam(week) }, simulations: 1200, seed: `waiver-future-${week}` } });
          const futureById = new Map((future.actions || []).map((row) => [row.id, row]));
          suggestions = candidates.map((row, index) => ({ ...row, futureWin: futureById.get(`waiver-${index + 1}`) || null }))
            .filter((row) => Number(row.futureWin?.delta?.expectedFutureHeadToHeadWins || 0) > 0)
            .sort((a, b) => (a.futureWin?.rank || 999) - (b.futureWin?.rank || 999));
        }
      }
      $("#waiver-result").className = "result-space";
      const transactionNote = transactionContextLabel();
      $("#waiver-result").innerHTML = suggestions.length ? `<div class="decision-list">${suggestions.map((row) => {
        const bid = mode === "faab" ? faabRange(row, budget, week) : null;
        const claim = bid ? `Bid about $${bid.target}` : waiverPriorityLabel(row);
        const detail = bid ? `Reasonable range: ${bid.floor}–${bid.ceiling}` : row.lineupGain > 0 ? `Could improve your starters by ${num(row.lineupGain)} points` : `Adds ${num(row.depthGain)} points of bench depth`;
        const futureDetail = row.futureWin ? `<span>Future H2H win chance: <b>${pct(row.futureWin.outcome.averageMatchupWinProbability, 1)}</b> (${row.futureWin.delta.averageMatchupWinProbability >= 0 ? "+" : ""}${pct(row.futureWin.delta.averageMatchupWinProbability, 1)}) · expected wins ${row.futureWin.delta.expectedFutureHeadToHeadWins >= 0 ? "+" : ""}${num(row.futureWin.delta.expectedFutureHeadToHeadWins, 2)}</span>` : "";
        return `<article class="decision-card friendly-decision"><div class="decision-head"><div><span class="result-kicker">${esc(claim)}</span><strong>Add ${esc(row.add.name)}</strong></div><b>Drop ${esc(row.drop.name)}</b></div><p>${esc(row.reason)}</p><div class="decision-stats"><span>${esc(detail)}</span>${futureDetail}</div></article>`;
      }).join("")}</div>${transactionNote ? `<p class="fineprint">Transaction state: ${esc(transactionNote)}.</p>` : ""}` : `<div class="empty-answer"><strong>No pickup is clearly worth it right now.</strong><p>Your current roster grades better than the available add/drop options for this week.</p>${transactionNote ? `<p class="fineprint">Transaction state: ${esc(transactionNote)}.</p>` : ""}</div>`;
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

  async function analyzeStandaloneTrade(giveIds, getIds, week) {
    const button = $("#analyze-trade");
    button.disabled = true;
    status("Comparing both sides using current player value and projection context…");
    try {
      const selected = [...giveIds, ...getIds].map((id) => playerById(id)).filter(Boolean);
      const contextState = await prepareDecisionContext(selected, week);
      const give = giveIds.map((id) => playerById(id)).filter(Boolean).map((player) => decisionPlayerForWeek(player, week, "trades"));
      const receive = getIds.map((id) => playerById(id)).filter(Boolean).map((player) => decisionPlayerForWeek(player, week, "trades"));
      const settings = currentLeagueSettings();
      const analysis = core.analyzeTrade({ roster: give, give, receive, players: state.players.map((player) => leagueApi.playerForScoring(player, settings)), settings, week });
      const edgePct = analysis.giveValue > 0 ? (analysis.assetGain / analysis.giveValue) * 100 : 0;
      const verdict = edgePct >= 8 ? "SIDE B HIGHER" : edgePct <= -8 ? "SIDE A HIGHER" : "EVEN VALUE";
      const giveProjection = give.reduce((sum, player) => sum + Number(player.decisionProjection || baselineWeekProjection(player, week)), 0);
      const getProjection = receive.reduce((sum, player) => sum + Number(player.decisionProjection || baselineWeekProjection(player, week)), 0);
      $("#trade-check-result").className = "result-space";
      $("#trade-check-result").innerHTML = `<div class="trade-verdict neutral"><span>STANDALONE VALUE CHECK</span><strong>${verdict}</strong><p>${edgePct >= 8 ? "Side B carries more standalone value." : edgePct <= -8 ? "Side A carries more standalone value." : "The two packages are close in standalone value."}</p></div><div class="metric-grid friendly-metrics"><div class="metric"><span>SIDE A VALUE</span><strong>${num(analysis.giveValue, 1)}</strong></div><div class="metric"><span>SIDE B VALUE</span><strong>${num(analysis.receiveValue, 1)}</strong></div><div class="metric"><span>B − A EDGE</span><strong>${edgePct >= 0 ? "+" : ""}${num(edgePct, 1)}%</strong></div><div class="metric"><span>WEEK ${week} B − A PROJECTION</span><strong>${num(getProjection - giveProjection, 1)} pts</strong></div><div class="metric"><span>TRADE BALANCE</span><strong>${analysis.fairness}/100</strong></div></div><div class="trade-summary"><strong>Side A sends:</strong> ${esc(give.map((player) => player.name).join(" + "))}<br><strong>Side B sends:</strong> ${esc(receive.map((player) => player.name).join(" + "))}<br><span>This is a league-independent package comparison. Connect ESPN in <strong>My League</strong> to add roster fit, actual ownership, opponent schedule, transaction rules, and future-win impact.</span></div><p class="fineprint">${esc(decisionContextLabel(contextState))}.</p>`;
      status("Standalone trade comparison ready.", "good");
    } catch (error) {
      status(error.message, "error");
    } finally { button.disabled = false; }
  }

  function matchupAverageAgainst(outcome, teamId) {
    const rows = (outcome?.matchupWinProbabilities || []).filter((row) => String(row.opponentTeamId) === String(teamId));
    return rows.length ? rows.reduce((sum, row) => sum + Number(row.winProbability || 0), 0) / rows.length : null;
  }

  async function analyzeThirdPartyTrade(giveIds, getIds, week, actor, partner) {
    const button = $("#analyze-trade");
    button.disabled = true;
    status(`Modeling how ${actor.name} trading with ${partner.name} changes your future schedule…`);
    try {
      const future = await runFutureWinActions([{ id: "league-trade", type: "trade", label: `${actor.name} ↔ ${partner.name}`, actorTeamId: String(actor.teamId), opponentTeamId: String(partner.teamId), sendPlayerIds: giveIds, receivePlayerIds: getIds }], "trades", week, 2200, `third-party-trade-${actor.teamId}-${partner.teamId}-${week}-${giveIds.join("-")}-${getIds.join("-")}`, 900);
      if (!future) throw new Error("A complete connected schedule and recognized league rosters are required for third-party league impact.");
      const hold = future.actions?.find((row) => row.id === "hold");
      const trade = future.actions?.find((row) => row.id === "league-trade");
      if (!hold || !trade) throw new Error("League impact simulation did not return the requested trade state.");
      const actorBefore = hold.opponents?.[String(actor.teamId)], actorAfter = trade.opponents?.[String(actor.teamId)];
      const partnerBefore = hold.opponents?.[String(partner.teamId)], partnerAfter = trade.opponents?.[String(partner.teamId)];
      const vsActorBefore = matchupAverageAgainst(hold.outcome, actor.teamId), vsActorAfter = matchupAverageAgainst(trade.outcome, actor.teamId);
      const vsPartnerBefore = matchupAverageAgainst(hold.outcome, partner.teamId), vsPartnerAfter = matchupAverageAgainst(trade.outcome, partner.teamId);
      const give = giveIds.map((id) => playerById(id)).filter(Boolean), receive = getIds.map((id) => playerById(id)).filter(Boolean);
      const equity = trade.delta?.leagueEquity;
      const metric = (label, value, delta, deltaKind = "pct") => {
        const deltaText = !Number.isFinite(delta) ? "" : deltaKind === "wins" ? `${delta >= 0 ? "+" : ""}${num(delta, 2)} wins` : `${delta >= 0 ? "+" : ""}${pct(delta, 1)}`;
        return `<div class="metric"><span>${esc(label)}</span><strong>${value}${deltaText ? ` <small>${deltaText}</small>` : ""}</strong></div>`;
      };
      $("#trade-check-result").className = "result-space";
      $("#trade-check-result").innerHTML = `<div class="trade-verdict neutral"><span>LEAGUE IMPACT</span><strong>${esc(actor.name)} ↔ ${esc(partner.name)}</strong><p>This is not a recommendation that you make the trade. It models what happens to you if these two managers complete it.</p></div><div class="metric-grid friendly-metrics">${metric("YOUR FUTURE GAME WIN CHANCE", pct(trade.outcome.averageMatchupWinProbability, 1), trade.delta.averageMatchupWinProbability)}${metric("YOUR EXPECTED REMAINING WINS", num(trade.outcome.expectedFutureHeadToHeadWins, 2), Number(trade.delta.expectedFutureHeadToHeadWins || 0), "wins")}${equity ? metric("YOUR CHAMPIONSHIP CHANCE", pct(trade.leagueEquity.user.championshipProbability, 1), equity.championshipProbability) : ""}${actorBefore && actorAfter ? metric(`${actor.name.toUpperCase()} FUTURE WIN CHANCE`, pct(actorAfter.averageMatchupWinProbability, 1), actorAfter.averageMatchupWinProbability - actorBefore.averageMatchupWinProbability) : ""}${partnerBefore && partnerAfter ? metric(`${partner.name.toUpperCase()} FUTURE WIN CHANCE`, pct(partnerAfter.averageMatchupWinProbability, 1), partnerAfter.averageMatchupWinProbability - partnerBefore.averageMatchupWinProbability) : ""}${vsActorBefore !== null && vsActorAfter !== null ? metric(`YOUR GAMES VS ${actor.name.toUpperCase()}`, pct(vsActorAfter, 1), vsActorAfter - vsActorBefore) : ""}${vsPartnerBefore !== null && vsPartnerAfter !== null ? metric(`YOUR GAMES VS ${partner.name.toUpperCase()}`, pct(vsPartnerAfter, 1), vsPartnerAfter - vsPartnerBefore) : ""}</div><div class="trade-summary"><strong>${esc(actor.name)} sends:</strong> ${esc(give.map((player) => player.name).join(" + "))}<br><strong>${esc(partner.name)} sends:</strong> ${esc(receive.map((player) => player.name).join(" + "))}</div><p class="fineprint">The model evaluates your future matchups and league equity after moving the players between those two rosters. It does not assert another manager's platform-specific trade legality or intent.</p>`;
      status(`League impact modeled for ${actor.name} and ${partner.name}.`, "good");
    } catch (error) {
      status(error.message, "error");
    } finally { button.disabled = false; }
  }

  async function analyzeSelectedTrade() {
    const actor = state.tradeAnalysisMode === "league" ? selectedTradeActorTeam() : null;
    const giveIds = tradeSelectedIds("give");
    const getIds = tradeSelectedIds("get");
    if (!giveIds.length || !getIds.length) return status("Choose at least one player on each side of the trade.", "error");
    if (giveIds.some((id) => getIds.includes(id))) return status("The same player cannot be on both sides of the trade.", "error");
    const partnerMode = tradePartnerMode();
    const partner = selectedTradePartnerTeam();
    if (partnerMode && !partner) return status("Choose Party B first.", "error");
    if (partnerMode) {
      const givePoolIds = new Set((actor?.roster || []).map((player) => String(player.id)));
      const receivePoolIds = new Set((partner?.roster || []).map((player) => String(player.id)));
      if (giveIds.some((id) => !givePoolIds.has(String(id)))) return status(`Every player Party A sends must be on ${actor?.name || "Party A"}'s roster.`, "error");
      if (getIds.some((id) => !receivePoolIds.has(String(id)))) return status(`Every player Party B sends must be on ${partner?.name || "Party B"}'s roster.`, "error");
    }
    const week = Number($("#trade-week").value || 1);
    if (state.tradeAnalysisMode !== "league") return analyzeStandaloneTrade(giveIds, getIds, week);
    if (!hasEspnMyLeagueAccess()) return status("Sync your league to use League Impact.", "error");
    if (!actor) return status("Choose Party A for the trade.", "error");
    if (!partner) return status("Choose Party B for the trade.", "error");
    const userTeamId = connectedUserTeamId();
    const userIsPartyA = String(actor.teamId) === userTeamId;
    const userIsPartyB = String(partner.teamId) === userTeamId;
    if (!userIsPartyA && !userIsPartyB) return analyzeThirdPartyTrade(giveIds, getIds, week, actor, partner);
    let roster = [...((userIsPartyA ? actor : partner).roster || [])];
    const userGiveIds = userIsPartyA ? giveIds : getIds;
    const userGetIds = userIsPartyA ? getIds : giveIds;
    const counterpartyTeam = userIsPartyA ? partner : actor;
    if (!roster.length) return status("Your connected ESPN team has no recognized roster players yet.", "error");
    const tradeRosterUsage = transactionRosterUsage();
    const irGiveCount = userGiveIds.filter((id) => leagueApi.normalizeLineupSlot(tradeRosterUsage.entryByPlayer.get(String(id))?.lineupSlot) === "IR").length;
    const tradeFeasibility = leagueApi.transactionFeasibility({
      league: activeLeagueState(), teamId: connectedUserTeamId(), type: "trade", now: Date.now(),
      rosterCountAfter: tradeRosterUsage.active === null ? null : tradeRosterUsage.active - (userGiveIds.length - irGiveCount) + userGetIds.length,
      irCountAfter: tradeRosterUsage.ir === null ? null : Math.max(0, tradeRosterUsage.ir - irGiveCount),
    });
    if (!tradeFeasibility.allowed) return status("Trade is not legal: " + tradeFeasibility.reasons.join("; ") + ".", "error");
    const selected = [...roster, ...userGetIds.map((id) => playerById(id)).filter(Boolean)];
    const button = $("#analyze-trade");
    button.disabled = true;
    status("Checking the trade against your lineup, future opponents, and current player context…");
    try {
      const contextState = await prepareDecisionContext(selected, week);
      roster = refreshDecisionPlayers(roster);
      const decisionRoster = roster.map((player) => decisionPlayerForWeek(player, week, "trades"));
      const give = userGiveIds.map((id) => playerById(id)).filter(Boolean).map((player) => decisionPlayerForWeek(player, week, "trades"));
      const receive = userGetIds.map((id) => playerById(id)).filter(Boolean).map((player) => decisionPlayerForWeek(player, week, "trades"));
      const settings = currentLeagueSettings();
      const analysis = core.analyzeTrade({ roster: decisionRoster, give, receive, players: state.players.map((player) => leagueApi.playerForScoring(player, settings)), settings, week });
      const tradePolicy = servingPolicy("trades");
      const acceptScore = Number(tradePolicy.acceptScore || 28), passScore = Number(tradePolicy.passScore || -28);
      const opponentTeam = counterpartyTeam;
      let future = null, futureAction = null, opponentBefore = null;
      if (opponentTeam && hasRealFantasySchedule()) {
        future = await runFutureWinActions([{
          id: "selected-trade", type: "trade", label: "Proposed trade",
          opponentTeamId: String(opponentTeam.teamId), sendPlayerIds: userGiveIds, receivePlayerIds: userGetIds,
        }], "trades", week, 2200, `trade-future-${[...userGiveIds].sort().join("-")}-${[...userGetIds].sort().join("-")}-${week}`, 900);
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
      const transactionNote = transactionContextLabel();
      const objectiveNote = (futureAction
        ? `<p class="fineprint">Primary objective: maximize your expected wins across the remaining scheduled head-to-head games. Trade simulations transfer players on both rosters and use common random numbers. The historically qualified trade score remains a guardrail: the new layer can veto or rerank, but cannot turn a qualified rejection into an accept.</p>`
        : `<p class="fineprint">Connect ESPN with a recognized schedule and target players owned by one opponent to unlock opponent-aware future-win simulation.</p>`) + (transactionNote ? `<p class="fineprint">Transaction state: ${esc(transactionNote)}.</p>` : "");
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
    if (!hasEspnMyLeagueAccess()) return status("Connect ESPN and choose your team before asking for trade ideas.", "error");
    let userRoster = rosterPlayers();
    if (!userRoster.length) return status("Your connected ESPN team has no recognized roster players yet.", "error");
    const week = Number($("#trade-week").value || 1);
    const tradeWindow = leagueApi.transactionFeasibility({ league: activeLeagueState(), teamId: connectedUserTeamId(), type: "trade", now: Date.now() });
    if (!tradeWindow.allowed) return status("Trades are not currently legal: " + tradeWindow.reasons.join("; ") + ".", "error");
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
            settings: preparedLeague.settings,
            week,
            includeTwoForTwo: true,
            maxEvaluations: 450,
            limit: 4,
          } });
          const userUsage = transactionRosterUsage();
          for (const proposal of proposals) {
            if (Number(proposal.userAnalysis?.score) < acceptScore) continue;
            const irGiveCount = proposal.give.filter((player) => leagueApi.normalizeLineupSlot(userUsage.entryByPlayer.get(String(player.id))?.lineupSlot) === "IR").length;
            const feasible = leagueApi.transactionFeasibility({
              league: activeLeagueState(), teamId: connectedUserTeamId(), type: "trade", now: Date.now(),
              rosterCountAfter: userUsage.active === null ? null : userUsage.active - (proposal.give.length - irGiveCount) + proposal.receive.length,
              irCountAfter: userUsage.ir === null ? null : Math.max(0, userUsage.ir - irGiveCount),
            });
            if (!feasible.allowed) continue;
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
          settings: preparedLeague.settings,
          schedule: state.schedule,
          fantasySchedule: fantasyScheduleForLeague(),
          startWeek: week,
          regularSeasonEnd: endWeek,
          evidenceByPlayer: preparedLeague.evidenceByPlayer,
          evidenceByPlayerWeek: preparedLeague.evidenceByPlayerWeek,
          validatedMeanScale: preparedLeague.validatedMeanScale,
          lineupConstraintsByTeamWeek: { [week]: currentWeekLeagueConstraintsByTeam(week) },
          finalScoresByTeamWeek: { [week]: currentWeekLeagueFinalScoresByTeam(week) },
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
        settings: currentLeagueSettings(),
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
    if (!state.leagueTeams) balancedLeague(currentLeagueSettings().teams);
    const scenarios = Number($("#league-scenarios").value || 1500);
    const regularSeasonEnd = Number($("#regular-season-end").value || 14);
    const championshipWeek = Number($("#championship-week").value || 17);
    const startWeek = hasRealFantasySchedule() ? Math.max(1, Number(activeLeagueState()?.currentWeek || 1)) : 1;
    $("#run-league").disabled = true;
    let leaguePlayers = [...new Map(state.leagueTeams.flatMap((team) => team.roster).map((player) => [String(player.id), player])).values()];
    $("#league-source-status").textContent = `Checking ${leaguePlayers.length} players and current team context…`;
    let contextState = { live: { failed: [] }, history: {} };
    try {
      contextState = await prepareDecisionContext(leaguePlayers);
      const settings = currentLeagueSettings();
      state.leagueTeams = state.leagueTeams.map((team) => ({ ...team, roster: refreshDecisionPlayers(team.roster).map((player) => leagueApi.playerForScoring(player, settings)) }));
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
        settings,
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
        lineupConstraintsByTeamWeek: { [startWeek]: currentWeekLeagueConstraintsByTeam(startWeek) },
        finalScoresByTeamWeek: { [startWeek]: currentWeekLeagueFinalScoresByTeam(startWeek) },
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
    clearImportedProjectionOverrides();
    await Promise.all([store.remove("roster-ids"), store.remove("evidence-ledger"), store.remove("ensemble-weights"), store.remove("draft-custom-board"), store.remove("espn-connection"), store.remove("espn-snapshot"), store.remove("league-state"), store.remove("league-profile"), store.remove("my-league-enabled"), store.remove("player-outlooks"), store.remove("player-passes"), store.remove("outlook-round-lock")]);
    state.rosterIds = [];
    state.playerOutlooks = {};
    state.playerPasses = {};
    state.outlookRoundLock = false;
    state.ledger = new evidenceApi.EvidenceLedger();
    state.ensembleWeights = { market: 0.55, opportunity: 0.45 };
    state.leagueTeams = null;
    state.leagueMeta = null;
    state.leagueState = null;
    state.connectedTeamId = null;
    state.pendingLeagueImport = null;
    state.leagueProfile = leagueApi.normalizeProfile({ source: "manual", teams: 12, scoring: "ppr", slots: { ...core.DEFAULT_SETTINGS.slots, BN: 7 } });
    state.tradePartnerTeamId = null;
    state.espnLeague = null;
    state.espnConnection = null;
    state.espnNeedsSession = false;
    state.draftBoard = null;
    state.draftContext = "public";
    state.publicDraftSettings = null;
    state.publicDraftPreset = null;
    state.publicDraftPresetSettings = null;
    $("#draft-custom-board").value = "";
    populateLeagueProfileForm();
    setDraftContext("public");
    await resetDraft({ refine: false });
    renderRoster();
    renderEspnConnection();
    renderEvidenceStatus();
    renderWeights();
    $("#chain-status").textContent = "Not checked";
    status("Local roster, evidence, and calibration state cleared.", "good");
  }

  function bindEvents() {
    $$('[data-panel-target]').forEach((button) => button.addEventListener("click", () => {
      if (button.disabled) return;
      if (button.dataset.tradeMode && !setTradeAnalysisMode(button.dataset.tradeMode)) return;
      activatePanel(button.dataset.panelTarget, { draftContext: button.dataset.draftContext });
    }));
    $$('[data-jump]').forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.tradeMode && !setTradeAnalysisMode(button.dataset.tradeMode)) return;
      activatePanel(button.dataset.jump, { draftContext: button.dataset.draftContext });
    }));
    $$('[data-league-jump]').forEach((button) => button.addEventListener("click", () => openMyLeagueDestination(button.dataset.leagueJump)));
    $$('[data-league-nav]').forEach((button) => button.addEventListener("click", () => openMyLeagueDestination(button.dataset.leagueNav)));
    $("#my-league-menu-button")?.addEventListener("click", () => setMyLeagueMenuOpen($("#my-league-menu")?.classList.contains("hidden")));
    const openLeagueSwitcher = () => hasEspnMyLeagueAccess() ? activatePanel("myleague") : focusEspnSetup();
    ["#sidebar-sync-button", "#mobile-sync-button"].forEach((selector) => $(selector)?.addEventListener("click", openLeagueSwitcher));
    $$('[data-sync-league]').forEach((button) => button.addEventListener("click", openLeagueSwitcher));
    $("#sidebar-settings-button")?.addEventListener("click", () => hasEspnMyLeagueAccess() ? focusManualLeagueSetup() : focusEspnSetup());
    $$('[data-set-trade-mode]').forEach((button) => button.addEventListener("click", () => { if (setTradeAnalysisMode(button.dataset.setTradeMode)) activatePanel("trades"); }));
    $("#mobile-nav-toggle")?.addEventListener("click", () => $(".app-shell")?.classList.toggle("nav-open"));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { setMyLeagueMenuOpen(false); $(".app-shell")?.classList.remove("nav-open"); }
    });
    $("#enable-default-league")?.addEventListener("click", () => resetManualLeagueProfile().catch((error) => status(error.message, "error")));
    $("#use-any-league").addEventListener("click", focusManualLeagueSetup);
    $("#show-espn-connect").addEventListener("click", focusEspnSetup);
    $("#open-league-settings").addEventListener("click", () => { if (!hasEspnMyLeagueAccess()) return focusEspnSetup(); activatePanel("myleague"); if ($("#my-league-settings")) $("#my-league-settings").open = true; $("#my-league-settings")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    $("#save-manual-profile").addEventListener("click", () => saveManualLeagueProfile().catch((error) => status(error.message, "error")));
    $("#manual-profile-standard").addEventListener("click", () => resetManualLeagueProfile().catch((error) => status(error.message, "error")));
    $("#manual-league-scoring").addEventListener("change", () => $("#manual-custom-scoring-wrap").classList.toggle("hidden", $("#manual-league-scoring").value !== "custom"));
    $("#read-league-import").addEventListener("click", () => readLeagueImport().catch((error) => { $("#league-import-status").textContent = error.message; status(error.message, "error"); }));
    $("#league-import-example").addEventListener("click", loadLeagueImportExample);
    $("#use-league-import").addEventListener("click", () => useLeagueImport().catch((error) => status(error.message, "error")));
    $("#disconnect-league-import").addEventListener("click", () => disconnectImportedLeague().catch((error) => status(error.message, "error")));
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
    ["#rankings-search", "#rankings-position", "#rankings-view", "#rankings-week"].forEach((selector) => $(selector)?.addEventListener(selector === "#rankings-search" ? "input" : "change", renderPublicRankings));
    ["#outlook-search", "#outlook-position", "#outlook-filter", "#outlook-teams"].forEach((selector) => $(selector)?.addEventListener(selector === "#outlook-search" ? "input" : "change", renderPlayerOutlooks));
    $("#outlook-round-lock")?.addEventListener("change", (event) => saveOutlookRoundLock(event.currentTarget.checked).catch((error) => status(error.message, "error")));
    $("#roster-search").addEventListener("input", () => fillPlayerPicker("#roster-add", $("#roster-search").value));
    $("#trade-actor-team")?.addEventListener("change", () => {
      state.tradeActorTeamId = $("#trade-actor-team").value || connectedUserTeamId();
      state.tradePartnerTeamId = null;
      renderTradeSide("give", []);
      renderTradeSide("get", []);
      syncTradePartnerControl();
    });
    $("#trade-partner").addEventListener("change", () => {
      state.tradePartnerTeamId = $("#trade-partner").value || null;
      renderTradeSide("give", []);
      renderTradeSide("get", []);
      syncTradePartnerControl();
    });
    document.addEventListener("mousedown", (event) => {
      if (!event.target.closest(".trade-typeahead")) closeAllTradeSuggestions();
      if (!event.target.closest(".my-league-nav")) setMyLeagueMenuOpen(false);
      if ($(".app-shell")?.classList.contains("nav-open") && !event.target.closest(".context-sidebar") && !event.target.closest("#mobile-nav-toggle")) $(".app-shell").classList.remove("nav-open");
    });
    $("#draft-pick-search").addEventListener("input", () => renderDraftManualOptions());
    $("#draft-start-live").addEventListener("click", () => startLeagueLiveAssistant().catch((error) => status(error.message, "error")));
    $("#draft-launch-league-mock").addEventListener("click", () => launchLeagueMockDraft().catch((error) => status(error.message, "error")));
    $("#run-player").addEventListener("click", runPlayerLab);
    $("#load-intelligence").addEventListener("click", loadPlayerIntelligence);
    $("#sync-live-intelligence").addEventListener("click", syncLiveIntelligence);
    $("#player-select").addEventListener("change", () => renderNewsPulse());
    $("#save-evidence").addEventListener("click", saveEvidence);
    $("#draft-reset").addEventListener("click", () => restartDraft().catch((error) => status(error.message, "error")));
    $("#draft-undo").addEventListener("click", undoDraftPick);
    $("#draft-record-pick").addEventListener("click", recordNextDraftPick);
    $("#draft-import-board").addEventListener("click", importDraftBoard);
    $("#draft-clear-board").addEventListener("click", clearDraftBoard);
    $("#draft-benchmark").addEventListener("click", runDraftBenchmark);
    $("#draft-board-position").addEventListener("change", renderDraftBigBoard);
    $("#draft-mode").addEventListener("change", () => changeDraftMode().catch((error) => status(error.message, "error")));
    ["#draft-teams", "#draft-position", "#draft-rounds", "#draft-scoring", "#draft-qb-format"].forEach((selector) => $(selector).addEventListener("change", () => resetDraft({ refine: false }).catch((error) => status(error.message, "error"))));
    $("#roster-add-button").addEventListener("click", () => addRosterPlayer($("#roster-add").value));
    $("#roster-demo").addEventListener("click", loadDemoRoster);
    $("#roster-clear").addEventListener("click", async () => { state.rosterIds = []; await persistRoster(); renderRoster(); });
    $("#run-lineup").addEventListener("click", () => analyzeLineup().catch((error) => status(error.message, "error")));
    $("#run-waivers").addEventListener("click", runWaivers);
    $("#waiver-mode").addEventListener("change", () => $("#faab-budget-label").classList.toggle("hidden", $("#waiver-mode").value !== "faab"));
    $("#analyze-trade").addEventListener("click", analyzeSelectedTrade);
    $("#run-trades").addEventListener("click", runTrades);
    $("#build-demo-league").addEventListener("click", () => { balancedLeague(currentLeagueSettings().teams); status("Balanced demo league ready for your league size.", "good"); });
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
      const [response, coachResponse, healthResponse, rookieResponse, campResponse, profileResponse, specialTeamsResponse, footballContextResponse] = await Promise.all([
        fetch("./data/players-lite.json"),
        fetch("./data/coaches-2026.json"),
        fetch("./data/health-calibration-2026.json"),
        fetch("./data/rookies-2026.json"),
        fetch("./data/camp-2026.json"),
        fetch("./data/analytics-runtime-profile.json"),
        fetch("./data/special-teams-2026.json"),
        fetch("./data/football-context-2026.json"),
      ]);
      if (!response.ok || !coachResponse.ok || !healthResponse.ok || !rookieResponse.ok || !campResponse.ok || !profileResponse.ok || !specialTeamsResponse.ok || !footballContextResponse.ok) throw new Error("one or more qualified runtime artifacts failed to load");
      state.dataset = await response.json();
      state.analyticsProfile = await profileResponse.json();
      if (state.analyticsProfile?.mode !== "serve-frozen-qualified-analytics") throw new Error("qualified analytics profile is invalid");
      state.coaches = await coachResponse.json();
      state.healthCalibration = await healthResponse.json();
      state.rookieArtifact = await rookieResponse.json();
      state.rookieIndex = rookieModel.indexArtifact(state.rookieArtifact);
      state.campArtifact = await campResponse.json();
      state.campIndex = new Map((state.campArtifact?.players || []).map((row) => [String(row.id), row]));
      state.specialTeams = await specialTeamsResponse.json();
      state.footballContextArtifact = await footballContextResponse.json();
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
      renderPublicRankings();

      const [savedLedger, savedRoster, savedWeights, savedBoard, savedLeagueProfile, savedEspnConnection, savedEspnSnapshot, savedPlayerOutlooks, savedPlayerPasses, savedOutlookRoundLock] = await Promise.all([
        store.get("evidence-ledger", []),
        store.get("roster-ids", []),
        store.get("ensemble-weights", null),
        store.get("draft-custom-board", ""),
        store.get("league-profile", null),
        store.get("espn-connection", null),
        store.get("espn-snapshot", null),
        store.get("player-outlooks", {}),
        store.get("player-passes", {}),
        store.get("outlook-round-lock", false),
      ]);
      state.ledger = new evidenceApi.EvidenceLedger(Array.isArray(savedLedger) ? savedLedger : []);
      state.rosterIds = Array.isArray(savedRoster) ? savedRoster.map(String).filter((id) => playerById(id)) : [];
      state.playerOutlooks = savedPlayerOutlooks && typeof savedPlayerOutlooks === "object" && !Array.isArray(savedPlayerOutlooks) ? savedPlayerOutlooks : {};
      const migratedOutlooks = Object.fromEntries(Object.entries(state.playerOutlooks).map(([id, value]) => [id, OUTLOOK_ALIASES[value] || value]));
      const outlookMigrationChanged = Object.keys(migratedOutlooks).some((id) => migratedOutlooks[id] !== state.playerOutlooks[id]);
      state.playerOutlooks = migratedOutlooks;
      state.playerPasses = savedPlayerPasses && typeof savedPlayerPasses === "object" && !Array.isArray(savedPlayerPasses) ? Object.fromEntries(Object.entries(savedPlayerPasses).filter(([, value]) => Boolean(value))) : {};
      state.outlookRoundLock = Boolean(savedOutlookRoundLock);
      if (outlookMigrationChanged) await store.set("player-outlooks", state.playerOutlooks);
      renderPlayerOutlooks();
        const canRestoreEspnProfile = Boolean(savedEspnConnection?.leagueId && savedEspnSnapshot?.provider === "espn");
      state.leagueProfile = canRestoreEspnProfile && savedLeagueProfile ? leagueApi.normalizeProfile(savedLeagueProfile) : leagueApi.normalizeProfile({ source: "manual", teams: 12, scoring: "ppr", slots: { ...core.DEFAULT_SETTINGS.slots, BN: 7 } });
      populateLeagueProfileForm();
      syncDraftControlsToLeagueProfile();
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
      } else {
        await Promise.all([store.remove("league-state"), store.remove("my-league-enabled")]);
        renderEspnConnection();
      }
      renderRoster();
      renderEvidenceStatus();
      renderWeights();
      await resetDraft({ refine: false });
      bindEvents();
      $("#cache-status").textContent = globalThis.indexedDB ? "IndexedDB enabled" : "localStorage fallback";
      syncRuntimeReadouts();
      status("");
      const requested = location.hash.replace("#", "");
      if (requested === "league-draft") activatePanel("draft", { draftContext: "league" });
      else if (requested && $(`[data-panel-target="${CSS.escape(requested)}"]`)) activatePanel(requested);
      else activatePanel("overview");
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js?v=1.33.0", { updateViaCache: "none" }).then((registration) => registration.update()).catch(() => {});
    } catch (error) {
      $("#bootstrap-status").textContent = "Load failed";
      syncRuntimeReadouts();
      status(`Startup failed: ${error.message}`, "error");
      console.error(error);
    }
  }

  initialize();
})();

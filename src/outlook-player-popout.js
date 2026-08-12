(function attachSnapCountPlayerPopout(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.SnapCountPlayerPopout = api;
    api.install(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createSnapCountPlayerPopout() {
  "use strict";

  const VERSION = "snapcount-player-popout-2026.1";
  const DATA_URL = "./data/players-lite.json";
  const STYLE_ID = "snapcount-player-popout-styles";
  let playerIndexPromise = null;

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function projectedAveragePpg(player) {
    if (!player) return null;
    const byeWeek = finite(player.byeWeek);
    const weekly = Array.isArray(player.weeklyProjections) ? player.weeklyProjections : [];
    const playable = weekly.map((value, index) => ({ week: index + 1, value: finite(value) }))
      .filter((row) => row.value !== null && row.value > 0 && row.week !== byeWeek);
    if (playable.length >= 4) return playable.reduce((sum, row) => sum + row.value, 0) / playable.length;
    const weeklyProjection = finite(player.weeklyProjection);
    if (weeklyProjection !== null && weeklyProjection > 0) return weeklyProjection;
    const projectedPoints = finite(player.projectedPoints);
    if (projectedPoints !== null && projectedPoints > 0) return projectedPoints / 17;
    return null;
  }

  function installStyles(document) {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#outlooks .player-cell[data-player-analysis-popout]{cursor:pointer;outline:none}
#outlooks .player-cell[data-player-analysis-popout] .player-identity{border-radius:10px;padding:4px 5px;margin:-4px -5px;transition:background .15s ease,box-shadow .15s ease}
#outlooks .player-cell[data-player-analysis-popout]:hover .player-identity,#outlooks .player-cell[data-player-analysis-popout]:focus-visible .player-identity{background:#eef5fd;box-shadow:0 0 0 2px #b8cde6}
#outlooks .player-cell[data-player-analysis-popout]:hover .player-identity-copy strong{text-decoration:underline;text-underline-offset:2px}
#player-analysis-popout{width:min(980px,calc(100vw - 32px));max-height:90vh;margin:auto;padding:0;border:1px solid #c9d7e7;border-radius:18px;background:#f5f9fe;color:#102f52;overflow:hidden}
#player-analysis-popout::backdrop{background:rgba(7,24,43,.58);backdrop-filter:blur(2px)}
.player-popout-shell{max-height:90vh;overflow:auto;overscroll-behavior:contain}
.player-popout-head{position:sticky;top:0;z-index:4;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 20px;border-bottom:1px solid #d5e0ec;background:rgba(255,255,255,.97)}
.player-popout-title{min-width:0}.player-popout-title span{display:block;margin-bottom:3px;color:#1768d7;font-size:9px;font-weight:900;letter-spacing:.12em}.player-popout-title h2{margin:0;color:#102f52;font-size:22px}.player-popout-title p{margin:3px 0 0;color:#667b92;font-size:11px}
.player-popout-actions{display:flex;align-items:end;gap:10px;flex:0 0 auto}.player-popout-actions label{display:grid;gap:4px;color:#52677f;font-size:9px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.player-popout-actions select{min-width:104px;padding:8px 30px 8px 10px;border:1px solid #b8c9dc;border-radius:9px;background:#fff;color:#163b66;font:inherit;text-transform:none}.player-popout-close{width:36px;height:36px;border:1px solid #b8c9dc;border-radius:999px;background:#fff;color:#163b66;font-size:22px;line-height:1;cursor:pointer}
.player-popout-body{display:grid;gap:14px;padding:18px}.player-popout-section{border:1px solid #d5e0ec;border-radius:15px;background:#fff;overflow:hidden}.player-popout-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px;border-bottom:1px solid #e0e8f1}.player-popout-section-head strong{color:#153f6c;font-size:12px}.player-popout-section-head span{color:#74859a;font-size:10px}.player-popout-section .result-space{margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important}.player-popout-loading{padding:28px 18px;color:#697b90;text-align:center}.player-popout-loading strong{display:block;margin-bottom:5px;color:#173f6b}.player-popout-error{color:#8e352f}.player-popout-season-ppg strong{color:#174f8f}.player-popout-section .table-wrap{max-width:100%;overflow-x:auto}
@media(max-width:700px){#player-analysis-popout{width:calc(100vw - 14px);max-height:94vh;border-radius:14px}.player-popout-shell{max-height:94vh}.player-popout-head{align-items:flex-start;padding:14px;gap:10px}.player-popout-title h2{font-size:18px}.player-popout-actions{gap:6px}.player-popout-actions label{display:none}.player-popout-close{width:34px;height:34px}.player-popout-body{padding:10px;gap:10px}.player-popout-section-head{padding:11px 12px}}
`;
    document.head.appendChild(style);
  }

  function waitFor(predicate, timeout = 20000, interval = 80) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        try {
          const value = predicate();
          if (value) return resolve(value);
        } catch (_) { /* keep waiting */ }
        if (Date.now() - started >= timeout) return reject(new Error("Timed out waiting for player analysis"));
        setTimeout(check, interval);
      };
      check();
    });
  }

  function loadPlayerIndex(window) {
    if (playerIndexPromise) return playerIndexPromise;
    playerIndexPromise = window.fetch(DATA_URL, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Player data HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => new Map((payload.players || []).map((player) => [String(player.id), player])))
      .catch(() => new Map());
    return playerIndexPromise;
  }

  function ensureDialog(document) {
    let dialog = document.getElementById("player-analysis-popout");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "player-analysis-popout";
    dialog.setAttribute("aria-labelledby", "player-popout-name");
    dialog.innerHTML = `
      <div class="player-popout-shell">
        <header class="player-popout-head">
          <div class="player-popout-title"><span>PLAYER ANALYSIS</span><h2 id="player-popout-name">Player</h2><p id="player-popout-meta">Projection, role, health, matchup, and recent form</p></div>
          <div class="player-popout-actions"><label>Week<select id="player-popout-week"></select></label><button type="button" class="player-popout-close" aria-label="Close player analysis">×</button></div>
        </header>
        <div class="player-popout-body">
          <section class="player-popout-section"><div class="player-popout-section-head"><strong>Projection</strong><span id="player-popout-projection-status">Loading…</span></div><div id="player-popout-projection" class="player-popout-loading" aria-live="polite"><strong>Building projection…</strong><span>Using the same analysis as Player Analysis.</span></div></section>
          <section class="player-popout-section"><div class="player-popout-section-head"><strong>Full player read</strong><span id="player-popout-intelligence-status">Loading recent context…</span></div><div id="player-popout-intelligence" class="player-popout-loading" aria-live="polite"><strong>Loading recent games + status…</strong><span>This can take a few seconds the first time.</span></div></section>
        </div>
      </div>`;
    const weekSelect = dialog.querySelector("#player-popout-week");
    weekSelect.innerHTML = Array.from({ length: 18 }, (_, index) => `<option value="${index + 1}">Week ${index + 1}</option>`).join("");
    dialog.querySelector(".player-popout-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    document.body.appendChild(dialog);
    return dialog;
  }

  function decorateOutlookRows(document) {
    const table = document.getElementById("outlook-table");
    if (!table) return;
    table.querySelectorAll("tr").forEach((row) => {
      const playerControl = row.querySelector("[data-player-outlook]");
      const cell = row.querySelector(".player-cell.player-cell-visual");
      if (!playerControl || !cell) return;
      const playerId = String(playerControl.dataset.playerOutlook || "");
      const name = cell.querySelector(".player-identity-copy strong")?.textContent?.trim() || "player";
      cell.dataset.playerAnalysisPopout = playerId;
      cell.tabIndex = 0;
      cell.setAttribute("role", "button");
      cell.setAttribute("aria-label", `Open player analysis for ${name}`);
      cell.title = `Open ${name} analysis`;
    });
  }

  function seasonAverageMetric(document, container, player, week) {
    const metrics = container.querySelector(".friendly-metrics");
    if (!metrics) return;
    const firstLabel = metrics.querySelector(".metric span");
    if (firstLabel) firstLabel.textContent = `WEEK ${week} PROJECTION`;
    metrics.querySelector(".player-popout-season-ppg")?.remove();
    const average = projectedAveragePpg(player);
    const metric = document.createElement("div");
    metric.className = "metric player-popout-season-ppg";
    metric.innerHTML = `<span>AVG PROJECTED PPG</span><strong>${average === null ? "—" : average.toFixed(1)}</strong>`;
    metrics.insertBefore(metric, metrics.children[1] || null);
  }

  function install(window) {
    const document = window.document;
    if (!document || document.documentElement.dataset.playerPopoutInstalled === "true") return;
    document.documentElement.dataset.playerPopoutInstalled = "true";
    installStyles(document);
    const dialog = ensureDialog(document);
    const state = { token: 0, playerId: "", playerName: "", observers: [] };

    const disconnectObservers = () => {
      state.observers.forEach((observer) => observer.disconnect());
      state.observers = [];
    };

    const selectPlayer = async (playerId, playerName, week) => {
      const search = document.getElementById("player-search");
      const select = document.getElementById("player-select");
      const weekSelect = document.getElementById("player-week");
      if (!search || !select || !weekSelect) throw new Error("Player Analysis controls are unavailable");
      search.value = playerName;
      search.dispatchEvent(new window.Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      if ([...select.options].some((option) => String(option.value) === String(playerId))) select.value = String(playerId);
      else {
        const fallback = [...select.options].find((option) => option.textContent.toLowerCase().includes(playerName.toLowerCase()));
        if (fallback) select.value = fallback.value;
      }
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
      weekSelect.value = String(week);
      weekSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
      if (!select.value) throw new Error("Could not select this player in Player Analysis");
    };

    const runAnalysis = async (playerId, playerName, week) => {
      const token = ++state.token;
      disconnectObservers();
      const projectionTarget = dialog.querySelector("#player-popout-projection");
      const intelligenceTarget = dialog.querySelector("#player-popout-intelligence");
      const projectionStatus = dialog.querySelector("#player-popout-projection-status");
      const intelligenceStatus = dialog.querySelector("#player-popout-intelligence-status");
      projectionTarget.className = "player-popout-loading";
      projectionTarget.innerHTML = "<strong>Building projection…</strong><span>Using the same analysis as Player Analysis.</span>";
      intelligenceTarget.className = "player-popout-loading";
      intelligenceTarget.innerHTML = "<strong>Loading recent games + status…</strong><span>This can take a few seconds the first time.</span>";
      projectionStatus.textContent = `Week ${week}`;
      intelligenceStatus.textContent = "Loading recent context…";

      const index = await loadPlayerIndex(window);
      const player = index.get(String(playerId)) || null;
      if (token !== state.token) return;
      if (player) dialog.querySelector("#player-popout-meta").textContent = `${player.position || ""} · ${player.team || "FA"} · Week ${week}`;
      await selectPlayer(playerId, playerName, week);
      if (token !== state.token) return;

      const sourceProjection = document.getElementById("player-result");
      const sourceIntelligence = document.getElementById("player-intelligence");
      const runButton = document.getElementById("run-player");
      const intelligenceButton = document.getElementById("load-intelligence");
      if (!sourceProjection || !sourceIntelligence || !runButton || !intelligenceButton) throw new Error("Player Analysis is unavailable");
      await waitFor(() => !runButton.disabled && !intelligenceButton.disabled, 6000).catch(() => null);
      sourceProjection.innerHTML = "";
      sourceIntelligence.innerHTML = "";

      const copyProjection = () => {
        if (token !== state.token || !sourceProjection.innerHTML.trim()) return false;
        const renderedName = sourceProjection.querySelector(".friendly-verdict h2")?.textContent?.trim();
        if (renderedName && renderedName !== playerName) return false;
        projectionTarget.className = "result-space";
        projectionTarget.innerHTML = sourceProjection.innerHTML;
        seasonAverageMetric(document, projectionTarget, player, week);
        projectionStatus.textContent = `Week ${week} + season average`;
        return true;
      };
      const projectionObserver = new window.MutationObserver(() => copyProjection());
      projectionObserver.observe(sourceProjection, { childList: true, subtree: true, characterData: true });
      state.observers.push(projectionObserver);

      runButton.click();
      intelligenceButton.click();

      const projectionPromise = waitFor(copyProjection, 22000).catch((error) => {
        if (token !== state.token) return;
        projectionTarget.className = "player-popout-loading player-popout-error";
        projectionTarget.innerHTML = `<strong>Projection unavailable</strong><span>${error.message}</span>`;
        projectionStatus.textContent = "Unavailable";
      });
      const intelligencePromise = waitFor(() => {
        if (token !== state.token || !sourceIntelligence.innerHTML.trim()) return false;
        intelligenceTarget.className = "result-space";
        intelligenceTarget.innerHTML = sourceIntelligence.innerHTML;
        const sourceLabel = document.getElementById("intelligence-source")?.textContent?.trim();
        intelligenceStatus.textContent = sourceLabel || "Recent context loaded";
        return true;
      }, 30000).catch((error) => {
        if (token !== state.token) return;
        intelligenceTarget.className = "player-popout-loading player-popout-error";
        intelligenceTarget.innerHTML = `<strong>Recent context unavailable</strong><span>${error.message}</span>`;
        intelligenceStatus.textContent = "Unavailable";
      });
      await Promise.allSettled([projectionPromise, intelligencePromise]);
    };

    const openPlayer = async (playerId, playerName) => {
      state.playerId = String(playerId);
      state.playerName = playerName;
      dialog.querySelector("#player-popout-name").textContent = playerName;
      const hiddenWeek = Number(document.getElementById("player-week")?.value || 1);
      const week = Math.max(1, Math.min(18, hiddenWeek || 1));
      dialog.querySelector("#player-popout-week").value = String(week);
      if (!dialog.open) dialog.showModal();
      try { await runAnalysis(state.playerId, state.playerName, week); }
      catch (error) {
        const target = dialog.querySelector("#player-popout-projection");
        target.className = "player-popout-loading player-popout-error";
        target.innerHTML = `<strong>Could not open player analysis</strong><span>${error.message}</span>`;
      }
    };

    dialog.querySelector("#player-popout-week").addEventListener("change", (event) => {
      if (!state.playerId) return;
      runAnalysis(state.playerId, state.playerName, Number(event.currentTarget.value || 1)).catch(() => {});
    });
    dialog.addEventListener("close", () => { state.token += 1; disconnectObservers(); });

    document.addEventListener("click", (event) => {
      const cell = event.target.closest?.("#outlooks .player-cell[data-player-analysis-popout]");
      if (!cell) return;
      const name = cell.querySelector(".player-identity-copy strong")?.textContent?.trim() || "Player";
      openPlayer(cell.dataset.playerAnalysisPopout, name).catch(() => {});
    });
    document.addEventListener("keydown", (event) => {
      const cell = event.target.closest?.("#outlooks .player-cell[data-player-analysis-popout]");
      if (!cell || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      const name = cell.querySelector(".player-identity-copy strong")?.textContent?.trim() || "Player";
      openPlayer(cell.dataset.playerAnalysisPopout, name).catch(() => {});
    });

    const table = document.getElementById("outlook-table");
    if (table) {
      decorateOutlookRows(document);
      const observer = new window.MutationObserver(() => decorateOutlookRows(document));
      observer.observe(table, { childList: true, subtree: true });
    }
  }

  return { VERSION, projectedAveragePpg, install };
});

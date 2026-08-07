"use strict";

const fs = require("node:fs");
const debuggerOrigin = process.env.DEBUGGER_ORIGIN || "http://127.0.0.1:9235";
const appUrl = process.env.APP_URL || "http://127.0.0.1:4189/";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const targets = await fetch(`${debuggerOrigin}/json`).then((response) => response.json());
  const target = targets.find((row) => row.type === "page" && (row.url === appUrl || row.url.startsWith(appUrl)));
  if (!target) throw new Error(`No Edge target for ${appUrl}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const errors = [];
  let sequence = 0;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails?.text || "Runtime exception");
    if (message.method === "Log.entryAdded" && message.params.entry?.level === "error") errors.push(message.params.entry.text);
  });
  if (socket.readyState !== WebSocket.OPEN) {
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
      setTimeout(() => reject(new Error("Timed out connecting to Edge DevTools")), 5000);
    });
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Evaluation failed");
    return result.result.value;
  };
  const waitFor = async (expression, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(150);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");

  async function snapshot(name, width, height) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await delay(250);
    const metrics = await evaluate(`(() => ({
      playerCount: document.querySelector('#player-count')?.textContent,
      activePanel: document.querySelector('.panel.active')?.dataset.panel,
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      tabs: document.querySelectorAll('.tab').length,
      quickActions: document.querySelectorAll('.quick-action').length,
      background: getComputedStyle(document.body).backgroundColor
    }))()`);
    const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(`.qa-${name}.png`, Buffer.from(capture.data, "base64"));
    return metrics;
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.reload", { ignoreCache: true });
  await waitFor(`document.querySelector('#player-count')?.textContent === '700'`);
  const home = await snapshot("home-desktop", 1440, 1000);
  if (home.tabs !== 7 || home.quickActions !== 5) throw new Error("Friendly task navigation did not render");
  if (home.horizontalOverflow || !home.background.includes("246")) throw new Error("Home light-theme/layout check failed");

  await evaluate(`(() => { document.querySelector('[data-panel-target="player"]').click(); const s=document.querySelector('#player-search'); s.value='Jahmyr'; s.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  const playerSearch = await evaluate(`document.querySelector('#player-select option:checked')?.textContent || ''`);
  if (!playerSearch.includes('Jahmyr')) throw new Error('Player search did not narrow the picker');
  await evaluate(`document.querySelector('#run-player').click(); true`);
  await waitFor(`Boolean(document.querySelector('#player-result .friendly-verdict'))`, 20000);
  const player = await evaluate(`(() => ({
    text: document.querySelector('#player-result').textContent,
    why: document.querySelectorAll('#player-result .why-row').length,
    metrics: document.querySelectorAll('#player-result .metric').length
  }))()`);
  if (!player.text.includes("PROJECTED POINTS") || !player.text.includes("LIKELY RANGE") || player.why < 3 || player.metrics < 5) throw new Error("Friendly player result failed");

  await evaluate(`document.querySelector('#history-season').value='2025'; document.querySelector('#load-intelligence').click(); true`);
  await waitFor(`Boolean(document.querySelector('#player-intelligence .outlook-card'))`, 45000);
  const veteran = await evaluate(`(() => ({
    text: document.querySelector('#player-intelligence').textContent,
    gameLog: Boolean(document.querySelector('#player-intelligence .game-log-details'))
  }))()`);
  if (!veteran.text.includes("OUR READ") || !veteran.text.includes("RECENT FORM") || !veteran.gameLog) throw new Error("Friendly player intelligence failed");

  await evaluate(`document.querySelector('#sync-live-intelligence').click(); true`);
  await waitFor(`!document.querySelector('#live-intelligence-status')?.textContent.includes('Syncing')`, 75000);
  const liveNews = await evaluate(`document.querySelectorAll('#news-pulse .news-item').length`);
  if (liveNews < 1) throw new Error("News/preseason refresh did not render");

  await evaluate(`(() => {
    const search = document.querySelector('#player-search'); search.value=''; search.dispatchEvent(new Event('input',{bubbles:true}));
    const select = document.querySelector('#player-select');
    const option = [...select.options].find((row) => row.textContent.includes('Jeremiyah Love'));
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles:true }));
    document.querySelector('#run-player').click();
    return true;
  })()`);
  await waitFor(`document.querySelector('#player-result .rookie-pill')?.textContent.includes('ROOKIE')`, 20000);
  await evaluate(`document.querySelector('#load-intelligence').click(); true`);
  await waitFor(`Boolean(document.querySelector('#player-intelligence .rookie-profile'))`, 25000);
  const rookie = await evaluate(`(() => ({
    text: document.querySelector('#player-intelligence').textContent,
    profile: document.querySelector('.rookie-profile')?.textContent,
    tables: document.querySelectorAll('#player-intelligence tbody tr').length
  }))()`);
  if (!rookie.text.includes("ROOKIE SNAPSHOT") || !rookie.text.includes("ROLE CLARITY") || rookie.tables !== 0) throw new Error("Rookie-friendly path failed");
  const rookieTablet = await snapshot("player-tablet", 768, 1024);
  if (rookieTablet.horizontalOverflow) throw new Error("Tablet player layout overflow");

  await evaluate(`document.querySelector('[data-panel-target="draft"]').click(); document.querySelector('#draft-reset').click(); true`);
  await waitFor(`document.querySelectorAll('#draft-big-board .big-board-row').length >= 50`, 10000);
  await waitFor(`document.querySelectorAll('#draft-table tr').length >= 10`, 15000);
  const board = await evaluate(`(() => ({
    rows: document.querySelectorAll('#draft-big-board .big-board-row').length,
    first: document.querySelector('#draft-big-board .big-board-row')?.textContent
  }))()`);
  if (board.rows < 50 || !board.first.includes("ORACLE SCORE")) throw new Error("Oracle draft list failed");
  await evaluate(`(() => { const s=document.querySelector('#draft-pick-search'); s.value='Bijan'; s.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  const draftSearch = await evaluate(`document.querySelector('#draft-manual-player option:checked')?.textContent || ''`);
  if (!draftSearch.includes('Bijan')) throw new Error('Draft pick search failed');
  await evaluate(`(() => { const s=document.querySelector('#draft-pick-search'); s.value=''; s.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#draft-advance').click(); return true; })()`);
  await waitFor(`document.querySelector('#draft-meta')?.textContent.includes('YOUR PICK')`, 20000);
  const draftRoom = await evaluate(`document.querySelectorAll('#draft-table tr').length`);
  if (draftRoom < 10) throw new Error("Draft recommendations did not render");
  await evaluate(`document.querySelector('#draft-table [data-draft-player]').click(); true`);
  await waitFor(`document.querySelector('#draft-roster')?.textContent.includes('1/16')`, 8000);
  await evaluate(`document.querySelector('#draft-benchmark').closest('details').open=true; document.querySelector('#draft-benchmark-count').value='40'; document.querySelector('#draft-benchmark').click(); true`);
  await waitFor(`document.querySelector('#global-status')?.textContent.includes('Comparison finished')`, 45000);
  const benchmark = await evaluate(`document.querySelector('#draft-benchmark-result').textContent`);
  if (!benchmark.includes("better projected roster")) throw new Error("Friendly draft comparison failed");
  const draftDesktop = await snapshot("draft-desktop", 1440, 1000);
  if (draftDesktop.horizontalOverflow || draftDesktop.activePanel !== "draft") throw new Error("Draft desktop layout failed");

  await evaluate(`(() => { document.querySelector('[data-panel-target="lineup"]').click(); const s=document.querySelector('#roster-search'); s.value='Josh Allen'; s.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  const rosterSearch = await evaluate(`document.querySelector('#roster-add option:checked')?.textContent || ''`);
  if (!rosterSearch.includes('Josh Allen')) throw new Error('Roster search failed');
  await evaluate(`document.querySelector('#roster-demo').click(); document.querySelector('#run-lineup').click(); true`);
  await waitFor(`Boolean(document.querySelector('#lineup-result .friendly-result-head'))`, 20000);
  const lineup = await evaluate(`(() => ({
    roster: document.querySelectorAll('#roster-strip .roster-chip').length,
    starters: document.querySelectorAll('#lineup-result .lineup-list:first-of-type .lineup-row').length,
    text: document.querySelector('#lineup-result').textContent
  }))()`);
  if (lineup.roster < 10 || lineup.starters < 8 || !lineup.text.includes("RECOMMENDED LINEUP")) throw new Error("Start/sit flow failed");

  await evaluate(`document.querySelector('[data-panel-target="trades"]').click(); true`);
  await waitFor(`document.querySelectorAll('#trade-give-1 option').length > 2 && document.querySelectorAll('#trade-get-1 option').length > 20`);
  await evaluate(`(() => { const search=document.querySelector('#trade-search'); search.value='Achane'; search.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  const tradeSearch = await evaluate(`document.querySelector('#trade-get-1 option:nth-child(2)')?.textContent || ''`);
  if (!tradeSearch.includes('Achane')) throw new Error('Trade target search failed');
  await evaluate(`(() => {
    const give = document.querySelector('#trade-give-1'); const get = document.querySelector('#trade-get-1');
    give.selectedIndex = 1; get.selectedIndex = 1; document.querySelector('#analyze-trade').click(); return true;
  })()`);
  await waitFor(`Boolean(document.querySelector('#trade-check-result .trade-verdict'))`, 25000);
  const trade = await evaluate(`document.querySelector('#trade-check-result').textContent`);
  if (!["ACCEPT", "PASS", "CLOSE CALL"].some((word) => trade.includes(word))) throw new Error("Direct trade analyzer failed");
  const tradeDesktop = await snapshot("trade-desktop", 1440, 1000);
  if (tradeDesktop.horizontalOverflow) throw new Error("Trade desktop overflow");

  await evaluate(`document.querySelector('#run-trades').closest('details').open=true; document.querySelector('#run-trades').click(); true`);
  await waitFor(`document.querySelector('#global-status')?.textContent.includes('Trade ideas are ready')`, 35000);
  const tradeIdeas = await evaluate(`document.querySelector('#trade-result').textContent.length`);
  if (tradeIdeas < 20) throw new Error("Optional trade ideas failed");

  await evaluate(`document.querySelector('[data-panel-target="waivers"]').click(); document.querySelector('#waiver-mode').value='priority'; document.querySelector('#run-waivers').click(); true`);
  await waitFor(`document.querySelector('#global-status')?.textContent.includes('waiver recommendations are ready')`, 35000);
  const waivers = await evaluate(`document.querySelector('#waiver-result').textContent`);
  if (!waivers.includes("Add") && !waivers.includes("No pickup")) throw new Error("Friendly waiver flow failed");

  await evaluate(`document.querySelector('[data-panel-target="league"]').click(); document.querySelector('#build-demo-league').click(); document.querySelector('#league-scenarios').value='500'; document.querySelector('#run-league').click(); true`);
  await waitFor(`document.querySelectorAll('#league-result tbody tr').length >= 10`, 35000);
  const season = await evaluate(`(() => ({rows:document.querySelectorAll('#league-result tbody tr').length,text:document.querySelector('#league-result').textContent,status:document.querySelector('#league-source-status').textContent}))()`);
  if (season.rows < 10 || !season.text.includes("Make playoffs") || !season.text.includes("Win league") || !season.status.includes("Season outlook ready")) throw new Error("Season outlook failed");

  await evaluate(`document.querySelector('[data-panel-target="draft"]').click(); true`);
  const draftMobile = await snapshot("draft-mobile", 390, 844);
  if (draftMobile.horizontalOverflow) throw new Error("Draft mobile overflow");
  await evaluate(`document.querySelector('[data-panel-target="trades"]').click(); true`);
  const tradeMobile = await snapshot("trade-mobile", 390, 844);
  if (tradeMobile.horizontalOverflow) throw new Error("Trade mobile overflow");
  await evaluate(`document.querySelector('[data-panel-target="overview"]').click(); true`);
  const homeMobile = await snapshot("home-mobile", 390, 844);
  if (homeMobile.horizontalOverflow || homeMobile.quickActions !== 5) throw new Error("Home mobile layout failed");

  const result = { home, player, veteran, liveNews, rookie, rookieTablet, board, draftRoom, benchmark, draftDesktop, lineup, trade, tradeDesktop, tradeIdeas, waivers, season, draftMobile, tradeMobile, homeMobile, errors,
    screenshots: [".qa-home-desktop.png", ".qa-player-tablet.png", ".qa-draft-desktop.png", ".qa-trade-desktop.png", ".qa-draft-mobile.png", ".qa-trade-mobile.png", ".qa-home-mobile.png"] };
  fs.writeFileSync(".qa-results.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) throw new Error(`Browser logged ${errors.length} error(s)`);
  socket.close();
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

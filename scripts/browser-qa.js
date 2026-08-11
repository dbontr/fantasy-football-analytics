"use strict";

const fs = require("node:fs");
const debuggerOrigin = process.env.DEBUGGER_ORIGIN || "http://127.0.0.1:9235";
const appUrl = process.env.APP_URL || "http://127.0.0.1:4189/";
const captureScreenshots = process.env.QA_SCREENSHOTS !== "0";
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
  async function chooseTradePlayer(side, index, query, expected = query) {
    const listSelector = `#trade-${side}-list`;
    await evaluate(`(() => { const input=document.querySelectorAll('${listSelector} [data-trade-player-input]')[${index}]; if(!input) return false; input.focus(); input.value=${JSON.stringify(query)}; input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await waitFor(`[...document.querySelectorAll('${listSelector} .trade-suggestion')].some((row)=>row.textContent.includes(${JSON.stringify(expected)}))`, 10000);
    await evaluate(`(() => { const option=[...document.querySelectorAll('${listSelector} .trade-suggestion')].find((row)=>row.textContent.includes(${JSON.stringify(expected)})); option?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); return Boolean(option); })()`);
  }

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Storage.clearDataForOrigin", { origin: new URL(appUrl).origin, storageTypes: "all" });

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
      tabRows: new Set([...document.querySelectorAll('.tab')].map((tab) => Math.round(tab.getBoundingClientRect().top))).size,
      tabsScrollable: document.querySelector('.tabs')?.scrollWidth > document.querySelector('.tabs')?.clientWidth + 1,
      quickActions: document.querySelectorAll('.quick-action').length,
      publicCards: document.querySelectorAll('#overview .public-tool-card').length,
      mastheadContextDisplay: getComputedStyle(document.querySelector('.masthead-context')).display,
      background: getComputedStyle(document.body).backgroundColor,
      brand: document.querySelector('.brand-logo')?.getAttribute('alt'),
      brandLoaded: Boolean(document.querySelector('.brand-logo')?.complete && document.querySelector('.brand-logo')?.naturalWidth > 0),
      title: document.title,
      primaryBackground: getComputedStyle(document.querySelector('.primary')).backgroundColor,
      legacyBrandVisible: /Oracle/i.test(document.body.innerText),
      greenishColors: (() => {
        const found = new Set();
        const parse = (value) => { const text=String(value); if (!text.startsWith('rgb')) return null; return text.slice(text.indexOf('(')+1, text.indexOf(')')).split(',').slice(0,3).map((part) => Number(part.trim())); };
        for (const element of document.querySelectorAll('body *')) {
          if (!element.getClientRects().length) continue;
          const style = getComputedStyle(element);
          for (const value of [style.color, style.backgroundColor, style.borderTopColor, style.borderLeftColor]) {
            const rgb = parse(value); if (!rgb) continue;
            const [r,g,b] = rgb;
            if (g >= 70 && g > r * 1.22 && g > b * 1.12) found.add(value);
          }
        }
        return [...found];
      })()
    }))()`);
    if (metrics.legacyBrandVisible) throw new Error(`Legacy Oracle branding is visible in ${name}`);
    if (metrics.greenishColors.length) throw new Error(`Green theme color leaked into ${name}: ${metrics.greenishColors.join(', ')}`);
    if (captureScreenshots) {
      const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(`.qa-${name}.png`, Buffer.from(capture.data, "base64"));
    }
    return metrics;
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: appUrl });
  await waitFor(`document.querySelector('#player-count')?.textContent === '700'`);
  await waitFor(`document.querySelector('#cache-status')?.textContent.includes('enabled') || document.querySelector('#cache-status')?.textContent.includes('fallback')`, 20000);
  const modelState = await evaluate(`({
    correlation: window.SnapCountCorrelation?.VERSION || null,
    calibration: window.SnapCountCalibration?.VERSION || null,
    calibrationInstalled: window.OracleBrowserEngine?.__snapCountCalibrationVersion || null,
    meanCalibration: window.SnapCountMeanCalibration?.VERSION || null,
    context: window.OracleContext?.VERSION || null,
    runtime: window.OracleBrowserEngine?.VERSION || null,
    liveIntelligence: window.OracleLiveIntelligence?.VERSION || null,
  })`);
  if (modelState.correlation !== "snapcount-correlation-2026.1" || modelState.runtime !== "oracle-browser-2026.8-future-win" || modelState.context !== "oracle-context-browser-2026.4" || modelState.meanCalibration !== "snapcount-mean-calibration-2026.1" || modelState.liveIntelligence !== "oracle-live-intelligence-2026.2") throw new Error("Current empirical runtime/context/mean/live-intelligence bundle did not install");
  if (modelState.calibration !== "snapcount-calibration-2026.1" || modelState.calibrationInstalled !== modelState.calibration) throw new Error("Empirical uncertainty calibration did not install");
  const profileState = await evaluate(`fetch('./data/analytics-runtime-profile.json').then((response) => response.json()).then((profile) => ({ mode: profile.mode, grades: profile.grades || {}, startSit: profile.startSit?.policy, draft: profile.draft?.policy, objective: profile.decisionObjective?.primary, objectiveStatus: profile.decisionObjective?.status }))`);
  const gradeDrift = Object.entries(profileState.grades).some(([surface, grade]) => grade !== (surface === "provenance" ? "A" : "A+"));
  if (profileState.mode !== "serve-frozen-qualified-analytics" || gradeDrift || profileState.startSit !== "raw-live-ppr-exact-lineup" || profileState.draft !== "segmented-qualified" || profileState.objective !== "maximize-future-head-to-head-wins" || profileState.objectiveStatus !== "prospective-overlay") throw new Error("Frozen qualified analytics profile / future-win objective did not load");
  const home = await snapshot("home-desktop", 1440, 1000);
  if (home.activePanel !== "overview" || home.tabs !== 6 || home.publicCards !== 4) throw new Error("Public-first navigation did not render from the app root");
  if (home.horizontalOverflow || home.background !== "rgb(243, 244, 246)") throw new Error("SnapCount sports-desk canvas/layout check failed");
  if (home.brand !== "SnapCount Fantasy Football" || !home.brandLoaded || !home.title.startsWith("SnapCount") || home.legacyBrandVisible) throw new Error("SnapCount branding check failed");
  if (home.primaryBackground !== "rgb(200, 16, 46)") throw new Error("Primary action is not using the sports-red SnapCount palette");
  if (home.mastheadContextDisplay !== "none") throw new Error("League rules leaked into the visible masthead");
  const publicNav = await evaluate(`(() => ({labels:[...document.querySelectorAll('.tab')].map((row)=>row.textContent.trim()),disabled:[...document.querySelectorAll('.tab')].filter((row)=>row.disabled).length}))()`);
  if (publicNav.labels.slice(0, 5).join('|') !== 'Home|Rankings|Players|Mock Draft|Trade Analyzer' || !publicNav.labels[5]?.startsWith('My League') || publicNav.disabled) throw new Error(`Public navigation is wrong: ${JSON.stringify(publicNav)}`);
  const homeStructure = await evaluate(`(() => ({publicHome:Boolean(document.querySelector('.public-home')),topPlayers:document.querySelectorAll('#home-top-players .home-player-row').length,toolCards:document.querySelectorAll('#overview .public-tool-card').length,myLeague:Boolean(document.querySelector('#myleague #show-espn-connect'))}))()`);
  if (!homeStructure.publicHome || homeStructure.topPlayers < 5 || homeStructure.toolCards !== 4 || !homeStructure.myLeague) throw new Error(`Public home information architecture failed: ${JSON.stringify(homeStructure)}`);
  const universalHome = await evaluate(`(() => ({manualHidden:document.querySelector('#manual-league-card')?.classList.contains('hidden'),espn:Boolean(document.querySelector('#myleague #connect-espn')),espnRequired:document.querySelector('.espn-badge')?.textContent||'',logo:document.querySelector('.brand-logo')?.getAttribute('src')||'',primary:document.querySelector('#overview .primary')?.textContent.trim()||''}))()`);
  if (!universalHome.manualHidden || !universalHome.espn || !universalHome.espnRequired.includes('REQUIRED') || !universalHome.logo.includes("snapcount-logo.svg") || universalHome.primary !== "View rankings") throw new Error(`Public home / ESPN-required My League shell did not render: ${JSON.stringify(universalHome)}`);
  const noConnectionAccess = await evaluate(`(() => ({espnState:document.querySelector('#espn-connection-state')?.textContent,espnConnectedVisible:!document.querySelector('#espn-connected')?.classList.contains('hidden'),leagueToolsHidden:document.querySelector('#league-tools-panel')?.classList.contains('hidden'),manualHidden:document.querySelector('#manual-league-card')?.classList.contains('hidden'),settingsOpen:document.querySelector('#my-league-settings')?.open,title:document.querySelector('#my-league-title')?.textContent||'',disabledTabs:[...document.querySelectorAll('.tab')].filter((button)=>button.disabled).map((button)=>button.textContent.trim())}))()`);
  if (noConnectionAccess.espnState !== 'Not connected' || noConnectionAccess.espnConnectedVisible || !noConnectionAccess.leagueToolsHidden || !noConnectionAccess.manualHidden || !noConnectionAccess.settingsOpen || !noConnectionAccess.title.includes('Connect ESPN') || noConnectionAccess.disabledTabs.length) throw new Error(`ESPN-required disconnected state failed: ${JSON.stringify(noConnectionAccess)}`);

  await evaluate(`document.querySelector('[data-panel-target="rankings"]').click(); true`);
  await waitFor(`document.querySelectorAll('#rankings-table tr').length >= 50`, 10000);
  const publicRankings = await evaluate(`({rows:document.querySelectorAll('#rankings-table tr').length,first:document.querySelector('#rankings-table tr')?.textContent||'',count:document.querySelector('#rankings-count')?.textContent||''})`);
  if (publicRankings.rows < 50 || !publicRankings.first || !publicRankings.count.includes('players')) throw new Error(`Public rankings failed: ${JSON.stringify(publicRankings)}`);
  const rankingsDesktop = await snapshot("rankings-desktop", 1440, 1000);
  if (rankingsDesktop.horizontalOverflow || rankingsDesktop.activePanel !== 'rankings') throw new Error("Rankings desktop layout failed");

  await evaluate(`document.querySelector('[data-panel-target="draft"]').click(); true`);
  await waitFor(`document.querySelector('.panel.active')?.dataset.panel === 'draft' && document.querySelectorAll('#draft-table tr').length >= 10`, 15000);
  const publicDraftBefore = await evaluate(`({title:document.querySelector('#draft-title')?.textContent||'',start:document.querySelector('#draft-reset')?.textContent||'',leagueHidden:document.querySelector('#draft-league-context')?.classList.contains('hidden'),modeHidden:document.querySelector('#draft-mode-wrap')?.classList.contains('hidden'),hasAdvance:Boolean(document.querySelector('#draft-advance')),espn:document.querySelector('#espn-connection-state')?.textContent||''})`);
  if (!publicDraftBefore.title.includes('mock draft') || publicDraftBefore.start !== 'Start mock' || !publicDraftBefore.leagueHidden || !publicDraftBefore.modeHidden || publicDraftBefore.hasAdvance || publicDraftBefore.espn !== 'Not connected') throw new Error(`Public Mock Draft shell failed: ${JSON.stringify(publicDraftBefore)}`);
  await evaluate(`document.querySelector('#draft-reset').click(); true`);
  await waitFor(`document.querySelector('#draft-meta')?.textContent.includes('YOUR PICK') && Boolean(document.querySelector('#draft-table [data-draft-player]:not(:disabled)'))`, 20000);
  await evaluate(`document.querySelector('#draft-table [data-draft-player]:not(:disabled)').click(); true`);
  await waitFor(`document.querySelector('#draft-roster')?.textContent.includes('1/') && document.querySelector('#draft-meta')?.textContent.includes('YOUR PICK')`, 20000);
  const publicMock = await evaluate(`({meta:document.querySelector('#draft-meta')?.textContent||'',roster:document.querySelector('#draft-roster')?.textContent||'',start:document.querySelector('#draft-reset')?.textContent||''})`);
  if (!publicMock.meta.includes('YOUR PICK') || !publicMock.roster.includes('1/') || publicMock.start !== 'Restart mock') throw new Error(`Public Mock Draft failed to run: ${JSON.stringify(publicMock)}`);
  const publicDraftDesktop = await snapshot("draft-public-desktop", 1440, 1000);
  if (publicDraftDesktop.horizontalOverflow || publicDraftDesktop.activePanel !== 'draft') throw new Error("Public Mock Draft desktop layout failed");

  await evaluate(`document.querySelector('[data-panel-target="trades"]').click(); true`);
  await waitFor(`document.querySelectorAll('#trade-give-list [data-trade-player-input]').length === 2 && document.querySelectorAll('#trade-get-list [data-trade-player-input]').length === 2`);
  const publicTradeShell = await evaluate(`({partnerHidden:document.querySelector('#trade-partner-label')?.classList.contains('hidden'),giveScope:document.querySelector('#trade-give-scope')?.textContent,getScope:document.querySelector('#trade-get-scope')?.textContent,leagueIdeas:Boolean(document.querySelector('#trades #trade-ideas-panel'))})`);
  if (!publicTradeShell.partnerHidden || publicTradeShell.giveScope !== 'Any player' || publicTradeShell.getScope !== 'Any player' || publicTradeShell.leagueIdeas) throw new Error(`Public trade shell is not unrestricted: ${JSON.stringify(publicTradeShell)}`);
  await chooseTradePlayer('give', 0, 'Jahmyr', 'Jahmyr Gibbs');
  await chooseTradePlayer('give', 1, 'Puka', 'Puka Nacua');
  await waitFor(`document.querySelectorAll('#trade-give-list [data-trade-player-input]').length === 3`);
  await chooseTradePlayer('give', 2, 'Jaxon', 'Jaxon Smith-Njigba');
  await waitFor(`document.querySelectorAll('#trade-give-list [data-trade-player-input]').length === 4`);
  await chooseTradePlayer('get', 0, 'Bijan', 'Bijan Robinson');
  await chooseTradePlayer('get', 1, "Ja'Marr", "Ja'Marr Chase");
  await waitFor(`document.querySelectorAll('#trade-get-list [data-trade-player-input]').length === 3`);
  const publicTradeShape = await evaluate(`({giveRows:document.querySelectorAll('#trade-give-list [data-trade-player-input]').length,getRows:document.querySelectorAll('#trade-get-list [data-trade-player-input]').length,giveSelected:[...document.querySelectorAll('#trade-give-list [data-trade-player-input]')].filter((row)=>row.dataset.playerId).length,getSelected:[...document.querySelectorAll('#trade-get-list [data-trade-player-input]')].filter((row)=>row.dataset.playerId).length})`);
  if (publicTradeShape.giveRows !== 4 || publicTradeShape.getRows !== 3 || publicTradeShape.giveSelected !== 3 || publicTradeShape.getSelected !== 2) throw new Error(`Dynamic trade rows failed: ${JSON.stringify(publicTradeShape)}`);
  await evaluate(`document.querySelector('#analyze-trade').click(); true`);
  await waitFor(`document.querySelector('#trade-check-result')?.textContent.includes('STANDALONE VALUE CHECK')`, 45000);
  const publicTrade = await evaluate(`document.querySelector('#trade-check-result').textContent`);
  if (!publicTrade.includes('VALUE YOU GIVE') || !publicTrade.includes('VALUE YOU GET') || !publicTrade.includes('TRADE BALANCE') || !publicTrade.includes('Jaxon Smith-Njigba') || !publicTrade.includes("Ja'Marr Chase") || !publicTrade.includes('My League') || publicTrade.includes('FUTURE GAME WIN CHANCE')) throw new Error(`Standalone big-trade analysis failed: ${publicTrade}`);
  const publicTradeDesktop = await snapshot("trade-public-desktop", 1440, 1000);
  if (publicTradeDesktop.horizontalOverflow || publicTradeDesktop.activePanel !== 'trades') throw new Error("Public trade desktop layout failed");

  await evaluate(`document.querySelector('#my-league-menu-button').click(); true`);
  await waitFor(`!document.querySelector('#my-league-menu')?.classList.contains('hidden')`, 5000);
  const leagueMenuBefore = await evaluate(`({expanded:document.querySelector('#my-league-menu-button')?.getAttribute('aria-expanded'),required:[...document.querySelectorAll('[data-requires-league]')].map((row)=>({label:row.textContent.trim(),disabled:row.disabled})),homeDisabled:document.querySelector('[data-league-nav="myleague"]')?.disabled})`);
  if (leagueMenuBefore.expanded !== 'true' || leagueMenuBefore.homeDisabled || leagueMenuBefore.required.some((row)=>!row.disabled)) throw new Error(`My League dropdown did not gate league tools: ${JSON.stringify(leagueMenuBefore)}`);
  await evaluate(`document.querySelector('[data-league-nav="myleague"]').click(); true`);
  const myLeagueBefore = await evaluate(`({hidden:document.querySelector('#league-tools-panel')?.classList.contains('hidden'),kicker:document.querySelector('#rail-context-kicker')?.textContent,settingsOpen:document.querySelector('#my-league-settings')?.open,manualHidden:document.querySelector('#manual-league-card')?.classList.contains('hidden'),tradeIdeasHidden:document.querySelector('#trade-ideas-panel')?.classList.contains('hidden'),connectText:document.querySelector('#show-espn-connect')?.textContent||''})`);
  if (!myLeagueBefore.hidden || myLeagueBefore.kicker !== 'ESPN REQUIRED' || !myLeagueBefore.settingsOpen || !myLeagueBefore.manualHidden || !myLeagueBefore.tradeIdeasHidden || !myLeagueBefore.connectText.includes('Connect ESPN')) throw new Error(`My League should require ESPN first: ${JSON.stringify(myLeagueBefore)}`);
  await evaluate(`document.querySelector('#show-espn-connect').click(); true`);
  await waitFor(`document.querySelector('#my-league-settings')?.open && !document.querySelector('#espn-connect-empty')?.classList.contains('hidden')`, 5000);

  await evaluate(`(() => {
    OracleEspnFantasy.loadLeague = async (_input, _season, options = {}) => {
      if (!options.browserSession) { const error = new Error("This league needs an ESPN sign-in."); error.code = "ESPN_AUTH_REQUIRED"; throw error; }
      return { leagueId:'424242', season:2026, browserSession:true, raw:{ id:424242, seasonId:2026, settings:{name:'QA Sunday League',scheduleSettings:{playoffTeamCount:2,matchupPeriodCount:14},rosterSettings:{lineupLocktimeType:'INDIVIDUAL_GAME',rosterLocktimeType:'INDIVIDUAL_GAME',lineupSlotCounts:{0:1,2:2,4:2,6:1,16:1,17:1,20:7,21:1,23:1}},scoringSettings:{playerRankType:'PPR',scoringItems:[{statId:3,points:.04},{statId:4,points:4},{statId:20,points:-2},{statId:24,points:.1},{statId:25,points:6},{statId:42,points:.1},{statId:43,points:6},{statId:53,points:1}]}}, status:{currentScoringPeriod:3,finalScoringPeriod:17}, schedule:Array.from({length:12},(_,i)=>({id:i+1,matchupPeriodId:i+3,home:{teamId:1},away:{teamId:2}})), members:[{id:'u1',displayName:'QA User'},{id:'u2',displayName:'Opponent'}], teams:[{id:1,name:'QA Champions',primaryOwner:'u1',record:{overall:{wins:2,losses:0,ties:0,pointsFor:250}},roster:{entries:[{playerPoolEntry:{player:{id:4429795,fullName:'Jahmyr Gibbs'}}},{playerPoolEntry:{player:{id:4430807,fullName:'Bijan Robinson'}}},{playerPoolEntry:{player:{id:4426515,fullName:'Puka Nacua'}}}]}},{id:2,name:'QA Rivals',primaryOwner:'u2',record:{overall:{wins:0,losses:2,ties:0,pointsFor:180}},roster:{entries:[{playerPoolEntry:{player:{id:12483,fullName:'Matthew Stafford'}}},{playerPoolEntry:{player:{id:4429160,fullName:"De'Von Achane"}}},{playerPoolEntry:{player:{id:4696981,fullName:'Cam Skattebo'}}},{playerPoolEntry:{player:{id:4239993,fullName:'Tee Higgins'}}},{playerPoolEntry:{player:{id:4035687,fullName:'Michael Pittman Jr.'}}},{playerPoolEntry:{player:{id:4047650,fullName:'DK Metcalf'}}},{playerPoolEntry:{player:{id:3040151,fullName:'George Kittle'}}},{playerPoolEntry:{player:{id:3055899,fullName:'Harrison Butker'}}},{playerPoolEntry:{player:{id:-16021,fullName:'Eagles D/ST'}}}]}}] } };
    };
    document.querySelector('#espn-league-input').value='424242';
    document.querySelector('#connect-espn').click();
    return true;
  })()`);
  await waitFor(`!document.querySelector('#espn-auth-step').classList.contains('hidden') && document.querySelector('#espn-connection-state').textContent.includes('Sign-in')`, 10000);
  await evaluate(`document.querySelector('#connect-espn-session').click(); true`);
  await waitFor(`!document.querySelector('#espn-team-step').classList.contains('hidden')`, 10000);
  await evaluate(`document.querySelector('#espn-team-select').value='1'; document.querySelector('#use-espn-team').click(); true`);
  await waitFor(`!document.querySelector('#league-command-strip').classList.contains('hidden') && document.querySelectorAll('#roster-strip .roster-chip').length===3`, 10000);
  const espnSync = await evaluate(`(() => ({team:document.querySelector('#espn-connected-team').textContent,league:document.querySelector('#home-league-label').textContent,roster:document.querySelectorAll('#roster-strip .roster-chip').length,week:document.querySelector('#lineup-week').value,title:document.querySelector('#my-league-title')?.textContent||''}))()`);
  if (espnSync.team !== 'QA Champions' || espnSync.league !== 'QA Sunday League' || espnSync.roster !== 3 || espnSync.week !== '3' || espnSync.title !== 'QA Champions command center.') throw new Error("ESPN league sync flow failed");
  const importedRules = await evaluate(`({state:document.querySelector('#manual-profile-state')?.textContent,summary:document.querySelector('#manual-profile-summary')?.textContent})`);
  if (!importedRules.state.includes('Autofilled from ESPN') || !importedRules.summary.includes('PPR')) throw new Error(`ESPN league rules did not autofill universal profile: ${JSON.stringify(importedRules)}`);
  const connectedLeagueUi = await evaluate(`({requiredEnabled:[...document.querySelectorAll('[data-requires-league]')].every((row)=>!row.disabled),tradeIdeasVisible:!document.querySelector('#trade-ideas-panel')?.classList.contains('hidden'),tradeIdeasInLeague:Boolean(document.querySelector('#myleague #trade-ideas-panel'))})`);
  if (!connectedLeagueUi.requiredEnabled || !connectedLeagueUi.tradeIdeasVisible || !connectedLeagueUi.tradeIdeasInLeague) throw new Error(`Connected My League menu/tools failed: ${JSON.stringify(connectedLeagueUi)}`);
  const masthead = await evaluate(`({team:document.querySelector('#masthead-team')?.textContent,week:document.querySelector('#masthead-week')?.textContent})`);
  if (masthead.team !== 'QA Champions' || !masthead.week.includes('Week 3')) throw new Error("Persistent league masthead did not hydrate");
  const connectedHome = await snapshot("home-connected-desktop", 1440, 1000);
  if (connectedHome.horizontalOverflow) throw new Error("Connected ESPN home layout overflow");

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
  if (!player.text.includes("PROJECTED POINTS") || !player.text.includes("LIKELY RANGE") || player.why < 1 || player.metrics < 5) throw new Error(`Friendly player result failed: ${JSON.stringify(player)}`);

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
  const campState = await evaluate(`Promise.all([fetch('./data/camp-2026.json').then(r=>r.json()), Promise.resolve(document.querySelector('#live-intelligence-status')?.textContent || '')]).then(([camp,status])=>({players:camp.players?.length||0, advisory:camp.players?.every(row=>row.modelEffect==='advisory-only'), status}))`);
  if (campState.players < 10 || !campState.advisory || !campState.status.includes("camp reads")) throw new Error(`Camp intelligence did not load safely: ${JSON.stringify(campState)}`);

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

  await evaluate(`document.querySelector('#my-league-menu-button').click(); document.querySelector('[data-league-nav="draft"]').click(); true`);
  await waitFor(`document.querySelector('.panel.active')?.dataset.panel === 'draft' && !document.querySelector('#draft-league-context')?.classList.contains('hidden') && document.querySelectorAll('#draft-table tr').length >= 10`, 15000);
  const leagueDraftShell = await evaluate(`({title:document.querySelector('#draft-title')?.textContent||'',context:document.querySelector('#draft-league-context-name')?.textContent||'',modeVisible:!document.querySelector('#draft-mode-wrap')?.classList.contains('hidden'),teamsHidden:document.querySelector('#draft-teams-wrap')?.classList.contains('hidden'),scoringHidden:document.querySelector('#draft-scoring-wrap')?.classList.contains('hidden'),qbHidden:document.querySelector('#draft-qb-format-wrap')?.classList.contains('hidden'),start:document.querySelector('#draft-reset')?.textContent||''})`);
  if (!leagueDraftShell.title.includes('QA Champions') || !leagueDraftShell.context.includes('PPR') || !leagueDraftShell.modeVisible || !leagueDraftShell.teamsHidden || !leagueDraftShell.scoringHidden || !leagueDraftShell.qbHidden || leagueDraftShell.start !== 'Start mock') throw new Error(`My League Draft shell is cluttered or unsynced: ${JSON.stringify(leagueDraftShell)}`);
  const board = await evaluate(`(() => ({rows:document.querySelectorAll('#draft-big-board .big-board-row').length,first:document.querySelector('#draft-big-board .big-board-row')?.textContent||'',boardClosed:!document.querySelector('.draft-board-details')?.open}))()`);
  const campBadges = await evaluate(`document.querySelectorAll('#draft-big-board .camp-pill').length`);
  if (board.rows < 50 || !board.first.includes('SNAP SCORE') || !board.boardClosed || campBadges < 1) throw new Error(`SnapCount draft board/camp disclosure failed: ${JSON.stringify(board)}`);
  await evaluate(`document.querySelector('#draft-reset').click(); true`);
  await waitFor(`document.querySelector('#draft-meta')?.textContent.includes('YOUR PICK') && Boolean(document.querySelector('#draft-table [data-draft-player]:not(:disabled)'))`, 20000);
  const draftRoom = await evaluate(`document.querySelectorAll('#draft-table tr').length`);
  const draftSettingsVisible = await evaluate(`({teams:Number(document.querySelector('#draft-teams')?.value||0),position:Number(document.querySelector('#draft-position')?.value||0)})`);
  if (!(draftSettingsVisible.position >= 1 && draftSettingsVisible.position <= draftSettingsVisible.teams) || draftRoom < 10) throw new Error(`League Draft position/recommendations failed: ${JSON.stringify(draftSettingsVisible)}`);
  await evaluate(`document.querySelector('#draft-table [data-draft-player]:not(:disabled)').click(); true`);
  await waitFor(`document.querySelector('#draft-roster')?.textContent.includes('1/16') && document.querySelector('#draft-meta')?.textContent.includes('YOUR PICK')`, 20000);
  const mockFlow = await evaluate(`({picks:parseInt(document.querySelector('#draft-meta')?.textContent || '0',10)||0,roster:document.querySelector('#draft-roster')?.textContent||'',meta:document.querySelector('#draft-meta')?.textContent||''})`);
  if (mockFlow.picks <= 1 || !mockFlow.meta.includes('YOUR PICK')) throw new Error(`My League Mock Draft did not auto-advance: ${JSON.stringify(mockFlow)}`);
  await evaluate(`document.querySelector('#draft-benchmark').closest('details').open=true; document.querySelector('#draft-benchmark-count').value='40'; document.querySelector('#draft-benchmark').click(); true`);
  await waitFor(`document.querySelector('#global-status')?.textContent.includes('Comparison finished')`, 45000);
  const benchmark = await evaluate(`document.querySelector('#draft-benchmark-result').textContent`);
  if (!benchmark.includes('better projected roster')) throw new Error('Friendly draft comparison failed');
  const draftDesktop = await snapshot("draft-league-desktop", 1440, 1000);
  if (draftDesktop.horizontalOverflow || draftDesktop.activePanel !== 'draft') throw new Error('My League Draft desktop layout failed');

  await evaluate(`(() => { document.querySelector('[data-league-jump="lineup"]').click(); const s=document.querySelector('#roster-search'); s.value='Josh Allen'; s.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  const rosterSearch = await evaluate(`document.querySelector('#roster-add option:checked')?.textContent || ''`);
  if (!rosterSearch.includes('Josh Allen')) throw new Error('Roster search failed');
  await evaluate(`document.querySelector('#roster-demo').click(); document.querySelector('#run-lineup').click(); true`);
  await waitFor(`Boolean(document.querySelector('#lineup-result .friendly-result-head'))`, 20000);
  const lineup = await evaluate(`(() => ({
    roster: document.querySelectorAll('#roster-strip .roster-chip').length,
    starters: document.querySelectorAll('#lineup-result .lineup-list:first-of-type .lineup-row').length,
    text: document.querySelector('#lineup-result').textContent
  }))()`);
  if (lineup.roster < 10 || lineup.starters < 8 || !lineup.text.includes("RECOMMENDED LINEUP") || !lineup.text.includes("WIN CHANCE VS QA RIVALS")) throw new Error("Opponent-aware start/sit flow failed");

  await evaluate(`document.querySelector('[data-panel-target="trades"]').click(); true`);
  await waitFor(`!document.querySelector('#trade-partner-label').classList.contains('hidden') && document.querySelectorAll('#trade-partner option').length >= 2`);
  const tradePartnerControl = await evaluate(`({value:document.querySelector('#trade-partner')?.value,options:[...document.querySelectorAll('#trade-partner option')].map((row)=>row.textContent),giveScope:document.querySelector('#trade-give-scope')?.textContent})`);
  if (tradePartnerControl.value || !tradePartnerControl.options.some((row)=>row.includes('QA Rivals')) || tradePartnerControl.giveScope !== 'Your roster') throw new Error(`Connected trade partner control failed: ${JSON.stringify(tradePartnerControl)}`);
  await evaluate(`(() => { const select=document.querySelector('#trade-partner'); select.value='2'; select.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await waitFor(`document.querySelector('#trade-get-scope')?.textContent.includes('QA Rivals') && document.querySelectorAll('#trade-get-list [data-trade-player-input]').length === 2`);
  await evaluate(`(() => { const input=document.querySelector('#trade-get-list [data-trade-player-input]'); input.focus(); input.value='Bijan'; input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await waitFor(`document.querySelector('#trade-get-list .trade-no-suggestions')?.textContent.includes('No matching players')`);
  await evaluate(`(() => { const input=document.querySelector('#trade-give-list [data-trade-player-input]'); input.focus(); input.value='Stafford'; input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await waitFor(`document.querySelector('#trade-give-list .trade-no-suggestions')?.textContent.includes('No matching players')`);
  await chooseTradePlayer('give', 0, 'Jahmyr', 'Jahmyr Gibbs');
  await chooseTradePlayer('get', 0, 'Stafford', 'Matthew Stafford');
  const restrictedTrade = await evaluate(`({partner:document.querySelector('#trade-partner option:checked')?.textContent,give:document.querySelector('#trade-give-list [data-trade-player-input]')?.value,get:document.querySelector('#trade-get-list [data-trade-player-input]')?.value})`);
  if (!restrictedTrade.partner.includes('QA Rivals') || !restrictedTrade.give.includes('Jahmyr Gibbs') || !restrictedTrade.get.includes('Matthew Stafford')) throw new Error(`Connected typeahead selection failed: ${JSON.stringify(restrictedTrade)}`);
  await evaluate(`document.querySelector('#analyze-trade').click(); true`);
  await waitFor(`document.querySelector('#trade-check-result')?.textContent.includes('THE CALL') && document.querySelector('#trade-check-result')?.textContent.includes('QA Rivals')`, 25000);
  const trade = await evaluate(`document.querySelector('#trade-check-result').textContent`);
  if (!["ACCEPT", "PASS", "CLOSE CALL"].some((word) => trade.includes(word)) || !trade.includes("FUTURE GAME WIN CHANCE") || !trade.includes("QA Rivals") || !trade.includes('Jahmyr Gibbs') || !trade.includes('Matthew Stafford')) throw new Error("Opponent-aware direct trade analyzer failed");
  const tradeDesktop = await snapshot("trade-desktop", 1440, 1000);
  if (tradeDesktop.horizontalOverflow) throw new Error("Trade desktop overflow");

  await evaluate(`document.querySelector('#my-league-menu-button').click(); document.querySelector('[data-league-nav="trade-ideas"]').click(); true`);
  await waitFor(`document.querySelector('.panel.active')?.dataset.panel === 'myleague' && document.querySelector('#trade-ideas-panel')?.open`, 5000);
  await evaluate(`document.querySelector('#run-trades').click(); true`);
  await waitFor(`document.querySelector('#global-status')?.textContent.includes('Trade ideas are ready')`, 35000);
  const tradeIdeas = await evaluate(`({length:document.querySelector('#trade-result').textContent.length,inLeague:Boolean(document.querySelector('#myleague #trade-ideas-panel')),inTrade:Boolean(document.querySelector('#trades #trade-ideas-panel'))})`);
  if (tradeIdeas.length < 20 || !tradeIdeas.inLeague || tradeIdeas.inTrade) throw new Error(`My League trade ideas placement/flow failed: ${JSON.stringify(tradeIdeas)}`);

  await evaluate(`document.querySelector('[data-league-jump="waivers"]').click(); document.querySelector('#waiver-mode').value='priority'; document.querySelector('#run-waivers').click(); true`);
  await waitFor(`document.querySelector('#global-status')?.textContent.includes('waiver recommendations are ready')`, 35000);
  const waivers = await evaluate(`document.querySelector('#waiver-result').textContent`);
  if (!waivers.includes("Add") && !waivers.includes("No pickup")) throw new Error("Friendly waiver flow failed");
  if (["De'Von Achane","Cam Skattebo","Tee Higgins","DK Metcalf","George Kittle"].some((name)=>waivers.includes(name))) throw new Error(`Waiver pool exposed a player rostered by QA Rivals: ${waivers}`);

  await evaluate(`document.querySelector('[data-league-jump="league"]').click(); document.querySelector('#build-demo-league').click(); document.querySelector('#league-scenarios').value='500'; document.querySelector('#run-league').click(); true`);
  await waitFor(`document.querySelectorAll('#league-result tbody tr').length >= Number(document.querySelector('#manual-league-teams')?.value || 4)`, 35000);
  const season = await evaluate(`(() => ({rows:document.querySelectorAll('#league-result tbody tr').length,text:document.querySelector('#league-result').textContent,status:document.querySelector('#league-source-status').textContent}))()`);
  const expectedSeasonTeams = await evaluate(`Number(document.querySelector('#manual-league-teams')?.value || 4)`);
  if (season.rows < expectedSeasonTeams || !season.text.includes("Make playoffs") || !season.text.includes("Win league") || !season.status.includes("Season outlook ready")) throw new Error("Season outlook failed");

  await evaluate(`document.querySelector('[data-league-jump="draft"]').click(); true`);
  const draftMobile = await snapshot("draft-mobile", 390, 844);
  if (draftMobile.horizontalOverflow || draftMobile.tabRows !== 1 || !draftMobile.tabsScrollable) throw new Error("Draft mobile navigation/layout failed");
  await evaluate(`document.querySelector('[data-panel-target="trades"]').click(); true`);
  const tradeMobile = await snapshot("trade-mobile", 390, 844);
  if (tradeMobile.horizontalOverflow || tradeMobile.tabRows !== 1) throw new Error("Trade mobile navigation/layout failed");
  await evaluate(`document.querySelector('[data-panel-target="overview"]').click(); true`);
  const homeMobile = await snapshot("home-mobile", 390, 844);
  if (homeMobile.horizontalOverflow || homeMobile.publicCards !== 4 || homeMobile.tabRows !== 1) throw new Error("Home mobile layout failed");

  await evaluate(`document.querySelector('#my-league-menu-button').click(); document.querySelector('[data-league-nav="myleague"]').click(); document.querySelector('#disconnect-espn').click(); true`);
  await waitFor(`document.querySelector('#espn-connection-state')?.textContent === 'Not connected' && document.querySelector('#league-tools-panel')?.classList.contains('hidden')`, 10000);
  const relockedLeague = await evaluate(`({title:document.querySelector('#my-league-title')?.textContent||'',toolsHidden:document.querySelector('#league-tools-panel')?.classList.contains('hidden'),manualHidden:document.querySelector('#manual-league-card')?.classList.contains('hidden'),tradeIdeasHidden:document.querySelector('#trade-ideas-panel')?.classList.contains('hidden'),settingsOpen:document.querySelector('#my-league-settings')?.open,requiredDisabled:[...document.querySelectorAll('[data-requires-league]')].every((row)=>row.disabled)})`);
  if (!relockedLeague.toolsHidden || !relockedLeague.manualHidden || !relockedLeague.tradeIdeasHidden || !relockedLeague.settingsOpen || !relockedLeague.requiredDisabled || !relockedLeague.title.includes('Connect ESPN')) throw new Error(`My League did not relock after ESPN disconnect: ${JSON.stringify(relockedLeague)}`);
  await evaluate(`document.querySelector('[data-panel-target="trades"]').click(); document.querySelector('#analyze-trade').click(); true`);
  await waitFor(`document.querySelector('#trade-check-result')?.textContent.includes('STANDALONE VALUE CHECK')`, 30000);
  const postDisconnectTrade = await evaluate(`({partnerHidden:document.querySelector('#trade-partner-label')?.classList.contains('hidden'),giveScope:document.querySelector('#trade-give-scope')?.textContent,getScope:document.querySelector('#trade-get-scope')?.textContent,text:document.querySelector('#trade-check-result')?.textContent||'',leagueIdeas:Boolean(document.querySelector('#trades #trade-ideas-panel'))})`);
  if (!postDisconnectTrade.partnerHidden || postDisconnectTrade.giveScope !== 'Any player' || postDisconnectTrade.getScope !== 'Any player' || postDisconnectTrade.text.includes('FUTURE GAME WIN CHANCE') || postDisconnectTrade.leagueIdeas) throw new Error(`Public trade did not return to standalone mode after ESPN disconnect: ${JSON.stringify(postDisconnectTrade)}`);
  await evaluate(`document.querySelector('[data-panel-target="draft"]').click(); true`);
  await waitFor(`document.querySelector('#draft-title')?.textContent.includes('mock draft') && document.querySelector('#draft-league-context')?.classList.contains('hidden')`, 5000);
  const postDisconnectMock = await evaluate(`({panel:document.querySelector('.panel.active')?.dataset.panel,title:document.querySelector('#draft-title')?.textContent||'',modeHidden:document.querySelector('#draft-mode-wrap')?.classList.contains('hidden')})`);
  if (postDisconnectMock.panel !== 'draft' || !postDisconnectMock.title.includes('mock draft') || !postDisconnectMock.modeHidden) throw new Error(`Public Mock Draft was lost after ESPN disconnect: ${JSON.stringify(postDisconnectMock)}`);

  const result = { home, publicRankings, rankingsDesktop, publicDraftBefore, publicMock, publicDraftDesktop, publicTrade, publicTradeDesktop, noConnectionAccess, leagueMenuBefore, myLeagueBefore, relockedLeague, postDisconnectTrade, postDisconnectMock, espnSync, connectedLeagueUi, connectedHome, player, veteran, liveNews, rookie, rookieTablet, leagueDraftShell, board, draftRoom, mockFlow, benchmark, draftDesktop, lineup, trade, tradeDesktop, tradeIdeas, waivers, season, draftMobile, tradeMobile, homeMobile, errors,
    screenshots: [".qa-home-desktop.png", ".qa-rankings-desktop.png", ".qa-draft-public-desktop.png", ".qa-trade-public-desktop.png", ".qa-home-connected-desktop.png", ".qa-player-tablet.png", ".qa-draft-league-desktop.png", ".qa-trade-desktop.png", ".qa-draft-mobile.png", ".qa-trade-mobile.png", ".qa-home-mobile.png"] };
  fs.writeFileSync(".qa-results.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) throw new Error(`Browser logged ${errors.length} error(s)`);
  socket.close();
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

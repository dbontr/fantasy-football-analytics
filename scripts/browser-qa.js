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
    const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(`.qa-${name}.png`, Buffer.from(capture.data, "base64"));
    return metrics;
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.reload", { ignoreCache: true });
  await waitFor(`document.querySelector('#player-count')?.textContent === '700'`);
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
  if (home.tabs !== 5 || home.publicCards !== 4) throw new Error("Public-first navigation did not render");
  if (home.horizontalOverflow || home.background !== "rgb(243, 244, 246)") throw new Error("SnapCount sports-desk canvas/layout check failed");
  if (home.brand !== "SnapCount Fantasy Football" || !home.title.startsWith("SnapCount") || home.legacyBrandVisible) throw new Error("SnapCount branding check failed");
  if (home.primaryBackground !== "rgb(200, 16, 46)") throw new Error("Primary action is not using the sports-red SnapCount palette");
  if (home.mastheadContextDisplay !== "none") throw new Error("League rules leaked into the visible masthead");
  const publicNav = await evaluate(`(() => ({labels:[...document.querySelectorAll('.tab')].map((row)=>row.textContent.trim()),disabled:[...document.querySelectorAll('.tab')].filter((row)=>row.disabled).length}))()`);
  if (publicNav.labels.join('|') !== 'Home|Rankings|Players|Trade Analyzer|My League' || publicNav.disabled) throw new Error(`Public navigation is wrong: ${JSON.stringify(publicNav)}`);
  const homeStructure = await evaluate(`(() => ({publicHome:Boolean(document.querySelector('.public-home')),topPlayers:document.querySelectorAll('#home-top-players .home-player-row').length,toolCards:document.querySelectorAll('#overview .public-tool-card').length,myLeague:Boolean(document.querySelector('#myleague #enable-default-league'))}))()`);
  if (!homeStructure.publicHome || homeStructure.topPlayers < 5 || homeStructure.toolCards !== 4 || !homeStructure.myLeague) throw new Error(`Public home information architecture failed: ${JSON.stringify(homeStructure)}`);
  const universalHome = await evaluate(`(() => ({manual:Boolean(document.querySelector('#myleague #save-manual-profile')),espn:Boolean(document.querySelector('#myleague #connect-espn')),logo:document.querySelector('.brand-logo')?.getAttribute('src')||'',primary:document.querySelector('#overview .primary')?.textContent.trim()||''}))()`);
  if (!universalHome.manual || !universalHome.espn || !universalHome.logo.includes("snapcount-logo.svg") || universalHome.primary !== "View rankings") throw new Error(`Public home / My League shell did not render: ${JSON.stringify(universalHome)}`);
  const noConnectionAccess = await evaluate(`(() => ({espnState:document.querySelector('#espn-connection-state')?.textContent,espnConnectedVisible:!document.querySelector('#espn-connected')?.classList.contains('hidden'),leagueToolsHidden:document.querySelector('#league-tools-panel')?.classList.contains('hidden'),disabledTabs:[...document.querySelectorAll('.tab')].filter((button)=>button.disabled).map((button)=>button.textContent.trim())}))()`);
  if (noConnectionAccess.espnState !== 'Not connected' || noConnectionAccess.espnConnectedVisible || !noConnectionAccess.leagueToolsHidden || noConnectionAccess.disabledTabs.length) throw new Error(`Public-first disconnected state failed: ${JSON.stringify(noConnectionAccess)}`);

  await evaluate(`document.querySelector('[data-panel-target="rankings"]').click(); true`);
  await waitFor(`document.querySelectorAll('#rankings-table tr').length >= 50`, 10000);
  const publicRankings = await evaluate(`({rows:document.querySelectorAll('#rankings-table tr').length,first:document.querySelector('#rankings-table tr')?.textContent||'',count:document.querySelector('#rankings-count')?.textContent||''})`);
  if (publicRankings.rows < 50 || !publicRankings.first || !publicRankings.count.includes('players')) throw new Error(`Public rankings failed: ${JSON.stringify(publicRankings)}`);
  const rankingsDesktop = await snapshot("rankings-desktop", 1440, 1000);
  if (rankingsDesktop.horizontalOverflow || rankingsDesktop.activePanel !== 'rankings') throw new Error("Rankings desktop layout failed");

  await evaluate(`(() => { document.querySelector('[data-panel-target="trades"]').click(); const give=document.querySelector('#trade-give-search'); give.value='Jahmyr'; give.dispatchEvent(new Event('input',{bubbles:true})); const get=document.querySelector('#trade-search'); get.value='Bijan'; get.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await waitFor(`document.querySelector('#trade-give-1 option:nth-child(2)')?.textContent.includes('Jahmyr') && document.querySelector('#trade-get-1 option:nth-child(2)')?.textContent.includes('Bijan')`, 10000);
  await evaluate(`(() => { document.querySelector('#trade-give-1').selectedIndex=1; document.querySelector('#trade-get-1').selectedIndex=1; document.querySelector('#analyze-trade').click(); return true; })()`);
  await waitFor(`document.querySelector('#trade-check-result')?.textContent.includes('STANDALONE VALUE CHECK')`, 45000);
  const publicTrade = await evaluate(`document.querySelector('#trade-check-result').textContent`);
  if (!publicTrade.includes('VALUE YOU GIVE') || !publicTrade.includes('VALUE YOU GET') || !publicTrade.includes('TRADE BALANCE') || !publicTrade.includes('My League') || publicTrade.includes('FUTURE GAME WIN CHANCE')) throw new Error(`Standalone trade analysis failed: ${publicTrade}`);
  const publicTradeDesktop = await snapshot("trade-public-desktop", 1440, 1000);
  if (publicTradeDesktop.horizontalOverflow || publicTradeDesktop.activePanel !== 'trades') throw new Error("Public trade desktop layout failed");

  await evaluate(`document.querySelector('[data-panel-target="myleague"]').click(); true`);
  const myLeagueBefore = await evaluate(`({hidden:document.querySelector('#league-tools-panel')?.classList.contains('hidden'),kicker:document.querySelector('#rail-context-kicker')?.textContent,settingsOpen:document.querySelector('#my-league-settings')?.open})`);
  if (!myLeagueBefore.hidden || myLeagueBefore.kicker !== 'SETUP REQUIRED') throw new Error(`My League should start locked: ${JSON.stringify(myLeagueBefore)}`);
  await evaluate(`document.querySelector('#enable-default-league').click(); true`);
  await waitFor(`!document.querySelector('#league-tools-panel').classList.contains('hidden') && document.querySelector('#manual-profile-summary')?.textContent.includes('12-team PPR')`, 10000);
  const myLeagueUnlock = await evaluate(`({espn:document.querySelector('#espn-connection-state')?.textContent,kicker:document.querySelector('#rail-context-kicker')?.textContent,summary:document.querySelector('#manual-profile-summary')?.textContent,tools:document.querySelectorAll('#league-tools-panel .quick-action').length})`);
  if (myLeagueUnlock.espn !== 'Not connected' || myLeagueUnlock.kicker !== 'MY LEAGUE READY' || !myLeagueUnlock.summary.includes('12-team PPR') || myLeagueUnlock.tools !== 5) throw new Error(`My League default unlock failed: ${JSON.stringify(myLeagueUnlock)}`);

  await evaluate(`document.querySelector('#league-tools-panel [data-jump="draft"]').click(); document.querySelector('#draft-reset').click(); true`);
  await waitFor(`document.querySelectorAll('#draft-big-board .big-board-row').length >= 50`, 10000);
  await evaluate(`document.querySelector('#draft-advance').click(); true`);
  await waitFor(`document.querySelector('#draft-meta')?.textContent.includes('YOUR PICK')`, 20000);
  await evaluate(`document.querySelector('#draft-table [data-draft-player]').click(); true`);
  await waitFor(`document.querySelector('#draft-roster')?.textContent.includes('1/') && document.querySelector('#draft-meta')?.textContent.includes('YOUR PICK')`, 20000);
  const disconnectedMock = await evaluate(`({meta:document.querySelector('#draft-meta')?.textContent||'',roster:document.querySelector('#draft-roster')?.textContent||'',espn:document.querySelector('#espn-connection-state')?.textContent||''})`);
  if (disconnectedMock.espn !== 'Not connected' || !disconnectedMock.meta.includes('YOUR PICK') || !disconnectedMock.meta.includes('A+ QUALIFIED PPR') || !disconnectedMock.roster.includes('1/')) throw new Error(`My League mock draft failed without ESPN: ${JSON.stringify(disconnectedMock)}`);
  await evaluate(`document.querySelector('#draft-reset').click(); document.querySelector('[data-panel-target="myleague"]').click(); document.querySelector('#my-league-settings').open=true; true`);

  await evaluate(`(() => { document.querySelector('#manual-league-teams').value=10; document.querySelector('#manual-league-scoring').value='half-ppr'; document.querySelector('#manual-slot-wr').value=3; document.querySelector('#manual-slot-dst').value=0; document.querySelector('#manual-slot-k').value=0; document.querySelector('#save-manual-profile').click(); return true; })()`);
  await waitFor(`document.querySelector('#manual-profile-summary')?.textContent.includes('10-team Half PPR') && document.querySelector('#masthead-team')?.textContent.includes('Any fantasy league')`);



  await evaluate(`(() => {
    const imported = {
      name:'QA Imported League', currentWeek:1, userTeamId:'1',
      settings:{scoring:'ppr',lineupLockType:'INDIVIDUAL_GAME',slots:{QB:1,RB:1,WR:1,TE:0,FLEX:0,SUPERFLEX:0,DST:0,K:0,BN:2}},
      transactions:{faabBudget:100,acquisitionLimit:8,tradeDeadline:'2026-11-20T00:00:00Z',rosterLimit:5,irSlots:1,complete:true},
      teams:[
        {teamId:'1',name:'Imported Stars',transactions:{faabSpent:25,waiverPriority:2,acquisitions:1,irUsed:0},rosterEntries:[{playerId:'4429795',lineupSlot:'RB',locked:true,currentPoints:11.2,final:true}]},
        {teamId:'2',name:'Imported Rivals',rosterEntries:[{playerId:'12483',lineupSlot:'QB',locked:false,currentPoints:0,final:false}]}
      ],
      fantasySchedule:{1:[['1','2']]}
    };
    document.querySelector('#league-import-text').value=JSON.stringify(imported);
    document.querySelector('#read-league-import').click();
    return true;
  })()`);
  await waitFor(`!document.querySelector('#league-import-team-step').classList.contains('hidden') && document.querySelector('#league-import-status').textContent.includes('QA Imported League')`, 10000);
  await evaluate(`document.querySelector('#league-import-team-select').value='1'; document.querySelector('#use-league-import').click(); true`);
  await waitFor(`document.querySelector('#masthead-team')?.textContent === 'Imported Stars' && document.querySelectorAll('#roster-strip .roster-chip').length === 1`, 10000);
  const importedState = await evaluate(`({provider:document.querySelector('#season-provider-badge')?.textContent,faab:document.querySelector('#faab-budget')?.value,mode:document.querySelector('#waiver-mode')?.value,source:document.querySelector('#manual-profile-state')?.textContent})`);
  if (importedState.provider !== 'IMPORT' || importedState.faab !== '75' || importedState.mode !== 'faab' || !importedState.source.includes('Autofilled from import')) throw new Error(`Universal league import did not hydrate correctly: ${JSON.stringify(importedState)}`);
  const importedHome = await snapshot("home-imported-desktop", 1440, 1000);
  if (importedHome.horizontalOverflow) throw new Error("Imported league home layout overflow");
  await send("Page.reload", { ignoreCache: true });
  await waitFor(`document.querySelector('#masthead-team')?.textContent === 'Imported Stars' && document.querySelectorAll('#roster-strip .roster-chip').length === 1`, 10000);
  await evaluate(`document.querySelector('#disconnect-league-import').click(); true`);
  await waitFor(`document.querySelector('#masthead-team')?.textContent.includes('Any fantasy league')`, 10000);

  await evaluate(`(() => { const scoring=document.querySelector('#manual-league-scoring'); scoring.value='custom'; scoring.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  const customScoringUi = await evaluate(`({hidden:document.querySelector('#manual-custom-scoring-wrap')?.classList.contains('hidden'),draftOption:Boolean(document.querySelector('#draft-scoring option[value="custom"]'))})`);
  if (customScoringUi.hidden || !customScoringUi.draftOption) throw new Error('Exact custom-scoring controls did not render');
  await evaluate(`(() => { const scoring=document.querySelector('#manual-league-scoring'); scoring.value='ppr'; scoring.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);

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

  await evaluate(`document.querySelector('#league-tools-panel [data-jump="draft"]').click(); document.querySelector('#draft-reset').click(); true`);
  await waitFor(`document.querySelectorAll('#draft-big-board .big-board-row').length >= 50`, 10000);
  await waitFor(`document.querySelectorAll('#draft-table tr').length >= 10`, 15000);
  const board = await evaluate(`(() => ({
    rows: document.querySelectorAll('#draft-big-board .big-board-row').length,
    first: document.querySelector('#draft-big-board .big-board-row')?.textContent
  }))()`);
  const campBadges = await evaluate(`document.querySelectorAll('#draft-big-board .camp-pill').length`);
  if (board.rows < 50 || !board.first.includes("SNAP SCORE") || campBadges < 1) throw new Error("SnapCount draft board/camp advisories failed");
  await evaluate(`(() => { const s=document.querySelector('#draft-pick-search'); s.value='Bijan'; s.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  const draftSearch = await evaluate(`document.querySelector('#draft-manual-player option:checked')?.textContent || ''`);
  if (!draftSearch.includes('Bijan')) throw new Error('Draft pick search failed');
  await evaluate(`(() => { const s=document.querySelector('#draft-pick-search'); s.value=''; s.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#draft-advance').click(); return true; })()`);
  await waitFor(`document.querySelector('#draft-meta')?.textContent.includes('YOUR PICK')`, 20000);
  const draftRoom = await evaluate(`document.querySelectorAll('#draft-table tr').length`);
  const draftSettingsVisible = await evaluate(`({teams:Number(document.querySelector('#draft-teams')?.value||0),position:Number(document.querySelector('#draft-position')?.value||0)})`);
  if (!(draftSettingsVisible.position >= 1 && draftSettingsVisible.position <= draftSettingsVisible.teams)) throw new Error(`Draft position display escaped league size: ${JSON.stringify(draftSettingsVisible)}`);
  if (draftRoom < 10) throw new Error("Draft recommendations did not render");
  await evaluate(`document.querySelector('#draft-table [data-draft-player]').click(); true`);
  await waitFor(`document.querySelector('#draft-roster')?.textContent.includes('1/16') && document.querySelector('#draft-meta')?.textContent.includes('YOUR PICK')`, 20000);
  const mockFlow = await evaluate(`({picks:parseInt(document.querySelector('#draft-meta')?.textContent || '0', 10) || 0, roster:document.querySelector('#draft-roster')?.textContent || '', meta:document.querySelector('#draft-meta')?.textContent || ''})`);
  if (mockFlow.picks <= 1 || !mockFlow.meta.includes('YOUR PICK')) throw new Error(`Mock draft did not auto-advance after user pick: ${JSON.stringify(mockFlow)}`);
  await evaluate(`document.querySelector('#draft-benchmark').closest('details').open=true; document.querySelector('#draft-benchmark-count').value='40'; document.querySelector('#draft-benchmark').click(); true`);
  await waitFor(`document.querySelector('#global-status')?.textContent.includes('Comparison finished')`, 45000);
  const benchmark = await evaluate(`document.querySelector('#draft-benchmark-result').textContent`);
  if (!benchmark.includes("better projected roster")) throw new Error("Friendly draft comparison failed");
  const draftDesktop = await snapshot("draft-desktop", 1440, 1000);
  if (draftDesktop.horizontalOverflow || draftDesktop.activePanel !== "draft") throw new Error("Draft desktop layout failed");

  await evaluate(`(() => { document.querySelector('#league-tools-panel [data-jump="lineup"]').click(); const s=document.querySelector('#roster-search'); s.value='Josh Allen'; s.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
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
  await waitFor(`document.querySelectorAll('#trade-give-1 option').length > 2 && document.querySelectorAll('#trade-get-1 option').length > 2`);
  await evaluate(`(() => { const search=document.querySelector('#trade-search'); search.value='Stafford'; search.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  const tradeSearch = await evaluate(`document.querySelector('#trade-get-1 option:nth-child(2)')?.textContent || ''`);
  if (!tradeSearch.includes('Stafford')) throw new Error('Trade target search failed');
  await evaluate(`(() => {
    const give = document.querySelector('#trade-give-1'); const get = document.querySelector('#trade-get-1');
    give.selectedIndex = 1; get.selectedIndex = 1; document.querySelector('#analyze-trade').click(); return true;
  })()`);
  await waitFor(`Boolean(document.querySelector('#trade-check-result .trade-verdict'))`, 25000);
  const trade = await evaluate(`document.querySelector('#trade-check-result').textContent`);
  if (!["ACCEPT", "PASS", "CLOSE CALL"].some((word) => trade.includes(word)) || !trade.includes("FUTURE GAME WIN CHANCE") || !trade.includes("QA Rivals")) throw new Error("Opponent-aware direct trade analyzer failed");
  const tradeDesktop = await snapshot("trade-desktop", 1440, 1000);
  if (tradeDesktop.horizontalOverflow) throw new Error("Trade desktop overflow");

  await evaluate(`document.querySelector('#run-trades').closest('details').open=true; document.querySelector('#run-trades').click(); true`);
  await waitFor(`document.querySelector('#global-status')?.textContent.includes('Trade ideas are ready')`, 35000);
  const tradeIdeas = await evaluate(`document.querySelector('#trade-result').textContent.length`);
  if (tradeIdeas < 20) throw new Error("Optional trade ideas failed");

  await evaluate(`document.querySelector('#league-tools-panel [data-jump="waivers"]').click(); document.querySelector('#waiver-mode').value='priority'; document.querySelector('#run-waivers').click(); true`);
  await waitFor(`document.querySelector('#global-status')?.textContent.includes('waiver recommendations are ready')`, 35000);
  const waivers = await evaluate(`document.querySelector('#waiver-result').textContent`);
  if (!waivers.includes("Add") && !waivers.includes("No pickup")) throw new Error("Friendly waiver flow failed");
  if (["De'Von Achane","Cam Skattebo","Tee Higgins","DK Metcalf","George Kittle"].some((name)=>waivers.includes(name))) throw new Error(`Waiver pool exposed a player rostered by QA Rivals: ${waivers}`);

  await evaluate(`document.querySelector('#league-tools-panel [data-jump="league"]').click(); document.querySelector('#build-demo-league').click(); document.querySelector('#league-scenarios').value='500'; document.querySelector('#run-league').click(); true`);
  await waitFor(`document.querySelectorAll('#league-result tbody tr').length >= Number(document.querySelector('#manual-league-teams')?.value || 4)`, 35000);
  const season = await evaluate(`(() => ({rows:document.querySelectorAll('#league-result tbody tr').length,text:document.querySelector('#league-result').textContent,status:document.querySelector('#league-source-status').textContent}))()`);
  const expectedSeasonTeams = await evaluate(`Number(document.querySelector('#manual-league-teams')?.value || 4)`);
  if (season.rows < expectedSeasonTeams || !season.text.includes("Make playoffs") || !season.text.includes("Win league") || !season.status.includes("Season outlook ready")) throw new Error("Season outlook failed");

  await evaluate(`document.querySelector('#league-tools-panel [data-jump="draft"]').click(); true`);
  const draftMobile = await snapshot("draft-mobile", 390, 844);
  if (draftMobile.horizontalOverflow || draftMobile.tabRows !== 1 || !draftMobile.tabsScrollable) throw new Error("Draft mobile navigation/layout failed");
  await evaluate(`document.querySelector('[data-panel-target="trades"]').click(); true`);
  const tradeMobile = await snapshot("trade-mobile", 390, 844);
  if (tradeMobile.horizontalOverflow || tradeMobile.tabRows !== 1) throw new Error("Trade mobile navigation/layout failed");
  await evaluate(`document.querySelector('[data-panel-target="overview"]').click(); true`);
  const homeMobile = await snapshot("home-mobile", 390, 844);
  if (homeMobile.horizontalOverflow || homeMobile.publicCards !== 4 || homeMobile.tabRows !== 1) throw new Error("Home mobile layout failed");

  const result = { home, publicRankings, rankingsDesktop, publicTrade, publicTradeDesktop, noConnectionAccess, myLeagueBefore, myLeagueUnlock, disconnectedMock, espnSync, connectedHome, player, veteran, liveNews, rookie, rookieTablet, board, draftRoom, benchmark, draftDesktop, lineup, trade, tradeDesktop, tradeIdeas, waivers, season, draftMobile, tradeMobile, homeMobile, errors,
    screenshots: [".qa-home-desktop.png", ".qa-rankings-desktop.png", ".qa-trade-public-desktop.png", ".qa-home-connected-desktop.png", ".qa-player-tablet.png", ".qa-draft-desktop.png", ".qa-trade-desktop.png", ".qa-draft-mobile.png", ".qa-trade-mobile.png", ".qa-home-mobile.png"] };
  fs.writeFileSync(".qa-results.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) throw new Error(`Browser logged ${errors.length} error(s)`);
  socket.close();
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

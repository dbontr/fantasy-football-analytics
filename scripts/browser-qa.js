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
    const metrics = await evaluate(`(() => {
      const context=document.querySelector('.context-sidebar'); const rail=document.querySelector('.global-rail'); const header=document.querySelector('.workspace-header');
      return { playerCount:document.querySelector('#player-count')?.textContent, activePanel:document.querySelector('.panel.active')?.dataset.panel, viewportWidth:innerWidth, documentWidth:document.documentElement.scrollWidth, horizontalOverflow:document.documentElement.scrollWidth > innerWidth + 1, contextDisplay:context ? getComputedStyle(context).display : 'missing', contextPosition:context ? getComputedStyle(context).position : 'missing', contextTransform:context ? getComputedStyle(context).transform : 'missing', railDisplay:rail ? getComputedStyle(rail).display : 'missing', contextNavItems:document.querySelectorAll('.context-nav-item').length, visibleLeagueNav:document.querySelectorAll('.context-nav .league-only:not(.hidden)').length, workspaceHeaderDisplay:header ? getComputedStyle(header).display : 'missing', benchmarkRows:document.querySelectorAll('#home-benchmark-chart .benchmark-row').length, background:getComputedStyle(document.body).backgroundColor, brandLoaded:Boolean(document.querySelector('.global-brand img')?.complete && document.querySelector('.global-brand img')?.naturalWidth > 0), title:document.title, primaryBackground:getComputedStyle(document.querySelector('.primary')).backgroundColor, topbar:Boolean(document.querySelector('.topbar')), legacyBrandVisible:/Oracle/i.test(document.body.innerText) };
    })()`);
    if (metrics.legacyBrandVisible) throw new Error(`Legacy Oracle branding is visible in ${name}`);
    if (captureScreenshots) { const capture=await send("Page.captureScreenshot", { format:"png", captureBeyondViewport:false }); fs.writeFileSync(`.qa-${name}.png`, Buffer.from(capture.data,"base64")); }
    return metrics;
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: appUrl });
  await waitFor(`document.querySelector('#player-count')?.textContent === '700'`);
  await waitFor(`document.querySelectorAll('#home-benchmark-chart .benchmark-row').length === 6`, 10000);
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
  if (home.activePanel !== "overview" || home.contextNavItems !== 11 || home.contextPosition !== "sticky" || home.railDisplay !== "flex") throw new Error(`Two-tier desktop navigation failed: ${JSON.stringify(home)}`);
  if (home.horizontalOverflow || home.background !== "rgb(247, 248, 251)") throw new Error("SnapCount canvas/layout check failed");
  if (!home.brandLoaded || !home.title.startsWith("SnapCount")) throw new Error("SnapCount branding check failed");
  if (home.primaryBackground !== "rgb(18, 104, 215)") throw new Error(`Primary action is not using the new blue palette: ${home.primaryBackground}`);
  if (home.benchmarkRows !== 6) throw new Error(`Home historical comparison did not render six sources: ${home.benchmarkRows}`);
  const homeStructure = await evaluate(`({hero:Boolean(document.querySelector('.home-hero-v2')),sync:Boolean(document.querySelector('#sidebar-sync-button')),publicTools:document.querySelectorAll('.home-tools-v2 button').length,benchmark:document.querySelector('#benchmark-season-label')?.textContent||'',benchmarkNames:document.querySelector('#home-benchmark-chart')?.textContent||'',syncTitle:document.querySelector('#sidebar-sync-title')?.textContent||'',draftContext:document.querySelector('[data-nav-key="draft"]')?.dataset.draftContext,tradeMode:document.querySelector('[data-nav-key="trades"]')?.dataset.tradeMode,leagueNavVisible:document.querySelectorAll('.context-nav .league-only:not(.hidden)').length})`);
  if (!homeStructure.hero || !homeStructure.sync || homeStructure.publicTools !== 3 || !homeStructure.benchmark.includes('2018 frozen holdout') || homeStructure.syncTitle !== 'Sync a League' || homeStructure.draftContext !== 'public' || homeStructure.tradeMode !== 'basic' || homeStructure.leagueNavVisible !== 0) throw new Error(`Home/nav hierarchy failed: ${JSON.stringify(homeStructure)}`);
  for (const name of ['ESPN ADP','Yahoo ADP','CBS Sports ADP','NFL.com ADP','FantasyPros ECR']) if (!homeStructure.benchmarkNames.includes(name)) throw new Error(`Missing big-platform benchmark row: ${name}`);
  for (const name of ['3-site consensus','FantasyData ADP','Fantasy Football Calculator','MyFantasyLeague ADP']) if (homeStructure.benchmarkNames.includes(name)) throw new Error(`Legacy benchmark label leaked into UI: ${name}`);
  const noConnectionAccess = await evaluate(`({espnState:document.querySelector('#espn-connection-state')?.textContent,leagueToolsHidden:document.querySelector('#league-tools-panel')?.classList.contains('hidden'),settingsOpen:document.querySelector('#my-league-settings')?.open,shellConnected:document.querySelector('.app-shell')?.classList.contains('league-connected'),switcherConnected:document.querySelector('#sidebar-sync-button')?.classList.contains('connected'),tradeSwitchHidden:document.querySelector('#trade-mode-switch')?.classList.contains('hidden')})`);
  if (noConnectionAccess.espnState !== 'Not connected' || !noConnectionAccess.leagueToolsHidden || !noConnectionAccess.settingsOpen || noConnectionAccess.shellConnected || noConnectionAccess.switcherConnected || !noConnectionAccess.tradeSwitchHidden) throw new Error(`League Sync disconnected gate failed: ${JSON.stringify(noConnectionAccess)}`);

  await evaluate(`document.querySelector('[data-panel-target="outlooks"]').click(); true`);
  await waitFor(`document.querySelectorAll('#outlook-table tr').length >= 100`, 10000);
  const outlookSetup = await evaluate(`(() => { const rows=[...document.querySelectorAll('#outlook-table tr')]; const set=(name,value)=>{const row=rows.find(r=>r.textContent.includes(name)); const select=row?.querySelector('[data-player-outlook]'); if(!select) return false; select.value=value; select.dispatchEvent(new Event('change',{bubbles:true})); return true;}; return {a:set('Jahmyr Gibbs','positive'),b:set('Puka Nacua','neutral')}; })()`);
  if (!outlookSetup.a || !outlookSetup.b) throw new Error(`Could not set player outlooks: ${JSON.stringify(outlookSetup)}`);
  await waitFor(`document.querySelector('#outlook-count')?.textContent.includes('2 rated')`, 5000);
  await evaluate(`document.querySelector('#outlook-filter').value='rated'; document.querySelector('#outlook-filter').dispatchEvent(new Event('change',{bubbles:true})); true`);
  await waitFor(`document.querySelectorAll('#outlook-table tr').length === 2`, 5000);
  const outlookState = await evaluate(`({text:document.querySelector('#outlook-table')?.textContent||'',values:[...document.querySelectorAll('#outlook-table [data-player-outlook]')].map(s=>s.value)})`);
  if (!outlookState.text.includes('Jahmyr Gibbs') || !outlookState.text.includes('Puka Nacua') || !outlookState.values.includes('positive') || !outlookState.values.includes('neutral')) throw new Error(`Unknown/Neutral outlook state failed: ${JSON.stringify(outlookState)}`);

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
  const publicMock = await evaluate(`({meta:document.querySelector('#draft-meta')?.textContent||'',roster:document.querySelector('#draft-roster')?.textContent||'',start:document.querySelector('#draft-reset')?.textContent||'',teams:document.querySelectorAll('#draft-room-board .draft-team-column').length,picks:document.querySelectorAll('#draft-room-board .draft-room-pick').length,recent:document.querySelectorAll('#draft-history .draft-recent-pick').length,strategy:document.querySelector('#draft-strategy-body')?.textContent||''})`);
  if (!publicMock.meta.includes('YOUR PICK') || !publicMock.roster.includes('1/') || publicMock.start !== 'Restart mock' || publicMock.teams !== 12 || publicMock.picks <= 1 || publicMock.recent < 1 || !publicMock.strategy.includes('Roster needs') || !publicMock.strategy.includes('HOW SNAPCOUNT IS DRAFTING')) throw new Error(`Public Mock Draft failed to run/show the room: ${JSON.stringify(publicMock)}`);
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

  const syncGateBefore = await evaluate(`({syncTitle:document.querySelector('#sidebar-sync-title')?.textContent||'',visibleLeagueNav:document.querySelectorAll('.context-nav .league-only:not(.hidden)').length,draftContext:document.querySelector('[data-nav-key="draft"]')?.dataset.draftContext,tradeMode:document.querySelector('[data-nav-key="trades"]')?.dataset.tradeMode})`);
  if (syncGateBefore.syncTitle !== 'Sync a League' || syncGateBefore.visibleLeagueNav !== 0 || syncGateBefore.draftContext !== 'public' || syncGateBefore.tradeMode !== 'basic') throw new Error(`Pre-sync navigation is not minimal: ${JSON.stringify(syncGateBefore)}`);
  await evaluate(`document.querySelector('#sidebar-sync-button').click(); true`);
  await waitFor(`document.querySelector('.panel.active')?.dataset.panel === 'myleague' && document.querySelector('#my-league-settings')?.open`, 5000);
  const myLeagueBefore = await evaluate(`({hidden:document.querySelector('#league-tools-panel')?.classList.contains('hidden'),settingsOpen:document.querySelector('#my-league-settings')?.open,manualHidden:document.querySelector('#manual-league-card')?.classList.contains('hidden'),connectVisible:!document.querySelector('#espn-connect-empty')?.classList.contains('hidden'),title:document.querySelector('#my-league-title')?.textContent||''})`);
  if (!myLeagueBefore.hidden || !myLeagueBefore.settingsOpen || !myLeagueBefore.manualHidden || !myLeagueBefore.connectVisible || !myLeagueBefore.title.includes('Connect ESPN')) throw new Error(`League Sync entry failed: ${JSON.stringify(myLeagueBefore)}`);

  await evaluate(`(() => {
    OracleEspnFantasy.loadLeague = async (_input, _season, options = {}) => {
      if (!options.browserSession) { const error = new Error("This league needs an ESPN sign-in."); error.code = "ESPN_AUTH_REQUIRED"; throw error; }
      return { leagueId:'424242', season:2026, browserSession:true, raw:{ id:424242, seasonId:2026, settings:{name:'QA Sunday League',scheduleSettings:{playoffTeamCount:2,matchupPeriodCount:14},rosterSettings:{lineupLocktimeType:'INDIVIDUAL_GAME',rosterLocktimeType:'INDIVIDUAL_GAME',lineupSlotCounts:{0:1,2:2,4:2,6:1,16:1,17:1,20:7,21:1,23:1}},scoringSettings:{playerRankType:'PPR',scoringItems:[{statId:3,points:.04},{statId:4,points:4},{statId:20,points:-2},{statId:24,points:.1},{statId:25,points:6},{statId:42,points:.1},{statId:43,points:6},{statId:53,points:1}]}}, status:{currentScoringPeriod:3,finalScoringPeriod:17}, schedule:Array.from({length:12},(_,i)=>({id:i+1,matchupPeriodId:i+3,home:{teamId:1},away:{teamId:i%2?3:2}})), members:[{id:'u1',displayName:'QA User'},{id:'u2',displayName:'Opponent'},{id:'u3',displayName:'Third Manager'}], teams:[{id:1,name:'QA Champions',primaryOwner:'u1',record:{overall:{wins:2,losses:0,ties:0,pointsFor:250}},roster:{entries:[{playerPoolEntry:{player:{id:4429795,fullName:'Jahmyr Gibbs'}}},{playerPoolEntry:{player:{id:4430807,fullName:'Bijan Robinson'}}},{playerPoolEntry:{player:{id:4426515,fullName:'Puka Nacua'}}}]}},{id:2,name:'QA Rivals',primaryOwner:'u2',record:{overall:{wins:0,losses:2,ties:0,pointsFor:180}},roster:{entries:[{playerPoolEntry:{player:{id:12483,fullName:'Matthew Stafford'}}},{playerPoolEntry:{player:{id:4429160,fullName:"De'Von Achane"}}},{playerPoolEntry:{player:{id:4696981,fullName:'Cam Skattebo'}}},{playerPoolEntry:{player:{id:4239993,fullName:'Tee Higgins'}}},{playerPoolEntry:{player:{id:4035687,fullName:'Michael Pittman Jr.'}}},{playerPoolEntry:{player:{id:4047650,fullName:'DK Metcalf'}}},{playerPoolEntry:{player:{id:3040151,fullName:'George Kittle'}}},{playerPoolEntry:{player:{id:3055899,fullName:'Harrison Butker'}}},{playerPoolEntry:{player:{id:-16021,fullName:'Eagles D/ST'}}}]}},{id:3,name:'QA Outsiders',primaryOwner:'u3',record:{overall:{wins:1,losses:1,ties:0,pointsFor:210}},roster:{entries:[{playerPoolEntry:{player:{id:3918298,fullName:'Josh Allen'}}},{playerPoolEntry:{player:{id:4241389,fullName:'CeeDee Lamb'}}},{playerPoolEntry:{player:{id:4242335,fullName:'Jonathan Taylor'}}},{playerPoolEntry:{player:{id:4361307,fullName:'Trey McBride'}}},{playerPoolEntry:{player:{id:5083526,fullName:'Brandon Aubrey'}}},{playerPoolEntry:{player:{id:3929630,fullName:'Saquon Barkley'}}},{playerPoolEntry:{player:{id:4362506,fullName:'Amon-Ra St. Brown'}}},{playerPoolEntry:{player:{id:4431455,fullName:'Chase Brown'}}},{playerPoolEntry:{player:{id:-16007,fullName:'Broncos D/ST'}}}]}}] } };
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
  const connectedLeagueUi = await evaluate(`({shellConnected:document.querySelector('.app-shell')?.classList.contains('league-connected'),visibleLeagueNav:document.querySelectorAll('.context-nav .league-only:not(.hidden)').length,tradeIdeasVisible:!document.querySelector('#trade-ideas-panel')?.classList.contains('hidden'),tradeIdeasInLeague:Boolean(document.querySelector('#myleague #trade-ideas-panel')),switcherConnected:document.querySelector('#sidebar-sync-button')?.classList.contains('connected'),syncTitle:document.querySelector('#sidebar-sync-title')?.textContent||'',syncCopy:document.querySelector('#sidebar-sync-copy')?.textContent||'',draftContext:document.querySelector('[data-nav-key="draft"]')?.dataset.draftContext,tradeMode:document.querySelector('[data-nav-key="trades"]')?.dataset.tradeMode,draftLabel:getComputedStyle(document.querySelector('[data-nav-key="draft"] .nav-label-league')).display})`);
  if (!connectedLeagueUi.shellConnected || connectedLeagueUi.visibleLeagueNav !== 5 || !connectedLeagueUi.tradeIdeasVisible || !connectedLeagueUi.tradeIdeasInLeague || !connectedLeagueUi.switcherConnected || connectedLeagueUi.syncTitle !== 'QA Champions' || connectedLeagueUi.syncCopy !== 'QA Sunday League' || connectedLeagueUi.draftContext !== 'league' || connectedLeagueUi.tradeMode !== 'league' || connectedLeagueUi.draftLabel === 'none') throw new Error(`Connected navigation did not upgrade in place: ${JSON.stringify(connectedLeagueUi)}`);
  await evaluate(`document.querySelector('[data-nav-key="home"]').click(); true`);
  const connectedHome = await snapshot("home-connected-desktop", 1440, 1000);
  if (connectedHome.horizontalOverflow || connectedHome.activePanel !== 'overview' || connectedHome.visibleLeagueNav !== 5) throw new Error(`Connected home/navigation layout failed: ${JSON.stringify(connectedHome)}`);

  await send("Page.navigate", { url: appUrl });
  await waitFor(`document.querySelector('#player-count')?.textContent === '700' && document.querySelector('#espn-connection-state')?.textContent === 'Connected'`, 15000);
  const persistedLeague = await evaluate(`({leagueId:document.querySelector('#espn-league-input')?.value||'',shellConnected:document.querySelector('.app-shell')?.classList.contains('league-connected'),switcherConnected:document.querySelector('#sidebar-sync-button')?.classList.contains('connected'),team:document.querySelector('#sidebar-sync-title')?.textContent||'',draftContext:document.querySelector('[data-nav-key="draft"]')?.dataset.draftContext})`);
  if (persistedLeague.leagueId !== '424242' || !persistedLeague.shellConnected || !persistedLeague.switcherConnected || persistedLeague.team !== 'QA Champions' || persistedLeague.draftContext !== 'league') throw new Error(`League ID/team/navigation did not persist across reload: ${JSON.stringify(persistedLeague)}`);
  await evaluate(`document.querySelector('[data-panel-target="outlooks"]').click(); document.querySelector('#outlook-filter').value='rated'; document.querySelector('#outlook-filter').dispatchEvent(new Event('change',{bubbles:true})); true`);
  await waitFor(`document.querySelectorAll('#outlook-table tr').length === 2`, 5000);
  const persistedOutlooks = await evaluate(`({text:document.querySelector('#outlook-table')?.textContent||'',values:[...document.querySelectorAll('#outlook-table [data-player-outlook]')].map((row)=>row.value)})`);
  if (!persistedOutlooks.text.includes('Jahmyr Gibbs') || !persistedOutlooks.text.includes('Puka Nacua') || !persistedOutlooks.values.includes('positive') || !persistedOutlooks.values.includes('neutral')) throw new Error(`Player outlooks did not persist across reload: ${JSON.stringify(persistedOutlooks)}`);

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
  if (!player.text.includes("PROJECTED POINTS") || !player.text.includes("LIKELY RANGE") || !player.text.includes("PLAY CALLER") || player.why < 1 || player.metrics < 5) throw new Error(`Friendly player result failed: ${JSON.stringify(player)}`);

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

  await evaluate(`document.querySelector('[data-nav-key="draft"]').click(); true`);
  await waitFor(`document.querySelector('.panel.active')?.dataset.panel === 'draft' && !document.querySelector('#draft-league-hub')?.classList.contains('hidden')`, 15000);
  const leagueDraftShell = await evaluate(`({title:document.querySelector('#draft-title')?.textContent||'',context:document.querySelector('#draft-league-context-name')?.textContent||'',hubVisible:!document.querySelector('#draft-league-hub')?.classList.contains('hidden'),workspaceHidden:document.querySelector('#draft-launch-card')?.classList.contains('hidden'),strategyHidden:document.querySelector('#draft-strategy')?.classList.contains('hidden'),liveLabel:document.querySelector('#draft-start-live')?.textContent||'',mockLabel:document.querySelector('#draft-launch-league-mock')?.textContent||'',modeHidden:document.querySelector('#draft-mode-wrap')?.classList.contains('hidden')})`);
  if (!leagueDraftShell.title.includes('QA Champions') || !leagueDraftShell.context.includes('PPR') || !leagueDraftShell.hubVisible || !leagueDraftShell.workspaceHidden || !leagueDraftShell.strategyHidden || !leagueDraftShell.modeHidden || !leagueDraftShell.liveLabel.includes('Live Draft') || leagueDraftShell.mockLabel !== 'Mock draft') throw new Error(`My League Draft Center did not present explicit live/mock choices: ${JSON.stringify(leagueDraftShell)}`);

  await evaluate(`document.querySelector('#league-draft-position').value='2'; document.querySelector('#draft-launch-league-mock').click(); true`);
  await waitFor(`document.querySelector('.panel.active')?.dataset.panel === 'draft' && !document.querySelector('#draft-public-preset')?.classList.contains('hidden') && document.querySelector('#draft-mode')?.value === 'sim'`, 10000);
  const leagueMockPreset = await evaluate(`({preset:document.querySelector('#draft-public-preset')?.textContent||'',teams:Number(document.querySelector('#draft-teams')?.value||0),position:Number(document.querySelector('#draft-position')?.value||0),rounds:Number(document.querySelector('#draft-rounds')?.value||0),scoring:document.querySelector('#draft-scoring')?.value||'',start:document.querySelector('#draft-reset')?.textContent||''})`);
  if (!leagueMockPreset.preset.includes('QA Champions') || leagueMockPreset.teams !== 4 || leagueMockPreset.position !== 2 || leagueMockPreset.scoring !== 'ppr' || leagueMockPreset.start !== 'Start mock') throw new Error(`My League preset did not launch the normal Mock Draft correctly: ${JSON.stringify(leagueMockPreset)}`);
  await evaluate(`document.querySelector('#draft-reset').click(); true`);
  await waitFor(`document.querySelector('#draft-meta')?.textContent.includes('YOUR PICK') && Boolean(document.querySelector('#draft-table [data-draft-player]:not(:disabled)'))`, 20000);
  await evaluate(`document.querySelector('#draft-table [data-draft-player]:not(:disabled)').click(); true`);
  await waitFor(`document.querySelector('#draft-roster')?.textContent.includes('1/') && document.querySelector('#draft-meta')?.textContent.includes('YOUR PICK')`, 20000);
  const mockFlow = await evaluate(`({picks:document.querySelectorAll('#draft-room-board .draft-room-pick').length,teams:document.querySelectorAll('#draft-room-board .draft-team-column').length,roster:document.querySelector('#draft-roster')?.textContent||'',meta:document.querySelector('#draft-meta')?.textContent||'',strategy:document.querySelector('#draft-strategy-body')?.textContent||''})`);
  if (mockFlow.picks < 6 || mockFlow.teams !== 4 || !mockFlow.meta.includes('YOUR PICK') || !mockFlow.strategy.includes('Back next turn')) throw new Error(`League-preset Mock Draft did not expose a full simulated room: ${JSON.stringify(mockFlow)}`);
  const board = await evaluate(`(() => ({rows:document.querySelectorAll('#draft-big-board .big-board-row').length,first:document.querySelector('#draft-big-board .big-board-row')?.textContent||'',boardClosed:!document.querySelector('#draft-board-details')?.open}))()`);
  const campBadges = await evaluate(`document.querySelectorAll('#draft-big-board .camp-pill').length`);
  if (board.rows < 50 || !board.first.includes('SNAP SCORE') || !board.boardClosed || campBadges < 1) throw new Error(`SnapCount draft board/camp disclosure failed: ${JSON.stringify(board)}`);
  await evaluate(`document.querySelector('#draft-benchmark-details').open=true; document.querySelector('#draft-benchmark-count').value='40'; document.querySelector('#draft-benchmark').click(); true`);
  await waitFor(`document.querySelector('#global-status')?.textContent.includes('Comparison finished')`, 45000);
  const benchmark = await evaluate(`document.querySelector('#draft-benchmark-result').textContent`);
  if (!benchmark.includes('better projected roster')) throw new Error('Friendly draft comparison failed');

  await evaluate(`document.querySelector('[data-nav-key="draft"]').click(); true`);
  await waitFor(`!document.querySelector('#draft-league-hub')?.classList.contains('hidden')`, 10000);
  await evaluate(`document.querySelector('#league-draft-position').value='2'; document.querySelector('#draft-start-live').click(); true`);
  await waitFor(`document.querySelector('#draft-mode')?.value === 'live' && !document.querySelector('#draft-live-controls')?.classList.contains('hidden') && document.querySelector('#draft-live-controls')?.open`, 10000);
  const liveDraftStart = await evaluate(`({turn:document.querySelector('#draft-live-turn')?.textContent||'',note:document.querySelector('#draft-live-room-note')?.textContent||'',teams:document.querySelectorAll('#draft-room-board .draft-team-column').length,strategy:document.querySelector('#draft-strategy-body')?.textContent||'',targetDisabled:document.querySelector('#draft-table [data-draft-player]')?.disabled})`);
  if (!liveDraftStart.turn.includes('Team 1') || !liveDraftStart.note.includes('Team 1 is on the clock') || liveDraftStart.teams !== 4 || !liveDraftStart.strategy.includes('HOW SNAPCOUNT IS DRAFTING') || !liveDraftStart.targetDisabled) throw new Error(`Live Draft Assistant did not start in real-room tracking mode: ${JSON.stringify(liveDraftStart)}`);
  await evaluate(`(() => { const s=document.querySelector('#draft-pick-search'); s.value='Jahmyr'; s.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#draft-record-pick').click(); return true; })()`);
  await waitFor(`document.querySelector('#draft-meta')?.textContent.includes('YOUR PICK') && document.querySelectorAll('#draft-room-board .draft-room-pick').length === 1 && Boolean(document.querySelector('#draft-table [data-draft-player]:not(:disabled)'))`, 15000);
  const liveOnClock = await evaluate(`({status:document.querySelector('#draft-strategy-status')?.textContent||'',strategy:document.querySelector('#draft-strategy-body')?.textContent||'',turn:document.querySelector('#draft-live-turn')?.textContent||'',button:document.querySelector('#draft-table [data-draft-player]:not(:disabled)')?.textContent||'',recent:document.querySelector('#draft-history')?.textContent||''})`);
  if (!liveOnClock.status.includes("YOU'RE ON THE CLOCK") || !liveOnClock.strategy.includes('Roster needs') || !liveOnClock.strategy.includes('Wait cost') || !liveOnClock.turn.includes('YOU') || liveOnClock.button !== 'I drafted him' || !liveOnClock.recent.includes('Jahmyr Gibbs')) throw new Error(`Live strategy did not adapt after the opponent pick: ${JSON.stringify(liveOnClock)}`);
  await evaluate(`document.querySelector('#draft-table [data-draft-player]:not(:disabled)').click(); true`);
  await waitFor(`document.querySelectorAll('#draft-room-board .draft-room-pick').length === 2 && document.querySelector('#draft-live-turn')?.textContent.includes('Team 3')`, 10000);
  const draftRoom = await evaluate(`({rows:document.querySelectorAll('#draft-table tr').length,picks:document.querySelectorAll('#draft-room-board .draft-room-pick').length,userPicks:document.querySelectorAll('#draft-room-board .draft-team-column.user-team .draft-room-pick').length,liveVisible:!document.querySelector('#draft-live-controls')?.classList.contains('hidden')})`);
  if (draftRoom.rows < 10 || draftRoom.picks !== 2 || draftRoom.userPicks !== 1 || !draftRoom.liveVisible) throw new Error(`Live Draft Assistant room board failed: ${JSON.stringify(draftRoom)}`);
  const draftDesktop = await snapshot("draft-league-desktop", 1440, 1000);
  if (draftDesktop.horizontalOverflow || draftDesktop.activePanel !== 'draft') throw new Error('My League Live Draft Assistant desktop layout failed');

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

  await evaluate(`document.querySelector('[data-set-trade-mode="basic"]').click(); true`);
  await waitFor(`document.querySelector('#trade-mode-note')?.textContent.includes('Basic Value') && document.querySelector('#trade-partner-label')?.classList.contains('hidden')`, 5000);
  const syncedBasicTrade = await evaluate(`({mode:document.querySelector('#trade-mode-note')?.textContent||'',giveScope:document.querySelector('#trade-give-scope')?.textContent,getScope:document.querySelector('#trade-get-scope')?.textContent,actorHidden:document.querySelector('#trade-league-controls')?.classList.contains('hidden')})`);
  if (!syncedBasicTrade.mode.includes('Basic Value') || syncedBasicTrade.giveScope !== 'Any player' || syncedBasicTrade.getScope !== 'Any player' || !syncedBasicTrade.actorHidden) throw new Error(`Basic Trade Value morphed after sync: ${JSON.stringify(syncedBasicTrade)}`);
  await chooseTradePlayer('give', 0, 'Jahmyr', 'Jahmyr Gibbs');
  await chooseTradePlayer('get', 0, 'Stafford', 'Matthew Stafford');
  await evaluate(`document.querySelector('#analyze-trade').click(); true`);
  await waitFor(`document.querySelector('#trade-check-result')?.textContent.includes('STANDALONE VALUE CHECK')`, 25000);
  const syncedBasicResult = await evaluate(`document.querySelector('#trade-check-result')?.textContent||''`);
  if (syncedBasicResult.includes('FUTURE GAME WIN CHANCE')) throw new Error('Basic Trade Value leaked league simulation after sync');

  await evaluate(`document.querySelector('[data-set-trade-mode="league"]').click(); true`);
  await waitFor(`!document.querySelector('#trade-league-controls')?.classList.contains('hidden') && !document.querySelector('#trade-partner-label')?.classList.contains('hidden')`, 5000);
  const tradePartnerControl = await evaluate(`({actor:document.querySelector('#trade-actor-team option:checked')?.textContent||'',actors:[...document.querySelectorAll('#trade-actor-team option')].map((row)=>row.textContent),partners:[...document.querySelectorAll('#trade-partner option')].map((row)=>row.textContent),giveScope:document.querySelector('#trade-give-scope')?.textContent||'',mode:document.querySelector('#trade-mode-note')?.textContent||''})`);
  if (!tradePartnerControl.actor.includes('QA Champions') || !tradePartnerControl.actors.some((row)=>row.includes('QA Outsiders')) || !tradePartnerControl.partners.some((row)=>row.includes('QA Rivals')) || tradePartnerControl.giveScope !== 'QA Champions roster' || !tradePartnerControl.mode.includes('League Impact')) throw new Error(`Advanced Trade Lab actor/partner control failed: ${JSON.stringify(tradePartnerControl)}`);
  await evaluate(`(() => { const select=document.querySelector('#trade-partner'); select.value='2'; select.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await waitFor(`document.querySelector('#trade-get-scope')?.textContent.includes('QA Rivals')`);
  await chooseTradePlayer('give', 0, 'Jahmyr', 'Jahmyr Gibbs');
  await chooseTradePlayer('get', 0, 'Stafford', 'Matthew Stafford');
  await evaluate(`document.querySelector('#analyze-trade').click(); true`);
  await waitFor(`document.querySelector('#trade-check-result')?.textContent.includes('THE CALL') && document.querySelector('#trade-check-result')?.textContent.includes('QA Rivals')`, 30000);
  const trade = await evaluate(`document.querySelector('#trade-check-result').textContent`);
  if (!["ACCEPT", "PASS", "CLOSE CALL"].some((word) => trade.includes(word)) || !trade.includes("FUTURE GAME WIN CHANCE") || !trade.includes("QA Rivals")) throw new Error("User-centric Advanced Trade Lab failed");

  await evaluate(`(() => { const actor=document.querySelector('#trade-actor-team'); actor.value='3'; actor.dispatchEvent(new Event('change',{bubbles:true})); const partner=document.querySelector('#trade-partner'); partner.value='2'; partner.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await waitFor(`document.querySelector('#trade-give-scope')?.textContent.includes('QA Outsiders') && document.querySelector('#trade-get-scope')?.textContent.includes('QA Rivals')`, 5000);
  const thirdPartyShell = await evaluate(`({giveHead:document.querySelector('[data-trade-side="give"] .trade-side-head > strong')?.textContent||'',getHead:document.querySelector('[data-trade-side="get"] .trade-side-head > strong')?.textContent||''})`);
  if (!thirdPartyShell.giveHead.includes('QA Outsiders') || !thirdPartyShell.getHead.includes('QA Rivals')) throw new Error(`Third-party trade perspective labels failed: ${JSON.stringify(thirdPartyShell)}`);
  await chooseTradePlayer('give', 0, 'Josh Allen', 'Josh Allen');
  await chooseTradePlayer('get', 0, 'Stafford', 'Matthew Stafford');
  await evaluate(`document.querySelector('#analyze-trade').click(); true`);
  await waitFor(`document.querySelector('#trade-check-result')?.textContent.includes('LEAGUE IMPACT')`, 30000);
  const thirdPartyTrade = await evaluate(`document.querySelector('#trade-check-result')?.textContent||''`);
  if (!thirdPartyTrade.includes('YOUR FUTURE GAME WIN CHANCE') || !thirdPartyTrade.includes('QA OUTSIDERS') || !thirdPartyTrade.includes('QA RIVALS')) throw new Error(`Third-party league impact failed: ${thirdPartyTrade}`);
  const tradeDesktop = await snapshot("trade-desktop", 1440, 1000);
  if (tradeDesktop.horizontalOverflow) throw new Error("Trade desktop overflow");

  await evaluate(`document.querySelector('[data-league-nav="trade-ideas"]').click(); true`);
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
  if (draftMobile.horizontalOverflow || draftMobile.workspaceHeaderDisplay !== 'grid' || draftMobile.railDisplay !== 'none') throw new Error(`Draft mobile shell failed: ${JSON.stringify(draftMobile)}`);
  await evaluate(`document.querySelector('[data-set-trade-mode="basic"]').click(); true`);
  const tradeMobile = await snapshot("trade-mobile", 390, 844);
  if (tradeMobile.horizontalOverflow || tradeMobile.workspaceHeaderDisplay !== 'grid' || tradeMobile.railDisplay !== 'none') throw new Error(`Trade mobile shell failed: ${JSON.stringify(tradeMobile)}`);
  await evaluate(`document.querySelector('[data-nav-key="home"]').click(); true`);
  const homeMobile = await snapshot("home-mobile", 390, 844);
  if (homeMobile.horizontalOverflow || homeMobile.workspaceHeaderDisplay !== 'grid' || homeMobile.benchmarkRows !== 6) throw new Error(`Home mobile layout failed: ${JSON.stringify(homeMobile)}`);
  const drawerBefore = await evaluate(`document.querySelector('.context-sidebar').getBoundingClientRect().right <= 1`);
  if (!drawerBefore) throw new Error('Mobile tool sidebar should begin off canvas');
  await evaluate(`document.querySelector('#mobile-nav-toggle').click(); true`);
  await waitFor(`document.querySelector('.app-shell')?.classList.contains('nav-open') && document.querySelector('.context-sidebar').getBoundingClientRect().left >= -1`, 3000);
  const drawerOpen = await evaluate(`({open:document.querySelector('.app-shell')?.classList.contains('nav-open'),left:Math.round(document.querySelector('.context-sidebar').getBoundingClientRect().left)})`);
  if (!drawerOpen.open || drawerOpen.left < -1) throw new Error(`Mobile sidebar drawer failed: ${JSON.stringify(drawerOpen)}`);

  await evaluate(`document.querySelector('#sidebar-sync-button').click(); document.querySelector('#disconnect-espn').click(); true`);
  await waitFor(`document.querySelector('#espn-connection-state')?.textContent === 'Not connected' && document.querySelector('#league-tools-panel')?.classList.contains('hidden')`, 10000);
  const relockedLeague = await evaluate(`({title:document.querySelector('#my-league-title')?.textContent||'',toolsHidden:document.querySelector('#league-tools-panel')?.classList.contains('hidden'),manualHidden:document.querySelector('#manual-league-card')?.classList.contains('hidden'),tradeIdeasHidden:document.querySelector('#trade-ideas-panel')?.classList.contains('hidden'),settingsOpen:document.querySelector('#my-league-settings')?.open,shellConnected:document.querySelector('.app-shell')?.classList.contains('league-connected'),switcherConnected:document.querySelector('#sidebar-sync-button')?.classList.contains('connected'),visibleLeagueNav:document.querySelectorAll('.context-nav .league-only:not(.hidden)').length,draftContext:document.querySelector('[data-nav-key="draft"]')?.dataset.draftContext,tradeMode:document.querySelector('[data-nav-key="trades"]')?.dataset.tradeMode})`);
  if (!relockedLeague.toolsHidden || !relockedLeague.manualHidden || !relockedLeague.tradeIdeasHidden || !relockedLeague.settingsOpen || relockedLeague.shellConnected || relockedLeague.switcherConnected || relockedLeague.visibleLeagueNav !== 0 || relockedLeague.draftContext !== 'public' || relockedLeague.tradeMode !== 'basic' || !relockedLeague.title.includes('Connect ESPN')) throw new Error(`League Sync did not return to the basic navigation: ${JSON.stringify(relockedLeague)}`);
  await evaluate(`document.querySelector('[data-nav-key="trades"]').click(); true`);
  await chooseTradePlayer('give', 0, 'Jahmyr', 'Jahmyr Gibbs');
  await chooseTradePlayer('get', 0, 'Stafford', 'Matthew Stafford');
  await evaluate(`document.querySelector('#analyze-trade').click(); true`);
  await waitFor(`document.querySelector('#trade-check-result')?.textContent.includes('STANDALONE VALUE CHECK')`, 30000);
  const postDisconnectTrade = await evaluate(`({partnerHidden:document.querySelector('#trade-partner-label')?.classList.contains('hidden'),giveScope:document.querySelector('#trade-give-scope')?.textContent,getScope:document.querySelector('#trade-get-scope')?.textContent,text:document.querySelector('#trade-check-result')?.textContent||''})`);
  if (!postDisconnectTrade.partnerHidden || postDisconnectTrade.giveScope !== 'Any player' || postDisconnectTrade.getScope !== 'Any player' || postDisconnectTrade.text.includes('FUTURE GAME WIN CHANCE')) throw new Error(`Basic trade did not remain standalone after disconnect: ${JSON.stringify(postDisconnectTrade)}`);
  await evaluate(`document.querySelector('[data-nav-key="draft"]').click(); true`);
  await waitFor(`document.querySelector('#draft-title')?.textContent.includes('mock draft') && document.querySelector('#draft-league-context')?.classList.contains('hidden')`, 5000);
  const postDisconnectMock = await evaluate(`({panel:document.querySelector('.panel.active')?.dataset.panel,title:document.querySelector('#draft-title')?.textContent||'',modeHidden:document.querySelector('#draft-mode-wrap')?.classList.contains('hidden')})`);
  if (postDisconnectMock.panel !== 'draft' || !postDisconnectMock.title.includes('mock draft') || !postDisconnectMock.modeHidden) throw new Error(`Public Mock Draft was lost after disconnect: ${JSON.stringify(postDisconnectMock)}`);

  const result = { home, homeStructure, outlookState, publicRankings, rankingsDesktop, publicDraftBefore, publicMock, publicDraftDesktop, publicTrade, publicTradeDesktop, noConnectionAccess, syncGateBefore, myLeagueBefore, relockedLeague, postDisconnectTrade, postDisconnectMock, espnSync, connectedLeagueUi, connectedHome, persistedLeague, persistedOutlooks, player, veteran, liveNews, rookie, rookieTablet, leagueDraftShell, leagueMockPreset, mockFlow, board, benchmark, liveDraftStart, liveOnClock, draftRoom, draftDesktop, lineup, syncedBasicTrade, syncedBasicResult, tradePartnerControl, trade, thirdPartyShell, thirdPartyTrade, tradeDesktop, tradeIdeas, waivers, season, draftMobile, tradeMobile, homeMobile, drawerOpen, errors,
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

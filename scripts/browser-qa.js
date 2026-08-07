"use strict";

const fs = require("node:fs");

const debuggerOrigin = process.env.DEBUGGER_ORIGIN || "http://127.0.0.1:9235";
const appUrl = process.env.APP_URL || "http://127.0.0.1:4189/";

async function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  const targets = await fetch(`${debuggerOrigin}/json`).then((response) => response.json());
  const target = targets.find((row) => row.url === appUrl || row.url.startsWith(`${appUrl}#`));
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
    if (message.method === "Log.entryAdded" && message.params.entry?.level === "error") {
      const entry = message.params.entry;
      errors.push(`${entry.text}${entry.url ? ` · ${entry.url}` : ""}`);
    }
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Evaluation failed");
    return result.result.value;
  };
  const waitFor = async (expression, timeout = 12000) => {
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
      bootstrap: document.querySelector('#bootstrap-status')?.textContent,
      worker: document.querySelector('#worker-status')?.textContent,
      activePanel: document.querySelector('.panel.active')?.dataset.panel,
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      tabs: document.querySelectorAll('.tab').length,
      sources: document.querySelectorAll('.source-row').length
    }))()`);
    const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(`.qa-${name}.png`, Buffer.from(capture.data, "base64"));
    return metrics;
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.reload", { ignoreCache: true });
  await waitFor(`document.querySelector('#player-count')?.textContent === '700'`);

  const desktop = await snapshot("desktop", 1440, 1000);
  if (desktop.horizontalOverflow) throw new Error(`Desktop horizontal overflow: ${desktop.documentWidth}/${desktop.viewportWidth}`);
  if (desktop.playerCount !== "700" || !desktop.worker.includes("online")) throw new Error("Bootstrap or worker status is incorrect");

  await evaluate(`document.querySelector('[data-panel-target="player"]').click(); document.querySelector('#player-scenarios').value='2000'; document.querySelector('#run-player').click(); true`);
  await waitFor(`Boolean(document.querySelector('#player-result .player-banner'))`, 15000);
  const playerLab = await evaluate(`(() => ({status:document.querySelector('#global-status').textContent, metrics:document.querySelectorAll('#player-result .metric').length, drivers:document.querySelectorAll('#player-result .driver-row').length}))()`);
  if (playerLab.metrics < 5) throw new Error("Player Lab did not render distribution metrics");

  await evaluate(`document.querySelector('#history-season').value='2025'; document.querySelector('#load-intelligence').click(); true`);
  await waitFor(`document.querySelectorAll('#player-intelligence tbody tr').length >= 8`, 45000);
  const intelligence = await evaluate(`(() => ({status:document.querySelector('#global-status').textContent, games:document.querySelectorAll('#player-intelligence tbody tr').length, outlook:document.querySelector('#player-intelligence .outlook-card h3')?.textContent, source:document.querySelector('#intelligence-source').textContent}))()`);
  if (intelligence.games < 8 || !intelligence.outlook) throw new Error("Player intelligence did not render game history and outlook");

  await evaluate(`document.querySelector('[data-panel-target="lineup"]').click(); document.querySelector('#roster-demo').click(); document.querySelector('#run-lineup').click(); true`);
  await waitFor(`document.querySelectorAll('#lineup-result .metric').length >= 5`, 15000);
  const lineup = await evaluate(`(() => ({roster:document.querySelectorAll('.roster-chip').length, starters:document.querySelectorAll('#lineup-result .lineup-row').length, status:document.querySelector('#global-status').textContent}))()`);
  if (lineup.roster < 10 || lineup.starters < 8) throw new Error("Lineup workflow did not produce a complete roster analysis");

  if (!lineup.status.includes("history")) throw new Error("Lineup did not report history-aware decision evidence");

  await evaluate(`document.querySelector('[data-panel-target="waivers"]').click(); document.querySelector('#run-waivers').click(); true`);
  await waitFor(`document.querySelector('#global-status')?.textContent.includes('Waiver search complete')`, 30000);
  const waivers = await evaluate(`(() => ({status:document.querySelector('#global-status').textContent, empty:document.querySelector('#waiver-result').classList.contains('empty-state'), text:document.querySelector('#waiver-result').textContent.length}))()`);
  if (waivers.empty || waivers.text < 20 || !waivers.status.includes("history")) throw new Error("Waiver workflow did not use decision intelligence");

  await evaluate(`document.querySelector('[data-panel-target="trades"]').click(); document.querySelector('#run-trades').click(); true`);
  await waitFor(`document.querySelector('#global-status')?.textContent.includes('Trade search complete')`, 30000);
  const trades = await evaluate(`(() => ({status:document.querySelector('#global-status').textContent, empty:document.querySelector('#trade-result').classList.contains('empty-state'), text:document.querySelector('#trade-result').textContent.length}))()`);
  if (trades.empty || trades.text < 20 || !trades.status.includes("history")) throw new Error("Trade workflow did not use decision intelligence");

  await evaluate(`document.querySelector('[data-panel-target="league"]').click(); document.querySelector('#build-demo-league').click(); document.querySelector('#league-scenarios').value='500'; document.querySelector('#run-league').click(); true`);
  await waitFor(`document.querySelectorAll('#league-result tbody tr').length >= 10`, 35000);
  const league = await evaluate(`(() => ({teams:document.querySelectorAll('#league-result tbody tr').length, status:document.querySelector('#league-source-status').textContent}))()`);
  if (league.teams < 10 || !league.status.includes("history-aware")) throw new Error("League simulator did not render a history-aware board");

  await evaluate(`document.querySelector('[data-panel-target="overview"]').click(); true`);
  const mobile = await snapshot("mobile", 390, 844);
  if (mobile.horizontalOverflow) throw new Error(`Mobile horizontal overflow: ${mobile.documentWidth}/${mobile.viewportWidth}`);

  const result = { desktop, playerLab, intelligence, lineup, waivers, trades, league, mobile, errors, screenshots: [".qa-desktop.png", ".qa-mobile.png"] };
  fs.writeFileSync(".qa-results.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) throw new Error(`Browser logged ${errors.length} error(s)`);
  socket.close();
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

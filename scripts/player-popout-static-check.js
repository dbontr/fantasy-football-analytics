"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const popout = fs.readFileSync(path.join(root, "src", "outlook-player-popout.js"), "utf8");
const store = fs.readFileSync(path.join(root, "src", "storage", "browser-store.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");

const requiredPopoutTokens = [
  "player-analysis-popout",
  "data-player-analysis-popout",
  "AVG PROJECTED PPG",
  "#run-player",
  "#load-intelligence",
  "#player-result",
  "#player-intelligence",
];
for (const token of requiredPopoutTokens) {
  if (!popout.includes(token)) throw new Error(`Player popout missing integration token: ${token}`);
}
if (!store.includes("./src/outlook-player-popout.js")) throw new Error("Browser store does not load the player popout module");
if (!worker.includes("./src/outlook-player-popout.js")) throw new Error("Service worker does not precache the player popout module");
if (!worker.includes("snapcount-browser-v1.34.0-player-popout")) throw new Error("Player popout cache version was not bumped");
console.log("Player popout static integration check passed.");

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const hist = require("./lib/historical-data.js");
const SEASON = Number(process.env.SNAPCOUNT_SITE_BENCHMARK_SEASON || 2018);
process.env.SNAPCOUNT_DRAFT_SEASON = String(SEASON);
process.env.SNAPCOUNT_ALLOW_2018_HOLDOUT = "1";
const robust = require("./draft-robust-historical.js");
const intel = require("../src/engine/intelligence.js");
const core = require("../src/engine/core.js");
const draft = require("../src/engine/draft-sim.js");
const root = path.resolve(__dirname, "..");
const mean = (rows) => rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function key(name, position) { return `${intel.normalizeName(name)}|${String(position || "").toUpperCase()}`; }
function realized(roster, settings) { let total = 0; const rows = roster.map((p) => ({ ...p, projectedPoints: p.actualWeekly.reduce((s,v) => s + Number(v || 0), 0), weeklyProjection: 0, weeklyProjections: p.actualWeekly })); for (let week = 1; week <= 17; week += 1) total += core.optimizeWeeklyLineup(rows, settings, week).total; return total; }
function boardFromScores(pool, scores) { const ranked = [...pool].sort((a,b) => (scores.get(key(a.name,a.position)) ?? 9999 + Number(a.adp || 999)) - (scores.get(key(b.name,b.position)) ?? 9999 + Number(b.adp || 999))); return draft.parseRankingBoard(`rank,name\n${ranked.map((p,i) => `${i+1},${String(p.name).replaceAll(',', '')}`).join("\n")}`); }
async function fetchJson(url) { const response = await fetch(url, { headers: { "user-agent": "SnapCount historical benchmark" } }); if (!response.ok) throw new Error(`${response.status} ${url}`); const bytes = Buffer.from(await response.arrayBuffer()); return { json: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes), bytes: bytes.length, url }; }
function mflName(name) { const parts = String(name || "").split(",").map((value) => value.trim()); return parts.length >= 2 ? `${parts.slice(1).join(" ")} ${parts[0]}`.trim() : String(name || ""); }
async function sourceBoards(pool) {
  const ffc = await fetchJson(`https://fantasyfootballcalculator.com/api/v1/adp/ppr?teams=12&year=${SEASON}`);
  const mflAdp = await fetchJson(`https://api.myfantasyleague.com/${SEASON}/export?TYPE=adp&JSON=1&COUNT=500&POS=*&PERIOD=ALL&IS_PPR=1`);
  const mflPlayers = await fetchJson(`https://api.myfantasyleague.com/${SEASON}/export?TYPE=players&JSON=1`);
  const ffcScores = new Map((ffc.json.players || []).map((row) => [key(row.name, row.position), Number(row.adp)]));
  const mflIdentity = new Map((mflPlayers.json?.players?.player || []).map((row) => [String(row.id), { name: mflName(row.name), position: row.position === "Def" ? "DST" : row.position }]));
  const mflScores = new Map();
  for (const row of mflAdp.json?.adp?.player || []) { const p = mflIdentity.get(String(row.id)); if (p && ["QB","RB","WR","TE","K","DST"].includes(p.position)) mflScores.set(key(p.name,p.position), Number(row.averagePick)); }
  const fdScores = new Map(pool.map((p) => [key(p.name,p.position), Number(p.adp)]));
  const consensusScores = new Map(pool.map((p) => { const k = key(p.name,p.position); const vals = [fdScores.get(k), ffcScores.get(k), mflScores.get(k)].filter(Number.isFinite); return [k, vals.length ? mean(vals) : 9999]; }));
  return {
    "FantasyData ADP": { board: boardFromScores(pool, fdScores), matched: pool.filter((p) => fdScores.has(key(p.name,p.position))).length },
    "Fantasy Football Calculator": { board: boardFromScores(pool, ffcScores), matched: pool.filter((p) => ffcScores.has(key(p.name,p.position))).length },
    "MyFantasyLeague ADP": { board: boardFromScores(pool, mflScores), matched: pool.filter((p) => mflScores.has(key(p.name,p.position))).length },
    "3-site consensus": { board: boardFromScores(pool, consensusScores), matched: pool.length },
    _sources: { ffc: { url: ffc.url, sha256: ffc.sha256, bytes: ffc.bytes }, mflAdp: { url: mflAdp.url, sha256: mflAdp.sha256, bytes: mflAdp.bytes }, mflPlayers: { url: mflPlayers.url, sha256: mflPlayers.sha256, bytes: mflPlayers.bytes } },
  };
}
async function main() {
  const built = await robust.buildPool();
  const pool = built.pool;
  if (pool.length < 180) throw new Error(`Historical pool too small: ${pool.length}`);
  const sources = await sourceBoards(pool);
  const baseBoard = sources["FantasyData ADP"].board;
  const policy = JSON.parse(fs.readFileSync(path.join(root,"data","validation","draft-robust-policy.json"),"utf8")).policy;
  const samples = { SnapCount: [], "FantasyData ADP": [], "Fantasy Football Calculator": [], "MyFantasyLeague ADP": [], "3-site consensus": [] };
  for (const teams of [10,12]) for (const [bucket, slot] of [["early",1],["middle",Math.ceil(teams/2)],["late",teams]]) {
    const settings = core.cloneSettings({ teams, rounds: 16, scoring: "ppr", draftPosition: slot });
    for (let seed = 0; seed < 8; seed += 1) {
      const roomSeed = `site-benchmark:${SEASON}:${teams}:${bucket}:${seed}`;
      const context = draft.createRoomContext(pool, settings, baseBoard);
      const common = { players: pool, settings, userTeamId: slot, opponentStrategy: "mixed", board: baseBoard, context, seed: roomSeed };
      samples.SnapCount.push(realized(draft.simulateDraft({ ...common, userStrategy: "oracle", oraclePolicy: policy }).userRoster, settings));
      for (const name of Object.keys(samples).filter((name) => name !== "SnapCount")) samples[name].push(realized(draft.simulateDraft({ ...common, userStrategy: "site-board", userBoard: sources[name].board }).userRoster, settings));
    }
  }
  const rows = Object.entries(samples).map(([name, values]) => ({ name, drafts: values.length, meanRealizedStarterPoints: Number(mean(values).toFixed(2)), winRateVsSnapCount: name === "SnapCount" ? null : Number(values.filter((value,index) => value > samples.SnapCount[index]).length / values.length) })).sort((a,b) => b.meanRealizedStarterPoints - a.meanRealizedStarterPoints);
  const report = { version: "site-benchmark-2026.1", season: SEASON, methodology: "48 paired 10/12-team PPR drafts across early/middle/late slots; common CPU room strategy/seeds; realized weekly optimal-starter points; site rows use archived public ADP ordering only.", disclaimer: "Retrospective descriptive benchmark. Not a qualification gate or future-performance guarantee.", poolPlayers: pool.length, rows, sourceCoverage: Object.fromEntries(Object.entries(sources).filter(([name]) => !name.startsWith("_")).map(([name,row]) => [name,row.matched])), sources: { historicalPool: built.sources, ...sources._sources } };
  const output = path.join(root,"data","validation",`site-benchmark-${SEASON}.json`);
  fs.writeFileSync(output, `${JSON.stringify(report,null,2)}\n`);
  console.log(JSON.stringify(report,null,2));
}
if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

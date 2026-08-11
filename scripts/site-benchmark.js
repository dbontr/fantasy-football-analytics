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
const POSITION_BY_ID = { 1:"QB", 2:"RB", 3:"WR", 4:"TE", 5:"K", 16:"DST" };
const mean = (rows) => rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function key(name, position) { return `${intel.normalizeName(name)}|${String(position || "").toUpperCase()}`; }
function cleanHtml(value) { return String(value || "").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g," ").replace(/\s+/g," ").trim(); }
function realized(roster, settings) { let total = 0; const rows = roster.map((p) => ({ ...p, projectedPoints: p.actualWeekly.reduce((s,v) => s + Number(v || 0), 0), weeklyProjection: 0, weeklyProjections: p.actualWeekly })); for (let week = 1; week <= 17; week += 1) total += core.optimizeWeeklyLineup(rows, settings, week).total; return total; }
function boardFromScores(pool, scores) {
  const ranked = [...pool].sort((a,b) => {
    const ar = scores.get(key(a.name,a.position)); const br = scores.get(key(b.name,b.position));
    return (Number.isFinite(ar) ? ar : 10000 + Number(a.adp || 999)) - (Number.isFinite(br) ? br : 10000 + Number(b.adp || 999));
  });
  return draft.parseRankingBoard(`rank,name\n${ranked.map((p,i) => `${i+1},${String(p.name).replaceAll(',', '')}`).join("\n")}`);
}
async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "SnapCount historical benchmark" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { text: bytes.toString("utf8"), sha256: sha256(bytes), bytes: bytes.length, url };
}
function tableHtml(text, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text).match(new RegExp(`<table[^>]+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/table>`, "i"));
  if (!match) throw new Error(`Archived table ${id} was not found`);
  return match[1];
}
function archivedBoardScores(text, tableId, sourceColumn) {
  const table = tableHtml(text, tableId);
  const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((row) => cleanHtml(row[1]).replace(/\s*\(.*?\)\s*/g," ").trim());
  const sourceIndex = headers.findIndex((header) => header.toLowerCase() === sourceColumn.toLowerCase());
  if (sourceIndex < 0) throw new Error(`Column ${sourceColumn} missing from archived table`);
  const scores = new Map();
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const raw = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (!raw.length || raw.length <= sourceIndex) continue;
    const playerCell = raw.find((cell) => /player-name|full-name|data-name=/i.test(cell));
    const nameMatch = playerCell?.match(/class=["'][^"']*player-name[^"']*["'][^>]*>([\s\S]*?)<\/a>/i) || playerCell?.match(/class=["'][^"']*full-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || playerCell?.match(/data-name=["']([^"']+)["']/i);
    const name = cleanHtml(nameMatch?.[1]);
    const positionIndex = headers.findIndex((header) => /^pos$/i.test(header));
    const positionText = cleanHtml(raw[positionIndex] || "").toUpperCase();
    const position = positionText.replace(/\d.*$/, "");
    const rank = Number(cleanHtml(raw[sourceIndex]).replace(/[^0-9.]/g,""));
    if (name && ["QB","RB","WR","TE","K","DST"].includes(position) && Number.isFinite(rank) && rank > 0) scores.set(key(name, position), rank);
  }
  return scores;
}
function espnAdpScores(payload) {
  const scores = new Map();
  for (const wrapper of payload?.players || []) {
    const player = wrapper.player || {}; const position = POSITION_BY_ID[Number(player.defaultPositionId)];
    const adp = Number(player.ownership?.averageDraftPosition);
    if (position && player.fullName && Number.isFinite(adp) && adp > 0) scores.set(key(player.fullName, position), adp);
  }
  return scores;
}
async function sourceBoards(pool) {
  const espn = await hist.espnSeason(SEASON, 3);
  const yahoo = await fetchText("https://web.archive.org/web/20180626065718id_/https://www.fantasypros.com/nfl/adp/overall.php");
  const major = await fetchText("https://web.archive.org/web/20180802020109id_/https://www.fantasypros.com/nfl/adp/overall.php");
  const ecr = await fetchText("https://web.archive.org/web/20180906045130id_/https://www.fantasypros.com/nfl/rankings/consensus-cheatsheets.php");
  const scoreSets = {
    "ESPN ADP": espnAdpScores(espn.payload),
    "Yahoo ADP": archivedBoardScores(yahoo.text, "data", "Yahoo"),
    "CBS Sports ADP": archivedBoardScores(major.text, "data", "CBS"),
    "NFL.com ADP": archivedBoardScores(major.text, "data", "NFL"),
    "FantasyPros ECR": archivedBoardScores(ecr.text, "rank-data", "Rank"),
  };
  const notes = {
    "ESPN ADP": "ESPN · 2018 PPR historical ADP",
    "Yahoo ADP": "Yahoo · archived Jun 26, 2018",
    "CBS Sports ADP": "CBS · archived Aug 2, 2018",
    "NFL.com ADP": "NFL.com · archived Aug 2, 2018",
    "FantasyPros ECR": "FantasyPros consensus · archived Sep 6, 2018",
  };
  const boards = Object.fromEntries(Object.entries(scoreSets).map(([name, scores]) => [name, { board: boardFromScores(pool, scores), matched: pool.filter((p) => scores.has(key(p.name,p.position))).length, note: notes[name] }]));
  boards._sources = {
    espn: { url: espn.url, sha256: espn.sha256, bytes: espn.bytes.length, dateLabel: "2018 season" },
    yahoo: { url: yahoo.url, sha256: yahoo.sha256, bytes: yahoo.bytes, dateLabel: "2018-06-26" },
    cbsNfl: { url: major.url, sha256: major.sha256, bytes: major.bytes, dateLabel: "2018-08-02" },
    fantasyPros: { url: ecr.url, sha256: ecr.sha256, bytes: ecr.bytes, dateLabel: "2018-09-06" },
  };
  return boards;
}
async function main() {
  if (SEASON !== 2018) throw new Error("Big-platform benchmark currently has fixed archived source snapshots for the frozen 2018 holdout only.");
  const built = await robust.buildPool(); const pool = built.pool;
  if (pool.length < 180) throw new Error(`Historical pool too small: ${pool.length}`);
  const sources = await sourceBoards(pool);
  const marketScores = new Map(pool.map((player) => [key(player.name, player.position), Number(player.adp)]));
  const baseBoard = boardFromScores(pool, marketScores);
  const policy = JSON.parse(fs.readFileSync(path.join(root,"data","validation","draft-robust-policy.json"),"utf8")).policy;
  const names = ["ESPN ADP", "Yahoo ADP", "CBS Sports ADP", "NFL.com ADP", "FantasyPros ECR"];
  const samples = Object.fromEntries(["SnapCount", ...names].map((name) => [name, []]));
  for (const teams of [10,12]) for (const [bucket, slot] of [["early",1],["middle",Math.ceil(teams/2)],["late",teams]]) {
    const settings = core.cloneSettings({ teams, rounds: 16, scoring: "ppr", draftPosition: slot });
    for (let seed = 0; seed < 8; seed += 1) {
      const roomSeed = `site-benchmark:${SEASON}:${teams}:${bucket}:${seed}`;
      const context = draft.createRoomContext(pool, settings, baseBoard);
      const common = { players: pool, settings, userTeamId: slot, opponentStrategy: "mixed", board: baseBoard, context, seed: roomSeed };
      samples.SnapCount.push(realized(draft.simulateDraft({ ...common, userStrategy: "oracle", oraclePolicy: policy }).userRoster, settings));
      for (const name of names) samples[name].push(realized(draft.simulateDraft({ ...common, userStrategy: "site-board", userBoard: sources[name].board }).userRoster, settings));
    }
  }
  const rows = Object.entries(samples).map(([name, values]) => ({
    name, drafts: values.length, meanRealizedStarterPoints: Number(mean(values).toFixed(2)),
    winRateVsSnapCount: name === "SnapCount" ? null : Number(values.filter((value,index) => value > samples.SnapCount[index]).length / values.length),
    sourceNote: name === "SnapCount" ? "SnapCount qualified draft policy" : sources[name].note,
  })).sort((a,b) => b.meanRealizedStarterPoints - a.meanRealizedStarterPoints);
  const report = {
    version: "site-benchmark-2026.2", season: SEASON,
    methodology: "48 paired 10/12-team PPR drafts across early/middle/late slots; same CPU rooms and seeds; realized weekly optimal-starter points; only the user-side draft board changes.",
    disclaimer: "Retrospective descriptive benchmark. Platform snapshots use their available 2018 native draft-board formats and dates; this is not a qualification gate or future-performance guarantee.",
    poolPlayers: pool.length, rows,
    sourceCoverage: Object.fromEntries(names.map((name) => [name, sources[name].matched])),
    sources: { historicalPool: built.sources, ...sources._sources },
  };
  const output = path.join(root,"data","validation",`site-benchmark-${SEASON}.json`);
  fs.writeFileSync(output, `${JSON.stringify(report,null,2)}\n`);
  console.log(JSON.stringify(report,null,2));
}
if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

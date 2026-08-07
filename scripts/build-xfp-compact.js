"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const sources = require("../src/data/sources.js");

const root = path.resolve(__dirname, "..");
const season = Math.round(Number(process.argv[2] || 2025));
if (season < 2006 || season > 2100) throw new RangeError("Invalid ffopportunity season");

const url = `https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_${season}.csv`;
const outputDir = path.join(root, "data", "intelligence");
const output = path.join(outputDir, `xfp_weekly_${season}.csv.gz`);
const README = path.join(outputDir, "README.md");

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function main() {
  const response = await fetch(url, { headers: { "User-Agent": "fantasy-football-analytics" } });
  if (!response.ok) throw new Error(`ffopportunity returned HTTP ${response.status}`);
  const text = await response.text();
  const rows = sources.parseCsv(text);
  const fields = [
    "season", "posteam", "week", "player_id", "full_name", "position",
    "pass_attempt", "rec_attempt", "rush_attempt", "rec_air_yards",
    "pass_fantasy_points_exp", "rec_fantasy_points_exp", "rush_fantasy_points_exp",
    "pass_fantasy_points", "rec_fantasy_points", "rush_fantasy_points",
    "total_fantasy_points", "total_fantasy_points_exp", "total_fantasy_points_diff",
    "rec_attempt_team", "rush_attempt_team", "rec_air_yards_team",
  ];
  for (const field of fields) {
    if (!(field in (rows[0] || {}))) throw new Error(`ffopportunity field missing: ${field}`);
  }
  const filtered = rows.filter((row) => ["QB", "RB", "WR", "TE"].includes(String(row.position || "").toUpperCase()));
  const csv = [fields.join(","), ...filtered.map((row) => fields.map((field) => csvEscape(row[field])).join(","))].join("\n") + "\n";
  const gzip = zlib.gzipSync(Buffer.from(csv), { level: 9 });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(output, gzip);

  const meta = [
    "# Expected fantasy opportunity assets",
    "",
    `- \`xfp_weekly_${season}.csv.gz\`: compacted from ffverse/ffopportunity \`ep_weekly_${season}.csv\`.`,
    "- Source model: expected fantasy points trained from public nflverse play-by-play.",
    "- License: CC BY-SA 4.0 for the expected-points data/model output; preserve attribution.",
    "- The browser loads this archive only when player/decision intelligence needs prior-season opportunity quality.",
    "- Generated fields are a strict subset of the upstream weekly file; no model is retrained in the browser.",
    "",
  ].join("\n");
  fs.writeFileSync(README, meta, "utf8");
  console.log(JSON.stringify({
    season,
    sourceBytes: Buffer.byteLength(text),
    rows: filtered.length,
    compactBytes: Buffer.byteLength(csv),
    gzipBytes: gzip.byteLength,
    output: path.relative(root, output),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const sources = require("../src/data/sources.js");

const ROOT = path.resolve(__dirname, "..");
const SEASON = 2026;
const HISTORY_START = 2016;
const HISTORY_END = 2025;
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const HIT_PPG = Object.freeze({ QB: 14, RB: 10, WR: 9, TE: 7 });
const PLAYERS_URL = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";
const COMBINE_URL = "https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv";
const ESPN_DRAFT_URL = `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/draft?season=${SEASON}`;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function nullable(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}
function normalizeName(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/[^a-z0-9]/g, "");
}
function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function quantile(values, probability) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(probability, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(index), upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}
function ageOnDate(birthDate, target = `${SEASON}-09-01`) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const date = new Date(`${target}T00:00:00Z`);
  if (!Number.isFinite(birth.getTime())) return null;
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (date.getUTCMonth() < birth.getUTCMonth() || (date.getUTCMonth() === birth.getUTCMonth() && date.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}
function draftBucket(round, overall) {
  const pick = finite(overall, 0), selectedRound = finite(round, 0);
  if (!pick || !selectedRound) return "udfa";
  if (pick <= 12) return "top12";
  if (selectedRound === 1) return "round1";
  if (selectedRound <= 3) return "day2";
  if (selectedRound <= 5) return "round4_5";
  return "round6_7";
}
async function fetchText(url) {
  const response = await fetch(url, { headers: { Accept: "text/csv,text/plain,application/json,*/*" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}
async function fetchGzipCsv(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return sources.parseCsv(zlib.gunzipSync(buffer).toString("utf8"));
}
function attributeMap(athlete) {
  return Object.fromEntries((athlete?.attributes || []).map((row) => [row.name, nullable(row.displayValue ?? row.value)]));
}
function combineKey(name, position) {
  return `${normalizeName(name)}|${String(position || "").toUpperCase()}`;
}
function playerKey(name, position) {
  return combineKey(name, position);
}
function positionSummary(rows, position) {
  const selected = rows.filter((row) => row.position === position);
  const ppg = selected.map((row) => row.ppg);
  const late = selected.map((row) => row.lateLiftPct).filter(Number.isFinite);
  return {
    n: selected.length,
    meanPpg: average(ppg),
    p25: quantile(ppg, 0.25),
    p50: quantile(ppg, 0.5),
    p75: quantile(ppg, 0.75),
    p90: quantile(ppg, 0.9),
    hitRate: selected.length ? selected.filter((row) => row.ppg >= HIT_PPG[position]).length / selected.length : 0,
    lateLiftPct: late.length ? average(late) : 0,
  };
}
function buildCohorts(rows) {
  const cohorts = {};
  for (const position of FANTASY_POSITIONS) {
    const allBaseline = positionSummary(rows, position);
    const draftedBaseline = positionSummary(rows.filter((row) => row.bucket !== "udfa"), position);
    cohorts[position] = {
      all: { ...allBaseline, confidence: clamp(allBaseline.n / 220, 0.25, 0.82) },
      drafted: { ...draftedBaseline, confidence: clamp(draftedBaseline.n / 160, 0.25, 0.82) },
    };
    for (const bucket of ["top12", "round1", "day2", "round4_5", "round6_7", "udfa"]) {
      const selected = rows.filter((row) => row.position === position && row.bucket === bucket);
      if (!selected.length) continue;
      const raw = positionSummary(selected, position);
      const baseline = bucket === "udfa" ? allBaseline : draftedBaseline;
      const weight = raw.n / (raw.n + 12);
      cohorts[position][bucket] = {
        n: raw.n,
        meanPpg: raw.meanPpg * weight + baseline.meanPpg * (1 - weight),
        p25: raw.p25 * weight + baseline.p25 * (1 - weight),
        p50: raw.p50 * weight + baseline.p50 * (1 - weight),
        p75: raw.p75 * weight + baseline.p75 * (1 - weight),
        p90: raw.p90 * weight + baseline.p90 * (1 - weight),
        hitRate: raw.hitRate * weight + baseline.hitRate * (1 - weight),
        lateLiftPct: raw.lateLiftPct * weight + baseline.lateLiftPct * (1 - weight),
        confidence: clamp(0.28 + raw.n / 140, 0.28, 0.78),
      };
    }
  }
  return cohorts;
}
function percentile(value, distribution, lowerIsBetter = false) {
  if (!Number.isFinite(value) || distribution.length < 20) return null;
  const favorable = distribution.filter((row) => lowerIsBetter ? row >= value : row <= value).length;
  return clamp(favorable / distribution.length, 0.01, 0.99);
}
function athleticProfile(row, historicalCombine) {
  if (!row) return { measurements: {}, percentile: null, metrics: 0 };
  const position = String(row.pos || "").toUpperCase();
  const peers = historicalCombine.filter((peer) => String(peer.pos || "").toUpperCase() === position);
  const specs = [
    ["forty", true], ["vertical", false], ["broad_jump", false], ["cone", true], ["shuttle", true],
  ];
  const measurements = {};
  const scores = [];
  for (const [field, inverse] of specs) {
    const value = nullable(row[field]);
    if (!Number.isFinite(value)) continue;
    measurements[field] = value;
    const distribution = peers.map((peer) => nullable(peer[field])).filter(Number.isFinite);
    const score = percentile(value, distribution, inverse);
    if (Number.isFinite(score)) scores.push(score);
  }
  const height = String(row.ht || "").trim();
  const weight = nullable(row.wt);
  if (height) measurements.height = height;
  if (Number.isFinite(weight)) measurements.weight = weight;
  return {
    measurements,
    percentile: scores.length >= 2 ? average(scores) : null,
    metrics: scores.length,
  };
}

async function loadHistoricalRookieRows(allPlayers) {
  const years = Array.from({ length: HISTORY_END - HISTORY_START + 1 }, (_, index) => HISTORY_START + index);
  const [seasonRows, weeklyRows] = await Promise.all([
    Promise.all(years.map((year) => fetchGzipCsv(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${year}.csv.gz`))),
    Promise.all(years.map((year) => fetchGzipCsv(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv.gz`))),
  ]);
  const output = [];
  for (let offset = 0; offset < years.length; offset += 1) {
    const year = years[offset];
    const seasonById = new Map(seasonRows[offset].map((row) => [String(row.player_id || ""), row]));
    const weeklyById = new Map();
    for (const row of weeklyRows[offset]) {
      const id = String(row.player_id || "");
      if (!id) continue;
      if (!weeklyById.has(id)) weeklyById.set(id, []);
      weeklyById.get(id).push(row);
    }
    const rookies = allPlayers.filter((row) => Number(row.rookie_season) === year && FANTASY_POSITIONS.has(String(row.position || "").toUpperCase()));
    for (const rookie of rookies) {
      const id = String(rookie.gsis_id || "");
      const season = seasonById.get(id);
      const draftRound = nullable(rookie.draft_round), draftPick = nullable(rookie.draft_pick);
      const games = Math.max(0, finite(season?.games));
      const ppg = games > 0 ? Math.max(0, finite(season?.fantasy_points_ppr) / games) : 0;
      const weeks = weeklyById.get(id) || [];
      const early = weeks.filter((row) => finite(row.week) <= 8).map((row) => finite(row.fantasy_points_ppr));
      const late = weeks.filter((row) => finite(row.week) >= 9 && finite(row.week) <= 17).map((row) => finite(row.fantasy_points_ppr));
      const lateLiftPct = early.length >= 3 && late.length >= 3
        ? clamp((average(late) - average(early)) / Math.max(8, average(early)), -0.35, 0.55)
        : null;
      output.push({
        position: String(rookie.position).toUpperCase(),
        bucket: draftBucket(draftRound, draftPick),
        ppg,
        lateLiftPct,
      });
    }
  }
  return output;
}
async function main() {
  const bootstrap = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "players-lite.json"), "utf8"));
  const [playersText, combineText, draftText] = await Promise.all([
    fetchText(PLAYERS_URL),
    fetchText(COMBINE_URL),
    fetchText(ESPN_DRAFT_URL),
  ]);
  const allPlayers = sources.parseCsv(playersText);
  const combineRows = sources.parseCsv(combineText);
  const draft = JSON.parse(draftText);
  const historicalRookies = await loadHistoricalRookieRows(allPlayers);
  const cohorts = buildCohorts(historicalRookies);
  const historicalCombine = combineRows.filter((row) => Number(row.season) >= HISTORY_START && Number(row.season) <= HISTORY_END && FANTASY_POSITIONS.has(String(row.pos || "").toUpperCase()));
  const currentCombine = new Map(combineRows.filter((row) => Number(row.season) === SEASON).map((row) => [combineKey(row.player_name, row.pos), row]));
  const currentNflverse = allPlayers.filter((row) => Number(row.rookie_season) === SEASON && FANTASY_POSITIONS.has(String(row.position || "").toUpperCase()));
  const nflverseByEspn = new Map(currentNflverse.filter((row) => row.espn_id).map((row) => [String(row.espn_id), row]));
  const nflverseByName = new Map(currentNflverse.map((row) => [playerKey(row.display_name, row.position), row]));
  const draftByEspn = new Map();
  for (const pick of draft.picks || []) {
    const athlete = pick.athlete || {};
    if (!athlete.alternativeId) continue;
    const attrs = attributeMap(athlete);
    draftByEspn.set(String(athlete.alternativeId), {
      round: nullable(pick.round), overall: nullable(pick.overall),
      grade: attrs.grade, prospectOverallRank: attrs.overall, positionRank: attrs.rank,
    });
  }
  const rookies = [];
  for (const player of bootstrap.players || []) {
    if (!FANTASY_POSITIONS.has(String(player.position || "").toUpperCase())) continue;
    const nflverse = nflverseByEspn.get(String(player.id)) || nflverseByName.get(playerKey(player.name, player.position));
    const draftInfo = draftByEspn.get(String(player.id)) || null;
    if (!nflverse && !draftInfo) continue;
    const combine = athleticProfile(currentCombine.get(combineKey(player.name, player.position)), historicalCombine);
    const bucket = draftBucket(draftInfo?.round, draftInfo?.overall);
    const position = String(player.position).toUpperCase();
    const prior = cohorts[position]?.[bucket] || cohorts[position]?.all || null;
    rookies.push({
      id: String(player.id),
      name: player.name,
      position,
      team: player.team,
      birthDate: nflverse?.birth_date || null,
      age: ageOnDate(nflverse?.birth_date),
      college: nflverse?.college_name || null,
      yearsExperience: 0,
      draft: draftInfo ? { ...draftInfo, bucket } : { round: null, overall: null, grade: null, prospectOverallRank: null, positionRank: null, bucket },
      combine,
      prior: prior ? {
        sampleSize: prior.n,
        meanPpg: Number(prior.meanPpg.toFixed(3)),
        p25: Number(prior.p25.toFixed(3)),
        p50: Number(prior.p50.toFixed(3)),
        p75: Number(prior.p75.toFixed(3)),
        p90: Number(prior.p90.toFixed(3)),
        hitRate: Number(prior.hitRate.toFixed(4)),
        lateLiftPct: Number(prior.lateLiftPct.toFixed(4)),
        confidence: Number(prior.confidence.toFixed(4)),
      } : null,
    });
  }
  rookies.sort((a, b) => (bootstrap.players.find((row) => String(row.id) === a.id)?.pprRank || 9999) - (bootstrap.players.find((row) => String(row.id) === b.id)?.pprRank || 9999));
  const output = {
    meta: {
      season: SEASON,
      modelVersion: "rookie-cohort-2026.1",
      historicalSeasons: [HISTORY_START, HISTORY_END],
      fantasyPositions: [...FANTASY_POSITIONS],
      sources: [
        { name: "nflverse players", url: PLAYERS_URL, use: "rookie season, identity, birth date, college" },
        { name: "nflverse combine", url: COMBINE_URL, use: "structured measurements and historical athletic percentiles" },
        { name: "nflverse stats_player", url: "https://github.com/nflverse/nflverse-data/releases/tag/stats_player", use: "2016-2025 rookie fantasy outcomes and development" },
        { name: "ESPN 2026 NFL draft", url: ESPN_DRAFT_URL, use: "structured draft round/pick and prospect grade/rank; no analysis text" },
      ],
      policy: "Market projection remains the anchor. Cohort, age, athletic and depth/preseason signals are bounded and validation-gated.",
      rookieCount: rookies.length,
      historicalRookieCount: historicalRookies.length,
    },
    cohorts,
    players: rookies,
  };
  const target = path.join(ROOT, "data", `rookies-${SEASON}.json`);
  fs.writeFileSync(target, JSON.stringify(output));
  const bytes = fs.statSync(target).size;
  console.log(`Wrote ${path.relative(ROOT, target)}: ${rookies.length} rookies, ${historicalRookies.length} historical cohort rows, ${bytes} bytes.`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

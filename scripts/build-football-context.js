"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { nflverseAsset, parseCsv, provenance, root } = require("./lib/historical-data.js");

const SEASONS = [2023, 2024, 2025];
const WEIGHTS = { 2023: 0.2, 2024: 0.3, 2025: 0.5 };
const OUT = path.join(root, "data", "football-context-2026.json");
const CURRENT_COACHES = JSON.parse(fs.readFileSync(path.join(root, "data", "coaches-2026.json"), "utf8"));
const COLUMNS = [
  "game_id", "season_type", "week", "posteam", "defteam", "home_team", "away_team", "home_coach", "away_coach",
  "qtr", "down", "yardline_100", "score_differential", "wp", "play_type", "pass_attempt", "rush_attempt", "sack", "qb_hit",
  "yards_gained", "success", "air_yards", "complete_pass", "interception", "fumble_lost", "touchdown", "first_down",
  "no_huddle", "shotgun", "qb_scramble", "rusher_player_id", "rusher_player_name", "receiver_player_id", "receiver_player_name"
];

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const maybe = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const yes = (value) => n(value) === 1;
const rate = (a, b) => b > 0 ? a / b : null;
const round = (value, digits = 4) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const canonicalTeam = (value) => ({ LAR: "LA", STL: "LA", WSH: "WAS", JAC: "JAX", OAK: "LV", SD: "LAC" })[String(value || "").toUpperCase()] || String(value || "").toUpperCase();

function baseRecord() {
  return {
    games: new Set(), plays: 0, passes: 0, rushes: 0, earlyDownPlays: 0, earlyDownPasses: 0,
    neutralPlays: 0, neutralPasses: 0, redZonePlays: 0, redZonePasses: 0, noHuddle: 0, shotgun: 0,
    qbScrambles: 0, sacks: 0, qbHits: 0, passSuccess: 0, rushSuccess: 0, passYards: 0, rushYards: 0,
    explosivePasses: 0, explosiveRushes: 0, interceptions: 0, fumblesLost: 0, redZoneTds: 0,
    targets: new Map(), rushers: new Map(),
  };
}
function record(map, key) {
  if (!key) return null;
  if (!map.has(key)) map.set(key, baseRecord());
  return map.get(key);
}
function coachFor(row) {
  if (canonicalTeam(row.posteam) === canonicalTeam(row.home_team)) return row.home_coach || null;
  if (canonicalTeam(row.posteam) === canonicalTeam(row.away_team)) return row.away_coach || null;
  return null;
}
function addIdentity(map, id, name) {
  const key = String(id || name || "").trim();
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}
function concentration(map, top = 2) {
  const values = [...map.values()].sort((a, b) => b - a);
  const total = values.reduce((sum, value) => sum + value, 0);
  return total ? values.slice(0, top).reduce((sum, value) => sum + value, 0) / total : null;
}
function summarize(rec) {
  const games = rec.games.size;
  const dropbacks = rec.passes + rec.sacks;
  return {
    games,
    playsPerGame: round(rate(rec.plays, games), 3),
    passRate: round(rate(rec.passes, rec.passes + rec.rushes)),
    earlyDownPassRate: round(rate(rec.earlyDownPasses, rec.earlyDownPlays)),
    neutralPassRate: round(rate(rec.neutralPasses, rec.neutralPlays)),
    redZonePassRate: round(rate(rec.redZonePasses, rec.redZonePlays)),
    noHuddleRate: round(rate(rec.noHuddle, rec.plays)),
    shotgunRate: round(rate(rec.shotgun, rec.plays)),
    qbScrambleRate: round(rate(rec.qbScrambles, rec.rushes)),
    pressureRate: round(rate(rec.sacks + rec.qbHits, dropbacks)),
    sackRate: round(rate(rec.sacks, dropbacks)),
    passSuccessRate: round(rate(rec.passSuccess, rec.passes)),
    rushSuccessRate: round(rate(rec.rushSuccess, rec.rushes)),
    passYardsPerAttempt: round(rate(rec.passYards, rec.passes), 3),
    rushYardsPerAttempt: round(rate(rec.rushYards, rec.rushes), 3),
    explosivePassRate: round(rate(rec.explosivePasses, rec.passes)),
    explosiveRushRate: round(rate(rec.explosiveRushes, rec.rushes)),
    turnoverRate: round(rate(rec.interceptions + rec.fumblesLost, Math.max(1, rec.plays))),
    redZoneTdRate: round(rate(rec.redZoneTds, rec.redZonePlays)),
    topTwoTargetConcentration: round(concentration(rec.targets, 2)),
    topTwoRushConcentration: round(concentration(rec.rushers, 2)),
  };
}
function weightedMetric(seasons, field) {
  let total = 0, weight = 0;
  for (const season of SEASONS) {
    const value = seasons[season]?.[field];
    if (!Number.isFinite(value)) continue;
    total += value * WEIGHTS[season];
    weight += WEIGHTS[season];
  }
  return weight ? round(total / weight) : null;
}
function weightedProfile(seasons) {
  const fields = [
    "playsPerGame", "passRate", "earlyDownPassRate", "neutralPassRate", "redZonePassRate", "noHuddleRate", "shotgunRate", "qbScrambleRate",
    "pressureRate", "sackRate", "passSuccessRate", "rushSuccessRate", "passYardsPerAttempt", "rushYardsPerAttempt", "explosivePassRate", "explosiveRushRate",
    "turnoverRate", "redZoneTdRate", "topTwoTargetConcentration", "topTwoRushConcentration"
  ];
  return Object.fromEntries(fields.map((field) => [field, weightedMetric(seasons, field)]));
}

async function seasonProfile(season) {
  const asset = await nflverseAsset("pbp", `play_by_play_${season}.csv.gz`);
  const rows = parseCsv(zlib.gunzipSync(asset.bytes).toString("utf8"), COLUMNS);
  const offense = new Map(), defense = new Map(), coaches = new Map();
  for (const row of rows) {
    if (row.season_type !== "REG" || !row.posteam || !row.defteam) continue;
    const team = canonicalTeam(row.posteam), opponent = canonicalTeam(row.defteam);
    const off = record(offense, team), def = record(defense, opponent), coach = record(coaches, coachFor(row));
    for (const rec of [off, def, coach]) rec?.games.add(row.game_id);
    const pass = yes(row.pass_attempt) || row.play_type === "pass";
    const rush = yes(row.rush_attempt) || row.play_type === "run";
    if (!pass && !rush) continue;
    const down = n(row.down), yardline = maybe(row.yardline_100), wp = maybe(row.wp), differential = maybe(row.score_differential);
    const neutral = Number.isFinite(wp) ? wp >= 0.2 && wp <= 0.8 : Number.isFinite(differential) ? Math.abs(differential) <= 8 : false;
    const redZone = Number.isFinite(yardline) && yardline > 0 && yardline <= 20;
    for (const rec of [off, def, coach]) {
      if (!rec) continue;
      rec.plays += 1;
      if (pass) rec.passes += 1; else rec.rushes += 1;
      if (down === 1 || down === 2) { rec.earlyDownPlays += 1; if (pass) rec.earlyDownPasses += 1; }
      if (neutral) { rec.neutralPlays += 1; if (pass) rec.neutralPasses += 1; }
      if (redZone) { rec.redZonePlays += 1; if (pass) rec.redZonePasses += 1; if (yes(row.touchdown)) rec.redZoneTds += 1; }
      if (yes(row.no_huddle)) rec.noHuddle += 1;
      if (yes(row.shotgun)) rec.shotgun += 1;
      if (yes(row.qb_scramble)) rec.qbScrambles += 1;
      if (yes(row.sack)) rec.sacks += 1;
      if (yes(row.qb_hit)) rec.qbHits += 1;
      if (pass) { rec.passSuccess += yes(row.success) ? 1 : 0; rec.passYards += Math.max(0, n(row.yards_gained)); if (n(row.yards_gained) >= 15) rec.explosivePasses += 1; }
      if (rush) { rec.rushSuccess += yes(row.success) ? 1 : 0; rec.rushYards += Math.max(0, n(row.yards_gained)); if (n(row.yards_gained) >= 10) rec.explosiveRushes += 1; }
      if (yes(row.interception)) rec.interceptions += 1;
      if (yes(row.fumble_lost)) rec.fumblesLost += 1;
    }
    if (pass) for (const rec of [off, coach]) if (rec) addIdentity(rec.targets, row.receiver_player_id, row.receiver_player_name);
    if (rush) for (const rec of [off, coach]) if (rec) addIdentity(rec.rushers, row.rusher_player_id, row.rusher_player_name);
  }
  return { season, asset, offense, defense, coaches };
}

async function main() {
  const seasons = [];
  for (const season of SEASONS) {
    console.log(`Loading ${season} football context...`);
    seasons.push(await seasonProfile(season));
  }
  const teams = {}, defenses = {}, coaches = {};
  for (const result of seasons) {
    for (const [team, rec] of result.offense) { teams[team] ||= { seasons: {} }; teams[team].seasons[result.season] = summarize(rec); }
    for (const [team, rec] of result.defense) { defenses[team] ||= { seasons: {} }; defenses[team].seasons[result.season] = summarize(rec); }
    for (const [name, rec] of result.coaches) { coaches[name] ||= { seasons: {} }; coaches[name].seasons[result.season] = summarize(rec); }
  }
  for (const entry of Object.values(teams)) entry.weighted = weightedProfile(entry.seasons);
  for (const entry of Object.values(defenses)) entry.weighted = weightedProfile(entry.seasons);
  for (const entry of Object.values(coaches)) entry.weighted = weightedProfile(entry.seasons);
  const current = {};
  for (const [team, profile] of Object.entries(CURRENT_COACHES.teams || {})) current[team] = {
    headCoach: profile.headCoach || null,
    offensiveCoordinator: profile.offensiveCoordinator || null,
    playCaller: profile.offensivePlayCaller || profile.offensiveCoordinator || profile.headCoach || null,
    scheme: profile.schemeLabel || null,
    archetype: profile.archetype || null,
    newStaff: Boolean(profile.newStaff),
    confidence: profile.confidence ?? null,
    statedTendencies: profile.offense || null,
    teamHistory: teams[team]?.weighted || null,
    headCoachHistory: profile.headCoach ? coaches[profile.headCoach]?.weighted || null : null,
    playCallerHistory: profile.offensivePlayCaller ? coaches[profile.offensivePlayCaller]?.weighted || null : null,
  };
  const output = {
    meta: {
      version: "snapcount-football-context-2026.1",
      builtAt: new Date().toISOString(), seasons: SEASONS, weights: WEIGHTS,
      source: "nflverse play-by-play + SnapCount current staff map",
      policy: "Descriptive football context. New mean effects remain shadow-only until walk-forward or prospective admission; existing separately-qualified matchup effects are unchanged.",
      provenance: provenance(seasons.map((row) => row.asset)),
    },
    teams, defenses, coaches, current,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${OUT}: ${Object.keys(teams).length} offenses, ${Object.keys(defenses).length} defenses, ${Object.keys(coaches).length} coach histories`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
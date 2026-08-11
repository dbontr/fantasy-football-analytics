"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { nflverseAsset, parseCsv, provenance, root } = require("./lib/historical-data.js");

const SEASONS = [2023, 2024, 2025];
const WEIGHTS = { 2023: 0.2, 2024: 0.3, 2025: 0.5 };
const OUT = path.join(root, "data", "special-teams-2026.json");
const COACHES = JSON.parse(fs.readFileSync(path.join(root, "data", "coaches-2026.json"), "utf8"));
const COLUMNS = [
  "game_id", "season_type", "posteam", "defteam", "home_team", "away_team", "home_coach", "away_coach",
  "drive", "down", "yardline_100", "ydstogo", "play_type", "field_goal_attempt", "field_goal_result",
  "kick_distance", "kicker_player_id", "kicker_player_name", "punt_attempt", "sack", "qb_hit", "interception",
  "fumble_lost", "touchdown", "return_touchdown"
];

const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const yes = (v) => n(v) === 1;
const rate = (a, b) => b > 0 ? a / b : null;
const round = (v, digits = 4) => Number.isFinite(v) ? Number(v.toFixed(digits)) : null;

function record(map, key) {
  if (!key) return null;
  if (!map.has(key)) map.set(key, {
    games: new Set(), fourthDecisions: 0, fourthGoes: 0, fourthFieldGoals: 0, fourthPunts: 0,
    fgAttempts: 0, fgMakes: 0, fg50Attempts: 0, fg50Makes: 0, fg60Attempts: 0, fg60Makes: 0,
    sacks: 0, qbHits: 0, interceptions: 0, fumblesLost: 0, returnTds: 0,
    drives40: 0, drives20: 0, drives40Fg: 0, drives20Fg: 0, drives40Td: 0, drives20Td: 0,
  });
  return map.get(key);
}

function coachFor(row) {
  if (row.posteam === row.home_team) return row.home_coach || null;
  if (row.posteam === row.away_team) return row.away_coach || null;
  return null;
}

function distanceBucket(distance) {
  if (distance >= 60) return "60+";
  if (distance >= 50) return "50-59";
  if (distance >= 40) return "40-49";
  return "0-39";
}

function kickerRecord(map, key, row) {
  if (!key) return null;
  if (!map.has(key)) map.set(key, { id: row.kicker_player_id || null, name: row.kicker_player_name || key, teams: {}, attempts: 0, makes: 0, byDistance: {} });
  return map.get(key);
}

function summarize(rec) {
  const games = rec.games?.size || 0;
  return {
    games,
    fourthDownDecisionCount: rec.fourthDecisions,
    fourthDownGoRate: round(rate(rec.fourthGoes, rec.fourthDecisions)),
    fourthDownFieldGoalRate: round(rate(rec.fourthFieldGoals, rec.fourthDecisions)),
    fourthDownPuntRate: round(rate(rec.fourthPunts, rec.fourthDecisions)),
    fgAttemptsPerGame: round(rate(rec.fgAttempts, games), 3),
    fgAccuracy: round(rate(rec.fgMakes, rec.fgAttempts)),
    fg50AttemptsPerGame: round(rate(rec.fg50Attempts, games), 3),
    fg50Accuracy: round(rate(rec.fg50Makes, rec.fg50Attempts)),
    fg60Attempts: rec.fg60Attempts,
    fg60Accuracy: round(rate(rec.fg60Makes, rec.fg60Attempts)),
    kickableDriveFgRate: round(rate(rec.drives40Fg, rec.drives40)),
    redZoneDriveFgRate: round(rate(rec.drives20Fg, rec.drives20)),
    redZoneDriveTdRate: round(rate(rec.drives20Td, rec.drives20)),
    sacksPerGame: round(rate(rec.sacks, games), 3),
    qbHitsPerGame: round(rate(rec.qbHits, games), 3),
    interceptionsPerGame: round(rate(rec.interceptions, games), 3),
    fumblesLostPerGame: round(rate(rec.fumblesLost, games), 3),
    takeawaysPerGame: round(rate(rec.interceptions + rec.fumblesLost, games), 3),
    returnTdsPerGame: round(rate(rec.returnTds, games), 3),
  };
}

function weightedSeasonMetric(seasons, field) {
  let total = 0, weight = 0;
  for (const season of SEASONS) {
    const value = seasons[season]?.[field];
    if (!Number.isFinite(value)) continue;
    total += value * WEIGHTS[season]; weight += WEIGHTS[season];
  }
  return weight ? round(total / weight) : null;
}

async function seasonProfile(season) {
  const asset = await nflverseAsset("pbp", `play_by_play_${season}.csv.gz`);
  const text = zlib.gunzipSync(asset.bytes).toString("utf8");
  const rows = parseCsv(text, COLUMNS);
  const offense = new Map(), defense = new Map(), coaches = new Map(), kickers = new Map(), drives = new Map();
  for (const row of rows) {
    if (row.season_type !== "REG" || !row.posteam) continue;
    const off = record(offense, row.posteam); const def = record(defense, row.defteam); const coach = record(coaches, coachFor(row));
    off?.games.add(row.game_id); def?.games.add(row.game_id); coach?.games.add(row.game_id);
    const down = n(row.down), yardline = n(row.yardline_100), toGo = n(row.ydstogo), type = row.play_type;
    const decision = down === 4 && yardline >= 20 && yardline <= 60 && toGo > 0 && toGo <= 10 && ["run", "pass", "field_goal", "punt"].includes(type);
    if (decision) for (const rec of [off, coach]) if (rec) {
      rec.fourthDecisions += 1;
      if (type === "run" || type === "pass") rec.fourthGoes += 1;
      else if (type === "field_goal") rec.fourthFieldGoals += 1;
      else if (type === "punt") rec.fourthPunts += 1;
    }
    if (yes(row.field_goal_attempt)) {
      const made = row.field_goal_result === "made", distance = n(row.kick_distance);
      for (const rec of [off, coach]) if (rec) {
        rec.fgAttempts += 1; if (made) rec.fgMakes += 1;
        if (distance >= 50) { rec.fg50Attempts += 1; if (made) rec.fg50Makes += 1; }
        if (distance >= 60) { rec.fg60Attempts += 1; if (made) rec.fg60Makes += 1; }
      }
      const key = row.kicker_player_id || `${row.posteam}|${row.kicker_player_name}`;
      const kicker = kickerRecord(kickers, key, row); const bucket = distanceBucket(distance);
      kicker.attempts += 1; if (made) kicker.makes += 1; kicker.teams[row.posteam] = (kicker.teams[row.posteam] || 0) + 1;
      kicker.byDistance[bucket] ||= { attempts: 0, makes: 0 }; kicker.byDistance[bucket].attempts += 1; if (made) kicker.byDistance[bucket].makes += 1;
    }
    if (def) {
      if (yes(row.sack)) def.sacks += 1;
      if (yes(row.qb_hit)) def.qbHits += 1;
      if (yes(row.interception)) def.interceptions += 1;
      if (yes(row.fumble_lost)) def.fumblesLost += 1;
      if (yes(row.return_touchdown)) def.returnTds += 1;
    }
    if (off) {
      if (yes(row.sack)) off.sacks += 1;
      if (yes(row.qb_hit)) off.qbHits += 1;
      if (yes(row.interception)) off.interceptions += 1;
      if (yes(row.fumble_lost)) off.fumblesLost += 1;
    }
    if (row.drive) {
      const driveKey = `${row.game_id}|${row.posteam}|${row.drive}`;
      if (!drives.has(driveKey)) drives.set(driveKey, { team: row.posteam, coach: coachFor(row), entered40: false, entered20: false, fg: false, td: false });
      const drive = drives.get(driveKey);
      if (yardline > 0 && yardline <= 40) drive.entered40 = true;
      if (yardline > 0 && yardline <= 20) drive.entered20 = true;
      if (yes(row.field_goal_attempt)) drive.fg = true;
      if (yes(row.touchdown)) drive.td = true;
    }
  }
  for (const drive of drives.values()) for (const rec of [record(offense, drive.team), record(coaches, drive.coach)]) if (rec) {
    if (drive.entered40) { rec.drives40 += 1; if (drive.fg) rec.drives40Fg += 1; if (drive.td) rec.drives40Td += 1; }
    if (drive.entered20) { rec.drives20 += 1; if (drive.fg) rec.drives20Fg += 1; if (drive.td) rec.drives20Td += 1; }
  }
  return { season, asset, offense, defense, coaches, kickers };
}

function summarizeKicker(rec) {
  const byDistance = {};
  for (const [bucket, values] of Object.entries(rec.byDistance || {})) byDistance[bucket] = {
    attempts: values.attempts,
    makes: values.makes,
    accuracy: round(rate(values.makes, values.attempts)),
  };
  const primaryTeam = Object.entries(rec.teams || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { id: rec.id, name: rec.name, team: primaryTeam, attempts: rec.attempts, makes: rec.makes, accuracy: round(rate(rec.makes, rec.attempts)), byDistance };
}

function weightedProfile(seasonMap) {
  const fields = [
    "fourthDownGoRate", "fourthDownFieldGoalRate", "fourthDownPuntRate", "fgAttemptsPerGame", "fgAccuracy",
    "fg50AttemptsPerGame", "fg50Accuracy", "kickableDriveFgRate", "redZoneDriveFgRate", "redZoneDriveTdRate",
    "sacksPerGame", "qbHitsPerGame", "interceptionsPerGame", "fumblesLostPerGame", "takeawaysPerGame", "returnTdsPerGame"
  ];
  return Object.fromEntries(fields.map((field) => [field, weightedSeasonMetric(seasonMap, field)]));
}

async function main() {
  const seasonResults = [];
  for (const season of SEASONS) {
    console.log(`Loading ${season} nflverse play-by-play...`);
    seasonResults.push(await seasonProfile(season));
  }
  const teams = {}, coachHistory = {}, kickerHistory = {}, defenses = {}, offenses = {};
  for (const result of seasonResults) {
    for (const [team, rec] of result.offense) { teams[team] ||= { seasons: {} }; teams[team].seasons[result.season] = summarize(rec); offenses[team] ||= { seasons: {} }; offenses[team].seasons[result.season] = summarize(rec); }
    for (const [team, rec] of result.defense) { defenses[team] ||= { seasons: {} }; defenses[team].seasons[result.season] = summarize(rec); }
    for (const [coach, rec] of result.coaches) { coachHistory[coach] ||= { seasons: {} }; coachHistory[coach].seasons[result.season] = summarize(rec); }
    for (const [id, rec] of result.kickers) { kickerHistory[id] ||= { seasons: {} }; kickerHistory[id].seasons[result.season] = summarizeKicker(rec); }
  }
  for (const [team, entry] of Object.entries(teams)) {
    entry.weighted = weightedProfile(entry.seasons);
    const coachName = COACHES.teams?.[team]?.headCoach || null;
    const coach = coachName ? coachHistory[coachName] : null;
    entry.currentHeadCoach = coachName;
    entry.currentCoachHistory = coach ? { seasons: coach.seasons, weighted: weightedProfile(coach.seasons) } : null;
  }
  for (const entry of Object.values(defenses)) entry.weighted = weightedProfile(entry.seasons);
  for (const entry of Object.values(offenses)) entry.weighted = weightedProfile(entry.seasons);

  const output = {
    meta: {
      version: "snapcount-special-teams-2026.1",
      builtAt: new Date().toISOString(),
      seasons: SEASONS,
      weights: WEIGHTS,
      source: "nflverse play-by-play",
      sourceNotice: "Historical interaction context only. Direct forecast effects require a separate walk-forward admission gate.",
      provenance: provenance(seasonResults.map((row) => row.asset)),
    },
    teams,
    defenses,
    offenses,
    coaches: Object.fromEntries(Object.entries(coachHistory).map(([name, entry]) => [name, { seasons: entry.seasons, weighted: weightedProfile(entry.seasons) }])),
    kickers: kickerHistory,
  };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUT} (${Object.keys(teams).length} teams, ${Object.keys(kickerHistory).length} kickers, ${Object.keys(coachHistory).length} coaches)`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

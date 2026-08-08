"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sourceTools = require("../src/data/sources.js");

const root = path.resolve(__dirname, "..");
const datasetPath = path.join(root, "data", "players-lite.json");
const ESPN_PPR_DEFAULT = 3;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
}
function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function scoringPoints(item, scoring = "ppr") {
  const total = finite(item?.appliedTotal);
  if (scoring !== "standard") return total;
  const receptions = finite(item?.stats?.["53"]);
  return Math.max(0, total - receptions);
}
function seasonTotal(stats, season, sourceId, scoring = "ppr") {
  const row = (stats || []).find((item) => Number(item.seasonId) === season
    && Number(item.scoringPeriodId) === 0
    && Number(item.statSourceId) === sourceId
    && Number(item.statSplitTypeId) === 0);
  return row ? scoringPoints(row, scoring) : 0;
}
function weeklyProjectionArray(stats, season, scoring = "ppr") {
  const weekly = Array.from({ length: 18 }, () => 0);
  for (const item of stats || []) {
    const week = Number(item.scoringPeriodId);
    if (Number(item.seasonId) === season && Number(item.statSourceId) === 1
      && Number(item.statSplitTypeId) === 1 && week >= 1 && week <= 18) {
      weekly[week - 1] = round(scoringPoints(item, scoring));
    }
  }
  return weekly;
}
function injuryRisk(status) {
  const text = String(status || "ACTIVE").toUpperCase();
  if (text.includes("OUT") || text.includes("IR")) return 0.92;
  if (text.includes("DOUBTFUL")) return 0.72;
  if (text.includes("QUESTIONABLE")) return 0.38;
  if (text.includes("SUSPENSION")) return 0.55;
  return 0.08;
}
function projectionRange(position, weeklyValues, risk, previous, projection) {
  const activeWeeks = weeklyValues.filter((value) => value > 0);
  const weeklyMean = activeWeeks.length ? mean(activeWeeks) : projection / 17;
  const baseVolatility = ({ QB: 0.28, RB: 0.42, WR: 0.48, TE: 0.50, K: 0.45, DST: 0.55 })[position] || 0.45;
  const priorGap = previous > 0 ? Math.abs(projection - previous) / Math.max(1, previous) : 0.35;
  const deviation = Math.max(standardDeviation(activeWeeks), weeklyMean * baseVolatility * (0.8 + risk * 0.55 + Math.min(0.35, priorGap) * 0.45));
  return { weeklyMean: round(weeklyMean), projectionStdDev: round(deviation), floorProjection: round(Math.max(0, weeklyMean - deviation)), ceilingProjection: round(weeklyMean + deviation * 1.45), reliability: round(Math.max(0.3, Math.min(0.97, 0.94 - risk * 0.48 - Math.min(0.28, priorGap * 0.22) - (previous <= 0 ? 0.12 : 0))), 3) };
}

async function fetchEspnPlayers(season) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/${ESPN_PPR_DEFAULT}?view=kona_player_info`;
  const filter = { players: { limit: 700, sortPercOwned: { sortPriority: 1, sortAsc: false } } };
  const response = await fetch(url, { headers: { "x-fantasy-filter": JSON.stringify(filter), "user-agent": "SnapCount-PPR-baseline-refresh/1.0" } });
  if (!response.ok) throw new Error(`ESPN PPR snapshot returned HTTP ${response.status}`);
  const text = await response.text();
  return { url, text, payload: JSON.parse(text), sha256: crypto.createHash("sha256").update(text).digest("hex") };
}
async function fetchSnapShares(season) {
  const url = `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;
  const response = await fetch(url, { headers: { "user-agent": "SnapCount-PPR-baseline-refresh/1.0" } });
  if (!response.ok) throw new Error(`nflverse snap counts returned HTTP ${response.status}`);
  const text = await response.text();
  const groups = new Map();
  for (const row of sourceTools.parseCsv(text)) {
    const position = String(row.position || "").toUpperCase();
    if (row.game_type !== "REG" || !["RB", "WR", "TE"].includes(position)) continue;
    const share = Number(row.offense_pct);
    if (!Number.isFinite(share)) continue;
    const key = `${sourceTools.normalizeName(row.player)}|${position}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ week: Number(row.week), share });
  }
  const shares = new Map();
  for (const [key, values] of groups) {
    const recent = values.sort((a, b) => a.week - b.week).slice(-5);
    let numerator = 0, denominator = 0;
    recent.forEach((row, index) => { const weight = index + 1; numerator += row.share * weight; denominator += weight; });
    if (denominator) shares.set(key, numerator / denominator);
  }
  return { url, shares, sha256: crypto.createHash("sha256").update(text).digest("hex") };
}
function rank(player, type) {
  const value = Number(player?.draftRanksByRankType?.[type]?.rank);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function main() {
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  const season = Number(dataset.meta?.season || 2026);
  const [fetched, snaps] = await Promise.all([fetchEspnPlayers(season), fetchSnapShares(season - 1)]);
  const byId = new Map((fetched.payload.players || []).map((wrapper) => [String(wrapper.player?.id || wrapper.id), wrapper.player]));
  let matched = 0;
  const players = dataset.players.map((existing) => {
    const player = byId.get(String(existing.id));
    if (!player) return existing;
    matched += 1;
    const projected = seasonTotal(player.stats, season, 1, "ppr");
    const standardProjected = seasonTotal(player.stats, season, 1, "standard");
    const previous = seasonTotal(player.stats, season - 1, 0, "ppr");
    const weeklyProjections = weeklyProjectionArray(player.stats, season, "ppr");
    const standardWeeklyProjections = weeklyProjectionArray(player.stats, season, "standard");
    const risk = injuryRisk(player.injuryStatus || existing.injuryStatus);
    const projection = projected > 0 ? projected : Math.max(0, previous * 0.92);
    const standardProjection = standardProjected > 0 ? standardProjected : projection;
    const range = projectionRange(existing.position, weeklyProjections, risk, previous, projection);
    const standardPositive = standardWeeklyProjections.filter((value) => value > 0);
    const standardWeeklyProjection = standardPositive.length ? mean(standardPositive) : standardProjection / 17;
    const ownership = player.ownership || {};
    const adp = finite(ownership.averageDraftPosition, 999);
    const snapKey = `${sourceTools.normalizeName(existing.name)}|${String(existing.position || "").toUpperCase()}`;
    const snapShare = snaps.shares.get(snapKey);
    return {
      ...existing,
      projectedPoints: round(projection), weeklyProjection: range.weeklyMean, weeklyProjections,
      standardProjectedPoints: round(standardProjection), standardWeeklyProjection: round(standardWeeklyProjection), standardWeeklyProjections,
      previousPoints: round(previous), floorProjection: range.floorProjection, ceilingProjection: range.ceilingProjection,
      projectionStdDev: range.projectionStdDev, reliability: range.reliability,
      adp: adp < 900 ? round(adp) : null, adpTrend: round(ownership.averageDraftPositionPercentChange),
      auctionValue: round(ownership.auctionValueAverage), auctionTrend: round(ownership.auctionValueAverageChange),
      activityLevel: round(ownership.activityLevel), percentOwned: round(ownership.percentOwned), percentStarted: round(ownership.percentStarted),
      pprRank: rank(player, "PPR"), standardRank: rank(player, "STANDARD"), superflexRank: rank(player, "SUPERFLEX"),
      opportunity: { ...existing.opportunity, ...(Number.isFinite(snapShare) ? { snapShare: round(snapShare, 4) } : {}) },
      injuryStatus: String(player.injuryStatus || existing.injuryStatus || "ACTIVE"), injuryRisk: risk, active: player.active !== false,
    };
  });

  if (matched < 650) throw new Error(`Only matched ${matched}/700 ESPN players; refusing to rewrite baseline`);
  const output = {
    ...dataset,
    meta: {
      ...dataset.meta,
      generatedFrom: "SnapCount PPR baseline refresh + existing opportunity artifacts",
      scoringBaseline: "PPR",
      espnLeagueDefault: ESPN_PPR_DEFAULT,
      espnSnapshotSha256: fetched.sha256,
      espnSnapshotUrl: fetched.url,
      snapCountsSha256: snaps.sha256,
      snapCountsUrl: snaps.url,
      refreshedAt: new Date().toISOString(),
      sources: [
        "ESPN Fantasy public PPR player snapshot (league default 3)",
        `nflverse ${season - 1} offensive snap counts (role prior)`,
        "nflverse weekly player statistics and identifiers (opportunity model)",
      ],
    },
    players,
  };
  fs.writeFileSync(datasetPath, JSON.stringify(output));
  console.log(`Refreshed ${matched}/${dataset.players.length} players from ESPN PPR default ${ESPN_PPR_DEFAULT}.`);
  console.log(`Snapshot SHA-256: ${fetched.sha256}`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

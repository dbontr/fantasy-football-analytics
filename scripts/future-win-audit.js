"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const core = require("../src/engine/core.js");
const engine = require("../src/engine/runtime.js");
const calibration = require("../src/engine/calibration.js");
const intelligence = require("../src/engine/intelligence.js");

calibration.install(engine, intelligence);

const root = path.resolve(__dirname, "..");
const validationDir = path.join(root, "data", "validation");
const datasetPath = path.join(validationDir, "historical-ppr-2020-2025.json.gz");
const outputPath = path.join(validationDir, "future-win-audit.json");
const VERIFY = process.argv.includes("--verify");
const SEASON = 2025;
const TEAM_COUNT = 10;
const REGULAR_SEASON_END = 14;
const SCENARIOS = 1200;
const ALLOWED = new Set(["QB", "RB", "WR", "TE"]);
const QUOTAS = { QB: 2, RB: 5, WR: 6, TE: 2 };
const SETTINGS = { slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 0, DST: 0, K: 0, BN: 8 } };

function snakeTeamForPick(pick, teams) {
  const round = Math.floor((pick - 1) / teams);
  const index = (pick - 1) % teams;
  return round % 2 === 0 ? index : teams - 1 - index;
}

function buildRosters(players) {
  const available = [...players]
    .filter((player) => ALLOWED.has(player.position) && Number.isFinite(Number(player.adp)))
    .sort((a, b) => Number(a.adp) - Number(b.adp) || Number(a.pprRank || 9999) - Number(b.pprRank || 9999));
  const rosters = Array.from({ length: TEAM_COUNT }, () => []);
  const counts = Array.from({ length: TEAM_COUNT }, () => ({ QB: 0, RB: 0, WR: 0, TE: 0 }));
  const drafted = new Set();
  for (let pick = 1; pick <= TEAM_COUNT * 15; pick += 1) {
    const team = snakeTeamForPick(pick, TEAM_COUNT);
    const choice = available.find((player) => !drafted.has(String(player.id)) && counts[team][player.position] < QUOTAS[player.position]);
    if (!choice) break;
    drafted.add(String(choice.id));
    rosters[team].push(choice);
    counts[team][choice.position] += 1;
  }
  return rosters;
}

function roundRobin(teamIds, week) {
  const teams = [...teamIds];
  if (teams.length % 2) teams.push(null);
  const fixed = teams[0], rotating = teams.slice(1);
  const round = (week - 1) % (teams.length - 1);
  for (let index = 0; index < round; index += 1) rotating.unshift(rotating.pop());
  const ordered = [fixed, ...rotating], pairs = [];
  for (let index = 0; index < ordered.length / 2; index += 1) {
    const left = ordered[index], right = ordered[ordered.length - 1 - index];
    if (left != null && right != null) pairs.push([left, right]);
  }
  return pairs;
}

function weekPlayer(player, week) {
  const baseline = Math.max(0, Number(player.weekly?.[week - 1] || 0));
  return {
    id: String(player.id), name: player.name, position: player.position, team: player.team,
    weeklyProjection: baseline,
    weeklyProjections: (player.weekly || []).map((value) => Math.max(0, Number(value || 0))),
    projectedPoints: Math.max(0, Number(player.seasonProjection || baseline * 17)),
    projectionSource: "espn-live-ppr",
    probabilityActive: baseline > 0 ? 0.96 : 0,
    reliability: 0.82,
    percentOwned: 90,
    pprRank: Number(player.pprRank || 9999),
    adp: Number(player.adp || 9999),
  };
}

function actualLineupScore(starterIds, draftById, week) {
  let total = 0;
  for (const id of starterIds || []) {
    const player = draftById.get(String(id));
    total += Math.max(0, Number(player?.actualWeekly?.[week - 1] || 0));
  }
  return total;
}

function baselineLineup(roster) {
  const lineup = core.optimizeLineup(roster, SETTINGS, "weeklyProjection");
  return lineup.starters.filter((row) => row.player).map((row) => String(row.player.id));
}

function credit(left, right) {
  if (Math.abs(left - right) <= 1e-9) return 0.5;
  return left > right ? 1 : 0;
}

function buildNflSchedule(rows) {
  const schedule = {};
  for (const row of rows) {
    if (Number(row.season) !== SEASON || !row.team || !row.opponent) continue;
    const week = Number(row.week);
    if (!schedule[week]) schedule[week] = [];
    const pair = [String(row.team), String(row.opponent)].sort();
    const key = pair.join("|");
    if (!schedule[week].some((game) => [game.homeTeam, game.awayTeam].sort().join("|") === key)) {
      schedule[week].push({ homeTeam: pair[0], awayTeam: pair[1] });
    }
  }
  return schedule;
}

function main() {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(datasetPath)));
  const draft = data.drafts?.[String(SEASON)] || [];
  const draftById = new Map(draft.map((player) => [String(player.id), player]));
  const rosters = buildRosters(draft);
  if (rosters.some((roster) => roster.length < 14)) throw new Error("Historical synthetic draft did not fill enough roster slots");
  const nflSchedule = buildNflSchedule(data.weeks || []);
  const results = [];

  for (let week = 1; week <= REGULAR_SEASON_END; week += 1) {
    const weeklyRosters = rosters.map((roster) => roster.map((player) => weekPlayer(player, week)));
    for (const [leftIndex, rightIndex] of roundRobin(rosters.map((_, index) => index), week)) {
      for (const [userIndex, opponentIndex] of [[leftIndex, rightIndex], [rightIndex, leftIndex]]) {
        const userRoster = weeklyRosters[userIndex], opponentRoster = weeklyRosters[opponentIndex];
        const baselineIds = baselineLineup(userRoster);
        const opponentIds = baselineLineup(opponentRoster);
        const evaluation = engine.evaluateMatchupLineups({
          userRoster,
          opponentRoster,
          settings: SETTINGS,
          week,
          schedule: nflSchedule,
          scenarios: SCENARIOS,
          validatedMeanScale: 0,
          seed: `future-win-audit-${SEASON}-${week}-${userIndex}-${opponentIndex}`,
        });
        const preferredIds = evaluation.winProbabilityGain95?.[0] > 0 ? evaluation.preferred.starterIds : baselineIds;
        const opponentActual = actualLineupScore(opponentIds, draftById, week);
        const baselineActual = actualLineupScore(baselineIds, draftById, week);
        const preferredActual = actualLineupScore(preferredIds, draftById, week);
        results.push({
          week, team: userIndex + 1, opponent: opponentIndex + 1,
          changed: [...preferredIds].sort().join("|") !== [...baselineIds].sort().join("|"),
          modelWinProbabilityGain: evaluation.winProbabilityGain,
          modelWinProbabilityGain95: evaluation.winProbabilityGain95,
          baselineCredit: credit(baselineActual, opponentActual),
          preferredCredit: credit(preferredActual, opponentActual),
          baselineActual, preferredActual, opponentActual,
        });
      }
    }
  }
  const baselineCredits = results.reduce((sum, row) => sum + row.baselineCredit, 0);
  const preferredCredits = results.reduce((sum, row) => sum + row.preferredCredit, 0);
  const changed = results.filter((row) => row.changed);
  const improvedOutcomes = changed.filter((row) => row.preferredCredit > row.baselineCredit).length;
  const worsenedOutcomes = changed.filter((row) => row.preferredCredit < row.baselineCredit).length;
  const weekRows = Array.from({ length: REGULAR_SEASON_END }, (_, index) => {
    const week = index + 1;
    const rows = results.filter((row) => row.week === week);
    return {
      week,
      decisions: rows.length,
      creditDelta: rows.reduce((sum, row) => sum + row.preferredCredit - row.baselineCredit, 0),
      changed: rows.filter((row) => row.changed).length,
    };
  });

  let state = 0x71f2a9c3 >>> 0;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const bootstrap = new Float64Array(100000);
  for (let replicate = 0; replicate < bootstrap.length; replicate += 1) {
    let delta = 0, decisions = 0;
    for (let draw = 0; draw < weekRows.length; draw += 1) {
      const row = weekRows[Math.floor(random() * weekRows.length)];
      delta += row.creditDelta;
      decisions += row.decisions;
    }
    bootstrap[replicate] = decisions ? delta / decisions : 0;
  }
  const sortedBootstrap = Array.from(bootstrap).sort((a, b) => a - b);
  const quantile = (p) => sortedBootstrap[Math.min(sortedBootstrap.length - 1, Math.max(0, Math.floor(p * (sortedBootstrap.length - 1))))];

  const report = {
    version: "future-win-audit-2026.1",
    purpose: "retrospective no-tuning diagnostic of opponent-aware lineup selection using the already-frozen 2025 uncertainty model and archived ESPN PPR projections",
    evidenceDiscipline: {
      season: SEASON,
      status: "retrospective-consumed-evidence-not-independent-holdout",
      policyFrozenBeforeAuditRun: true,
      tuningAllowedAfterInspection: false,
      prospectiveConfirmation: 2026,
    },
    syntheticLeague: {
      teams: TEAM_COUNT,
      rosterConstruction: "deterministic preseason-ADP snake with fixed position quotas",
      starterSettings: SETTINGS.slots,
      regularSeasonEnd: REGULAR_SEASON_END,
      scenariosPerDecision: SCENARIOS,
    },
    result: {
      decisions: results.length,
      changedDecisions: changed.length,
      baselineCredits,
      preferredCredits,
      creditDelta: preferredCredits - baselineCredits,
      averageCreditDeltaPerDecision: (preferredCredits - baselineCredits) / Math.max(1, results.length),
      improvedOutcomes,
      worsenedOutcomes,
      weekClusterBootstrap95: [quantile(0.025), quantile(0.975)],
      weeks: weekRows,
    },
    gates: {
      realizedNoninferiority: preferredCredits >= baselineCredits,
      clusterBootstrapLowerNonnegative: quantile(0.025) >= 0,
      defaultLineupOverlayAdmitted: preferredCredits >= baselineCredits && quantile(0.025) >= 0,
    },
    interpretation: "This audit can falsify obvious harm from the fixed opponent-aware lineup rule, but it is not an independent validation because 2025 outcomes were already consumed elsewhere. The untouched 2026 season remains the prospective admission evidence.",
  };

  if (VERIFY) {
    if (!fs.existsSync(outputPath)) throw new Error("future-win audit artifact is missing");
    const stored = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    if (JSON.stringify(stored) !== JSON.stringify(report)) throw new Error("future-win audit artifact drift");
    console.log(`Future-win audit verified: ${report.gates.defaultLineupOverlayAdmitted}`);
    return;
  }
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`Wrote ${outputPath}`);
  console.log(`Credits: ${baselineCredits} -> ${preferredCredits} (${(preferredCredits - baselineCredits).toFixed(1)})`);
  console.log(`Week-cluster bootstrap 95%: ${report.result.weekClusterBootstrap95.map((value) => value.toFixed(5)).join(" to ")}`);
  console.log(`Default lineup overlay admitted: ${report.gates.defaultLineupOverlayAdmitted}`);
}

main();

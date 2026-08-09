"use strict";

process.env.SNAPCOUNT_DRAFT_SEASON = "2017";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../src/engine/core.js");
const draft = require("../src/engine/draft-sim.js");
const historical = require("./draft-robust-historical.js");
const hist = require("./lib/historical-data.js");

const root = path.resolve(__dirname, "..");
const candidatePath = path.join(root, "data", "validation", "draft-robust-policy.json");
const outputPath = path.join(root, "data", "validation", "draft-overfit-confirmation-2017.json");
const planPath = path.join(root, "docs", "ai", "2026-08-08-draft-overfit-confirmation-plan.md");
const evaluatorPath = __filename;
const CONTROLS = ["espn-market", "balanced", "value", "need-heavy", "zero-rb"];
const SEGMENTS = [[10,"early",1],[10,"middle",5],[10,"late",10],[12,"early",1],[12,"middle",6],[12,"late",12]];
const SEEDS = 32;
const BOOTSTRAP_REPS = 20000;
const EXPECTED_POLICY_SHA = "7338a9c34cf40e5828a1ec33654ce482e13c2ae52ec129c4776dc5e8dbe7befc";
const cacheNames = ["espn-2017-default-3.json", ...["QB","RB","WR","TE","K","DST"].map(p => `robust-fantasydata-ppr-adp-${p}-2017.html`)];

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function mean(values) { return values.length ? values.reduce((a,b) => a + b, 0) / values.length : 0; }
function requireGate(condition, label) { if (!condition) throw new Error(`2017 overfit confirmation precondition failed: ${label}`); }
function realized(roster, settings) {
  const rows = roster.map(p => ({
    ...p,
    projectedPoints: (p.actualWeekly || []).reduce((sum,v) => sum + finite(v), 0),
    weeklyProjection: 0,
    weeklyProjections: p.actualWeekly || [],
  }));
  let total = 0;
  for (let week = 1; week <= 17; week += 1) total += core.optimizeWeeklyLineup(rows, settings, week).total;
  return total;
}
function percentile(values, probability) {
  const sorted = [...values].sort((a,b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(probability * sorted.length)));
  return sorted[index];
}
function seedFromText(text) {
  return crypto.createHash("sha256").update(text).digest().readUInt32LE(0);
}
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bootstrapControl(rows, control) {
  const bySeed = Array.from({length: SEEDS}, () => ({sum:0,wins:0,n:0}));
  for (const row of rows) {
    const cell = bySeed[row.seed];
    cell.sum += row.edge;
    cell.wins += row.edge > 0 ? 1 : 0;
    cell.n += 1;
  }
  requireGate(bySeed.every(row => row.n === SEGMENTS.length), `${control} complete seed clusters`);
  const rng = mulberry32(seedFromText(`snapcount-overfit-2017:${control}`));
  const edgeMeans = new Array(BOOTSTRAP_REPS);
  const winRates = new Array(BOOTSTRAP_REPS);
  for (let rep = 0; rep < BOOTSTRAP_REPS; rep += 1) {
    let sum = 0, wins = 0, n = 0;
    for (let draw = 0; draw < SEEDS; draw += 1) {
      const cluster = bySeed[Math.floor(rng() * SEEDS)];
      sum += cluster.sum;
      wins += cluster.wins;
      n += cluster.n;
    }
    edgeMeans[rep] = sum / n;
    winRates[rep] = wins / n;
  }
  return {
    method: "seed-cluster-bootstrap",
    clusters: SEEDS,
    roomsPerCluster: SEGMENTS.length,
    replicates: BOOTSTRAP_REPS,
    edge95: [percentile(edgeMeans, .025), percentile(edgeMeans, .975)],
    winRate95: [percentile(winRates, .025), percentile(winRates, .975)],
  };
}
function evaluateDetailed(pool, policy) {
  const edges = Object.fromEntries(CONTROLS.map(c => [c, []]));
  const segmentRows = Object.fromEntries(CONTROLS.map(c => [c, {}]));
  for (const [teams,bucket,slot] of SEGMENTS) {
    const segment = `${teams}-${bucket}`;
    const settings = core.cloneSettings({teams, rounds:16, scoring:"ppr", draftPosition:slot});
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const common = {players:pool, settings, userTeamId:slot, opponentStrategy:"mixed", seed:`overfit-confirm:2017:${teams}:${slot}:${seed}`};
      const oracle = draft.simulateDraft({...common, userStrategy:"oracle", oraclePolicy:policy});
      const score = realized(oracle.userRoster, settings);
      for (const control of CONTROLS) {
        const baseline = draft.simulateDraft({...common, userStrategy:control});
        const edge = score - realized(baseline.userRoster, settings);
        edges[control].push({seed, segment, edge});
        (segmentRows[control][segment] ||= []).push(edge);
      }
    }
  }
  const controls = {};
  for (const control of CONTROLS) {
    const values = edges[control].map(row => row.edge);
    controls[control] = {
      n: values.length,
      edge: mean(values),
      winRate: values.filter(v => v > 0).length / values.length,
      bootstrap: bootstrapControl(edges[control], control),
      segments: Object.fromEntries(Object.entries(segmentRows[control]).map(([name,segment]) => [name, {
        n: segment.length,
        edge: mean(segment),
        winRate: segment.filter(v => v > 0).length / segment.length,
      }])),
    };
  }
  return controls;
}
function pointGate(controls) {
  return CONTROLS.every(c => controls[c].edge >= 0 && controls[c].winRate >= .5)
    && controls["espn-market"].edge > 0
    && controls["espn-market"].winRate >= .75;
}
function confirmationGate(controls) {
  return CONTROLS.every(c => controls[c].bootstrap.edge95[0] > 0 && controls[c].bootstrap.winRate95[0] > .5)
    && controls["espn-market"].bootstrap.winRate95[0] > .75;
}

async function main() {
  const candidateBytes = fs.readFileSync(candidatePath);
  const candidate = JSON.parse(candidateBytes.toString("utf8"));
  requireGate(candidate.policyDefinitionSha256 === EXPECTED_POLICY_SHA, "exact frozen production policy hash");
  requireGate(!fs.existsSync(outputPath), "one-shot output must not already exist");
  for (const name of cacheNames) requireGate(!fs.existsSync(path.join(hist.cacheDir, name)), `2017 cache must be untouched: ${name}`);
  const tracked = ["data/validation/draft-robust-policy.json", "scripts/draft-overfit-confirmation-2017.js", "docs/ai/2026-08-08-draft-overfit-confirmation-plan.md"];
  const status = childProcess.execFileSync("git", ["status", "--porcelain", "--", ...tracked], {cwd:root, encoding:"utf8"}).trim();
  requireGate(status === "", "candidate, evaluator, and preregistration must be committed and unchanged");
  const freezeCommit = childProcess.execFileSync("git", ["rev-parse", "HEAD"], {cwd:root, encoding:"utf8"}).trim();
  const built = await historical.buildPool();
  requireGate(built.pool.length >= 180, "2017 player pool coverage");
  const controls = evaluateDetailed(built.pool, candidate.policy);
  const admitted = pointGate(controls);
  const independentlyConfirmed = admitted && confirmationGate(controls);
  const report = {
    version: "draft-overfit-confirmation-2017-2026.1",
    evaluatedAt: new Date().toISOString(),
    season: 2017,
    purpose: "single predeclared post-freeze overfit falsification; no policy selection",
    freezeCommit,
    candidateArtifactSha256: sha256(candidateBytes),
    policyDefinitionSha256: candidate.policyDefinitionSha256,
    evaluatorSha256: sha256(fs.readFileSync(evaluatorPath)),
    preregistrationSha256: sha256(fs.readFileSync(planPath)),
    policy: candidate.policy,
    poolPlayers: built.pool.length,
    sources: built.sources,
    pairedSeedsPerSegment: SEEDS,
    pairedRoomsPerControl: SEEDS * SEGMENTS.length,
    controls,
    pointGate: {
      everyControlMeanEdgeAtLeast: 0,
      everyControlWinRateAtLeast: .5,
      espnMarketWinRateAtLeast: .75,
      admitted,
    },
    antiOverfitGate: {
      method: "deterministic seed-cluster bootstrap, 95% percentile intervals",
      everyControlEdgeLowerBoundAbove: 0,
      everyControlWinRateLowerBoundAbove: .5,
      espnMarketWinRateLowerBoundAbove: .75,
      independentlyConfirmed,
    },
    interpretation: independentlyConfirmed
      ? "Frozen policy independently confirmed on the single predeclared 2017 season under a stricter uncertainty-aware gate. This is strong evidence against the observed historical overfit mode, not proof that overfit is impossible."
      : "Frozen policy did not clear the stricter independent confirmation gate. Do not tune to 2017 and do not search older seasons for a passing result.",
  };
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!independentlyConfirmed) process.exitCode = 2;
}

if (require.main === module) main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

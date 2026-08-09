"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const validationDir = path.join(root, "data", "validation");
const outputPath = path.join(validationDir, "draft-overfit-audit.json");
const CONTROLS = ["espn-market", "balanced", "value", "need-heavy", "zero-rb"];
const DEVELOPMENT_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const EVIDENCE_YEARS = [2018, ...DEVELOPMENT_YEARS];
const BOOTSTRAP_REPS = 200000;

const read = name => JSON.parse(fs.readFileSync(path.join(validationDir, name), "utf8"));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
function assert(condition, message) { if (!condition) throw new Error(`Draft overfit audit failed: ${message}`); }
function percentile(values, probability) {
  values.sort((a,b) => a - b);
  return values[Math.max(0, Math.min(values.length - 1, Math.floor(probability * values.length)))];
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
function aggregate(rows) {
  return {edge: mean(rows.map(row => row.edge)), winRate: mean(rows.map(row => row.winRate))};
}
function bootstrapSeasons(rows, control) {
  const seed = crypto.createHash("sha256").update(`snapcount-draft-season-bootstrap:${control}`).digest().readUInt32LE(0);
  const random = mulberry32(seed);
  const edges = new Array(BOOTSTRAP_REPS);
  const wins = new Array(BOOTSTRAP_REPS);
  for (let rep = 0; rep < BOOTSTRAP_REPS; rep += 1) {
    let edge = 0, win = 0;
    for (let draw = 0; draw < rows.length; draw += 1) {
      const selected = rows[Math.floor(random() * rows.length)];
      edge += selected.edge;
      win += selected.winRate;
    }
    edges[rep] = edge / rows.length;
    wins[rep] = win / rows.length;
  }
  return {
    method: "season-cluster-bootstrap",
    seasons: rows.length,
    replicates: BOOTSTRAP_REPS,
    edge95: [percentile(edges, .025), percentile(edges, .975)],
    winRate95: [percentile(wins, .025), percentile(wins, .975)],
  };
}
function ranking(row) {
  const minEdge = Math.min(...CONTROLS.map(control => row.controls[control].edge));
  const minWin = Math.min(...CONTROLS.map(control => row.controls[control].winRate));
  return Number(row.aggregatePass) * 1e9 + row.passCells * 1e6
    + Math.min(0, row.worstEdge) * 1e3 + Math.min(0, row.worstWin - .5) * 1e5
    + minEdge * 100 + minWin * 1000;
}
function subsetMetrics(finalist, years) {
  const controls = Object.fromEntries(CONTROLS.map(control => [control, aggregate(years.map(year => finalist.seasons[String(year)][control]))]));
  let passCells = 0, worstEdge = Infinity, worstWin = Infinity;
  for (const year of years) for (const control of CONTROLS) {
    const row = finalist.seasons[String(year)][control];
    if (row.edge >= 0 && row.winRate >= .5) passCells += 1;
    worstEdge = Math.min(worstEdge, row.edge);
    worstWin = Math.min(worstWin, row.winRate);
  }
  const aggregatePass = CONTROLS.every(control => controls[control].edge >= 0 && controls[control].winRate >= .5)
    && controls["espn-market"].winRate >= .75;
  return {...finalist, controls, passCells, worstEdge, worstWin, aggregatePass};
}
function samePolicy(a, b) {
  return Number(a?.market) === Number(b?.market)
    && Number(a?.value) === Number(b?.value)
    && Number(a?.need) === Number(b?.need);
}
function main() {
  const robustPolicyBytes = fs.readFileSync(path.join(validationDir, "draft-robust-policy.json"));
  const robust = JSON.parse(robustPolicyBytes);
  const holdout = read("draft-a-plus-holdout-2018.json");
  const refine = read("draft-robust-refine.json");
  assert(holdout.admitted === true, "2018 independent holdout no longer admitted");
  assert(holdout.policyDefinitionSha256 === robust.policyDefinitionSha256, "2018 policy hash drift");
  assert(refine.finalists.length >= 10, "finalist neighborhood missing");
  assert(samePolicy(refine.winner.policy, robust.policy), "frozen policy is no longer development winner");

  const seasons = {2018: holdout.result.controls};
  for (const year of DEVELOPMENT_YEARS) seasons[year] = robust.development.seasons[String(year)];
  const controls = {};
  const individualFailures = [];
  for (const control of CONTROLS) {
    const rows = EVIDENCE_YEARS.map(year => seasons[year][control]);
    for (let index = 0; index < rows.length; index += 1) {
      if (rows[index].edge < 0 || rows[index].winRate < .5) individualFailures.push({year:EVIDENCE_YEARS[index], control, ...rows[index]});
    }
    const jackknife = EVIDENCE_YEARS.map((omittedYear, omittedIndex) => {
      const kept = rows.filter((_, index) => index !== omittedIndex);
      return {omittedYear, ...aggregate(kept)};
    });
    controls[control] = {
      aggregate: aggregate(rows),
      seasonBootstrap: bootstrapSeasons(rows, control),
      jackknife,
      jackknifeMinimum: {
        edge: Math.min(...jackknife.map(row => row.edge)),
        winRate: Math.min(...jackknife.map(row => row.winRate)),
      },
    };
  }

  const productionFinalist = refine.finalists.find(row => samePolicy(row.policy, robust.policy));
  assert(productionFinalist, "frozen policy missing from finalist neighborhood");
  const loso = DEVELOPMENT_YEARS.map(heldOutYear => {
    const trainingYears = DEVELOPMENT_YEARS.filter(year => year !== heldOutYear);
    const ranked = refine.finalists.map(finalist => {
      const row = subsetMetrics(finalist, trainingYears);
      return {...row, rankScore: ranking(row)};
    }).sort((a,b) => b.rankScore - a.rankScore);
    const productionRank = ranked.findIndex(row => samePolicy(row.policy, robust.policy)) + 1;
    const selected = ranked[0];
    return {
      heldOutYear,
      selectedPolicy: selected.policy,
      productionRank,
      productionHeldOut: productionFinalist.seasons[String(heldOutYear)],
      selectedHeldOut: selected.seasons[String(heldOutYear)],
    };
  });
  const fullFinalistRank = refine.finalists.findIndex(row => samePolicy(row.policy, robust.policy)) + 1;
  const allFinalistsAggregatePass = refine.finalists.every(row => row.aggregatePass === true);
  const bootstrapPass = CONTROLS.every(control => controls[control].seasonBootstrap.edge95[0] > 0 && controls[control].seasonBootstrap.winRate95[0] > .5)
    && controls["espn-market"].seasonBootstrap.winRate95[0] > .75;
  const jackknifePass = CONTROLS.every(control => controls[control].jackknifeMinimum.edge >= 0 && controls[control].jackknifeMinimum.winRate >= .5)
    && controls["espn-market"].jackknifeMinimum.winRate >= .75;
  const robustnessPass = holdout.admitted === true && fullFinalistRank === 1 && bootstrapPass && jackknifePass;
  const report = {
    version: "draft-overfit-audit-2026.1",
    policyCanonicalSha256: sha256(Buffer.from(JSON.stringify(robust))),
    policyDefinitionSha256: robust.policyDefinitionSha256,
    purpose: "post-selection robustness audit of the frozen policy; no coefficient fitting or policy selection",
    evidenceYears: EVIDENCE_YEARS,
    developmentYears: DEVELOPMENT_YEARS,
    independentHistoricalHoldoutYear: 2018,
    controls,
    individualFailures,
    finalistNeighborhood: {
      finalists: refine.finalists.length,
      allAggregatePass: allFinalistsAggregatePass,
      productionFullRank: fullFinalistRank,
      productionTop1LeaveOneDevelopmentSeasonOut: loso.filter(row => row.productionRank === 1).length,
      productionTop3LeaveOneDevelopmentSeasonOut: loso.filter(row => row.productionRank <= 3).length,
      leaveOneSeasonOut: loso,
      caveat: "The finalist neighborhood itself was selected using 2019-2025, so LOSO ranks are a sensitivity diagnostic rather than independent validation.",
    },
    gates: {
      independent2018HoldoutPass: holdout.admitted === true,
      frozenPolicyIsFullDevelopmentWinner: fullFinalistRank === 1,
      leaveOneSeasonOutAggregatePass: jackknifePass,
      seasonBootstrap95Pass: bootstrapPass,
      robustnessPass,
    },
    interpretation: robustnessPass
      ? "No material aggregate overfit is detected in the tested historical evidence: the frozen low-dimensional policy remains qualified after every one-season omission and its season-cluster 95% lower bounds stay above the production gates. This does not prove zero overfit because 2019-2025 participated in selection and 2018 remains the single independent historical holdout."
      : "The frozen policy fails at least one anti-overfit robustness gate. Do not strengthen the Draft claim or retune against this audit.",
  };
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  if (process.argv.includes("--verify")) {
    assert(fs.existsSync(outputPath), "committed overfit report missing");
    const committed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert(JSON.stringify(committed) === JSON.stringify(report), "committed overfit report drift");
  } else {
    fs.writeFileSync(outputPath, bytes);
  }
  assert(robustnessPass, "anti-overfit robustness gate");
  console.log(`Draft overfit robustness verified: ${robustnessPass}`);
  console.log(`Need-heavy bootstrap lower bounds: edge=${controls["need-heavy"].seasonBootstrap.edge95[0].toFixed(2)}, win=${controls["need-heavy"].seasonBootstrap.winRate95[0].toFixed(4)}`);
}

main();

"use strict";
process.env.SNAPCOUNT_DRAFT_SEASON = "2019";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const core = require("../src/engine/core.js");
const draft = require("../src/engine/draft-sim.js");
const hist2019 = require("./draft-robust-historical.js");
const root = path.resolve(__dirname, "..");
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const CONTROLS = ["espn-market", "balanced", "value", "need-heavy", "zero-rb"];
const SEGMENTS = [[10,"early",1],[10,"middle",5],[10,"late",10],[12,"early",1],[12,"middle",6],[12,"late",12]];
const champion = JSON.parse(fs.readFileSync(path.join(root,"data","validation","draft-robust-policy.json"),"utf8")).policy;
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function mean(values) { return values.length ? values.reduce((a,b) => a + b, 0) / values.length : 0; }
function player(row) {
  const adp = Number(row.adp);
  const projection = finite(row.seasonProjection) > 0 ? finite(row.seasonProjection) : Math.max(1, finite(row.previousPoints));
  return { id:String(row.id), name:row.name, position:row.position, team:row.team,
    projectedPoints:projection, weeklyProjection:projection/17, weeklyProjections:Array(18).fill(projection/17),
    previousPoints:finite(row.previousPoints), adp:Number.isFinite(adp)&&adp>0?adp:null,
    pprRank:adp, standardRank:adp, superflexRank:adp, injuryRisk:0, reliability:.7,
    actualWeekly:(row.actualWeekly||[]).map((v)=>finite(v)) };
}
function realized(roster, settings) {
  const rows = roster.map((p)=>({...p, projectedPoints:p.actualWeekly.reduce((s,v)=>s+finite(v),0), weeklyProjection:0, weeklyProjections:p.actualWeekly}));
  let total = 0;
  for (let week=1; week<=17; week+=1) total += core.optimizeWeeklyLineup(rows, settings, week).total;
  return total;
}
function candidates() {
  const rows = [];
  for (const secondQbRound of [9,10,11,12])
    for (const secondTeRound of [9,10,11,12])
      for (const kickerRound of [13,14,15,16])
        for (const dstRound of [12,13,14,15])
          rows.push({ ...champion, secondQbRound, secondTeRound, kickerRound, dstRound });
  return rows;
}
function settingsFor(teams, slot) { return core.cloneSettings({ teams, rounds:16, scoring:"ppr", draftPosition:slot }); }
function seedKey(year, teams, slot, seed) { return `structure:${year}:${teams}:${slot}:${seed}`; }
function makeBuckets() {
  return {
    scores: [], champion: [],
    controls: Object.fromEntries(CONTROLS.map((control)=>[control, []])),
    championDelta: [],
  };
}
function summarizeBucket(bucket) {
  const controls = Object.fromEntries(CONTROLS.map((control)=>[control, {
    edge: mean(bucket.controls[control]),
    winRate: bucket.controls[control].filter((v)=>v>0).length / Math.max(1,bucket.controls[control].length),
  }]));
  return {
    meanRealized: mean(bucket.scores), championMean: mean(bucket.champion),
    championDelta: mean(bucket.championDelta),
    championWinRate: bucket.championDelta.filter((v)=>v>0).length / Math.max(1,bucket.championDelta.length),
    controls,
  };
}
function candidates() {
  const rows = [];
  for (const secondQbRound of [9,10,11,12])
    for (const secondTeRound of [9,10,11,12])
      for (const kickerRound of [13,14,15,16])
        for (const dstRound of [12,13,14,15])
          rows.push({ ...champion, secondQbRound, secondTeRound, kickerRound, dstRound });
  return rows;
}
function settingsFor(teams, slot) { return core.cloneSettings({ teams, rounds:16, scoring:"ppr", draftPosition:slot }); }
function seedKey(year, teams, slot, seed) { return `structure:${year}:${teams}:${slot}:${seed}`; }
function makeBuckets() {
  return {
    scores: [], champion: [],
    controls: Object.fromEntries(CONTROLS.map((control)=>[control, []])),
    championDelta: [],
  };
}
function summarizeBucket(bucket) {
  const controls = Object.fromEntries(CONTROLS.map((control)=>[control, {
    edge: mean(bucket.controls[control]),
    winRate: bucket.controls[control].filter((v)=>v>0).length / Math.max(1,bucket.controls[control].length),
  }]));
  return {
    meanRealized: mean(bucket.scores), championMean: mean(bucket.champion),
    championDelta: mean(bucket.championDelta),
    championWinRate: bucket.championDelta.filter((v)=>v>0).length / Math.max(1,bucket.championDelta.length),
    controls,
  };
}
function baselineTable(pools, seeds) {
  const table = {};
  for (const year of YEARS) for (const [teams,bucket,slot] of SEGMENTS) {
    const settings = settingsFor(teams, slot);
    for (let seed=0; seed<seeds; seed+=1) {
      const key = `${year}|${teams}|${bucket}|${seed}`;
      const common = { players:pools[year], settings, userTeamId:slot, opponentStrategy:"mixed", seed:seedKey(year,teams,slot,seed) };
      const championDraft = draft.simulateDraft({ ...common, userStrategy:"oracle", oraclePolicy:champion });
      table[key] = { champion:realized(championDraft.userRoster,settings), controls:{} };
      for (const control of CONTROLS) {
        const baseline = draft.simulateDraft({ ...common, userStrategy:control });
        table[key].controls[control] = realized(baseline.userRoster, settings);
      }
    }
  }
  return table;
}
function evaluate(policy, pools, seeds, baseline) {
  const all = makeBuckets();
  const byYear = Object.fromEntries(YEARS.map((year)=>[year, makeBuckets()]));
  for (const year of YEARS) for (const [teams,bucket,slot] of SEGMENTS) {
    const settings = settingsFor(teams, slot);
    for (let seed=0; seed<seeds; seed+=1) {
      const key = `${year}|${teams}|${bucket}|${seed}`;
      const common = { players:pools[year], settings, userTeamId:slot, opponentStrategy:"mixed", seed:seedKey(year,teams,slot,seed) };
      const candidate = draft.simulateDraft({ ...common, userStrategy:"oracle", oraclePolicy:policy });
      const score = realized(candidate.userRoster, settings);
      for (const target of [all, byYear[year]]) {
        target.scores.push(score); target.champion.push(baseline[key].champion);
        target.championDelta.push(score - baseline[key].champion);
        for (const control of CONTROLS) target.controls[control].push(score - baseline[key].controls[control]);
      }
    }
  }
  return { policy, aggregate:summarizeBucket(all), seasons:Object.fromEntries(YEARS.map((year)=>[year,summarizeBucket(byYear[year])])) };
}
function baselineTable(pools, seeds) {
  const table = {};
  for (const year of YEARS) for (const [teams,bucket,slot] of SEGMENTS) {
    const settings = settingsFor(teams, slot);
    for (let seed=0; seed<seeds; seed+=1) {
      const key = `${year}|${teams}|${bucket}|${seed}`;
      const common = { players:pools[year], settings, userTeamId:slot, opponentStrategy:"mixed", seed:seedKey(year,teams,slot,seed) };
      const championDraft = draft.simulateDraft({ ...common, userStrategy:"oracle", oraclePolicy:champion });
      table[key] = { champion:realized(championDraft.userRoster,settings), controls:{} };
      for (const control of CONTROLS) {
        const baseline = draft.simulateDraft({ ...common, userStrategy:control });
        table[key].controls[control] = realized(baseline.userRoster, settings);
      }
    }
  }
  return table;
}
function evaluate(policy, pools, seeds, baseline) {
  const all = makeBuckets();
  const byYear = Object.fromEntries(YEARS.map((year)=>[year, makeBuckets()]));
  for (const year of YEARS) for (const [teams,bucket,slot] of SEGMENTS) {
    const settings = settingsFor(teams, slot);
    for (let seed=0; seed<seeds; seed+=1) {
      const key = `${year}|${teams}|${bucket}|${seed}`;
      const common = { players:pools[year], settings, userTeamId:slot, opponentStrategy:"mixed", seed:seedKey(year,teams,slot,seed) };
      const candidate = draft.simulateDraft({ ...common, userStrategy:"oracle", oraclePolicy:policy });
      const score = realized(candidate.userRoster, settings);
      for (const target of [all, byYear[year]]) {
        target.scores.push(score); target.champion.push(baseline[key].champion);
        target.championDelta.push(score - baseline[key].champion);
        for (const control of CONTROLS) target.controls[control].push(score - baseline[key].controls[control]);
      }
    }
  }
  return { policy, aggregate:summarizeBucket(all), seasons:Object.fromEntries(YEARS.map((year)=>[year,summarizeBucket(byYear[year])])) };
}
function metricsForYears(result, years) {
  const rows = years.map((year)=>result.seasons[year]);
  const championDelta = mean(rows.map((row)=>row.championDelta));
  const controls = Object.fromEntries(CONTROLS.map((control)=>[control, {
    edge:mean(rows.map((row)=>row.controls[control].edge)),
    winRate:mean(rows.map((row)=>row.controls[control].winRate)),
  }]));
  const positiveSeasons = rows.filter((row)=>row.championDelta>0).length;
  const worstSeasonDelta = Math.min(...rows.map((row)=>row.championDelta));
  const leaveOneOut = years.length > 1 ? years.map((held)=>mean(years.filter((year)=>year!==held).map((year)=>result.seasons[year].championDelta))) : [championDelta];
  const qualified = CONTROLS.every((control)=>controls[control].edge>=0&&controls[control].winRate>=.5)
    && controls["espn-market"].winRate>=.75;
  return { championDelta, controls, positiveSeasons, worstSeasonDelta, looMin:Math.min(...leaveOneOut), qualified };
}
function compareResults(left, right, years = YEARS) {
  const a = metricsForYears(left, years), b = metricsForYears(right, years);
  const fields = [
    [Number(a.qualified), Number(b.qualified)],
    [Number(a.looMin>0), Number(b.looMin>0)],
    [a.positiveSeasons, b.positiveSeasons],
    [a.looMin, b.looMin],
    [a.championDelta, b.championDelta],
    [Math.min(...CONTROLS.map((c)=>a.controls[c].winRate)), Math.min(...CONTROLS.map((c)=>b.controls[c].winRate))],
  ];
  for (const [av,bv] of fields) if (av !== bv) return bv - av;
  return 0;
}
function compact(result) {
  const m = metricsForYears(result, YEARS);
  return { policy:{ secondQbRound:result.policy.secondQbRound, secondTeRound:result.policy.secondTeRound,
    kickerRound:result.policy.kickerRound, dstRound:result.policy.dstRound },
    meanRealized:+result.aggregate.meanRealized.toFixed(2), championDelta:+m.championDelta.toFixed(2),
    positiveSeasons:m.positiveSeasons, worstSeasonDelta:+m.worstSeasonDelta.toFixed(2), looMin:+m.looMin.toFixed(2),
    qualified:m.qualified, needHeavyWin:+m.controls["need-heavy"].winRate.toFixed(3),
    seasonDelta:Object.fromEntries(YEARS.map((year)=>[year,+result.seasons[year].championDelta.toFixed(2)])) };
}
function metricsForYears(result, years) {
  const rows = years.map((year)=>result.seasons[year]);
  const championDelta = mean(rows.map((row)=>row.championDelta));
  const controls = Object.fromEntries(CONTROLS.map((control)=>[control, {
    edge:mean(rows.map((row)=>row.controls[control].edge)),
    winRate:mean(rows.map((row)=>row.controls[control].winRate)),
  }]));
  const positiveSeasons = rows.filter((row)=>row.championDelta>0).length;
  const worstSeasonDelta = Math.min(...rows.map((row)=>row.championDelta));
  const leaveOneOut = years.length > 1 ? years.map((held)=>mean(years.filter((year)=>year!==held).map((year)=>result.seasons[year].championDelta))) : [championDelta];
  const qualified = CONTROLS.every((control)=>controls[control].edge>=0&&controls[control].winRate>=.5)
    && controls["espn-market"].winRate>=.75;
  return { championDelta, controls, positiveSeasons, worstSeasonDelta, looMin:Math.min(...leaveOneOut), qualified };
}
function compareResults(left, right, years = YEARS) {
  const a = metricsForYears(left, years), b = metricsForYears(right, years);
  const fields = [
    [Number(a.qualified), Number(b.qualified)],
    [Number(a.looMin>0), Number(b.looMin>0)],
    [a.positiveSeasons, b.positiveSeasons],
    [a.looMin, b.looMin],
    [a.championDelta, b.championDelta],
    [Math.min(...CONTROLS.map((c)=>a.controls[c].winRate)), Math.min(...CONTROLS.map((c)=>b.controls[c].winRate))],
  ];
  for (const [av,bv] of fields) if (av !== bv) return bv - av;
  return 0;
}
function compact(result) {
  const m = metricsForYears(result, YEARS);
  return { policy:{ secondQbRound:result.policy.secondQbRound, secondTeRound:result.policy.secondTeRound,
    kickerRound:result.policy.kickerRound, dstRound:result.policy.dstRound },
    meanRealized:+result.aggregate.meanRealized.toFixed(2), championDelta:+m.championDelta.toFixed(2),
    positiveSeasons:m.positiveSeasons, worstSeasonDelta:+m.worstSeasonDelta.toFixed(2), looMin:+m.looMin.toFixed(2),
    qualified:m.qualified, needHeavyWin:+m.controls["need-heavy"].winRate.toFixed(3),
    seasonDelta:Object.fromEntries(YEARS.map((year)=>[year,+result.seasons[year].championDelta.toFixed(2)])) };
}
function policyKey(policy) { return [policy.secondQbRound,policy.secondTeRound,policy.kickerRound,policy.dstRound].join("|"); }
async function main() {
  const archive = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,"data","validation","historical-ppr-2020-2025.json.gz"))).toString("utf8"));
  const built2019 = await hist2019.buildPool();
  const pools = { 2019:built2019.pool };
  for (const year of YEARS.filter((year)=>year!==2019)) {
    pools[year] = (archive.drafts[String(year)]||[]).map(player).filter((p)=>p.adp!==null&&p.projectedPoints>0);
  }
  const coarseSeeds = Number(process.env.SNAPCOUNT_STRUCTURE_COARSE_SEEDS||2);
  const fineSeeds = Number(process.env.SNAPCOUNT_STRUCTURE_FINE_SEEDS||8);
  const allCandidates = candidates();
  console.log(`coarse ${allCandidates.length} candidates x ${coarseSeeds} seeds`);
  const coarseBaseline = baselineTable(pools, coarseSeeds);
  const coarse = [];
  for (let i=0; i<allCandidates.length; i+=1) {
    if (i%32===0) console.log(`coarse ${i}/${allCandidates.length}`);
    coarse.push(evaluate(allCandidates[i], pools, coarseSeeds, coarseBaseline));
  }
  const finalistMap = new Map();
  [...coarse].sort((a,b)=>compareResults(a,b)).slice(0,12).forEach((row)=>finalistMap.set(policyKey(row.policy),row.policy));
  for (const heldOut of YEARS) {
    const trainYears = YEARS.filter((year)=>year!==heldOut);
    [...coarse].sort((a,b)=>compareResults(a,b,trainYears)).slice(0,3)
      .forEach((row)=>finalistMap.set(policyKey(row.policy),row.policy));
  }
  const finalists = [...finalistMap.values()];
  console.log(`fine ${finalists.length} finalists x ${fineSeeds} seeds`);
  const fineBaseline = baselineTable(pools, fineSeeds);
  const fine = finalists.map((policy,index)=>{
    console.log(`fine ${index+1}/${finalists.length} ${policyKey(policy)}`);
    return evaluate(policy,pools,fineSeeds,fineBaseline);
  });
function policyKey(policy) { return [policy.secondQbRound,policy.secondTeRound,policy.kickerRound,policy.dstRound].join("|"); }
async function main() {
  const archive = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,"data","validation","historical-ppr-2020-2025.json.gz"))).toString("utf8"));
  const built2019 = await hist2019.buildPool();
  const pools = { 2019:built2019.pool };
  for (const year of YEARS.filter((year)=>year!==2019)) {
    pools[year] = (archive.drafts[String(year)]||[]).map(player).filter((p)=>p.adp!==null&&p.projectedPoints>0);
  }
  const coarseSeeds = Number(process.env.SNAPCOUNT_STRUCTURE_COARSE_SEEDS||2);
  const fineSeeds = Number(process.env.SNAPCOUNT_STRUCTURE_FINE_SEEDS||8);
  const allCandidates = candidates();
  console.log(`coarse ${allCandidates.length} candidates x ${coarseSeeds} seeds`);
  const coarseBaseline = baselineTable(pools, coarseSeeds);
  const coarse = [];
  for (let i=0; i<allCandidates.length; i+=1) {
    if (i%32===0) console.log(`coarse ${i}/${allCandidates.length}`);
    coarse.push(evaluate(allCandidates[i], pools, coarseSeeds, coarseBaseline));
  }
  const finalistMap = new Map();
  [...coarse].sort((a,b)=>compareResults(a,b)).slice(0,12).forEach((row)=>finalistMap.set(policyKey(row.policy),row.policy));
  for (const heldOut of YEARS) {
    const trainYears = YEARS.filter((year)=>year!==heldOut);
    [...coarse].sort((a,b)=>compareResults(a,b,trainYears)).slice(0,3)
      .forEach((row)=>finalistMap.set(policyKey(row.policy),row.policy));
  }
  const finalists = [...finalistMap.values()];
  console.log(`fine ${finalists.length} finalists x ${fineSeeds} seeds`);
  const fineBaseline = baselineTable(pools, fineSeeds);
  const fine = finalists.map((policy,index)=>{
    console.log(`fine ${index+1}/${finalists.length} ${policyKey(policy)}`);
    return evaluate(policy,pools,fineSeeds,fineBaseline);
  });
  const ranked = [...fine].sort((a,b)=>compareResults(a,b));
  const outer = YEARS.map((heldOut)=>{
    const trainYears = YEARS.filter((year)=>year!==heldOut);
    const selected = [...fine].sort((a,b)=>compareResults(a,b,trainYears))[0];
    return { heldOut, selectedPolicy:compact(selected).policy,
      train:metricsForYears(selected,trainYears),
      heldOutChampionDelta:selected.seasons[heldOut].championDelta,
      heldOutNeedHeavyWin:selected.seasons[heldOut].controls["need-heavy"].winRate };
  });
  const winner = ranked[0];
  const winnerMetrics = metricsForYears(winner,YEARS);
  const outerPositive = outer.filter((row)=>row.heldOutChampionDelta>0).length;
  const researchPass = winnerMetrics.qualified && winnerMetrics.championDelta>0 && winnerMetrics.looMin>0
    && winnerMetrics.positiveSeasons>=5 && outerPositive>=4;
  const report = {
    version:"draft-structure-research-2026.1", generatedAt:new Date().toISOString(),
    purpose:"development-only structural roster timing search; 2018 excluded from selection",
    developmentYears:YEARS, excludedConsumedHoldout:2018,
    championPolicy:champion, candidateDimensions:{ secondQbRound:[9,10,11,12], secondTeRound:[9,10,11,12], kickerRound:[13,14,15,16], dstRound:[12,13,14,15] },
    coarseSeeds, fineSeeds, coarseCandidates:allCandidates.length, fineFinalists:finalists.length,
    selectionRule:"qualified controls, positive leave-one-season-out champion delta, season breadth, then paired starter-point delta",
    winner:compact(winner), outerLeaveOneSeasonOut:outer,
    outerPositiveHeldouts:outerPositive, researchPass,
    servingEligible:false,
    servingReason:"Consumed history can freeze a shadow successor but cannot replace the A+ champion; prospective 2026 evidence is required.",
    top:ranked.slice(0,12).map(compact),
  };
  fs.writeFileSync(path.join(root,"data","validation","draft-structure-research.json"),`${JSON.stringify(report,null,2)}\n`);
  console.log("WINNER",JSON.stringify(compact(winner)));
  console.log("OUTER",JSON.stringify(outer.map((row)=>({heldOut:row.heldOut,policy:row.selectedPolicy,delta:+row.heldOutChampionDelta.toFixed(2)}))));
  console.log(`researchPass=${researchPass} outerPositive=${outerPositive}/7`);
}
main().catch((error)=>{ console.error(error.stack||error); process.exitCode=1; });
  const ranked = [...fine].sort((a,b)=>compareResults(a,b));
  const outer = YEARS.map((heldOut)=>{
    const trainYears = YEARS.filter((year)=>year!==heldOut);
    const selected = [...fine].sort((a,b)=>compareResults(a,b,trainYears))[0];
    return { heldOut, selectedPolicy:compact(selected).policy,
      train:metricsForYears(selected,trainYears),
      heldOutChampionDelta:selected.seasons[heldOut].championDelta,
      heldOutNeedHeavyWin:selected.seasons[heldOut].controls["need-heavy"].winRate };
  });
  const winner = ranked[0];
  const winnerMetrics = metricsForYears(winner,YEARS);
  const outerPositive = outer.filter((row)=>row.heldOutChampionDelta>0).length;
  const researchPass = winnerMetrics.qualified && winnerMetrics.championDelta>0 && winnerMetrics.looMin>0
    && winnerMetrics.positiveSeasons>=5 && outerPositive>=4;
  const report = {
    version:"draft-structure-research-2026.1", generatedAt:new Date().toISOString(),
    purpose:"development-only structural roster timing search; 2018 excluded from selection",
    developmentYears:YEARS, excludedConsumedHoldout:2018,
    championPolicy:champion, candidateDimensions:{ secondQbRound:[9,10,11,12], secondTeRound:[9,10,11,12], kickerRound:[13,14,15,16], dstRound:[12,13,14,15] },
    coarseSeeds, fineSeeds, coarseCandidates:allCandidates.length, fineFinalists:finalists.length,
    selectionRule:"qualified controls, positive leave-one-season-out champion delta, season breadth, then paired starter-point delta",
    winner:compact(winner), outerLeaveOneSeasonOut:outer,
    outerPositiveHeldouts:outerPositive, researchPass,
    servingEligible:false,
    servingReason:"Consumed history can freeze a shadow successor but cannot replace the A+ champion; prospective 2026 evidence is required.",
    top:ranked.slice(0,12).map(compact),
  };
  fs.writeFileSync(path.join(root,"data","validation","draft-structure-research.json"),`${JSON.stringify(report,null,2)}\n`);
  console.log("WINNER",JSON.stringify(compact(winner)));
  console.log("OUTER",JSON.stringify(outer.map((row)=>({heldOut:row.heldOut,policy:row.selectedPolicy,delta:+row.heldOutChampionDelta.toFixed(2)}))));
  console.log(`researchPass=${researchPass} outerPositive=${outerPositive}/7`);
}
main().catch((error)=>{ console.error(error.stack||error); process.exitCode=1; });

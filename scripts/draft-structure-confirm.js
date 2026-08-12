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
const SEEDS = 8;
const champion = JSON.parse(fs.readFileSync(path.join(root,"data","validation","draft-robust-policy.json"),"utf8")).policy;
const candidate = { ...champion, secondQbRound:11, secondTeRound:10, kickerRound:13, dstRound:14 };
const lockPath = path.join(root, ".tmp-draft-structure-confirm.lock");
let lockFd;
try { lockFd = fs.openSync(lockPath, "wx"); fs.writeFileSync(lockFd, String(process.pid)); }
catch (error) { if (error.code === "EEXIST") { console.error("draft structure confirmation already running"); process.exit(3); } throw error; }
process.on("exit", () => { try { fs.closeSync(lockFd); } catch {} try { fs.unlinkSync(lockPath); } catch {} });
function finite(value, fallback=0) { const n=Number(value); return Number.isFinite(n)?n:fallback; }
function mean(values) { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0; }
function player(row) {
  const adp=Number(row.adp), projection=finite(row.seasonProjection)>0?finite(row.seasonProjection):Math.max(1,finite(row.previousPoints));
  return { id:String(row.id), name:row.name, position:row.position, team:row.team, projectedPoints:projection,
    weeklyProjection:projection/17, weeklyProjections:Array(18).fill(projection/17), previousPoints:finite(row.previousPoints),
    adp:Number.isFinite(adp)&&adp>0?adp:null, pprRank:adp, standardRank:adp, superflexRank:adp, injuryRisk:0, reliability:.7,
    actualWeekly:(row.actualWeekly||[]).map((value)=>finite(value)) };
}
function realized(roster, settings) {
  const rows=roster.map((p)=>({...p, projectedPoints:p.actualWeekly.reduce((sum,value)=>sum+finite(value),0), weeklyProjection:0, weeklyProjections:p.actualWeekly}));
  let total=0; for(let week=1;week<=17;week+=1) total+=core.optimizeWeeklyLineup(rows,settings,week).total; return total;
}
function settingsFor(teams,slot) { return core.cloneSettings({teams,rounds:16,scoring:"ppr",draftPosition:slot}); }
function seedKey(year,teams,slot,seed) { return `structure-confirm-v1:${year}:${teams}:${slot}:${seed}`; }
function blank() { return { delta:[], candidate:[], champion:[], candidateControls:Object.fromEntries(CONTROLS.map((c)=>[c,[]])), championControls:Object.fromEntries(CONTROLS.map((c)=>[c,[]])) }; }
function push(target,candidateScore,championScore,controls) {
  target.delta.push(candidateScore-championScore); target.candidate.push(candidateScore); target.champion.push(championScore);
  for(const control of CONTROLS) { target.candidateControls[control].push(candidateScore-controls[control]); target.championControls[control].push(championScore-controls[control]); }
}
function controlSummary(target,key) {
  return Object.fromEntries(CONTROLS.map((control)=>{ const values=target[key][control]; return [control,{edge:mean(values),winRate:values.filter((value)=>value>0).length/values.length}]; }));
}
function summarize(target) {
  return { n:target.delta.length, candidateMean:mean(target.candidate), championMean:mean(target.champion), championDelta:mean(target.delta),
    pairedWinRate:target.delta.filter((value)=>value>0).length/target.delta.length, candidateControls:controlSummary(target,"candidateControls"), championControls:controlSummary(target,"championControls") };
}
function gradeControls(controls) { return CONTROLS.every((control)=>controls[control].edge>=0&&controls[control].winRate>=.5) && controls["espn-market"].winRate>=.75; }
async function main() {
  const search=JSON.parse(fs.readFileSync(path.join(root,"data","validation","draft-structure-research.json"),"utf8"));
  const frozen=search.winner?.policy||{};
  for(const key of ["secondQbRound","secondTeRound","kickerRound","dstRound"]) if(Number(frozen[key])!==Number(candidate[key])) throw new Error(`candidate drift: ${key}`);
  if(search.excludedConsumedHoldout!==2018||!search.researchPass) throw new Error("development screen integrity failed");
  const archive=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,"data","validation","historical-ppr-2020-2025.json.gz"))).toString("utf8"));
  const built2019=await hist2019.buildPool(); const pools={2019:built2019.pool};
  for(const year of YEARS.filter((value)=>value!==2019)) pools[year]=(archive.drafts[String(year)]||[]).map(player).filter((p)=>p.adp!==null&&p.projectedPoints>0);
  const all=blank(), byYear=Object.fromEntries(YEARS.map((year)=>[year,blank()]));
  for(const year of YEARS) for(const [teams,bucket,slot] of SEGMENTS) {
    const settings=settingsFor(teams,slot);
    for(let seed=0;seed<SEEDS;seed+=1) {
      const common={players:pools[year],settings,userTeamId:slot,opponentStrategy:"mixed",seed:seedKey(year,teams,slot,seed)}, controls={};
      for(const control of CONTROLS) controls[control]=realized(draft.simulateDraft({...common,userStrategy:control}).userRoster,settings);
      const championScore=realized(draft.simulateDraft({...common,userStrategy:"oracle",oraclePolicy:champion}).userRoster,settings);
      const candidateScore=realized(draft.simulateDraft({...common,userStrategy:"oracle",oraclePolicy:candidate}).userRoster,settings);
      push(all,candidateScore,championScore,controls); push(byYear[year],candidateScore,championScore,controls);
    }
  }
  const aggregate=summarize(all), seasons=Object.fromEntries(YEARS.map((year)=>[year,summarize(byYear[year])]));
  const seasonDeltas=YEARS.map((year)=>seasons[year].championDelta);
  const leaveOneOut=YEARS.map((heldOut)=>({heldOut,meanDelta:mean(YEARS.filter((year)=>year!==heldOut).map((year)=>seasons[year].championDelta))}));
  const positiveSeasons=seasonDeltas.filter((value)=>value>0).length, candidateQualified=gradeControls(aggregate.candidateControls), championQualified=gradeControls(aggregate.championControls);
  const passed=aggregate.championDelta>0&&positiveSeasons>=5&&leaveOneOut.every((row)=>row.meanDelta>0)&&candidateQualified&&aggregate.candidateControls["espn-market"].winRate>=.75;
  const report={ version:"draft-structure-confirmation-2026.1", generatedAt:new Date().toISOString(), purpose:"fixed-candidate new-room-seed confirmation on consumed 2019-2025 outcomes; no candidate search",
    years:YEARS, consumedHoldoutExcluded:2018, seedNamespace:"structure-confirm-v1", seedsPerSegment:SEEDS, candidate, champion, aggregate, seasons, positiveSeasons, leaveOneOut,
    championQualified, candidateQualified, passed, interpretation:passed?"Fixed structural challenger survived disjoint room-randomness confirmation; prospective 2026 evidence is still required before serving promotion.":"Fixed structural challenger failed the preregistered confirmation and must remain rejected/non-serving.", servingEligible:false };
  fs.writeFileSync(path.join(root,"data","validation","draft-structure-confirmation.json"),`${JSON.stringify(report,null,2)}\n`);
  console.log(JSON.stringify({passed,positiveSeasons,aggregateDelta:+aggregate.championDelta.toFixed(3),pairedWin:+aggregate.pairedWinRate.toFixed(3),candidateQualified,seasonDeltas:Object.fromEntries(YEARS.map((year)=>[year,+seasons[year].championDelta.toFixed(3)])),looMin:+Math.min(...leaveOneOut.map((row)=>row.meanDelta)).toFixed(3)},null,2));
  if(!passed) process.exitCode=2;
}
main().catch((error)=>{ console.error(error.stack||error); process.exitCode=1; });

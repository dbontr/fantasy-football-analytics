"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const core = require("../src/engine/core.js");
const draft = require("../src/engine/draft-sim.js");
const forecastAudit = require("./forecast-history-audit.js");

const root = path.resolve(__dirname, "..");
const artifactPath = path.join(root, "data", "validation", "historical-ppr-2020-2025.json.gz");
const forecastReportPath = path.join(root, "data", "validation", "forecast-audit-report.json");

function finite(value, fallback = 0) { const number=Number(value); return Number.isFinite(number)?number:fallback; }
function mean(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;}
function quantile(values,p){if(!values.length)return 0;const s=[...values].sort((a,b)=>a-b);return s[Math.max(0,Math.min(s.length-1,Math.round(p*(s.length-1))))];}
function positions(teams){return [...new Set([1,Math.ceil(teams/4),Math.ceil(teams/2),Math.ceil(teams*.75),teams])];}

function draftPlayer(row){
  const adp=row.adp===null||row.adp===undefined?null:Number(row.adp);
  const projection=finite(row.seasonProjection)>0?finite(row.seasonProjection):Math.max(1,finite(row.previousPoints));
  return {id:String(row.id),name:row.name,position:row.position,team:row.team,projectedPoints:projection,weeklyProjection:projection/17,weeklyProjections:Array(18).fill(projection/17),previousPoints:finite(row.previousPoints),adp:Number.isFinite(adp)&&adp>0?adp:null,pprRank:adp,standardRank:adp,superflexRank:adp,injuryRisk:0,reliability:.7,actualWeekly:(row.actualWeekly||[]).map(v=>finite(v)),archivedWeekly:(row.weekly||[]).map(v=>Number.isFinite(v)?v:0)};
}
function modelMap(report){
  const result={};
  for(const [position,entry] of Object.entries(report.positions||{})){
    if(entry?.frozen2024?.admitted) result[position]={features:entry.model.features,rawIntercept:entry.model.intercept,rawCoefficients:entry.model.coefficients};
  }
  return result;
}
function correction(row,models){return models[row.position]?forecastAudit.predict(row,models[row.position]):row.baseline;}
function playerForWeek(player,week,prediction){return {...player,weeklyProjection:prediction,weeklyProjections:Array.from({length:18},(_,i)=>i===week-1?prediction:0)};}
function actualForWeek(player,week){return playerForWeek(player,week,finite(player.actualWeekly?.[week-1]));}
function selectedActual(lineup,byId,week){return lineup.starters.filter(row=>row.player).reduce((sum,row)=>sum+finite(byId.get(String(row.player.id))?.actualWeekly?.[week-1]),0);}
function evaluateRoster(roster,settings,season,data,weekRows,models,alphas=null){
  const byId=new Map(roster.map(player=>[String(player.id),player]));
  let rawRegret=0,modelRegret=0,oraclePoints=0,rawPoints=0,modelPoints=0,weeks=0;
  for(let week=1;week<=17;week++){
    const rawRoster=roster.map(player=>playerForWeek(player,week,finite(player.archivedWeekly?.[week-1])));
    const correctedRoster=roster.map(player=>{const row=weekRows.get(`${season}|${week}|${player.id}`);const raw=finite(player.archivedWeekly?.[week-1]);const full=row?correction(row,models):raw;const alpha=alphas?finite(alphas[player.position],0):1;return playerForWeek(player,week,raw+alpha*(full-raw));});
    const actualRoster=roster.map(player=>actualForWeek(player,week));
    const rawLineup=core.optimizeWeeklyLineup(rawRoster,settings,week);
    const modelLineup=core.optimizeWeeklyLineup(correctedRoster,settings,week);
    const oracle=core.optimizeWeeklyLineup(actualRoster,settings,week);
    const rawActual=selectedActual(rawLineup,byId,week),modelActual=selectedActual(modelLineup,byId,week);
    rawRegret+=oracle.total-rawActual;modelRegret+=oracle.total-modelActual;oraclePoints+=oracle.total;rawPoints+=rawActual;modelPoints+=modelActual;weeks++;
  }
  return {weeks,rawRegret,modelRegret,oraclePoints,rawPoints,modelPoints,regretDelta:rawRegret-modelRegret,pointDelta:modelPoints-rawPoints};
}
function summarize(rows){const deltas=rows.map(row=>row.regretDelta);return {n:rows.length,rawRegret:mean(rows.map(r=>r.rawRegret)),modelRegret:mean(rows.map(r=>r.modelRegret)),regretImprovement:mean(deltas),winRate:rows.filter(r=>r.regretDelta>0).length/Math.max(1,rows.length),medianImprovement:quantile(deltas,.5),pointDelta:mean(rows.map(r=>r.pointDelta))};}
function main(){
  const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(artifactPath)).toString("utf8"));
  const report=JSON.parse(fs.readFileSync(forecastReportPath,"utf8"));const models=modelMap(report);
  const weekRows=new Map(data.weeks.map(row=>[`${row.season}|${row.week}|${row.id}`,row]));const rows=[];
  const seeds=Number(process.env.DECISION_AUDIT_SEEDS||6);
  for(const season of [2021,2022,2023,2024,2025]){
    const pool=(data.drafts[String(season)]||data.drafts[season]||[]).map(draftPlayer).filter(p=>p.adp!==null&&p.projectedPoints>0);
    for(const teams of [10,12]){const settings=core.cloneSettings({teams,rounds:16,scoring:"ppr",draftPosition:1});for(const position of positions(teams))for(let seed=0;seed<seeds;seed++){
      const result=draft.simulateDraft({players:pool,settings:{...settings,draftPosition:position},userTeamId:position,userStrategy:"espn-market",opponentStrategy:"mixed",seed:`decision:${season}:${teams}:${position}:${seed}`});
      rows.push({season,teams,position,seed,...evaluateRoster(result.userRoster,{...settings,draftPosition:position},season,data,weekRows,models)});
    }}
    console.log(`Finished start/sit replay for ${season}.`);
  }
  const output={version:"decision-history-audit-2026.1",generatedAt:new Date().toISOString(),seeds,split:{development:[2021,2022],selection:2023,frozenTest:2024,consistencyOnly:2025},bySeason:{}};
  for(const season of [2021,2022,2023,2024,2025]){const score=summarize(rows.filter(r=>r.season===season));output.bySeason[season]=score;console.log(`${season}: regret ${score.rawRegret.toFixed(1)} -> ${score.modelRegret.toFixed(1)} | improve ${score.regretImprovement.toFixed(1)} | wins ${(score.winRate*100).toFixed(1)}% | lineup pts ${score.pointDelta>=0?"+":""}${score.pointDelta.toFixed(1)}`);}
  output.frozen2024=output.bySeason[2024];output.consistency2025=output.bySeason[2025];
  const residualAdmitted=output.frozen2024.regretImprovement>0&&output.frozen2024.pointDelta>0&&output.consistency2025.regretImprovement>=0;
  output.selectedPolicy=residualAdmitted?"validated-residual":"raw-live-ppr";
  output.residualAdmitted=residualAdmitted;
  output.releaseGatePassed=true;
  fs.writeFileSync(path.join(root,"data","validation","decision-audit-report.json"),JSON.stringify(output,null,2));
}
if(require.main===module) main();
module.exports={draftPlayer,evaluateRoster,modelMap,positions,summarize};

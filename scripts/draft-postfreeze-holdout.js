"use strict";

const fs = require("node:fs");
const path = require("node:path");
const hist = require("./lib/historical-data.js");
const intel = require("../src/engine/intelligence.js");
const core = require("../src/engine/core.js");
const draft = require("../src/engine/draft-sim.js");

const root = path.resolve(__dirname, "..");
const policyReport = JSON.parse(fs.readFileSync(path.join(root, "data", "validation", "draft-segmented-policy.json"), "utf8"));
const SEASON = 2019;
const CONTROLS = ["espn-market", "balanced", "value", "need-heavy", "zero-rb"];
const POSITION_BY_ID = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST" };
const TEAM_BY_ID = { 0:"FA",1:"ATL",2:"BUF",3:"CHI",4:"CIN",5:"CLE",6:"DAL",7:"DEN",8:"DET",9:"GB",10:"TEN",11:"IND",12:"KC",13:"LV",14:"LA",15:"MIA",16:"MIN",17:"NE",18:"NO",19:"NYG",20:"NYJ",21:"PHI",22:"ARI",23:"PIT",24:"LAC",25:"SF",26:"SEA",27:"TB",28:"WAS",29:"CAR",30:"JAX",33:"BAL",34:"HOU" };

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function canonicalTeam(value) { const t=String(value||"").toUpperCase(); return ({LAR:"LA",STL:"LA",WSH:"WAS",JAC:"JAX",OAK:"LV",SD:"LAC"})[t]||t; }
function htmlText(value) { return String(value||"").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g," ").replace(/\s+/g," ").trim(); }
function playerKey(name, position) { return `${intel.normalizeName(name)}|${String(position||"").toUpperCase()}`; }
function slotValue(teams, bucket) { return bucket === "early" ? 1 : bucket === "middle" ? Math.ceil(teams / 2) : teams; }
function segmentKey(teams, bucket) { return `${teams}-${bucket}`; }
function espnPlayers(payload) {
  const rows=[];
  for (const wrapper of payload?.players || []) {
    const p=wrapper.player||{}, position=POSITION_BY_ID[Number(p.defaultPositionId)]; if(!position)continue;
    const actualWeekly=Array(18).fill(0); let seasonProjection=null, previousPoints=null;
    for (const stat of p.stats||[]) {
      const source=Number(stat.statSourceId), split=Number(stat.statSplitTypeId), week=Number(stat.scoringPeriodId), season=Number(stat.seasonId);
      if(season===SEASON&&source===0&&split===1&&week>=1&&week<=18) actualWeekly[week-1]=finite(stat.appliedTotal);
      if(season===SEASON&&source===1&&split===0&&week===0) seasonProjection=finite(stat.appliedTotal);
      if(season===SEASON-1&&source===0&&split===0&&week===0) previousPoints=finite(stat.appliedTotal);
    }
    rows.push({ id:String(p.id||wrapper.id), name:String(p.fullName||""), position, team:canonicalTeam(TEAM_BY_ID[Number(p.proTeamId)]||"FA"), seasonProjection, previousPoints, actualWeekly });
  }
  return rows;
}
function parseFantasyDataAdp(text, position) {
  const rows=[];
  for(const match of String(text||"").matchAll(/<tr class='(?:shaded)?'>(.*?)<\/tr>/gs)){
    const cells=[...match[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((cell)=>htmlText(cell[1]));
    if(position==="DST") { if(cells.length<5)continue; const [rank,team,,posRank,adp]=cells; if(!/^DST\d+$/i.test(posRank))continue; rows.push({rank:+rank,name:`${team} D/ST`,team:canonicalTeam(team),position,adp:+adp}); }
    else { if(cells.length<8)continue; const [rank,name,team,,,pos,,adp]=cells; if(String(pos).toUpperCase()!==position)continue; rows.push({rank:+rank,name,team:canonicalTeam(team),position,adp:+adp}); }
  }
  return rows.filter((row)=>Number.isFinite(row.adp)&&row.adp>0);
}
async function fantasyDataAdp() {
  const slugs={QB:"qb",RB:"rb",WR:"wr",TE:"te",K:"k",DST:"dst"}, rows=[], sources=[];
  for(const [position,slug] of Object.entries(slugs)) {
    const asset=await hist.fetchCached(`https://fantasydata.com/nfl/ppr-adp/${slug}?season=${SEASON}`,`postfreeze-fantasydata-ppr-adp-${position}-${SEASON}.html`);
    rows.push(...parseFantasyDataAdp(hist.text(asset),position)); sources.push({position,url:asset.url,sha256:asset.sha256,bytes:asset.bytes.length});
  }
  return {rows,sources};
}
function historicalPlayer(row) {
  const projection=finite(row.seasonProjection)>0?finite(row.seasonProjection):Math.max(1,finite(row.previousPoints));
  return { ...row, projectedPoints:projection, weeklyProjection:projection/17, weeklyProjections:Array(18).fill(projection/17), adp:row.adp, pprRank:row.adp, standardRank:row.adp, superflexRank:row.adp, injuryRisk:0, reliability:.7 };
}
function realized(roster, settings) {
  const rows=roster.map((player)=>({ ...player, projectedPoints:player.actualWeekly.reduce((sum,value)=>sum+finite(value),0), weeklyProjection:0, weeklyProjections:player.actualWeekly }));
  let total=0; for(let week=1;week<=17;week++) total+=core.optimizeWeeklyLineup(rows,settings,week).total; return total;
}
function evaluate(pool, seeds=8) {
  const edges=Object.fromEntries(CONTROLS.map((control)=>[control,[]])), scores=[];
  for(const teams of [10,12]) for(const bucket of ["early","middle","late"]) {
    const slot=slotValue(teams,bucket), policy=policyReport.segments?.[segmentKey(teams,bucket)]?.policy;
    if(!policy) throw new Error(`Missing frozen draft policy ${segmentKey(teams,bucket)}`);
    const settings=core.cloneSettings({teams,rounds:16,scoring:"ppr",draftPosition:slot});
    for(let seed=0;seed<seeds;seed++) {
      const common={players:pool,settings,userTeamId:slot,opponentStrategy:"mixed",seed:`postfreeze:${SEASON}:${teams}:${slot}:${seed}`};
      const oracle=draft.simulateDraft({...common,userStrategy:"oracle",oraclePolicy:policy}); const score=realized(oracle.userRoster,settings); scores.push(score);
      for(const control of CONTROLS) { const baseline=draft.simulateDraft({...common,userStrategy:control}); edges[control].push(score-realized(baseline.userRoster,settings)); }
    }
  }
  return { meanRealized:mean(scores), controls:Object.fromEntries(CONTROLS.map((control)=>[control,{n:edges[control].length,edge:mean(edges[control]),winRate:edges[control].filter((value)=>value>0).length/edges[control].length}])) };
}
async function main() {
  const espn=await hist.espnSeason(SEASON,3), marketResult=await fantasyDataAdp(), market=marketResult.rows;
  const adpByKey=new Map(market.map((row)=>[row.position==="DST"?`DST|${row.team}`:playerKey(row.name,row.position),row]));
  const pool=espnPlayers(espn.payload).map((row)=>{const marketRow=adpByKey.get(row.position==="DST"?`DST|${row.team}`:playerKey(row.name,row.position));return {...row,adp:marketRow?.adp??null};}).map(historicalPlayer).filter((row)=>Number.isFinite(row.adp)&&row.adp>0&&row.projectedPoints>0);
  if(pool.length<180) throw new Error(`2019 holdout pool too small: ${pool.length}`);
  const result=evaluate(pool,8), controls=result.controls;
  const admitted=CONTROLS.every((control)=>controls[control].edge>=0&&controls[control].winRate>=.5)&&controls["espn-market"].edge>0&&controls["espn-market"].winRate>=.75;
  const report={version:"draft-postfreeze-holdout-2026.1",generatedAt:new Date().toISOString(),season:SEASON,policyArtifact:policyReport.version,policyFrozenBeforeInspection:true,poolPlayers:pool.length,sources:{espn:{url:espn.url,sha256:espn.sha256,bytes:espn.bytes.length},fantasyData:marketResult.sources},result,admitted};
  fs.writeFileSync(path.join(root,"data","validation","draft-postfreeze-holdout.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2)); if(!admitted) process.exitCode=2;
}
main().catch((error)=>{console.error(error.stack||error);process.exitCode=1;});

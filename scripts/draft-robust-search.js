"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const core = require("../src/engine/core.js");
const draft = require("../src/engine/draft-sim.js");

const root = path.resolve(__dirname, "..");
const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "data", "validation", "historical-ppr-2020-2025.json.gz"))).toString("utf8"));
const SEASONS = [2020, 2021, 2022, 2023, 2024, 2025];
const CONTROLS = ["espn-market", "balanced", "value", "need-heavy", "zero-rb"];
const SEGMENTS = [[10,"early",1],[10,"middle",5],[10,"late",10],[12,"early",1],[12,"middle",6],[12,"late",12]];
function finite(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function mean(v){return v.length?v.reduce((a,b)=>a+b,0)/v.length:0;}
function player(row){const adp=Number(row.adp),p=finite(row.seasonProjection)>0?finite(row.seasonProjection):Math.max(1,finite(row.previousPoints));return{id:String(row.id),name:row.name,position:row.position,team:row.team,projectedPoints:p,weeklyProjection:p/17,weeklyProjections:Array(18).fill(p/17),previousPoints:finite(row.previousPoints),adp:Number.isFinite(adp)&&adp>0?adp:null,pprRank:adp,standardRank:adp,superflexRank:adp,injuryRisk:0,reliability:.7,actualWeekly:(row.actualWeekly||[]).map(finite)};}
function realized(roster,settings){const rows=roster.map(p=>({...p,projectedPoints:p.actualWeekly.reduce((s,v)=>s+finite(v),0),weeklyProjection:0,weeklyProjections:p.actualWeekly}));let total=0;for(let w=1;w<=17;w++)total+=core.optimizeWeeklyLineup(rows,settings,w).total;return total;}
const pools=Object.fromEntries(SEASONS.map(y=>[y,(data.drafts[String(y)]||[]).map(player).filter(p=>p.adp!==null&&p.projectedPoints>0)]));
function settingsFor(teams,slot){return core.cloneSettings({teams,rounds:16,scoring:"ppr",draftPosition:slot});}
function seedKey(y,t,s,k){return `robust:${y}:${t}:${s}:${k}`;}
function baselineTable(seeds){
  const out={};
  for(const y of SEASONS) for(const [teams,bucket,slot] of SEGMENTS){
    const settings=settingsFor(teams,slot);
    for(let k=0;k<seeds;k++){
      const key=`${y}|${teams}|${bucket}|${k}`; out[key]={};
      for(const control of CONTROLS){
        const r=draft.simulateDraft({players:pools[y],settings,userTeamId:slot,userStrategy:control,opponentStrategy:"mixed",seed:seedKey(y,teams,slot,k)});
        out[key][control]=realized(r.userRoster,settings);
      }
    }
  }
  return out;
}
function evaluate(policy,seeds,baselines){
  const cells=Object.fromEntries(CONTROLS.map(c=>[c,[]]));
  const seasons={};
  for(const y of SEASONS){
    seasons[y]=Object.fromEntries(CONTROLS.map(c=>[c,[]]));
    for(const [teams,bucket,slot] of SEGMENTS){
      const settings=settingsFor(teams,slot);
      for(let k=0;k<seeds;k++){
        const key=`${y}|${teams}|${bucket}|${k}`;
        const r=draft.simulateDraft({players:pools[y],settings,userTeamId:slot,userStrategy:"oracle",oraclePolicy:policy,opponentStrategy:"mixed",seed:seedKey(y,teams,slot,k)});
        const score=realized(r.userRoster,settings);
        for(const c of CONTROLS){ const edge=score-baselines[key][c]; cells[c].push(edge); seasons[y][c].push(edge); }
      }
    }
  }
  const controls=Object.fromEntries(CONTROLS.map(c=>[c,{edge:mean(cells[c]),win:cells[c].filter(v=>v>0).length/cells[c].length}]));
  let passCells=0,worstEdge=Infinity,worstWin=Infinity;
  for(const y of SEASONS) for(const c of CONTROLS){ const a=seasons[y][c],e=mean(a),w=a.filter(v=>v>0).length/a.length; if(e>=0&&w>=.5) passCells++; worstEdge=Math.min(worstEdge,e); worstWin=Math.min(worstWin,w); }
  return {policy,controls,passCells,worstEdge,worstWin};
}
function candidates(){
  const rows=[];
  for(const market of [.5,.58,.62,.66,.7,.74,.78,.82,.9]) for(const value of [.08,.12,.16,.18,.2,.24,.28]) for(const need of [.75,.9,1,1.1,1.2,1.35,1.5,1.7]) rows.push({...draft.DEFAULT_ORACLE_POLICY,market,value,need,rookie:0});
  return rows;
}
function rankScore(r){
  const minControl=Math.min(...CONTROLS.map(c=>r.controls[c].edge));
  const minWin=Math.min(...CONTROLS.map(c=>r.controls[c].win));
  return r.passCells*1e6 + Math.min(0,r.worstEdge)*1e3 + Math.min(0,r.worstWin-.5)*1e5 + minControl*100 + minWin*1000 + r.controls["espn-market"].edge;
}
function compact(r){ return {policy:{market:r.policy.market,value:r.policy.value,need:r.policy.need},passCells:r.passCells,worstEdge:+r.worstEdge.toFixed(1),worstWin:+r.worstWin.toFixed(3),controls:Object.fromEntries(CONTROLS.map(c=>[c,{edge:+r.controls[c].edge.toFixed(1),win:+r.controls[c].win.toFixed(3)}]))}; }
function main(){
  console.log(`searching ${candidates().length} policies across ${SEASONS.join(",")}`);
  const base1=baselineTable(1);
  const coarse=candidates().map((p,i)=>{ if(i%60===0) console.log(`coarse ${i}`); const r=evaluate(p,1,base1); r.rank=rankScore(r); return r; }).sort((a,b)=>b.rank-a.rank);
  console.log("COARSE_TOP"); coarse.slice(0,12).forEach(r=>console.log(JSON.stringify(compact(r))));
  const finalists=coarse.slice(0,12).map(r=>r.policy);
  const base4=baselineTable(4);
  const fine=finalists.map(p=>{ const r=evaluate(p,4,base4); r.rank=rankScore(r); return r; }).sort((a,b)=>b.rank-a.rank);
  console.log("FINE_TOP"); fine.forEach(r=>console.log(JSON.stringify(compact(r))));
  fs.writeFileSync(path.join(root,"data","validation","draft-robust-search.json"),JSON.stringify({version:"draft-robust-search-2026.1",generatedAt:new Date().toISOString(),developmentSeasons:SEASONS,coarseSeeds:1,fineSeeds:4,top:fine.slice(0,12).map(compact)},null,2));
}
main();

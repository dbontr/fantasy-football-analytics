"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const audit = require("./forecast-history-audit.js");
const legacy = require("../src/engine/calibration.js");

const root = path.resolve(__dirname, "..");
const artifactPath = path.join(root, "data", "validation", "historical-ppr-2020-2025.json.gz");
const reportPath = path.join(root, "data", "validation", "forecast-audit-report.json");
const POSITIONS = ["QB", "RB", "WR", "TE"];
const BINS = [2, 6, 10, 14, 18, Infinity];
const Z80 = 1.2815515655446004;
const SHRINKAGE = 120;

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function mean(values) { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0; }
function quantile(values, p) { if(!values.length)return 0; const s=[...values].sort((a,b)=>a-b); const x=(s.length-1)*p,lo=Math.floor(x),hi=Math.ceil(x),t=x-lo; return s[lo]*(1-t)+s[hi]*t; }
function binIndex(value) { for(let i=0;i<BINS.length-1;i++) if(value>=BINS[i]&&value<BINS[i+1]) return i; return BINS.length-2; }
function pinball(actual, prediction, q) { const e=actual-prediction; return e>=0?q*e:(q-1)*e; }

function modelFor(position, report) {
  const entry=report.positions[position];
  if(!entry?.frozen2024?.admitted) return null;
  return {features:entry.model.features,rawIntercept:entry.model.intercept,rawCoefficients:entry.model.coefficients};
}
function prediction(row, report) {
  const model=modelFor(row.position,report);
  return model ? audit.predict(row,model) : row.baseline;
}
function fitCv(data, report) {
  const training=data.weeks.filter(r=>r.season>=2021&&r.season<=2023&&POSITIONS.includes(r.position)&&r.baseline>=2);
  const byPosition=new Map(),byBucket=new Map();
  for(const row of training){
    const pred=Math.max(2,prediction(row,report));
    const scaled=Math.abs(row.actual-pred)/pred;
    if(!byPosition.has(row.position))byPosition.set(row.position,[]);byPosition.get(row.position).push(scaled);
    const key=`${row.position}|${binIndex(pred)}`;if(!byBucket.has(key))byBucket.set(key,[]);byBucket.get(key).push(scaled);
  }
  const table={};
  for(const position of POSITIONS){
    const pos=byPosition.get(position)||[];const posQ=quantile(pos,.8);table[position]=[];
    for(let bin=0;bin<BINS.length-1;bin++){
      const values=byBucket.get(`${position}|${bin}`)||[];const q=values.length?quantile(values,.8):posQ;
      const shrunk=(q*values.length+posQ*SHRINKAGE)/(values.length+SHRINKAGE);
      table[position][bin]={samples:values.length,absoluteRelativeQ80:shrunk,cv:shrunk/Z80};
    }
  }
  return table;
}
function cvFor(table,position,predictionValue){const row=table[position]?.[binIndex(predictionValue)];return row?row.cv:null;}

function score(rows, report, cvResolver) {
  let covered=0,width=0,qLoss=0;
  for(const row of rows){
    const pred=prediction(row,report);const cv=cvResolver(row,pred);const half=Z80*Math.max(1,pred)*cv;
    const low=Math.max(0,pred-half),high=pred+half;
    if(row.actual>=low&&row.actual<=high)covered++;
    width+=high-low;
    qLoss+=pinball(row.actual,low,.1)+pinball(row.actual,high,.9);
  }
  return {n:rows.length,coverage:covered/Math.max(1,rows.length),meanWidth:width/Math.max(1,rows.length),quantileLoss:qLoss/Math.max(1,rows.length)};
}
function fmt(v,d=3){return Number.isFinite(v)?v.toFixed(d):"-";}
function main(){
  const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(artifactPath)).toString("utf8"));
  const report=JSON.parse(fs.readFileSync(reportPath,"utf8"));
  const table=fitCv(data,report);const output={version:"uncertainty-history-audit-2026.1",generatedAt:new Date().toISOString(),training:[2021,2022,2023],frozenTest:2024,consistencyOnly:2025,bins:BINS,shrinkage:SHRINKAGE,table,positions:{}};
  console.log("SnapCount exact-anchor uncertainty audit");
  console.log("Training 2021-2023 | frozen 2024 | 2025 consistency only | target central coverage 80%\n");
  for(const position of POSITIONS){
    const frozen=data.weeks.filter(r=>r.season===2024&&r.position===position&&r.baseline>=2);
    const consistency=data.weeks.filter(r=>r.season===2025&&r.position===position&&r.baseline>=2);
    const empirical=(row,pred)=>cvFor(table,row.position,pred);
    const old=(row,pred)=>legacy.empiricalCv(row.position,pred);
    const frozenOld=score(frozen,report,old),frozenNew=score(frozen,report,empirical),checkOld=score(consistency,report,old),checkNew=score(consistency,report,empirical);
    output.positions[position]={frozen2024:{legacy:frozenOld,empirical:frozenNew},consistency2025:{legacy:checkOld,empirical:checkNew}};
    console.log(`${position}: 2024 coverage ${fmt(frozenOld.coverage*100,1)}% -> ${fmt(frozenNew.coverage*100,1)}% | width ${fmt(frozenOld.meanWidth)} -> ${fmt(frozenNew.meanWidth)} | qloss ${fmt(frozenOld.quantileLoss)} -> ${fmt(frozenNew.quantileLoss)}`);
  }
  const all2024=data.weeks.filter(r=>r.season===2024&&POSITIONS.includes(r.position)&&r.baseline>=2);
  const all2025=data.weeks.filter(r=>r.season===2025&&POSITIONS.includes(r.position)&&r.baseline>=2);
  const empirical=(row,pred)=>cvFor(table,row.position,pred),old=(row,pred)=>legacy.empiricalCv(row.position,pred);
  output.overall={frozen2024:{legacy:score(all2024,report,old),empirical:score(all2024,report,empirical)},consistency2025:{legacy:score(all2025,report,old),empirical:score(all2025,report,empirical)}};
  console.log("\nOverall");
  console.log(`2024 coverage ${fmt(output.overall.frozen2024.legacy.coverage*100,1)}% -> ${fmt(output.overall.frozen2024.empirical.coverage*100,1)}%, quantile loss ${fmt(output.overall.frozen2024.legacy.quantileLoss)} -> ${fmt(output.overall.frozen2024.empirical.quantileLoss)}`);
  console.log(`2025 coverage ${fmt(output.overall.consistency2025.legacy.coverage*100,1)}% -> ${fmt(output.overall.consistency2025.empirical.coverage*100,1)}%, quantile loss ${fmt(output.overall.consistency2025.legacy.quantileLoss)} -> ${fmt(output.overall.consistency2025.empirical.quantileLoss)}`);
  output.selected="production-existing";
  output.admitted=Math.abs(output.overall.frozen2024.legacy.coverage-.8)<=.03
    && Math.abs(output.overall.consistency2025.legacy.coverage-.8)<=.03;
  fs.writeFileSync(path.join(root,"data","validation","uncertainty-audit-report.json"),JSON.stringify(output,null,2));
  if(!output.admitted)process.exitCode=2;
}
main();

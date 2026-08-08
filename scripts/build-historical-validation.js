"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const hist = require("./lib/historical-data.js");
const intel = require("../src/engine/intelligence.js");

const TARGET_SEASONS = [2020, 2021, 2022, 2023, 2024, 2025];
const SOURCE_SEASONS = [2019, ...TARGET_SEASONS];
const POSITIONS = ["QB", "RB", "WR", "TE"];
const DRAFT_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];
const POSITION_BY_ID = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST" };
const TEAM_BY_ID = { 0:"FA",1:"ATL",2:"BUF",3:"CHI",4:"CIN",5:"CLE",6:"DAL",7:"DEN",8:"DET",9:"GB",10:"TEN",11:"IND",12:"KC",13:"LV",14:"LA",15:"MIA",16:"MIN",17:"NE",18:"NO",19:"NYG",20:"NYJ",21:"PHI",22:"ARI",23:"PIT",24:"LAC",25:"SF",26:"SEA",27:"TB",28:"WAS",29:"CAR",30:"JAX",33:"BAL",34:"HOU" };

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function nullable(value) { const n = Number(value); return value === "" || !Number.isFinite(n) ? null : n; }
function clamp(value, lo, hi) { return Math.min(hi, Math.max(lo, finite(value, lo))); }
function mean(values) { return values.length ? values.reduce((a,b)=>a+b,0) / values.length : null; }
function canonicalTeam(value) { const t=String(value||"").toUpperCase(); return ({LAR:"LA",STL:"LA",WSH:"WAS",JAC:"JAX",OAK:"LV",SD:"LAC"})[t]||t; }
function playerKey(name, position) { return `${intel.normalizeName(name)}|${String(position||"").toUpperCase()}`; }
function weightedMean(rows, getter, count = 3) {
  const selected = rows.slice(-count); let n=0,d=0;
  selected.forEach((row,index)=>{const v=getter(row);if(Number.isFinite(v)){const w=index+1;n+=v*w;d+=w;}});
  return d ? n/d : null;
}

function espnPlayers(payload, season) {
  const rows = [];
  for (const wrapper of payload?.players || []) {
    const p = wrapper.player || {};
    const position = POSITION_BY_ID[Number(p.defaultPositionId)];
    if (!position) continue;
    const weekly = Array(18).fill(null);
    const actualWeekly = Array(18).fill(null);
    let seasonProjection = null, previousPoints = null;
    for (const stat of p.stats || []) {
      const statSeason = Number(stat.seasonId), source = Number(stat.statSourceId), split = Number(stat.statSplitTypeId), week = Number(stat.scoringPeriodId);
      if (statSeason === season && source === 1 && split === 1 && week >= 1 && week <= 18) weekly[week - 1] = finite(stat.appliedTotal);
      if (statSeason === season && source === 0 && split === 1 && week >= 1 && week <= 18) actualWeekly[week - 1] = finite(stat.appliedTotal);
      if (statSeason === season && source === 1 && split === 0 && week === 0) seasonProjection = finite(stat.appliedTotal);
      if (statSeason === season - 1 && source === 0 && split === 0 && week === 0) previousPoints = finite(stat.appliedTotal);
    }
    const ownership = p.ownership || {};
    rows.push({
      id: String(p.id || wrapper.id), name: String(p.fullName || ""), position,
      team: canonicalTeam(TEAM_BY_ID[Number(p.proTeamId)] || "FA"), weekly, actualWeekly,
      seasonProjection, previousPoints, adp: nullable(ownership.averageDraftPosition),
      pprRank: nullable(p?.draftRanksByRankType?.PPR?.rank), standardRank: nullable(p?.draftRanksByRankType?.STANDARD?.rank),
      superflexRank: nullable(p?.draftRanksByRankType?.SUPERFLEX?.rank), auctionValue: nullable(ownership.auctionValueAverage),
    });
  }
  return rows;
}

function htmlText(value) {
  return String(value || "").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
function parseFantasyDataAdp(text, position) {
  const rows=[];
  for(const match of String(text||"").matchAll(/<tr class='(?:shaded)?'>(.*?)<\/tr>/gs)){
    const cells=[...match[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((cell)=>htmlText(cell[1]));
    if(position==="DST"){
      if(cells.length<5)continue;
      const [rank,team,,posRank,adp]=cells;
      if(!/^DST\d+$/i.test(posRank))continue;
      rows.push({rank:+rank,name:`${team} D/ST`,team:canonicalTeam(team),position:"DST",positionRank:posRank,adp:+adp});
    } else {
      if(cells.length<8)continue;
      const [rank,name,team,,,pos,posRank,adp]=cells;
      if(String(pos).toUpperCase()!==position)continue;
      rows.push({rank:+rank,name,team:canonicalTeam(team),position,positionRank:posRank,adp:+adp});
    }
  }
  return rows.filter((row)=>Number.isFinite(row.adp)&&row.adp>0);
}
async function fantasyDataAdp(season,sources){
  const slugs={QB:"qb",RB:"rb",WR:"wr",TE:"te",K:"k",DST:"dst"};
  const output=[];
  for(const [position,slug] of Object.entries(slugs)){
    const url=`https://fantasydata.com/nfl/ppr-adp/${slug}?season=${season}`;
    const asset=await hist.fetchCached(url,`fantasydata-ppr-adp-${position}-${season}.html`);
    asset.assetName=`fantasydata-ppr-adp-${position}-${season}.html`;sources.push(asset);
    output.push(...parseFantasyDataAdp(hist.text(asset),position));
  }
  return output;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows || []) { const key = keyFn(row); if (!map.has(key)) map.set(key, []); map.get(key).push(row); }
  return map;
}
function priorRows(map, key, season, week, count = 8) {
  const rows = (map.get(key) || []).filter((row) => row.season < season || (row.season === season && row.week < week));
  return rows.slice(-count);
}

function parseXfp(text) {
  return intel.parseXfpWeeklyCsv(text).map((row) => ({ ...row, team: canonicalTeam(row.team) }));
}
function parseInjuries(text) {
  return hist.parseCsv(text, ["season","team","week","gsis_id","position","full_name","report_status","practice_status","date_modified"]).map((row) => ({
    season:+row.season, team:canonicalTeam(row.team), week:+row.week, gsisId:row.gsis_id, position:String(row.position||"").toUpperCase(), name:row.full_name,
    reportStatus:String(row.report_status||""), practiceStatus:String(row.practice_status||""), modified:row.date_modified,
  }));
}
function parseSnaps(text) {
  return hist.parseCsv(text, ["season","week","player","position","team","offense_pct"]).map((row) => ({
    season:+row.season, week:+row.week, name:row.player, position:String(row.position||"").toUpperCase(), team:canonicalTeam(row.team), offensePct:nullable(row.offense_pct),
  })).filter((row)=>row.week>0 && row.offensePct!==null);
}
function parseDepth(text) {
  return hist.parseCsv(text, ["season","club_code","week","game_type","depth_team","formation","gsis_id","position","depth_position","full_name"]).map((row) => ({
    season:+row.season, team:canonicalTeam(row.club_code), week:+row.week, gameType:row.game_type, depthTeam:+row.depth_team,
    formation:row.formation, gsisId:row.gsis_id, position:String(row.position||"").toUpperCase(), depthPosition:String(row.depth_position||"").toUpperCase(), name:row.full_name,
  })).filter((row)=>row.gameType==="REG" && row.week>0);
}
function parseGames(text) {
  return hist.parseCsv(text, ["game_id","season","game_type","week","away_team","home_team","spread_line","total_line","roof","temp","wind","away_qb_name","home_qb_name","away_coach","home_coach"]).map((row)=>({
    gameId:row.game_id, season:+row.season, gameType:row.game_type, week:+row.week, away:canonicalTeam(row.away_team), home:canonicalTeam(row.home_team),
    spread:nullable(row.spread_line), total:nullable(row.total_line), roof:String(row.roof||""), temp:nullable(row.temp), wind:nullable(row.wind),
    awayQb:row.away_qb_name, homeQb:row.home_qb_name, awayCoach:row.away_coach, homeCoach:row.home_coach,
  })).filter((row)=>row.gameType==="REG");
}

function addCarryShare(rows) {
  const teamCarries = new Map();
  for (const row of rows) {
    const key=`${row.season}|${row.week}|${canonicalTeam(row.team)}`;
    teamCarries.set(key, finite(teamCarries.get(key)) + Math.max(0, finite(row.carries)));
  }
  for (const row of rows) {
    row.team=canonicalTeam(row.team); row.opponent=canonicalTeam(row.opponent);
    const total=teamCarries.get(`${row.season}|${row.week}|${row.team}`)||0;
    row.carryShare=total>0 ? clamp(row.carries/total,0,1) : null;
  }
}
function defenseProfiles(previousRows) {
  const games = new Map(), league = new Map();
  for (const row of previousRows) {
    if (row.seasonType!=="REG" || !POSITIONS.includes(row.position)) continue;
    const key=`${row.week}|${canonicalTeam(row.opponent)}|${row.position}`;
    games.set(key, finite(games.get(key)) + Math.max(0,finite(row.fantasyPpr)));
  }
  const defense = new Map();
  for (const [key,points] of games) {
    const [,team,pos]=key.split("|"); const dk=`${team}|${pos}`;
    const d=defense.get(dk)||{points:0,games:0};d.points+=points;d.games++;defense.set(dk,d);
    const l=league.get(pos)||{points:0,games:0};l.points+=points;l.games++;league.set(pos,l);
  }
  const out=new Map();
  for(const [key,d] of defense){const pos=key.split("|")[1],l=league.get(pos);if(!l?.games||d.games<3)continue;const avg=l.points/l.games;const shrunk=(d.points+avg*4)/(d.games+4);out.set(key,clamp((shrunk/avg-1)/0.22,-1,1));}
  return out;
}

function teamWeekFeatures(statsRows) {
  const map = new Map();
  for (const row of statsRows) {
    if (row.seasonType!=="REG") continue;
    const key=`${row.season}|${row.week}|${row.team}`;
    const v=map.get(key)||{attempts:0,carries:0,targets:0,targetByPos:{RB:0,WR:0,TE:0},qbs:[]};
    v.carries+=Math.max(0,finite(row.carries));
    if (["RB","WR","TE"].includes(row.position)) {v.targets+=Math.max(0,finite(row.targets));v.targetByPos[row.position]+=Math.max(0,finite(row.targets));}
    if(row.position==="QB"&&row.attempts>0){v.attempts+=row.attempts;v.qbs.push({name:row.name,attempts:row.attempts});}
    map.set(key,v);
  }
  for(const v of map.values()){v.plays=v.attempts+v.carries;v.passRate=v.plays? v.attempts/v.plays:null;v.qbs.sort((a,b)=>b.attempts-a.attempts);v.starter=v.qbs[0]?.name||null;for(const pos of ["RB","WR","TE"])v[`${pos.toLowerCase()}TargetRate`]=v.targets?v.targetByPos[pos]/v.targets:null;}
  return map;
}
function teamHistory(teamMap, team, season, week) {
  const rows=[];
  for(const [key,value] of teamMap){const [s,w,t]=key.split("|");if(t!==team)continue;const sn=+s,wn=+w;if(sn<season||(sn===season&&wn<week))rows.push({season:sn,week:wn,...value});}
  rows.sort((a,b)=>a.season-b.season||a.week-b.week);return rows;
}
function qbHistory(statsByPlayer, qbName, season, week) {
  const rows=priorRows(statsByPlayer,playerKey(qbName,"QB"),season,week,8).filter((r)=>r.attempts>0);
  const attempts=rows.reduce((s,r)=>s+r.attempts,0); if(!attempts)return {quality:null};
  const passPoints=rows.reduce((s,r)=>s+r.passingYards*0.04+r.passingTds*4-r.interceptions*2,0);
  return {quality:passPoints/attempts, attempts};
}

function qbStyle(teamMap, qbName, season, week) {
  const normalized=intel.normalizeName(qbName); const rows=[];
  for(const [key,v] of teamMap){const [s,w]=key.split("|");const sn=+s,wn=+w;if(!(sn<season||(sn===season&&wn<week)))continue;if(intel.normalizeName(v.starter)===normalized)rows.push({season:sn,week:wn,...v});}
  rows.sort((a,b)=>a.season-b.season||a.week-b.week);const last=rows.slice(-8);
  return {rb:mean(last.map(r=>r.rbTargetRate).filter(Number.isFinite)),wr:mean(last.map(r=>r.wrTargetRate).filter(Number.isFinite)),te:mean(last.map(r=>r.teTargetRate).filter(Number.isFinite))};
}
function incumbentQb(teamMap, team, season, week) {
  const history=teamHistory(teamMap,team,season,week);const attempts=new Map();
  const same=history.filter(r=>r.season===season);const source=same.length?same:history.filter(r=>r.season===season-1);
  for(const row of source) for(const qb of row.qbs||[]) attempts.set(qb.name,finite(attempts.get(qb.name))+qb.attempts);
  return [...attempts].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
}
function latestCoach(gamesByTeam, team, season) {
  const rows=(gamesByTeam.get(`${season}|${team}`)||[]).slice().sort((a,b)=>a.week-b.week);const row=rows.at(-1);if(!row)return null;return row.home===team?row.homeCoach:row.awayCoach;
}
function gameFor(gameWeekMap,season,week,team){return gameWeekMap.get(`${season}|${week}|${team}`)||null;}
function gameTeamContext(game,team){if(!game)return {};const home=game.home===team;const implied=Number.isFinite(game.total)&&Number.isFinite(game.spread)?(home?(game.total+game.spread)/2:(game.total-game.spread)/2):null;return {total:game.total,implied,wind:game.wind,temp:game.temp,roof:game.roof,qb:home?game.homeQb:game.awayQb,coach:home?game.homeCoach:game.awayCoach};}

function depthKey(season,week,team){return `${season}|${week}|${team}`;}
function olSet(depthMap,season,week,team){return depthMap.get(depthKey(season,week,team))?.ol||new Set();}
function skillDepth(depthMap,season,week,team){return depthMap.get(depthKey(season,week,team))?.skill||[];}
function qbDepth(depthMap,season,week,team){return depthMap.get(depthKey(season,week,team))?.qb||[];}
function startingQbDepth(depthMap, injuryByTeam, season, week, team) {
  const injuries = injuryByTeam.get(injuryKey(season,week,team)) || [];
  const unavailable = new Set(injuries.filter((row)=>injurySeverity(row.reportStatus)>=0.75).map((row)=>intel.normalizeName(row.name)));
  return qbDepth(depthMap,season,week,team).find((row)=>!unavailable.has(intel.normalizeName(row.name)))?.name || null;
}
function priorOlSet(depthMap,season,week,team){if(week>1){const set=olSet(depthMap,season,week-1,team);if(set.size)return set;}for(let w=22;w>=1;w--){const set=olSet(depthMap,season-1,w,team);if(set.size)return set;}return new Set();}
function overlapRatio(current,prior){if(current.size<4||prior.size<4)return null;let n=0;for(const id of current)if(prior.has(id))n++;return n/Math.max(current.size,prior.size);}
function injuryKey(season,week,team){return `${season}|${week}|${team}`;}
function injurySeverity(status){const s=String(status||"").toLowerCase();if(s.includes("out"))return 1;if(s.includes("doubt"))return .75;if(s.includes("question"))return .35;return 0;}
function playerPriorShare(statsByPlayer,name,pos,season,week,field){const rows=priorRows(statsByPlayer,playerKey(name,pos),season,week,6);return weightedMean(rows,r=>r[field],3);}
function snapPrior(snapsByPlayer,name,pos,season,week){const rows=priorRows(snapsByPlayer,playerKey(name,pos),season,week,5);return weightedMean(rows,r=>r.offensePct,3);}
function xfpPrior(xfpByPlayer,name,pos,season,week,field,count){const rows=priorRows(xfpByPlayer,playerKey(name,pos),season,week,8);return weightedMean(rows,r=>r[field],count);}

async function loadSeasonSource(season, sources) {
  const [statsAsset, xfpAsset, snapAsset, depthAsset] = await Promise.all([
    hist.nflverseAsset("stats_player", `stats_player_week_${season}.csv`),
    hist.ffopportunityAsset(`ep_weekly_${season}.csv`),
    hist.nflverseAsset("snap_counts", `snap_counts_${season}.csv`),
    hist.nflverseAsset("depth_charts", `depth_charts_${season}.csv`),
  ]);
  sources.push(statsAsset,xfpAsset,snapAsset,depthAsset);
  const stats=intel.parseWeeklyStatsCsv(hist.text(statsAsset)).filter(r=>r.seasonType==="REG"&&DRAFT_POSITIONS.includes(r.position));addCarryShare(stats);
  return {stats,xfp:parseXfp(hist.text(xfpAsset)),snaps:parseSnaps(hist.text(snapAsset)),depth:parseDepth(hist.text(depthAsset))};
}

async function main() {
  const sources=[];
  const gamesAsset=await hist.nflverseAsset("schedules","games.csv");sources.push(gamesAsset);const games=parseGames(hist.text(gamesAsset));
  const allStats=[],allXfp=[],allSnaps=[],allDepth=[];const seasonData=new Map();
  for(const season of SOURCE_SEASONS){console.log(`Loading ${season} nflverse/ffopportunity sources...`);const data=await loadSeasonSource(season,sources);seasonData.set(season,data);allStats.push(...data.stats);allXfp.push(...data.xfp);allSnaps.push(...data.snaps);allDepth.push(...data.depth);}
  const injuries=[];for(const season of TARGET_SEASONS){const asset=await hist.nflverseAsset("injuries",`injuries_${season}.csv`);sources.push(asset);injuries.push(...parseInjuries(hist.text(asset)));}
  const statsByPlayer=groupBy(allStats,r=>playerKey(r.name,r.position));for(const rows of statsByPlayer.values())rows.sort((a,b)=>a.season-b.season||a.week-b.week);
  const xfpByPlayer=groupBy(allXfp,r=>playerKey(r.name,r.position));for(const rows of xfpByPlayer.values())rows.sort((a,b)=>a.season-b.season||a.week-b.week);
  const snapsByPlayer=groupBy(allSnaps,r=>playerKey(r.name,r.position));for(const rows of snapsByPlayer.values())rows.sort((a,b)=>a.season-b.season||a.week-b.week);

  const injuryByTeam=groupBy(injuries,r=>injuryKey(r.season,r.week,r.team));
  const injuryByPlayerWeek=new Map(injuries.map(r=>[`${r.season}|${r.week}|${r.team}|${playerKey(r.name,r.position)}`,r]));
  const injuryByIdentityWeek=new Map(injuries.map(r=>[`${r.season}|${r.week}|${playerKey(r.name,r.position)}`,r]));
  const depthByIdentityWeek=new Map();
  const depthMap=new Map();for(const r of allDepth){const k=depthKey(r.season,r.week,r.team);const v=depthMap.get(k)||{ol:new Set(),skill:[],qb:[]};if(r.formation==="Offense"&&r.depthTeam===1&&["C","G","T","OL","OT","OG"].includes(r.position))v.ol.add(r.gsisId||intel.normalizeName(r.name));if(r.formation==="Offense"&&["RB","WR","TE"].includes(r.position)&&r.depthTeam<=3)v.skill.push(r);if(r.formation==="Offense"&&r.position==="QB")v.qb.push(r);depthMap.set(k,v);const pk=`${r.season}|${r.week}|${playerKey(r.name,r.position)}`;if(!depthByIdentityWeek.has(pk)||r.depthTeam<depthByIdentityWeek.get(pk).depthTeam)depthByIdentityWeek.set(pk,r);}
  for(const value of depthMap.values()) value.qb.sort((left,right)=>left.depthTeam-right.depthTeam);
  const gameWeekMap=new Map(),gamesByTeam=new Map();for(const g of games){for(const team of [g.home,g.away]){gameWeekMap.set(`${g.season}|${g.week}|${team}`,g);const k=`${g.season}|${team}`;if(!gamesByTeam.has(k))gamesByTeam.set(k,[]);gamesByTeam.get(k).push(g);}}
  const teamMap=teamWeekFeatures(allStats);
  const weeks=[],drafts={};
  for(const season of TARGET_SEASONS){console.log(`Building ${season} historical records...`);const espn=await hist.espnSeason(season,3);sources.push(espn);const players=espnPlayers(espn.payload,season);const marketAdp=await fantasyDataAdp(season,sources);const adpByKey=new Map(marketAdp.map((row)=>[row.position==="DST"?`DST|${row.team}`:playerKey(row.name,row.position),row]));const prevDefense=defenseProfiles(seasonData.get(season-1).stats);const draftRows=[];
    for(const p of players){const key=playerKey(p.name,p.position);const actualRows=(statsByPlayer.get(key)||[]).filter(r=>r.season===season);const actualByWeek=new Map(actualRows.map(r=>[r.week,r]));const realizedWeekly=p.actualWeekly.map((value)=>Number.isFinite(value)?value:0);for(const r of actualRows)if(!Number.isFinite(p.actualWeekly[r.week-1]))realizedWeekly[r.week-1]=r.fantasyPpr;const market=adpByKey.get(p.position==="DST"?`DST|${p.team}`:key);
      draftRows.push({...p,adp:market?.adp??null,pprRank:market?.rank??null,standardRank:null,superflexRank:null,historicalAdpSource:"FantasyData PPR ADP",actualWeekly:realizedWeekly});
      if(!POSITIONS.includes(p.position)) continue;
      for(let week=1;week<=18;week++){
        const baseline=p.weekly[week-1],actualRow=actualByWeek.get(week);
        if(!Number.isFinite(baseline)) continue;
        const identityKey=`${season}|${week}|${key}`;
        const depthIdentity=depthByIdentityWeek.get(identityKey), injuryIdentity=injuryByIdentityWeek.get(identityKey);
        const team=canonicalTeam(actualRow?.team||depthIdentity?.team||injuryIdentity?.team||p.team);
        const rawGame=gameFor(gameWeekMap,season,week,team);
        if(!rawGame||team==="FA") continue;
        const opponent=rawGame.home===team?rawGame.away:rawGame.home;
        const archivedActual=p.actualWeekly[week-1];
        const actualPoints=Number.isFinite(archivedActual)?archivedActual:(actualRow?actualRow.fantasyPpr:0);
        const history=priorRows(statsByPlayer,key,season,week,8);const last3=history.slice(-3),last6=history.slice(-6);
        const game=gameTeamContext(rawGame,team);const incumbent=incumbentQb(teamMap,team,season,week);
        const currentQb=startingQbDepth(depthMap,injuryByTeam,season,week,team)||incumbent;
        const iq=incumbent?qbHistory(statsByPlayer,incumbent,season,week):{quality:null};const cq=currentQb?qbHistory(statsByPlayer,currentQb,season,week):{quality:null};const istyle=incumbent?qbStyle(teamMap,incumbent,season,week):{};const cstyle=currentQb?qbStyle(teamMap,currentQb,season,week):{};

        const prevTeam=history.length?history.at(-1).team:null;const teamChanged=Boolean(prevTeam&&prevTeam!==team&&history.at(-1).season<season);const prevCoach=latestCoach(gamesByTeam,team,season-1);const coachChanged=Boolean(prevCoach&&game.coach&&intel.normalizeName(prevCoach)!==intel.normalizeName(game.coach));const th=teamHistory(teamMap,team,season,week);const currentTeamGames=th.filter(r=>r.season===season).slice(-4),previousTeamGames=th.filter(r=>r.season===season-1);const currentPass=mean(currentTeamGames.map(r=>r.passRate).filter(Number.isFinite)),previousPass=mean(previousTeamGames.map(r=>r.passRate).filter(Number.isFinite));const currentPlays=mean(currentTeamGames.map(r=>r.plays).filter(Number.isFinite)),previousPlays=mean(previousTeamGames.map(r=>r.plays).filter(Number.isFinite));
        const currentOl=olSet(depthMap,season,week,team),previousOl=priorOlSet(depthMap,season,week,team),olContinuity=overlapRatio(currentOl,previousOl);const teamInj=injuryByTeam.get(injuryKey(season,week,team))||[];let olInjury=0,vacTarget=0,vacCarry=0;const absent=new Set();for(const inj of teamInj){const sev=injurySeverity(inj.reportStatus);if(!sev)continue;absent.add(intel.normalizeName(inj.name));if(["C","G","T","OL","OT","OG"].includes(inj.position))olInjury+=sev;if(["RB","WR","TE"].includes(inj.position)){vacTarget+=finite(playerPriorShare(statsByPlayer,inj.name,inj.position,season,week,"targetShare"))*sev;vacCarry+=finite(playerPriorShare(statsByPlayer,inj.name,inj.position,season,week,"carryShare"))*sev;}}
        let competitorTarget=0,competitorCarry=0;for(const mate of skillDepth(depthMap,season,week,team)){if(intel.normalizeName(mate.name)===intel.normalizeName(p.name)||absent.has(intel.normalizeName(mate.name)))continue;competitorTarget=Math.max(competitorTarget,finite(playerPriorShare(statsByPlayer,mate.name,mate.position,season,week,"targetShare")));competitorCarry=Math.max(competitorCarry,finite(playerPriorShare(statsByPlayer,mate.name,mate.position,season,week,"carryShare")));}

        const injury=injuryByPlayerWeek.get(`${season}|${week}|${team}|${key}`)||injuryIdentity;const positionPrior=p.position==="WR"?.20:p.position==="TE"?.17:p.position==="RB"?.10:.08;const carryPrior=p.position==="RB"?.48:.08;const roleTarget=weightedMean(last3,r=>r.targetShare,3),roleCarry=weightedMean(last3,r=>r.carryShare,3);const recent=weightedMean(last3,r=>r.fantasyPpr,3),older=last6.length>=6?weightedMean(last6.slice(0,3),r=>r.fantasyPpr,3):null;const opportunity=weightedMean(last3,r=>r.opportunities,3);const xfp=xfpPrior(xfpByPlayer,p.name,p.position,season,week,"xfp",3);const fpoe=xfpPrior(xfpByPlayer,p.name,p.position,season,week,"fpoe",5);const snap=snapPrior(snapsByPlayer,p.name,p.position,season,week);const grade=prevDefense.get(`${canonicalTeam(opponent)}|${p.position}`)??0;const posKey=p.position.toLowerCase();const qbStyleDelta=Number.isFinite(cstyle[posKey])&&Number.isFinite(istyle[posKey])?cstyle[posKey]-istyle[posKey]:0;
        weeks.push({season,week,id:p.id,name:p.name,position:p.position,team,opponent,baseline,actual:actualPoints,played:Boolean(actualRow),historyGames:history.length,recentPpr:recent,recentTrend:Number.isFinite(recent)&&Number.isFinite(older)?recent-older:null,opportunity,targetShare:roleTarget,carryShare:roleCarry,targetDelta:Number.isFinite(roleTarget)?roleTarget-positionPrior:null,carryDelta:Number.isFinite(roleCarry)?roleCarry-carryPrior:null,xfp,fpoe,snapShare:snap,defenseGrade:grade,gameTotal:game.total,teamImplied:game.implied,wind:game.wind,temp:game.temp,roof:game.roof,injuryStatus:injury?.reportStatus||"",practiceStatus:injury?.practiceStatus||"",qbReplacement:Boolean(currentQb&&incumbent&&intel.normalizeName(currentQb)!==intel.normalizeName(incumbent)),qbQualityDelta:Number.isFinite(cq.quality)&&Number.isFinite(iq.quality)?cq.quality-iq.quality:0,qbStyleDelta,incumbentQb:incumbent,currentQb,teamChanged,coachChanged,passRateDelta:Number.isFinite(currentPass)&&Number.isFinite(previousPass)?currentPass-previousPass:null,paceDelta:Number.isFinite(currentPlays)&&Number.isFinite(previousPlays)?currentPlays-previousPlays:null,olContinuity,olInjury,vacatedTargetShare:vacTarget,vacatedCarryShare:vacCarry,competitorTargetShare:competitorTarget,competitorCarryShare:competitorCarry});
      }
    }
    drafts[season]=draftRows;
  }

  const out={meta:{version:"historical-ppr-validation-2026.1",generatedAt:new Date().toISOString(),targetSeasons:TARGET_SEASONS,sourceSeasons:SOURCE_SEASONS,espnLeagueDefault:3,scoring:"PPR",policy:"All week features use only prior game history plus current-week pregame schedule/injury/depth information. 2025 remains consistency-only because earlier model audits inspected it.",sources:hist.provenance(sources)},weeks,drafts};
  const json=Buffer.from(JSON.stringify(out));const compressed=zlib.gzipSync(json,{level:9});const output=path.join(hist.root,"data","validation","historical-ppr-2020-2025.json.gz");fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,compressed);console.log(`Wrote ${weeks.length} player-weeks and ${Object.values(drafts).reduce((s,r)=>s+r.length,0)} draft players to ${output}`);console.log(`Compressed ${(compressed.length/1024/1024).toFixed(2)} MB from ${(json.length/1024/1024).toFixed(2)} MB`);
}

main().catch((error)=>{console.error(error.stack||error);process.exitCode=1;});

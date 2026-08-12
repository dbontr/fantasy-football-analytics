"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const alpha = require("../src/engine/preseason-alpha.js");
const live = require("../src/engine/live-intelligence.js");

test("generic camp hype has no standalone preseason-alpha effect", () => {
  const result = alpha.computePreseasonAlpha({ id:"x", position:"WR", pprRank:90, previousPoints:0, reliability:.6 }, { camp:{ available:true, performanceScore:1, roleScore:0, usageScore:0, confidence:.5, observations:[] } });
  assert.equal(result.alphaScore, 0);
  assert.equal(result.genericPerformanceContribution, 0);
});

test("direct coach usage intent outranks analyst hype", () => {
  const base = { id:"x", position:"RB", pprRank:60, previousPoints:80, reliability:.65, opportunity:{volumeStability:.55} };
  const coachCamp = { available:true, roleScore:.7, usageScore:.8, confidence:.5, performanceScore:0, observations:[{ storyId:"1", sourceKey:"coach", usageSourceRole:"head-coach", usageScore:.9, usageConfidence:.7, roleScore:.9, evidenceKeys:["usage.featured"] }] };
  const analystCamp = { available:true, roleScore:0, usageScore:0, confidence:.5, performanceScore:1, observations:[{ storyId:"2", sourceKey:"analyst", usageSourceRole:"analyst", usageScore:0, usageConfidence:.2, roleScore:0, evidenceKeys:["performance.positive"] }] };
  const coach = alpha.computePreseasonAlpha(base, { camp:coachCamp });
  const analyst = alpha.computePreseasonAlpha(base, { camp:analystCamp });
  assert.ok(coach.alphaScore > .3);
  assert.equal(analyst.alphaScore, 0);
  assert.ok(coach.coachIntent.directStories >= 1);
});

test("market reaction shrinks an already-priced structural signal", () => {
  const unpriced = alpha.marketReaction([{capturedAt:"2026-08-01T00:00:00Z",adp:30,pprRank:30},{capturedAt:"2026-08-05T00:00:00Z",adp:30,pprRank:30}], .8);
  const priced = alpha.marketReaction([{capturedAt:"2026-08-01T00:00:00Z",adp:38,pprRank:38},{capturedAt:"2026-08-05T00:00:00Z",adp:30,pprRank:30}], .8);
  assert.equal(unpriced.pricedFraction, 0);
  assert.ok(priced.pricedFraction > .9);
  assert.ok(priced.residualFactor < unpriced.residualFactor);
});

test("independent structural reports increase consensus strength", () => {
  const one = alpha.reporterConsensus({ observations:[{storyId:"1",sourceKey:"a",sourceRole:"reporter",roleScore:.7,evidenceKeys:["role.featured"]}] });
  const three = alpha.reporterConsensus({ observations:[
    {storyId:"1",sourceKey:"a",sourceRole:"reporter",roleScore:.7,evidenceKeys:["role.featured"]},
    {storyId:"2",sourceKey:"b",sourceRole:"reporter",roleScore:.6,evidenceKeys:["role.first_team"]},
    {storyId:"3",sourceKey:"c",sourceRole:"reporter",roleScore:.65,evidenceKeys:["usage.expand"]},
  ] });
  assert.ok(three.strength > one.strength);
  assert.equal(three.agreement, 1);
});

test("availability trajectory recognizes recovery from held out to full", () => {
  const held = live.classifyAvailabilityText("held out of practice");
  const full = live.classifyAvailabilityText("full participant with no limitations");
  assert.ok(held.score < 0);
  assert.ok(full.score > 0);
  const result = alpha.injuryTrajectory({ observations:[
    {published:"2026-08-01",availabilityScore:held.score,availabilityState:held.state},
    {published:"2026-08-08",availabilityScore:full.score,availabilityState:full.state},
  ] });
  assert.equal(result.trend, "improving");
  assert.ok(result.signal > 0);
});

test("uncertain rookies are more preseason-sensitive than established stars", () => {
  const rookie = alpha.sensitivityForPlayer({ position:"WR", rookie:true, pprRank:80, previousPoints:0, reliability:.55, opportunity:{volumeStability:.4} });
  const star = alpha.sensitivityForPlayer({ position:"WR", pprRank:12, previousPoints:250, reliability:.9, opportunity:{volumeStability:.9} });
  assert.ok(rookie.factor > star.factor);
});

test("role probabilities are normalized and candidate shifts are capped", () => {
  const result = alpha.computePreseasonAlpha({ id:"x", position:"RB", rookie:true, pprRank:100, previousPoints:0, reliability:.4 }, { camp:{ available:true, roleScore:1, usageScore:1, confidence:.68, firstTeamMentions:4, starterUnitMentions:4, observations:[{storyId:"1",sourceRole:"head-coach",usageSourceRole:"head-coach",usageScore:1,usageConfidence:.9,roleScore:1,evidenceKeys:["usage.featured","role.first_team"]}] } });
  assert.ok(Math.abs(result.roleProbabilities.reduce((sum,row)=>sum+row.probability,0)-1)<1e-9);
  assert.ok(Math.abs(result.candidateShift)<=2.5);
  assert.equal(result.modelEffect,"uncertainty-and-shadow-only");
});

test("committed preseason artifact keeps Achane structural role edge shadow-only", () => {
  const artifact = JSON.parse(fs.readFileSync(path.join(__dirname,"..","data","preseason-alpha-2026.json"),"utf8"));
  assert.equal(artifact.meta.servingMeanEffect,false);
  assert.equal(artifact.meta.servingDraftOrderEffect,false);
  const achane = artifact.players.find((row)=>row.name==="De'Von Achane");
  assert.ok(achane);
  assert.ok(achane.alphaScore>.15);
  assert.ok(achane.coachIntent.directStories>=1);
  assert.equal(achane.modelEffect,"uncertainty-and-shadow-only");
});

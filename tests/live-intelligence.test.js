"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const live = require("../src/engine/live-intelligence.js");

const athlete = { id: "123", displayName: "Rookie Runner" };
const summary = {
  header: { id: "g1", competitions: [{ id: "g1", date: "2026-08-07T00:00Z" }] },
  boxscore: { players: [{ team: { abbreviation: "DET" }, statistics: [
    { name: "rushing", keys: ["rushingAttempts", "rushingYards", "rushingTouchdowns"], athletes: [{ athlete, stats: ["11", "57", "1"] }] },
    { name: "receiving", keys: ["receptions", "receivingYards", "yardsPerReception", "receivingTouchdowns", "longReception", "receivingTargets"], athletes: [{ athlete, stats: ["3", "24", "8.0", "0", "12", "4"] }] },
  ] }] },
};

test("ESPN preseason summary extracts player opportunity without editorial text", () => {
  const rows = live.parseEspnPreseasonSummary(summary);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].carries, 11);
  assert.equal(rows[0].targets, 4);
  assert.equal(rows[0].rushingYards, 57);
});

test("preseason evidence is positive-only and heavily downweights established stars", () => {
  const rows = live.parseEspnPreseasonSummary(summary);
  const rookie = live.summarizePreseason(rows, { id: "123", position: "RB", pprRank: 140 });
  const star = live.summarizePreseason(rows, { id: "123", position: "RB", pprRank: 8 });
  const rookieEvidence = live.preseasonEvidence(rookie, { position: "RB", pprRank: 140 });
  const starEvidence = live.preseasonEvidence(star, { position: "RB", pprRank: 8 });
  assert.ok(rookieEvidence["preseason.usage_boost"].confidence > starEvidence["preseason.usage_boost"].confidence);
  assert.ok(rookieEvidence["preseason.usage_boost"].value >= 0);
});

test("news pulse keeps headline metadata and maps ESPN athlete ids", () => {
  const result = live.extractNewsPulse({ articles: [{ id: 7, headline: "Camp role changes", published: "2026-08-07T10:00:00Z", categories: [{ type: "athlete", athleteId: 123 }, { type: "team", team: { abbreviation: "DET" } }], links: { web: { href: "https://www.espn.com/nfl/story/_/id/7" } } }] }, [{ id: "123", name: "Rookie Runner" }]);
  assert.equal(result[0].headline, "Camp role changes");
  assert.deepEqual(result[0].playerIds, ["123"]);
  assert.equal("description" in result[0], true);
  assert.equal(Array.isArray(result[0].camp.matches), true);
});

test("ESPN game market becomes bounded team scoring evidence", () => {
  const market = live.parseEspnMarketScoreboard({ events: [{ id: "g2", date: "2026-09-10T00:20Z", competitions: [{ venue: { fullName: "Field", indoor: false }, competitors: [{ homeAway: "home", team: { abbreviation: "DET" } }, { homeAway: "away", team: { abbreviation: "GB" } }], odds: [{ overUnder: 48, spread: -4, provider: { displayName: "Market" } }] }] }] });
  assert.equal(market.DET.impliedPoints, 26);
  assert.equal(market.GB.impliedPoints, 22);
  const evidence = live.marketEvidence(market.DET);
  assert.equal(evidence["market.game_total"].value, 48);
  assert.equal(evidence["market.team_implied_points"].value, 26);
  assert.ok(evidence["market.team_implied_points"].confidence < 0.5);
});

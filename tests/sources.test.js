"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sources = require("../src/data/sources.js");

test("free-source policy accepts allowlisted public endpoints", () => {
  assert.equal(sources.assertFreeUrl("sleeper", "https://api.sleeper.app/v1/players/nfl").source.id, "sleeper");
  assert.equal(sources.assertFreeUrl("nws", "https://api.weather.gov/points/42.3,-83.2").source.id, "nws");
});

test("free-source policy rejects credentials and arbitrary origins", () => {
  assert.throws(() => sources.assertFreeUrl("sleeper", "https://example.com/v1/players/nfl"));
  assert.throws(() => sources.assertFreeUrl("sleeper", "https://api.sleeper.app/v1/players/nfl?api_key=secret"));
});

test("CSV parser handles quoted commas", () => {
  const rows = sources.parseCsv('name,team,note\n"Doe, John",DET,"a,b"\n');
  assert.deepEqual(rows, [{ name: "Doe, John", team: "DET", note: "a,b" }]);
});

test("catalog contains only anonymous zero-cost sources", () => {
  for (const source of sources.sourceCatalog()) {
    assert.equal(source.access.accountRequired, false);
    assert.equal(source.access.apiKeyRequired, false);
    assert.equal(source.cost.priceUsd, 0);
    assert.equal(source.cost.trialOnly, false);
  }
});


test("Sleeper active status clears a stale bootstrap injury designation", () => {
  const [player] = sources.enrichLocalPlayers(
    [{ id: "p1", name: "Test Runner", position: "RB", team: "DET", injuryStatus: "QUESTIONABLE", active: true }],
    { "s1": { full_name: "Test Runner", position: "RB", team: "DET", status: "Active", active: true, injury_status: null } },
  );
  assert.equal(player.injuryStatus, "ACTIVE");
  assert.equal(player.sleeper.active, true);
});

test("Sleeper reserve status canonicalizes to model availability vocabulary", () => {
  const [player] = sources.enrichLocalPlayers(
    [{ id: "p2", name: "Test Receiver", position: "WR", team: "GB", injuryStatus: "ACTIVE", active: true }],
    { "s2": { full_name: "Test Receiver", position: "WR", team: "GB", status: "Injured Reserve", active: false, injury_status: null } },
  );
  assert.equal(player.injuryStatus, "IR");
  assert.equal(player.active, false);
});


test("ESPN public web JSON is allowlisted without credential paths", () => {
  const result = sources.assertFreeUrl("espn", "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=20");
  assert.equal(result.source.id, "espn");
  assert.throws(() => sources.assertFreeUrl("espn", "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news"));
});

test("Sleeper enrichment preserves rookie identity and live development context", () => {
  const [player] = sources.enrichLocalPlayers(
    [{ id: "r1", name: "Rookie Runner", position: "RB", team: "ARI", rookie: { id: "r1" } }],
    { "s9": { full_name: "Rookie Runner", position: "RB", team: "ARI", status: "Active", active: true, age: 21, birth_date: "2005-05-31", college: "Notre Dame", years_exp: 0, search_rank: 20, depth_chart_order: 1, metadata: { rookie_year: "2026" } } },
  );
  assert.equal(player.rookie.id, "r1");
  assert.equal(player.yearsExperience, 0);
  assert.equal(player.rookieYear, 2026);
  assert.equal(player.sleeper.depthChartOrder, 1);
  assert.equal(player.sleeper.searchRank, 20);
});


test("browser-session credentials are restricted to the ESPN Fantasy adapter", async () => {
  const originalFetch = global.fetch;
  let seenCredentials = null;
  global.fetch = async (_url, options = {}) => {
    seenCredentials = options.credentials;
    return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const url = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/123?view=mTeam";
    const result = await sources.fetchJson("espnFantasy", url, { credentials: "include" });
    assert.equal(result.ok, true);
    assert.equal(seenCredentials, "include");
    await assert.rejects(() => sources.fetchJson("sleeper", "https://api.sleeper.app/v1/players/nfl", { credentials: "include" }), /does not permit browser-session credentials/i);
  } finally {
    global.fetch = originalFetch;
  }
});
test("ESPN PPR snapshot uses only the allowlisted fantasy filter header", async () => {
  const originalFetch = global.fetch;
  let seen = null;
  global.fetch = async (url, options = {}) => {
    seen = { url: String(url), headers: options.headers };
    return new Response('{"players":[]}', { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await sources.espnPprPlayerSnapshot(2026);
    assert.deepEqual(result.players, []);
    assert.match(seen.url, /leaguedefaults\/3/);
    assert.ok(seen.headers["x-fantasy-filter"]);
    await assert.rejects(
      () => sources.fetchJson("espnFantasy", seen.url, { headers: { Authorization: "secret" } }),
      /secret-bearing request headers are forbidden/i,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("PPR snapshot enrichment replaces mean projections but preserves local context", () => {
  const local = [{ id: "1", name: "Test WR", position: "WR", team: "DET", weeklyProjection: 10, weeklyProjections: Array(18).fill(10), projectedPoints: 170, floorProjection: 5, ceilingProjection: 18, projectionStdDev: 4, opportunity: { targetShare: 0.2 } }];
  const snapshot = { players: [{ player: { id: 1, active: true, injuryStatus: "ACTIVE", stats: [
    { seasonId: 2026, statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: 1, appliedTotal: 19 },
    { seasonId: 2026, statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: 2, appliedTotal: 21 },
    { seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, scoringPeriodId: 0, appliedTotal: 330 },
  ] } }] };
  const [player] = sources.enrichPprProjectionBaseline(local, snapshot, 2026);
  assert.equal(player.weeklyProjection, 20);
  assert.equal(player.weeklyProjections[0], 19);
  assert.equal(player.projectedPoints, 330);
  assert.equal(player.projectionSource, "espn-live-ppr");
  assert.equal(player.opportunity.targetShare, 0.2);
});


test("PPR enrichment also derives ESPN standard projections from receptions", () => {
  const snapshot = { players: [{ player: { id: "p3", stats: [
    { seasonId: 2026, scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 170, stats: { 53: 50 } },
    { seasonId: 2026, scoringPeriodId: 1, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 10, stats: { 53: 3 } },
    { seasonId: 2026, scoringPeriodId: 2, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 12, stats: { 53: 4 } },
  ] } }] };
  const [player] = sources.enrichPprProjectionBaseline([
    { id: "p3", name: "Receiver", position: "WR", projectedPoints: 150, weeklyProjection: 9, weeklyProjections: Array(18).fill(9), floorProjection: 5, ceilingProjection: 14, projectionStdDev: 4 },
  ], snapshot, 2026);
  assert.equal(player.projectedPoints, 170);
  assert.equal(player.standardProjectedPoints, 120);
  assert.equal(player.weeklyProjections[0], 10);
  assert.equal(player.standardWeeklyProjections[0], 7);
  assert.equal(player.standardWeeklyProjections[1], 8);
});

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

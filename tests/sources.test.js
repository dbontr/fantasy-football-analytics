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

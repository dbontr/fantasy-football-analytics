"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const espn = require("../src/data/espn-fantasy.js");
const sources = require("../src/data/sources.js");

test("ESPN league input accepts an ID or normal league URL", () => {
  assert.deepEqual(espn.parseLeagueInput("123456", 2026), { leagueId: "123456", season: 2026 });
  assert.deepEqual(
    espn.parseLeagueInput("https://fantasy.espn.com/football/league?leagueId=987654&seasonId=2025", 2026),
    { leagueId: "987654", season: 2025 },
  );
  assert.throws(() => espn.parseLeagueInput("not-a-league", 2026));
});

test("ESPN fantasy endpoint is keyless allowlisted and credential query params are rejected", () => {
  const url = espn.leagueApiUrl("123456", 2026);
  assert.equal(sources.assertFreeUrl("espnFantasy", url).source.id, "espnFantasy");
  assert.throws(() => sources.assertFreeUrl("espnFantasy", `${url}&token=nope`));
});

test("ESPN league normalization maps rosters to local players by ESPN id then name", () => {
  const local = [
    { id: "4429795", name: "Jahmyr Gibbs", position: "RB", team: "DET" },
    { id: "p2", name: "Puka Nacua", position: "WR", team: "LAR" },
  ];
  const raw = {
    id: 123456,
    seasonId: 2026,
    settings: { name: "Sunday Friends", scheduleSettings: { playoffTeamCount: 6 }, scoringSettings: { playerRankType: "PPR" } },
    status: { currentScoringPeriod: 4 },
    members: [{ id: "owner-1", displayName: "Devon" }],
    teams: [{ id: 1, name: "Fourth & Long", primaryOwner: "owner-1", record: { overall: { wins: 3, losses: 1, ties: 0, pointsFor: 488.2 } }, roster: { entries: [
      { playerPoolEntry: { player: { id: 4429795, fullName: "Jahmyr Gibbs" } } },
      { playerPoolEntry: { player: { id: 999, fullName: "Puka Nacua" } } },
      { playerPoolEntry: { player: { id: 888, fullName: "Unknown Player" } } },
    ] } }],
  };
  const league = espn.normalizeLeague(raw, local);
  assert.equal(league.name, "Sunday Friends");
  assert.equal(league.currentWeek, 4);
  assert.equal(league.playoffTeams, 6);
  assert.equal(league.scoringLabel, "PPR");
  assert.deepEqual(league.teams[0].rosterIds, ["4429795", "p2"]);
  assert.equal(league.teams[0].unmatchedPlayers[0], "Unknown Player");
  assert.equal(league.teams[0].ownerName, "Devon");
  assert.equal(league.teams[0].recordLabel, "3-1");
});

test("ESPN private-league failures become safe user-facing guidance", () => {
  const anonymous = espn.friendlyLoadError(new Error("espnFantasy returned HTTP 401"));
  assert.equal(anonymous.code, "ESPN_AUTH_REQUIRED");
  assert.match(anonymous.message, /browser's ESPN sign-in/i);
  const session = espn.friendlyLoadError(new Error("espnFantasy returned HTTP 403"), { browserSession: true });
  assert.equal(session.code, "ESPN_SESSION_FAILED");
  assert.match(session.message, /sign in to ESPN/i);
  assert.match(espn.friendlyLoadError(new Error("espnFantasy returned HTTP 404")).message, /couldn't find/i);
});

test("ESPN normalized snapshots remain compact and serializable", () => {
  const league = espn.normalizeLeague({ id: 7, seasonId: 2026, settings: { name: "Mini" }, teams: [{ id: 2, name: "Team Two", roster: { entries: [] } }] }, []);
  const roundTrip = JSON.parse(JSON.stringify(league));
  assert.equal(roundTrip.leagueId, "7");
  assert.equal(roundTrip.teams[0].teamId, "2");
  assert.deepEqual(roundTrip.teams[0].rosterIds, []);
});

test("ESPN league normalization preserves compact head-to-head schedule pairings", () => {
  const raw = {
    id: 55,
    seasonId: 2026,
    settings: { name: "Schedule League", scheduleSettings: { playoffTeamCount: 4, matchupPeriodCount: 14 } },
    status: { currentScoringPeriod: 6, finalScoringPeriod: 17 },
    teams: [
      { id: 1, name: "One", roster: { entries: [] } },
      { id: 2, name: "Two", roster: { entries: [] } },
      { id: 3, name: "Three", roster: { entries: [] } },
      { id: 4, name: "Four", roster: { entries: [] } },
    ],
    schedule: [
      { id: 1, matchupPeriodId: 6, home: { teamId: 1 }, away: { teamId: 4 } },
      { id: 2, scoringPeriodId: 6, home: { teamId: 2 }, away: { teamId: 3 } },
      { id: 3, matchupPeriodId: 7, home: { teamId: 1 }, away: { teamId: 2 } },
    ],
  };
  const league = espn.normalizeLeague(raw, []);
  assert.deepEqual(league.fantasySchedule[6], [["1", "4"], ["2", "3"]]);
  assert.deepEqual(league.fantasySchedule[7], [["1", "2"]]);
  assert.equal(league.regularSeasonEnd, 14);
  assert.equal(league.championshipWeek, 17);
});

test("ESPN league normalization imports supported lineup slots and scoring preset", () => {
  const league = espn.normalizeLeague({
    id: 88,
    seasonId: 2026,
    settings: {
      name: "Half PPR Superflex",
      rosterSettings: {
        lineupLocktimeType: "INDIVIDUAL_GAME",
        lineupSlotCounts: { 0: 1, 2: 2, 4: 3, 6: 1, 7: 1, 16: 0, 17: 0, 20: 7, 21: 2, 23: 1 },
      },
      scoringSettings: { playerRankType: "PPR", scoringItems: [{ statId: 53, points: 0.5 }] },
    },
    teams: Array.from({ length: 10 }, (_, index) => ({ id: index + 1, name: `Team ${index + 1}`, roster: { entries: [] } })),
  }, []);
  assert.equal(league.settings.teams, 10);
  assert.equal(league.settings.scoring, "half-ppr");
  assert.deepEqual(league.settings.slots, { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPERFLEX: 1, DST: 0, K: 0, BN: 7 });
  assert.equal(league.settings.irSlots, 2);
  assert.equal(league.settings.lineupLockType, "INDIVIDUAL_GAME");
  assert.equal(league.settings.supported, true);
});

test("ESPN settings flag unsupported IDP starter slots instead of pretending exact coverage", () => {
  const normalized = espn.normalizeEspnSettings({
    rosterSettings: { lineupSlotCounts: { 0: 1, 8: 2, 20: 6 } },
    scoringSettings: { playerRankType: "PPR", scoringItems: [{ statId: 53, points: 1 }] },
  }, 12);
  assert.equal(normalized.supported, false);
  assert.deepEqual(normalized.unsupportedStarterSlotIds, ["8"]);
});
test("ESPN custom offensive scoring is flagged instead of silently treated as standard PPR", () => {
  const normalized = espn.normalizeEspnSettings({
    rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 20: 7, 23: 1 } },
    scoringSettings: { playerRankType: "PPR", scoringItems: [
      { statId: 3, points: 0.04 }, { statId: 4, points: 6 }, { statId: 20, points: -2 },
      { statId: 24, points: 0.1 }, { statId: 25, points: 6 }, { statId: 42, points: 0.1 },
      { statId: 43, points: 6 }, { statId: 53, points: 1 },
    ] },
  }, 12);
  assert.equal(normalized.supported, false);
  assert.deepEqual(normalized.unsupportedScoringStatIds, ["4"]);
});
test("ESPN restricted flex slots are flagged when SnapCount cannot represent their exact eligibility", () => {
  const normalized = espn.normalizeEspnSettings({
    rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 3: 1, 4: 2, 6: 1, 20: 7 } },
    scoringSettings: { playerRankType: "PPR", scoringItems: [{ statId: 53, points: 1 }] },
  }, 12);
  assert.equal(normalized.supported, false);
  assert.deepEqual(normalized.unsupportedStarterSlotIds, ["3"]);
});
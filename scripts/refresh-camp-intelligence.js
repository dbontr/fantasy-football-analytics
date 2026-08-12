"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const live = require("../src/engine/live-intelligence.js");
const sources = require("../src/data/sources.js");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "data", "camp-2026.json");
const dataset = JSON.parse(fs.readFileSync(path.join(root, "data", "players-lite.json"), "utf8"));
const coachArtifact = JSON.parse(fs.readFileSync(path.join(root, "data", "coaches-2026.json"), "utf8"));
const players = new Map((dataset.players || []).map((player) => [String(player.id), player]));
const coaches = coachArtifact.teams || {};
const SKILL = new Set(["QB", "RB", "WR", "TE"]);
const SEARCH_PLAYER_LIMIT = Math.max(20, Math.min(300, Number(process.env.ROLE_SEARCH_PLAYER_LIMIT || 180)));
const SEARCH_MAX_AGE_DAYS = Math.max(7, Math.min(90, Number(process.env.ROLE_SEARCH_MAX_AGE_DAYS || 45)));

function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function normalize(value) { return stripHtml(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function unique(values) { return [...new Set(values)]; }
function wordNumber(value) {
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return Number.isFinite(Number(value)) ? Number(value) : words[String(value || "").toLowerCase()] ?? null;
}
function observationFacts(text) {
  const value = String(text || "");
  const firstTeam = /\b(?:first[- ]team|first unit|with the ones|starting offense|starter reps)\b/i.test(value);
  const snap = value.match(/\b(\d{1,3})\s+(?:first[- ]team\s+)?snaps?\b/i);
  const routes = value.match(/\b(\d{1,3})\s+(?:first[- ]team\s+)?routes?\b/i);
  const carries = value.match(/\b(\d{1,2})\s+(?:first[- ]team\s+)?carries\b/i);
  const targetCount = value.match(/\b(\d{1,2})\s+(?:first[- ]team\s+)?targets\b/i);
  const caught = value.match(/\bcaught\s+(?:only\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+of\s+(?:his\s+)?(\d+)\s+(?:passes|targets)\b/i);
  return {
    firstTeamSnaps: firstTeam && snap ? Number(snap[1]) : null,
    firstTeamRoutes: firstTeam && routes ? Number(routes[1]) : null,
    firstTeamCarries: firstTeam && carries ? Number(carries[1]) : null,
    firstTeamTargets: firstTeam && targetCount ? Number(targetCount[1]) : null,
    starterUnit: firstTeam,
    openingDrive: /\b(?:opening drive|first drive|opening series)\b/i.test(value),
    twoMinute: /\b(?:two-minute|2-minute|two minute)\b/i.test(value),
    thirdDown: /\bthird[- ]down\b/i.test(value),
    redZone: /\b(?:red[- ]zone|goal[- ]line|inside the 20)\b/i.test(value),
    catches: caught ? wordNumber(caught[1]) : null,
    targets: caught ? Number(caught[2]) : null,
  };
}
function storyBlocks(story) {
  return [...String(story || "").matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => ({
    html: match[2], text: stripHtml(match[2]),
    athleteIds: unique([...match[2].matchAll(/\/player\/_\/id\/(\d+)/g)].map((row) => row[1])),
  }));
}
function coreUrl(article) {
  const href = String(article?.links?.api?.self?.href || "");
  if (href) {
    const url = new URL(href);
    if (url.origin === "https://content.core.api.espn.com" && url.pathname.startsWith("/v1/sports/news/")) return url.href;
  }
  const id = String(article?.id || "");
  if (!/^\d+$/.test(id)) throw new Error("Unexpected ESPN content id");
  return `https://content.core.api.espn.com/v1/sports/news/${id}`;
}
async function fetchStory(article) {
  const url = coreUrl(article);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`ESPN content returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw new Error("ESPN content response too large");
  return { url, bytes, payload: JSON.parse(bytes.toString("utf8")) };
}
function resultArticle(row) {
  return {
    id: String(row?.id || ""),
    headline: String(row?.displayName || ""),
    published: row?.date || null,
    url: row?.link?.web || null,
  };
}
function usageCandidateHeadline(value) {
  return /(workload|touch(?:es| the ball)|carr(?:y|ies)|target|reps|role|featured|feature|focal|centerpiece|workhorse|bell.?cow|committee|pecking order|lead back|starter|starting|first[- ]team|first unit|two[- ]minute|third[- ]down|red[- ]zone|goal[- ]line|opening drive|build(?:ing)? around|building block|more involved|usage|get .*ball|feed|practice|limited|held out|sidelined|returned|cleared|pup|injur|depth chart)/i.test(String(value || ""));
}
function sourceRoleFor(player, value) {
  const staff = coaches[String(player?.team || "").toUpperCase()] || {};
  const text = String(value || "").toLowerCase();
  const attributed = (name) => {
    if (!name) return false;
    const full = String(name).toLowerCase();
    const last = full.split(/\s+/).at(-1);
    if (text.includes(`${full} on `) || (text.includes(full) && /press conference|media availability|speaking to|told reporters/.test(text))) return true;
    const index = text.indexOf(last);
    if (index < 0) return false;
    const window = text.slice(Math.max(0, index - 100), Math.min(text.length, index + last.length + 180));
    return /\b(?:said|says|told|promised|explained|added|called|declared|vowed)\b/.test(window);
  };
  if (attributed(staff.headCoach)) return "head-coach";
  if (attributed(staff.offensivePlayCaller)) return "play-caller";
  if (attributed(staff.offensiveCoordinator)) return "offensive-coordinator";
  return "reporter";
}
function playerContext(value, player) {
  const text = stripHtml(value);
  const lastName = String(player?.name || "").trim().split(/\s+/).at(-1)?.replace(/[^a-z'-]/gi, "") || "";
  if (!lastName) return "";
  const lower = text.toLowerCase();
  const needle = lastName.toLowerCase();
  const windows = [];
  let index = lower.indexOf(needle);
  while (index >= 0 && windows.length < 4) {
    windows.push(text.slice(Math.max(0, index - 500), Math.min(text.length, index + 700)));
    index = lower.indexOf(needle, index + needle.length);
  }
  return unique(windows).join(" ");
}
function targetRow(target, player) {
  const id = String(player.id);
  if (!target.has(id)) target.set(id, { id, name: player.name, team: player.team, position: player.position, observations: [] });
  return target.get(id);
}
function appendObservation(row, observation) {
  const keys = (observation.evidenceKeys || []).slice().sort().join(",");
  const fingerprint = `${observation.storyId}|${keys}`;
  const duplicate = row.observations.some((existing) => {
    const existingKeys = (existing.evidenceKeys || []).slice().sort().join(",");
    return `${existing.storyId}|${existingKeys}` === fingerprint;
  });
  if (!duplicate) row.observations.push(observation);
  return !duplicate;
}
function campObservation(article, block) {
  if (block.athleteIds.length !== 1) return null;
  const player = players.get(block.athleteIds[0]);
  if (!player || !SKILL.has(String(player.position))) return null;
  const camp = live.classifyCampText(`training camp practice ${block.text}`);
  const availability = live.classifyAvailabilityText(block.text);
  const facts = observationFacts(block.text);
  if (!camp.matches.length && !availability.active && !facts.starterUnit && !Number.isFinite(facts.catches)) return null;
  return { player, observation: {
    storyId: String(article.id || ""), published: article.published || article.lastModified || null,
    score: camp.score, roleScore: camp.roleScore, performanceScore: camp.performanceScore,
    availabilityRisk: Math.max(camp.availabilityRisk, Math.max(0, -Number(availability.score || 0))),
    availabilityScore: availability.active ? availability.score : null,
    availabilityState: availability.active ? availability.state : null,
    usageScore: 0, usageConfidence: 0,
    usageSourceRole: "reporter", sourceRole: "reporter", sourceKey: `ESPN:${article.id || "camp"}`,
    usageHyperbole: false,
    evidenceKeys: unique([...camp.matches.map((match) => match.key), ...availability.matches.map((match) => match.key)]),
    ...facts,
  } };
}
function usageObservation(player, article, detail) {
  const header = stripHtml(`${detail?.headline || article.headline || ""} ${detail?.description || ""}`);
  const body = stripHtml(detail?.story || "");
  const context = playerContext(`${header} ${body}`, player);
  if (!context && !normalize(header).includes(normalize(player.name))) return null;
  const evidenceText = `${header} ${context}`;
  const sourceRole = sourceRoleFor(player, evidenceText);
  const usage = live.classifyUsageIntentText(evidenceText, {
    sourceRole,
    directQuote: sourceRole !== "reporter" && /["“”]/.test(evidenceText),
  });
  const availability = live.classifyAvailabilityText(evidenceText);
  const camp = live.classifyCampText(`preseason ${evidenceText}`);
  const structuralMatches = camp.matches.filter((match) => match.family === "role");
  const facts = observationFacts(evidenceText);
  if (!usage.active && !availability.active && !structuralMatches.length && !facts.starterUnit && !facts.openingDrive) return null;
  const roleNumerator = (usage.active ? usage.usageScore * Math.max(0.35, usage.confidence) : 0) + (structuralMatches.length ? camp.roleScore * 0.7 : 0);
  const roleDenominator = (usage.active ? Math.max(0.35, usage.confidence) : 0) + (structuralMatches.length ? 0.7 : 0);
  const roleScore = roleDenominator ? roleNumerator / roleDenominator : 0;
  const sourceKey = stripHtml(detail?.byline || detail?.author || `${sourceRole}:${article.id || detail?.id || "story"}`);
  return {
    storyId: String(article.id || detail?.id || ""), published: detail?.published || article.published || article.date || null,
    score: roleScore, roleScore, performanceScore: 0,
    availabilityRisk: availability.active ? Math.max(0, -availability.score) : 0,
    availabilityScore: availability.active ? availability.score : null,
    availabilityState: availability.active ? availability.state : null,
    usageScore: usage.active ? usage.usageScore : 0, usageConfidence: usage.active ? usage.confidence : 0,
    usageSourceRole: sourceRole, sourceRole, sourceKey: `ESPN:${sourceKey}`,
    usageHyperbole: usage.hyperbole === true, literalVolume: usage.literalVolume === true,
    evidenceKeys: unique([...usage.matches.map((match) => match.key), ...structuralMatches.map((match) => match.key), ...availability.matches.map((match) => match.key)]),
    ...facts,
  };
}
function recentEnough(value, capturedAt) {
  const date = Date.parse(value || "");
  if (!Number.isFinite(date)) return true;
  return Date.parse(capturedAt) - date <= SEARCH_MAX_AGE_DAYS * 86400000;
}
function summarizePlayer(row, capturedAt) {
  const now = Date.parse(capturedAt);
  const weighted = row.observations.map((observation) => {
    const published = Date.parse(observation.published || "");
    const ageDays = Number.isFinite(published) ? Math.max(0, now - published) / 86400000 : 7;
    const structural = observation.evidenceKeys.some((key) => key.startsWith("role.") || key.startsWith("usage.") || key.startsWith("availability.")) || observation.starterUnit ? 1 : 0.55;
    const authority = Number.isFinite(Number(observation.usageConfidence)) && observation.usageConfidence > 0
      ? 0.75 + Number(observation.usageConfidence) * 0.5 : 1;
    return { observation, weight: Math.max(0.05, Math.exp((-Math.LN2 * ageDays) / 7) * structural * authority) };
  });
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  const avg = (field) => total ? weighted.reduce((sum, item) => sum + Number(item.observation[field] || 0) * item.weight, 0) / total : 0;
  const score = avg("score");
  const conflict = Math.min(1, total ? weighted.reduce((sum, item) => sum + Math.abs(item.observation.score - score) * item.weight, 0) / total : 0);
  const confidence = Math.min(0.68, Math.max(0.08, (0.16 + Math.min(0.42, total * 0.1)) * (1 - conflict * 0.45)));
  const availabilityTimeline = row.observations
    .filter((item) => item.availabilityScore !== null && item.availabilityScore !== undefined && Number.isFinite(Number(item.availabilityScore)))
    .map((item) => ({ storyId: item.storyId, published: item.published, state: item.availabilityState, score: Number(item.availabilityScore) }))
    .sort((a, b) => String(a.published || "").localeCompare(String(b.published || "")));
  const structuralObservationCount = row.observations.filter((item) => item.evidenceKeys.some((key) => key.startsWith("role.") || key.startsWith("usage.") || key.startsWith("availability.")) || item.starterUnit).length;
  return { ...row, available: true, score, roleScore: avg("roleScore"), usageScore: avg("usageScore"),
    usageConfidence: avg("usageConfidence"), performanceScore: avg("performanceScore"),
    availabilityRisk: Math.max(...row.observations.map((item) => Number(item.availabilityRisk || 0)), 0), availabilityTimeline,
    conflict, confidence, direction: score >= 0.18 ? "up" : score <= -0.18 ? "down" : conflict >= 0.3 ? "mixed" : "neutral",
    evidenceKeys: unique(row.observations.flatMap((item) => item.evidenceKeys)), structuralObservationCount,
    usageSourceRoles: unique(row.observations.map((item) => item.usageSourceRole).filter(Boolean)),
    sourceKeys: unique(row.observations.map((item) => item.sourceKey).filter(Boolean)),
    reportStoryCount: unique(row.observations.map((item) => item.storyId).filter(Boolean)).length,
    usageHyperbole: row.observations.some((item) => item.usageHyperbole === true),
    reportedFirstTeamSnaps: Math.max(...row.observations.map((item) => Number(item.firstTeamSnaps || 0)), 0) || null,
    reportedFirstTeamRoutes: Math.max(...row.observations.map((item) => Number(item.firstTeamRoutes || 0)), 0) || null,
    reportedFirstTeamCarries: Math.max(...row.observations.map((item) => Number(item.firstTeamCarries || 0)), 0) || null,
    reportedFirstTeamTargets: Math.max(...row.observations.map((item) => Number(item.firstTeamTargets || 0)), 0) || null,
    firstTeamMentions: row.observations.filter((item) => item.starterUnit).length,
    starterUnitMentions: row.observations.filter((item) => item.starterUnit || item.openingDrive).length,
    openingDriveMentions: row.observations.filter((item) => item.openingDrive).length,
    twoMinuteMentions: row.observations.filter((item) => item.twoMinute).length,
    thirdDownMentions: row.observations.filter((item) => item.thirdDown).length,
    redZoneMentions: row.observations.filter((item) => item.redZone).length,
    modelEffect: "advisory-only" };
}
function rankedSearchPlayers() {
  return [...players.values()]
    .filter((player) => SKILL.has(String(player.position)))
    .sort((a, b) => Number(a.pprRank ?? a.adp ?? 9999) - Number(b.pprRank ?? b.adp ?? 9999))
    .slice(0, SEARCH_PLAYER_LIMIT);
}
function articleGroup(search) {
  return (search?.results || []).find((row) => row.type === "article")?.contents || [];
}
async function collectPlayerSearchStories(capturedAt) {
  const selected = rankedSearchPlayers();
  const stories = new Map();
  let searches = 0;
  for (let offset = 0; offset < selected.length; offset += 10) {
    const batchPlayers = selected.slice(offset, offset + 10);
    const batch = await Promise.allSettled(batchPlayers.map((player) => sources.espnNflSearch(player.name, 10)));
    batch.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      searches += 1;
      const player = batchPlayers[index];
      for (const raw of articleGroup(result.value)) {
        const article = resultArticle(raw);
        if (!article.id || !usageCandidateHeadline(article.headline) || !recentEnough(article.published, capturedAt)) continue;
        const existing = stories.get(article.id) || { article, playerIds: new Set() };
        existing.playerIds.add(String(player.id));
        stories.set(article.id, existing);
      }
    });
  }
  return { selected, stories, searches };
}
function storyMeta(article, detail, bytes, mode) {
  return {
    id: String(article.id || detail?.id || ""),
    headline: String(detail?.headline || article.headline || ""),
    published: detail?.published || article.published || null,
    url: article.url || article.links?.web?.href || null,
    mode,
    contentSha256: hash(bytes),
  };
}
async function collectGeneralCamp(playerSignals, metadata) {
  const news = await sources.espnNflNews(100);
  const campStories = (news.articles || []).filter((article) =>
    /training camp/i.test(String(article.headline || ""))
    && (article.categories || []).filter((row) => row.type === "team").length === 1
    && article.links?.api?.self?.href);
  for (let offset = 0; offset < campStories.length; offset += 4) {
    const slice = campStories.slice(offset, offset + 4);
    const batch = await Promise.allSettled(slice.map(fetchStory));
    batch.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const article = slice[index];
      const detail = result.value.payload?.headlines?.[0] || {};
      for (const block of storyBlocks(detail.story)) {
        const found = campObservation(article, block);
        if (!found) continue;
        appendObservation(targetRow(playerSignals, found.player), found.observation);
      }
      metadata.push(storyMeta(article, detail, result.value.bytes, "general-camp"));
    });
  }
  return campStories.length;
}
async function collectUsageIntent(playerSignals, metadata, capturedAt) {
  const search = await collectPlayerSearchStories(capturedAt);
  let observations = 0;
  const assignments = [...search.stories.values()];
  for (let offset = 0; offset < assignments.length; offset += 6) {
    const slice = assignments.slice(offset, offset + 6);
    const batch = await Promise.allSettled(slice.map((assignment) => fetchStory(assignment.article)));
    batch.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const assignment = slice[index];
      const detail = result.value.payload?.headlines?.[0] || {};
      let accepted = false;
      for (const playerId of assignment.playerIds) {
        const player = players.get(String(playerId));
        if (!player) continue;
        const observation = usageObservation(player, assignment.article, detail);
        if (!observation) continue;
        if (appendObservation(targetRow(playerSignals, player), observation)) observations += 1;
        accepted = true;
      }
      if (accepted) metadata.push(storyMeta(assignment.article, detail, result.value.bytes, "player-search"));
    });
  }
  return { searchedPlayers: search.selected.length, searches: search.searches, candidateStories: assignments.length, observations };
}
async function main() {
  const capturedAt = new Date().toISOString();
  const playerSignals = new Map();
  const metadata = [];
  const generalCampStories = await collectGeneralCamp(playerSignals, metadata);
  const usage = await collectUsageIntent(playerSignals, metadata, capturedAt);
  const stories = [...new Map(metadata.map((row) => [String(row.id), row])).values()]
    .sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
  const rows = [...playerSignals.values()].map((row) => summarizePlayer(row, capturedAt)).sort((a, b) => a.name.localeCompare(b.name));
  const artifact = {
    meta: {
      version: "camp-intelligence-2026.3", season: 2026, capturedAt,
      source: "ESPN public NFL news plus player-specific ESPN search; offline-derived first-team role, coach-usage, injury-trajectory, and structural preseason observations",
      policy: "Derived signals only. Raw article bodies are never persisted. Structural role, coach/play-caller intent, first-unit usage, and availability trajectory are uncertainty/shadow evidence until prospective validation admits a serving effect.",
      stories: stories.length, generalCampStories,
      searchedPlayers: usage.searchedPlayers, playerSearches: usage.searches,
      usageCandidateStories: usage.candidateStories, usageObservations: usage.observations,
    },
    players: rows,
    stories,
  };
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  const up = rows.filter((row) => row.direction === "up").length;
  const down = rows.filter((row) => row.direction === "down").length;
  const usagePlayers = rows.filter((row) => Math.abs(Number(row.usageScore || 0)) >= 0.1).length;
  console.log(`Wrote ${rows.length} player role signals from ${stories.length} ESPN stories to ${output}`);
  console.log(`Coach/usage observations ${usage.observations} across ${usagePlayers} players; searched ${usage.searches}/${usage.searchedPlayers}`);
  console.log(`Up ${up} | Down ${down} | Mixed/neutral ${rows.length - up - down}`);
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = {
  observationFacts, storyBlocks, summarizePlayer, usageCandidateHeadline,
  playerContext, sourceRoleFor, usageObservation, collectPlayerSearchStories,
};

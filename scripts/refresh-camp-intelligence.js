"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const live = require("../src/engine/live-intelligence.js");
const sources = require("../src/data/sources.js");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "data", "camp-2026.json");
const dataset = JSON.parse(fs.readFileSync(path.join(root, "data", "players-lite.json"), "utf8"));
const players = new Map((dataset.players || []).map((player) => [String(player.id), player]));
const SKILL = new Set(["QB", "RB", "WR", "TE"]);

function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function unique(values) { return [...new Set(values)]; }
function wordNumber(value) {
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return Number.isFinite(Number(value)) ? Number(value) : words[String(value || "").toLowerCase()] ?? null;
}
function observationFacts(text) {
  const firstTeam = /\bfirst[- ]team\b/i.test(text);
  const snap = text.match(/\b(\d{1,3})\s+snaps?\b/i);
  const caught = text.match(/\bcaught\s+(?:only\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+of\s+(?:his\s+)?(\d+)\s+(?:passes|targets)\b/i);
  return {
    firstTeamSnaps: firstTeam && snap ? Number(snap[1]) : null,
    catches: caught ? wordNumber(caught[1]) : null,
    targets: caught ? Number(caught[2]) : null,
  };
}
function storyBlocks(story) {
  return [...String(story || "").matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => ({
    html: match[2],
    text: stripHtml(match[2]),
    athleteIds: unique([...match[2].matchAll(/\/player\/_\/id\/(\d+)/g)].map((row) => row[1])),
  }));
}
function coreUrl(article) {
  const href = String(article?.links?.api?.self?.href || "");
  const url = new URL(href);
  if (url.origin !== "https://content.core.api.espn.com" || !url.pathname.startsWith("/v1/sports/news/")) throw new Error("Unexpected ESPN content URL");
  return url.href;
}
async function fetchStory(article) {
  const url = coreUrl(article);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`ESPN content returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw new Error("ESPN content response too large");
  return { url, bytes, payload: JSON.parse(bytes.toString("utf8")) };
}
function addObservation(target, article, block) {
  if (block.athleteIds.length !== 1) return;
  const player = players.get(block.athleteIds[0]);
  if (!player || !SKILL.has(String(player.position))) return;
  const camp = live.classifyCampText(`training camp practice ${block.text}`);
  const facts = observationFacts(block.text);
  if (!camp.matches.length && !Number.isFinite(facts.firstTeamSnaps) && !Number.isFinite(facts.catches)) return;
  const row = target.get(String(player.id)) || { id: String(player.id), name: player.name, team: player.team, position: player.position, observations: [] };
  row.observations.push({
    storyId: String(article.id || ""), published: article.published || article.lastModified || null,
    score: camp.score, roleScore: camp.roleScore, performanceScore: camp.performanceScore,
    availabilityRisk: camp.availabilityRisk, evidenceKeys: camp.matches.map((match) => match.key), ...facts,
  });
  target.set(String(player.id), row);
}
function summarizePlayer(row, capturedAt) {
  const now = Date.parse(capturedAt);
  const weighted = row.observations.map((observation) => {
    const published = Date.parse(observation.published || "");
    const ageDays = Number.isFinite(published) ? Math.max(0, now - published) / 86400000 : 7;
    const structural = observation.evidenceKeys.some((key) => key.startsWith("role.")) ? 1 : 0.65;
    return { observation, weight: Math.max(0.05, Math.exp((-Math.LN2 * ageDays) / 7) * structural) };
  });
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  const avg = (field) => total ? weighted.reduce((sum, item) => sum + Number(item.observation[field] || 0) * item.weight, 0) / total : 0;
  const score = avg("score");
  const conflict = Math.min(1, total ? weighted.reduce((sum, item) => sum + Math.abs(item.observation.score - score) * item.weight, 0) / total : 0);
  const confidence = Math.min(0.62, Math.max(0.08, (0.16 + Math.min(0.38, total * 0.1)) * (1 - conflict * 0.45)));
  return { ...row, available: true, score, roleScore: avg("roleScore"), performanceScore: avg("performanceScore"), availabilityRisk: Math.max(...row.observations.map((item) => Number(item.availabilityRisk || 0)), 0), conflict, confidence,
    direction: score >= 0.18 ? "up" : score <= -0.18 ? "down" : conflict >= 0.3 ? "mixed" : "neutral",
    evidenceKeys: unique(row.observations.flatMap((item) => item.evidenceKeys)), reportedFirstTeamSnaps: Math.max(...row.observations.map((item) => Number(item.firstTeamSnaps || 0)), 0) || null,
    modelEffect: "advisory-only" };
}
async function main() {
  const capturedAt = new Date().toISOString();
  const news = await sources.espnNflNews(100);
  const campStories = (news.articles || []).filter((article) => /training camp/i.test(String(article.headline || "")) && (article.categories || []).filter((row) => row.type === "team").length === 1 && article.links?.api?.self?.href);
  const playerSignals = new Map();
  const storyMeta = [];
  for (let offset = 0; offset < campStories.length; offset += 4) {
    const batch = await Promise.allSettled(campStories.slice(offset, offset + 4).map(fetchStory));
    batch.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const article = campStories[offset + index];
      const detail = result.value.payload?.headlines?.[0] || {};
      for (const block of storyBlocks(detail.story)) addObservation(playerSignals, article, block);
      storyMeta.push({ id: String(article.id || ""), headline: String(article.headline || ""), published: article.published || null, url: article.links?.web?.href || null, contentSha256: hash(result.value.bytes) });
    });
  }
  const artifact = {
    meta: {
      version: "camp-intelligence-2026.1", season: 2026, capturedAt,
      source: "ESPN public NFL news metadata plus offline-derived camp observations",
      policy: "Derived signals only. Raw article bodies are never persisted. Camp evidence is advisory-only until prospective validation admits a model effect.",
      stories: storyMeta.length,
    },
    players: [...playerSignals.values()].map((row) => summarizePlayer(row, capturedAt)).sort((a, b) => a.name.localeCompare(b.name)),
    stories: storyMeta.sort((a, b) => String(b.published).localeCompare(String(a.published))),
  };
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${artifact.players.length} player camp signals from ${artifact.meta.stories} ESPN camp stories to ${output}`);
  console.log(`Up ${artifact.players.filter((row) => row.direction === "up").length} | Down ${artifact.players.filter((row) => row.direction === "down").length} | Mixed/neutral ${artifact.players.filter((row) => !["up", "down"].includes(row.direction)).length}`);
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { observationFacts, storyBlocks, summarizePlayer };

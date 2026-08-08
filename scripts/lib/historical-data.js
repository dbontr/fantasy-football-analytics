"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..", "..");
const cacheDir = path.join(root, ".cache", "validation");
const manifestPath = path.join(cacheDir, "manifest.json");
const USER_AGENT = "SnapCount-historical-validation/1.0";

function ensureCache() {
  fs.mkdirSync(cacheDir, { recursive: true });
}
function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "_");
}
function readManifest() {
  ensureCache();
  try { return JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
  catch (_) { return { version: 1, files: {} }; }
}
function writeManifest(manifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

async function fetchCached(url, cacheKey, options = {}) {
  ensureCache();
  const file = path.join(cacheDir, safeName(cacheKey));
  const manifest = readManifest();
  if (!options.refresh && fs.existsSync(file)) {
    const bytes = fs.readFileSync(file);
    return { file, bytes, url, sha256: sha256(bytes), cached: true, meta: manifest.files[cacheKey] || null };
  }
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, ...(options.headers || {}) },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(file, bytes);
  manifest.files[cacheKey] = {
    url: response.url || url,
    bytes: bytes.length,
    sha256: sha256(bytes),
    retrievedAt: new Date().toISOString(),
  };
  writeManifest(manifest);
  return { file, bytes, url: response.url || url, sha256: manifest.files[cacheKey].sha256, cached: false, meta: manifest.files[cacheKey] };
}

async function githubRelease(repo, tag, options = {}) {
  const key = `github-${repo.replace("/", "-")}-${tag}.json`;
  const url = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const result = await fetchCached(url, key, { ...options, headers: { accept: "application/vnd.github+json" } });
  return JSON.parse(result.bytes.toString("utf8"));
}

async function releaseAsset(repo, tag, assetName, options = {}) {
  const release = await githubRelease(repo, tag, options);
  const asset = (release.assets || []).find((row) => row.name === assetName);
  if (!asset) throw new Error(`Missing ${repo} ${tag} asset ${assetName}`);
  const result = await fetchCached(asset.browser_download_url, `${repo.replace("/", "-")}-${tag}-${assetName}`, options);
  return { ...result, releasePublishedAt: release.published_at || release.created_at || null, assetName };
}

async function espnSeason(season, leagueDefault = 3, options = {}) {
  const selected = Math.round(Number(season));
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${selected}/segments/0/leaguedefaults/${leagueDefault}?view=kona_player_info`;
  const filter = { players: { limit: 700, sortPercOwned: { sortPriority: 1, sortAsc: false } } };
  const result = await fetchCached(url, `espn-${selected}-default-${leagueDefault}.json`, {
    ...options,
    headers: { "x-fantasy-filter": JSON.stringify(filter) },
  });
  return { ...result, payload: JSON.parse(result.bytes.toString("utf8")), season: selected, leagueDefault };
}

async function nflverseAsset(tag, assetName, options = {}) {
  return releaseAsset("nflverse/nflverse-data", tag, assetName, options);
}
async function ffopportunityAsset(assetName, options = {}) {
  return releaseAsset("ffverse/ffopportunity", "latest-data", assetName, options);
}

function parseCsvLine(line) {
  const values = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index <= line.length; index += 1) {
    const char = line[index] ?? ",";
    const next = line[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { values.push(field); field = ""; }
    else field += char;
  }
  return values;
}

function parseCsv(text, columnsWanted = null) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const indices = columnsWanted
    ? columnsWanted.map((name) => [name, headers.indexOf(name)]).filter(([, index]) => index >= 0)
    : headers.map((name, index) => [name, index]);
  const rows = [];
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const values = parseCsvLine(lines[rowIndex]);
    const row = {};
    for (const [name, index] of indices) row[name] = values[index] ?? "";
    rows.push(row);
  }
  return rows;
}

function text(result) {
  return result.bytes.toString("utf8");
}
function provenance(results) {
  return results.filter(Boolean).map((result) => ({
    asset: result.assetName || path.basename(result.file),
    url: result.url,
    bytes: result.bytes.length,
    sha256: result.sha256,
    releasePublishedAt: result.releasePublishedAt || null,
  }));
}

module.exports = {
  USER_AGENT,
  cacheDir,
  espnSeason,
  ffopportunityAsset,
  fetchCached,
  githubRelease,
  nflverseAsset,
  parseCsv,
  parseCsvLine,
  provenance,
  releaseAsset,
  root,
  sha256,
  text,
};

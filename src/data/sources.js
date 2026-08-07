(function attachOracleSources(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleSources = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSources() {
  "use strict";

  const VERSION = "oracle-free-sources-browser-2026.1";
  const SOURCES = Object.freeze({
    sleeper: Object.freeze({
      id: "sleeper",
      origins: ["https://api.sleeper.app"],
      prefixes: ["/v1/"],
      maxBytes: 32 * 1024 * 1024,
      attribution: "Sleeper",
      terms: "https://docs.sleeper.com/",
      license: "Public read-only API",
    }),
    nflverse: Object.freeze({
      id: "nflverse",
      origins: ["https://api.github.com", "https://github.com", "https://release-assets.githubusercontent.com", "https://objects.githubusercontent.com"],
      prefixes: ["/repos/nflverse/nflverse-data/releases/", "/nflverse/nflverse-data/releases/download/", "/"],
      maxBytes: 180 * 1024 * 1024,
      attribution: "nflverse",
      terms: "https://github.com/nflverse/nflverse-data",
      license: "CC-BY-4.0 unless an individual release states otherwise",
    }),
    nws: Object.freeze({
      id: "nws",
      origins: ["https://api.weather.gov"],
      prefixes: ["/points/", "/gridpoints/", "/zones/"],
      maxBytes: 8 * 1024 * 1024,
      attribution: "NOAA National Weather Service",
      terms: "https://www.weather.gov/documentation/services-web-api",
      license: "United States Government open data",
    }),
  });

  function sourceCatalog() {
    return Object.values(SOURCES).map((source) => ({
      ...source,
      access: { anonymous: true, accountRequired: false, apiKeyRequired: false, oauthRequired: false },
      cost: { priceUsd: 0, trialOnly: false, paymentMethodRequired: false, expires: false, paidFallbackRequired: false },
    }));
  }

  function assertFreeUrl(sourceId, input) {
    const source = SOURCES[sourceId];
    if (!source) throw new RangeError(`Unknown free source: ${sourceId}`);
    const url = new URL(input);
    if (url.protocol !== "https:") throw new Error("Only HTTPS public sources are allowed");
    if (url.username || url.password) throw new Error("Credentials are forbidden in source URLs");
    const originAllowed = source.origins.includes(url.origin);
    const prefixAllowed = source.prefixes.some((prefix) => url.pathname.startsWith(prefix));
    if (!originAllowed || !prefixAllowed) throw new Error(`URL is outside the ${sourceId} allowlist`);
    for (const key of url.searchParams.keys()) {
      if (/key|token|secret|password|credential|auth/i.test(key)) throw new Error("Secret-bearing query parameters are forbidden");
    }
    return { source, url };
  }

  async function fetchBounded(sourceId, input, options = {}) {
    const { source, url } = assertFreeUrl(sourceId, input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(options.timeoutMs || 15_000)));
    try {
      const response = await fetch(url, {
        method: "GET",
        cache: options.cache || "default",
        credentials: "omit",
        redirect: "follow",
        signal: controller.signal,
        headers: { Accept: options.accept || "*/*" },
      });
      if (!response.ok) throw new Error(`${sourceId} returned HTTP ${response.status}`);
      const finalUrl = response.url || url.href;
      assertFreeUrl(sourceId, finalUrl);
      const declared = Number(response.headers.get("content-length") || 0);
      const maxBytes = Math.min(source.maxBytes, Number(options.maxBytes || source.maxBytes));
      if (declared > maxBytes) throw new RangeError(`${sourceId} response exceeds ${maxBytes} bytes`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new RangeError(`${sourceId} response exceeds ${maxBytes} bytes`);
      return { bytes, response, source, url: finalUrl };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchJson(sourceId, url, options = {}) {
    const result = await fetchBounded(sourceId, url, { ...options, accept: "application/json" });
    return JSON.parse(new TextDecoder().decode(result.bytes));
  }

  async function fetchText(sourceId, url, options = {}) {
    const result = await fetchBounded(sourceId, url, { ...options, accept: "text/csv,text/plain,*/*" });
    return new TextDecoder().decode(result.bytes);
  }

  async function decodeGzip(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("gzip decompression is unavailable in this browser");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  function normalizeName(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  async function loadSleeperPlayers(position = null) {
    const suffix = position ? `?position=${encodeURIComponent(String(position).toUpperCase())}` : "";
    return fetchJson("sleeper", `https://api.sleeper.app/v1/players/nfl${suffix}`, { timeoutMs: 30_000 });
  }

  async function loadSleeperLeague(leagueId) {
    const id = encodeURIComponent(String(leagueId || "").trim());
    if (!id) throw new TypeError("Sleeper league id is required");
    const base = "https://api.sleeper.app/v1";
    const [league, rosters, users] = await Promise.all([
      fetchJson("sleeper", `${base}/league/${id}`),
      fetchJson("sleeper", `${base}/league/${id}/rosters`),
      fetchJson("sleeper", `${base}/league/${id}/users`),
    ]);
    return { league, rosters, users };
  }

  function enrichLocalPlayers(localPlayers, sleeperPlayers) {
    const byKey = new Map();
    for (const [sleeperId, player] of Object.entries(sleeperPlayers || {})) {
      if (!player?.full_name) continue;
      const key = `${normalizeName(player.full_name)}|${String(player.position || "").toUpperCase()}`;
      const rows = byKey.get(key) || [];
      rows.push({ sleeperId, ...player });
      byKey.set(key, rows);
    }
    return (localPlayers || []).map((player) => {
      const key = `${normalizeName(player.name)}|${String(player.position || "").toUpperCase()}`;
      const candidates = byKey.get(key) || [];
      const match = candidates.find((candidate) => String(candidate.team || "").toUpperCase() === String(player.team || "").toUpperCase()) || candidates[0];
      if (!match) return player;
      return {
        ...player,
        sleeperId: match.sleeperId,
        injuryStatus: match.injury_status || player.injuryStatus,
        sleeper: {
          status: match.status || null,
          injuryBodyPart: match.injury_body_part || null,
          injuryNotes: match.injury_notes || null,
          injuryStartDate: match.injury_start_date || null,
          newsUpdated: match.news_updated || null,
          practiceParticipation: match.practice_participation || null,
          depthChartPosition: match.depth_chart_position || null,
          depthChartOrder: match.depth_chart_order || null,
        },
      };
    });
  }

  async function nflverseRelease(tag) {
    const safeTag = encodeURIComponent(String(tag || "").trim());
    if (!safeTag) throw new TypeError("nflverse release tag is required");
    return fetchJson("nflverse", `https://api.github.com/repos/nflverse/nflverse-data/releases/tags/${safeTag}`);
  }

  async function nflverseAssetText(tag, matcher, options = {}) {
    const release = await nflverseRelease(tag);
    const predicate = matcher instanceof RegExp ? (name) => matcher.test(name) : (name) => String(name).includes(String(matcher || ".csv"));
    const asset = (release.assets || []).find((row) => predicate(row.name));
    if (!asset) throw new Error(`No matching nflverse asset in ${tag}`);
    return { name: asset.name, text: await fetchText("nflverse", asset.browser_download_url, options) };
  }

  async function nflversePlayerWeeklyText(season) {
    const selected = Math.round(Number(season));
    if (selected < 1999 || selected > 2100) throw new RangeError("Invalid NFL season");
    const bundledUrl = `./data/history/stats_player_week_${selected}.csv.gz`;
    if (typeof location !== "undefined" && typeof DecompressionStream !== "undefined") {
      try {
        const response = await fetch(bundledUrl, { method: "GET", cache: "default", credentials: "omit" });
        if (response.ok) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength > 16 * 1024 * 1024) throw new RangeError("Bundled nflverse history exceeds size limit");
          return { season: selected, name: bundledUrl.split("/").pop(), text: await decodeGzip(bytes), bytes: bytes.byteLength, compressed: true, bundled: true, url: response.url || bundledUrl };
        }
      } catch (_) { /* fall through to the public nflverse release */ }
    }
    const release = await nflverseRelease("stats_player");
    const gzipName = `stats_player_week_${selected}.csv.gz`;
    const csvName = `stats_player_week_${selected}.csv`;
    const compressed = (release.assets || []).find((row) => row.name === gzipName);
    if (compressed && typeof DecompressionStream !== "undefined") {
      const result = await fetchBounded("nflverse", compressed.browser_download_url, { maxBytes: 16 * 1024 * 1024, timeoutMs: 30_000 });
      return { season: selected, name: gzipName, text: await decodeGzip(result.bytes), bytes: result.bytes.byteLength, compressed: true, url: result.url };
    }
    const plain = (release.assets || []).find((row) => row.name === csvName);
    if (!plain) throw new Error(`nflverse weekly player stats are unavailable for ${selected}`);
    const result = await fetchBounded("nflverse", plain.browser_download_url, { maxBytes: 32 * 1024 * 1024, timeoutMs: 30_000 });
    return { season: selected, name: csvName, text: new TextDecoder().decode(result.bytes), bytes: result.bytes.byteLength, compressed: false, url: result.url };
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const input = String(text || "");
    for (let index = 0; index <= input.length; index += 1) {
      const char = input[index] ?? "\n";
      const next = input[index + 1];
      if (quoted) {
        if (char === '"' && next === '"') { field += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        field = "";
      } else field += char;
    }
    if (!rows.length) return [];
    const headers = rows[0];
    return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }

  async function nwsForecast(latitude, longitude, kickoff = null) {
    const lat = Number(latitude).toFixed(4);
    const lon = Number(longitude).toFixed(4);
    const point = await fetchJson("nws", `https://api.weather.gov/points/${lat},${lon}`);
    const forecastUrl = point?.properties?.forecastHourly || point?.properties?.forecast;
    if (!forecastUrl) throw new Error("NWS point metadata did not include a forecast URL");
    const forecast = await fetchJson("nws", forecastUrl);
    const periods = forecast?.properties?.periods || [];
    if (!kickoff || !periods.length) return { point, forecast, period: periods[0] || null };
    const target = Date.parse(kickoff);
    const period = periods.find((row) => Date.parse(row.startTime) <= target && Date.parse(row.endTime) > target)
      || periods.reduce((best, row) => Math.abs(Date.parse(row.startTime) - target) < Math.abs(Date.parse(best.startTime) - target) ? row : best, periods[0]);
    return { point, forecast, period };
  }

  return {
    VERSION,
    SOURCES,
    assertFreeUrl,
    enrichLocalPlayers,
    fetchBounded,
    fetchJson,
    fetchText,
    loadSleeperLeague,
    loadSleeperPlayers,
    nflverseAssetText,
    nflversePlayerWeeklyText,
    nflverseRelease,
    normalizeName,
    nwsForecast,
    parseCsv,
    sourceCatalog,
  };
});

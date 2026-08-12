"use strict";

const CACHE = "snapcount-browser-v1.30.0-football-context";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./snapcount-mark.svg",
  "./snapcount-mark-sidebar.svg",
  "./snapcount-logo.svg",
  "./engine-worker.js",
  "./src/app.js",
  "./src/engine/core.js",
  "./src/engine/league.js",
  "./src/engine/rookies.js",
  "./src/engine/correlation.js",
  "./src/engine/mean-calibration.js",
  "./src/engine/football-context.js",
  "./src/engine/runtime.js",
  "./src/engine/evidence.js",
  "./src/engine/context.js",
  "./src/engine/intelligence.js",
  "./src/engine/live-intelligence.js",
  "./src/engine/calibration.js",
  "./src/engine/draft-sim.js",
  "./src/data/sources.js",
  "./src/data/espn-fantasy.js",
  "./src/storage/browser-store.js",
  "./data/players-lite.json",
  "./data/analytics-runtime-profile.json",
  "./data/model-interaction-coverage.json",
  "./data/special-teams-2026.json",
  "./data/football-context-2026.json",
  "./data/coaches-2026.json",
  "./data/health-calibration-2026.json",
  "./data/rookies-2026.json",
  "./data/camp-2026.json",
  "./data/validation/site-benchmark-2018.json",
];

self.addEventListener("install", (event) => {
  const freshAssets = STATIC_ASSETS.map((path) => new Request(new URL(path, self.registration.scope), { cache: "reload" }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(freshAssets)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const shellRequest = event.request.mode === "navigate" || ["document", "style", "script", "worker"].includes(event.request.destination) || /\.(?:html|css|js)$/.test(url.pathname);
  const network = () => fetch(event.request, { cache: "no-store" }).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  });
  if (shellRequest) event.respondWith(network().catch(() => caches.match(event.request)));
  else event.respondWith(caches.match(event.request).then((cached) => cached || network()));
});

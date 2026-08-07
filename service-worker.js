"use strict";

const CACHE = "oracle-browser-v0.7.0";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./engine-worker.js",
  "./src/app.js",
  "./src/engine/core.js",
  "./src/engine/runtime.js",
  "./src/engine/evidence.js",
  "./src/engine/context.js",
  "./src/engine/intelligence.js",
  "./src/data/sources.js",
  "./src/storage/browser-store.js",
  "./data/players-lite.json",
  "./data/coaches-2026.json",
  "./data/health-calibration-2026.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  })));
});

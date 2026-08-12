(function attachOracleStore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createStoreApi() {
  "use strict";

  const DB_NAME = "fantasy-oracle-browser";
  const DB_VERSION = 1;

  function openDb() {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function set(key, value) {
    const db = await openDb();
    if (!db) {
      localStorage.setItem(`${DB_NAME}:${key}`, JSON.stringify(value));
      return value;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function get(key, fallback = null) {
    const db = await openDb();
    if (!db) {
      const raw = localStorage.getItem(`${DB_NAME}:${key}`);
      return raw == null ? fallback : JSON.parse(raw);
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readonly");
      const request = tx.objectStore("kv").get(key);
      request.onsuccess = () => resolve(request.result === undefined ? fallback : request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function remove(key) {
    const db = await openDb();
    if (!db) return localStorage.removeItem(`${DB_NAME}:${key}`);
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { DB_NAME, DB_VERSION, get, openDb, remove, set };
});

if (typeof document !== "undefined" && !document.querySelector('script[data-snapcount-player-popout]')) {
  const script = document.createElement("script");
  script.src = "./src/outlook-player-popout.js";
  script.dataset.snapcountPlayerPopout = "true";
  document.head.appendChild(script);
}

if (typeof document !== "undefined" && !document.querySelector('script[data-snapcount-draft-intelligence]')) {
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "./draft-intelligence.css";
  style.dataset.snapcountDraftIntelligence = "true";
  document.head.appendChild(style);
  const script = document.createElement("script");
  script.src = "./src/engine/draft-intelligence.js";
  script.dataset.snapcountDraftIntelligence = "true";
  document.head.appendChild(script);
}

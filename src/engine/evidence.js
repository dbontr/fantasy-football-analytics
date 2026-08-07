(function attachOracleEvidence(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OracleEvidence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createEvidenceApi() {
  "use strict";

  const VERSION = "oracle-evidence-browser-2026.1";
  const DAY_MS = 86_400_000;
  const HALF_LIFE_DAYS = Object.freeze({
    market: 2,
    role: 7,
    health: 2,
    availability: 1,
    news: 2,
    environment: 0.5,
    matchup: 7,
    line: 7,
    coaching: 45,
    tracking: 14,
    efficiency: 21,
  });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }
  function familyFor(feature) {
    return String(feature || "custom").split(".")[0] || "custom";
  }
  function epoch(value, fallback = Date.now()) {
    const parsed = typeof value === "number" ? value : Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  async function sha256(value) {
    const text = typeof value === "string" ? value : stableJson(value);
    const bytes = new TextEncoder().encode(text);
    if (globalThis.crypto?.subtle) {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    if (typeof require === "function") {
      return require("node:crypto").createHash("sha256").update(bytes).digest("hex");
    }
    throw new Error("SHA-256 is unavailable in this runtime");
  }

  function normalizeObservation(raw, index = 0) {
    const observedAt = epoch(raw.observedAt ?? raw.timestamp);
    const effectiveAt = epoch(raw.effectiveAt, observedAt);
    const expiresAt = raw.expiresAt == null ? null : epoch(raw.expiresAt, effectiveAt);
    const feature = String(raw.feature || "");
    if (!feature) throw new TypeError("Evidence requires a feature");
    const entityType = String(raw.entityType || "player");
    const entityId = String(raw.entityId || raw.playerId || "");
    if (!entityId) throw new TypeError("Evidence requires an entityId");
    const type = raw.type || (typeof raw.value === "number" ? "numeric" : "categorical");
    return {
      schemaVersion: "evidence/v1",
      sequence: Number.isFinite(Number(raw.sequence)) ? Number(raw.sequence) : index,
      entityType,
      entityId,
      feature,
      family: String(raw.family || familyFor(feature)),
      type: String(type),
      value: raw.value,
      unit: raw.unit == null ? null : String(raw.unit),
      source: String(raw.source || "local"),
      reliability: clamp(raw.reliability ?? 0.7, 0, 1),
      confidence: clamp(raw.confidence ?? 0.7, 0, 1),
      observedAt,
      effectiveAt,
      expiresAt,
      metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
      previousHash: raw.previousHash || null,
      hash: raw.hash || null,
    };
  }

  function freshnessWeight(observation, asOf) {
    const halfLife = Math.max(0.125, finite(HALF_LIFE_DAYS[observation.family], 14)) * DAY_MS;
    const age = Math.max(0, asOf - observation.effectiveAt);
    return Math.exp((-Math.LN2 * age) / halfLife);
  }

  function observationWeight(observation, asOf) {
    return clamp(observation.reliability, 0, 1)
      * clamp(observation.confidence, 0, 1)
      * freshnessWeight(observation, asOf);
  }

  function activeAt(observation, asOf) {
    return observation.observedAt <= asOf
      && observation.effectiveAt <= asOf
      && (observation.expiresAt == null || observation.expiresAt > asOf);
  }

  function resolveRows(rows, asOf) {
    if (!rows.length) return { available: false, value: null, confidence: 0, conflict: 0, provenance: [] };
    const weighted = rows.map((row) => ({ row, weight: observationWeight(row, asOf) })).filter((entry) => entry.weight > 1e-8);
    if (!weighted.length) return { available: false, value: null, confidence: 0, conflict: 0, provenance: [] };
    const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    const numeric = weighted.every((entry) => typeof entry.row.value === "number" || Number.isFinite(Number(entry.row.value)));
    let value;
    let conflict;
    if (numeric) {
      value = weighted.reduce((sum, entry) => sum + finite(entry.row.value) * entry.weight, 0) / totalWeight;
      const variance = weighted.reduce((sum, entry) => sum + (finite(entry.row.value) - value) ** 2 * entry.weight, 0) / totalWeight;
      const scale = Math.max(0.25, Math.abs(value));
      conflict = clamp(Math.sqrt(variance) / scale, 0, 1);
    } else {
      const votes = new Map();
      for (const entry of weighted) {
        const key = String(entry.row.value);
        votes.set(key, (votes.get(key) || 0) + entry.weight);
      }
      const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      value = winner[0];
      conflict = clamp(1 - winner[1] / totalWeight, 0, 1);
    }
    const authority = weighted.reduce((sum, entry) => sum + entry.weight, 0) / weighted.length;
    const confidence = clamp(authority * (1 - conflict * 0.55), 0, 1);
    const newest = [...weighted].sort((a, b) => b.row.effectiveAt - a.row.effectiveAt)[0].row;
    return {
      available: true,
      type: numeric ? "numeric" : "categorical",
      value,
      unit: newest.unit,
      confidence,
      conflict,
      sources: [...new Set(weighted.map((entry) => entry.row.source))],
      provenance: weighted.sort((a, b) => b.weight - a.weight).map((entry) => ({
        hash: entry.row.hash,
        source: entry.row.source,
        value: entry.row.value,
        confidence: entry.row.confidence,
        reliability: entry.row.reliability,
        effectiveAt: entry.row.effectiveAt,
        observedAt: entry.row.observedAt,
        weight: entry.weight,
      })),
    };
  }

  class EvidenceLedger {
    constructor(observations = []) {
      this.observations = observations.map((row, index) => normalizeObservation(row, index));
    }

    async add(raw) {
      const observation = normalizeObservation(raw, this.observations.length);
      observation.previousHash = this.observations.at(-1)?.hash || null;
      observation.hash = await sha256({ ...observation, hash: null });
      this.observations.push(observation);
      return observation;
    }

    resolve(entityType, entityId, feature, options = {}) {
      const asOf = epoch(options.asOf, Date.now());
      const additions = (options.additionalObservations || []).map((row, index) => normalizeObservation(row, this.observations.length + index));
      const rows = [...this.observations, ...additions].filter((row) => (
        row.entityType === String(entityType)
        && row.entityId === String(entityId)
        && row.feature === String(feature)
        && activeAt(row, asOf)
      ));
      return resolveRows(rows, asOf);
    }

    evidenceFor(entityType, entityId, options = {}) {
      const asOf = epoch(options.asOf, Date.now());
      const features = [...new Set(this.observations
        .filter((row) => row.entityType === String(entityType) && row.entityId === String(entityId) && activeAt(row, asOf))
        .map((row) => row.feature))];
      return Object.fromEntries(features.map((feature) => [feature, this.resolve(entityType, entityId, feature, { asOf })]));
    }

    snapshot(options = {}) {
      const asOf = epoch(options.asOf, Date.now());
      return this.observations.filter((row) => activeAt(row, asOf)).map((row) => ({ ...row }));
    }

    export() {
      return {
        schemaVersion: "evidence-ledger/v1",
        version: VERSION,
        exportedAt: Date.now(),
        observations: this.observations.map((row) => ({ ...row })),
      };
    }

    async verifyChain() {
      let previousHash = null;
      for (const observation of this.observations) {
        if (observation.previousHash !== previousHash) return { valid: false, sequence: observation.sequence, reason: "previous-hash-mismatch" };
        const expected = await sha256({ ...observation, hash: null });
        if (expected !== observation.hash) return { valid: false, sequence: observation.sequence, reason: "hash-mismatch" };
        previousHash = observation.hash;
      }
      return { valid: true, count: this.observations.length, head: previousHash };
    }

    clear() {
      this.observations.length = 0;
    }
  }

  return {
    DAY_MS,
    EvidenceLedger,
    HALF_LIFE_DAYS,
    VERSION,
    activeAt,
    familyFor,
    freshnessWeight,
    normalizeObservation,
    resolveRows,
    sha256,
  };
});

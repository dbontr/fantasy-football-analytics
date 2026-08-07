"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EvidenceLedger } = require("../src/engine/evidence.js");

test("evidence ledger resolves as-of state and verifies SHA-256 chain", async () => {
  const base = Date.parse("2026-09-01T12:00:00Z");
  const ledger = new EvidenceLedger();
  await ledger.add({ entityType: "player", entityId: "1", feature: "role.target_share", value: 0.2, source: "a", observedAt: base, effectiveAt: base, confidence: 0.8 });
  await ledger.add({ entityType: "player", entityId: "1", feature: "role.target_share", value: 0.3, source: "b", observedAt: base + 1000, effectiveAt: base + 1000, confidence: 0.9 });
  const before = ledger.resolve("player", "1", "role.target_share", { asOf: base + 500 });
  const after = ledger.resolve("player", "1", "role.target_share", { asOf: base + 2000 });
  assert.equal(before.value, 0.2);
  assert.ok(after.value > 0.2 && after.value < 0.3);
  const verification = await ledger.verifyChain();
  assert.equal(verification.valid, true);
  assert.equal(verification.count, 2);
});

test("expired evidence disappears from replay", async () => {
  const base = Date.parse("2026-09-01T12:00:00Z");
  const ledger = new EvidenceLedger();
  await ledger.add({ entityId: "1", feature: "health.active_probability", value: 0.5, observedAt: base, expiresAt: base + 1000 });
  assert.equal(ledger.resolve("player", "1", "health.active_probability", { asOf: base + 500 }).available, true);
  assert.equal(ledger.resolve("player", "1", "health.active_probability", { asOf: base + 2000 }).available, false);
});

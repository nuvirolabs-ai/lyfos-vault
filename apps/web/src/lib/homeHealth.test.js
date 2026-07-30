import test from "node:test";
import assert from "node:assert/strict";
import { deriveHomeHealth, getPrimaryHomeAction, summarizeReleaseKeys } from "./homeHealth.js";

const vault = (overrides = {}) => ({
  items: [],
  releaseSettings: { mainNominee: "", nomineeEmail: "", keyHolders: ["", "", "", "", ""] },
  ...overrides
});

test("empty vault starts at zero protected areas and asks for the first record", () => {
  const current = vault();
  const health = deriveHomeHealth(current);
  assert.equal(health.completion, 0);
  assert.equal(health.protectedCount, 0);
  assert.equal(getPrimaryHomeAction(current, health).id, "capture");
});

test("missing nominee email is the primary setup action after records exist", () => {
  const current = vault({
    items: [{ id: "1", type: "bank_account", title: "Family account", emergencyEligible: true, updatedAt: new Date().toISOString() }]
  });
  const health = deriveHomeHealth(current);
  assert.equal(getPrimaryHomeAction(current, health).id, "nominee-email");
});

test("release summary shows named holders and three-share threshold", () => {
  const result = summarizeReleaseKeys([
    { id: "a", label: "Anika", status: "verified" },
    { id: "b", label: "Rohan", status: "accepted" },
    { id: "c", label: "Maya", status: "pending" },
    { id: "d", label: "Kabir", status: "verified" },
    { id: "e", label: "Ira", status: "pending" }
  ]);
  assert.equal(result.required, 3);
  assert.equal(result.received, 0);
  assert.deepEqual(result.holders.map((holder) => holder.label), ["Anika", "Rohan", "Maya", "Kabir", "Ira"]);
  assert.equal(result.ready, false);
});

test("release summary becomes ready only after three valid shares", () => {
  const result = summarizeReleaseKeys([
    { label: "Anika", status: "verified", share_released: true },
    { label: "Rohan", status: "accepted", share_released: true },
    { label: "Maya", status: "verified", share_released: true }
  ]);
  assert.equal(result.received, 3);
  assert.equal(result.ready, true);
});

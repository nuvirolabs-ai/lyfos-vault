import test from "node:test";
import assert from "node:assert/strict";

import { summarizeKeyHolders } from "./releasePlan.js";

test("accepted holders with release public keys count as verified-ready", () => {
  const summary = summarizeKeyHolders([
    { id: "1", status: "pending" },
    { id: "2", status: "accepted", release_pubkey: "pubkey-2" },
    { id: "3", status: "verified", release_pubkey: "pubkey-3" },
    { id: "4", status: "revoked", release_pubkey: "pubkey-4" }
  ]);

  assert.equal(summary.invited, 3);
  assert.equal(summary.accepted, 2);
  assert.equal(summary.verified, 2);
  assert.deepEqual(summary.activeHolders.map((h) => h.id), ["1", "2", "3"]);
  assert.deepEqual(summary.readyHolders.map((h) => h.id), ["2", "3"]);
});

test("revoked holders are not shown as active invite slots", () => {
  const summary = summarizeKeyHolders([
    { id: "old", status: "revoked" },
    { id: "new", status: "pending" }
  ]);

  assert.equal(summary.invited, 1);
  assert.deepEqual(summary.activeHolders.map((h) => h.id), ["new"]);
});

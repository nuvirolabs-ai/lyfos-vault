import test from "node:test";
import assert from "node:assert/strict";

import { buildTrustRosterSlots, summarizeHeldKeys, summarizeKeyHolders } from "./releasePlan.js";

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

test("buildTrustRosterSlots keeps real invites and fills empty invite slots", () => {
  const slots = buildTrustRosterSlots([
    { id: "1", label: "Neha", holder_email: "neha@example.com", status: "accepted" },
    { id: "2", label: "Rahul", holder_email: "rahul@example.com", status: "pending" }
  ]);

  assert.equal(slots.length, 5);
  assert.equal(slots[0].kind, "holder");
  assert.equal(slots[0].displayName, "Neha");
  assert.equal(slots[0].email, "neha@example.com");
  assert.equal(slots[0].statusLabel, "Accepted");
  assert.equal(slots[2].kind, "empty");
  assert.equal(slots[2].slotNumber, 3);
});

test("summarizeHeldKeys reports trusted relationships without exposing secret keys", () => {
  const summary = summarizeHeldKeys([
    { owner_email: "a@example.com", label: "Neha", status: "accepted", release_pubkey: "pub" },
    { owner_email: "b@example.com", label: "Neha", status: "pending", release_pubkey: null },
    { owner_email: "c@example.com", label: "Neha", status: "revoked", release_pubkey: "pub" }
  ]);

  assert.equal(summary.total, 2);
  assert.equal(summary.ready, 1);
  assert.equal(summary.relationships[0].ownerLabel, "a");
  assert.equal(summary.relationships[0].statusLabel, "Ready");
  assert.equal(summary.relationships[0].secretVisible, false);
});

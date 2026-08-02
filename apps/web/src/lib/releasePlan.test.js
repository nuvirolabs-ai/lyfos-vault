import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCircleActivationPayload,
  buildTrustRosterSlots,
  summarizeHeldKeys,
  summarizeKeyHolders
} from "./releasePlan.js";
import { makeReleaseProcessKeypair, openSealedShare, sha256HexBytes } from "./shareCrypto.js";

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

test("buildTrustRosterSlots exposes primary and backup role labels", () => {
  const slots = buildTrustRosterSlots([
    { id: "1", role: "primary", label: "Priya", holder_email: "priya@example.com", status: "accepted", release_pubkey: "pk" },
    { id: "2", role: "backup", label: "Ravi", holder_email: "ravi@example.com", status: "accepted", release_pubkey: "pk" }
  ]);

  assert.equal(slots[0].roleLabel, "Primary");
  assert.equal(slots[1].roleLabel, "Backup");
});

test("buildCircleActivationPayload binds five shares and encrypted instructions to the chosen recipients", async () => {
  const keypairs = await Promise.all(Array.from({ length: 5 }, () => makeReleaseProcessKeypair()));
  const holders = keypairs.map((keypair, index) => ({
    id: `holder-${index + 1}`,
    label: `Holder ${index + 1}`,
    status: "accepted",
    role: index === 0 ? "primary" : index === 1 ? "backup" : "trusted",
    release_pubkey: keypair.publicKey
  }));
  const payload = await buildCircleActivationPayload({
    rawVaultKey: crypto.getRandomValues(new Uint8Array(32)),
    holders,
    instructions: "Call our lawyer before moving any funds."
  });

  assert.equal(payload.algorithm, "recipient-gate-xor-sss-2of5-v1");
  assert.equal(payload.shares.length, 5);
  assert.deepEqual(payload.shares.map((share) => share.holder_id), holders.map((holder) => holder.id));
  assert.equal(payload.shares.every((share) => /^[0-9a-f]{64}$/.test(share.commitment)), true);
  assert.equal(payload.primary.holder_id, holders[0].id);
  assert.equal(payload.backup.holder_id, holders[1].id);

  const openedShare = await openSealedShare({
    ciphertext: payload.shares[0].ciphertext,
    ephemeralPub: payload.shares[0].ephemeral_pub
  }, keypairs[0].secretKey);
  assert.equal(await sha256HexBytes(openedShare), payload.shares[0].commitment);
  openedShare.fill(0);

  const opened = await openSealedShare({
    ciphertext: payload.primary.instructions_ciphertext,
    ephemeralPub: payload.primary.instructions_ephemeral_pub
  }, keypairs[0].secretKey);
  assert.equal(new TextDecoder().decode(opened), "Call our lawyer before moving any funds.");
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

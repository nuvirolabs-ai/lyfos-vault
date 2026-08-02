import test from "node:test";
import assert from "node:assert/strict";

import {
  canStartRecovery,
  canSupportRecovery,
  countValidSupport,
  createRecoveredVaultViewModel,
  mergeLatestInviteDeliveries,
  nextRecoveryState,
  reduceDeliveryState,
  validateCircleForActivation
} from "./recoveryCeremony.js";

const validRoster = [
  { id: "p", role: "primary", status: "accepted", release_pubkey: "pk-p" },
  { id: "b", role: "backup", status: "accepted", release_pubkey: "pk-b" },
  { id: "a", role: "trusted", status: "accepted", release_pubkey: "pk-a" },
  { id: "c", role: "trusted", status: "accepted", release_pubkey: "pk-c" },
  { id: "d", role: "trusted", status: "accepted", release_pubkey: "pk-d" }
];

test("activation requires five ready nominees with one primary and one backup", () => {
  assert.deepEqual(validateCircleForActivation(validRoster), { ok: true, reason: "" });
  assert.match(validateCircleForActivation(validRoster.map((row) => ({ ...row, role: "trusted" }))).reason, /primary/);
  assert.match(validateCircleForActivation(validRoster.slice(0, 4)).reason, /five/);
});

test("support excludes the selected recipient and counts unique nominees", () => {
  assert.equal(countValidSupport({
    recipientHolderId: "p",
    approvals: [{ holderId: "p" }, { holderId: "a" }]
  }), 1);
  assert.equal(countValidSupport({
    recipientHolderId: "p",
    approvals: [{ holderId: "a" }, { holderId: "a" }, { holderId: "b" }]
  }), 2);
});

test("normal recovery belongs to primary and fallback belongs to backup", () => {
  assert.equal(canStartRecovery({ role: "primary", kind: "normal" }), true);
  assert.equal(canStartRecovery({ role: "backup", kind: "normal" }), false);
  assert.equal(canStartRecovery({ role: "backup", kind: "backup" }), true);
});

test("the selected recipient cannot support their own recovery", () => {
  assert.equal(canSupportRecovery({ holderId: "p", recipientHolderId: "p", state: "collecting_support" }), false);
  assert.equal(canSupportRecovery({ holderId: "a", recipientHolderId: "p", state: "collecting_support" }), true);
  assert.equal(canSupportRecovery({ holderId: "a", recipientHolderId: "p", state: "holding" }), false);
});

test("recovery states move only through the defined sequence", () => {
  assert.equal(nextRecoveryState("draft", "submit_evidence"), "under_review");
  assert.equal(nextRecoveryState("under_review", "approve"), "collecting_support");
  assert.equal(nextRecoveryState("collecting_support", "threshold_met"), "holding");
  assert.throws(() => nextRecoveryState("draft", "threshold_met"), /Invalid recovery transition/);
});

test("delivery events distinguish provider acceptance from delivery", () => {
  assert.equal(reduceDeliveryState("queued", "email.sent"), "sent");
  assert.equal(reduceDeliveryState("sent", "email.delivered"), "delivered");
  assert.equal(reduceDeliveryState("sent", "email.delivery_delayed"), "delayed");
  assert.equal(reduceDeliveryState("delivered", "email.bounced"), "bounced");
});

test("invite rows expose only the newest observable delivery state", () => {
  const holders = [{ id: "one", status: "pending" }, { id: "two", status: "accepted" }];
  const merged = mergeLatestInviteDeliveries(holders, [
    { related_holder_id: "one", state: "sent", updated_at: "2026-08-02T10:00:00Z" },
    { related_holder_id: "one", state: "delivered", updated_at: "2026-08-02T10:01:00Z" }
  ]);
  assert.equal(merged[0].delivery_state, "delivered");
  assert.equal(merged[1].delivery_state, null);
});

test("recovered vault contains every record and no mutation capability", () => {
  const model = createRecoveredVaultViewModel({
    items: [
      { id: "normal", emergencyEligible: false, type: "important_document" },
      { id: "urgent", emergencyEligible: true, type: "emergency_instruction" }
    ]
  });
  assert.deepEqual(model.items.map((item) => item.id), ["urgent", "normal"]);
  assert.deepEqual(model.capabilities, {
    reveal: true,
    copy: true,
    downloadAttachments: true,
    mutate: false,
    sync: false,
    ownerSettings: false
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { appendAuditEvent, getAuditGroups, getRecentAuditEvents, parseAuditEvent } from "./stage1Audit.js";

test("prepends a safe audit event without storing sensitive detail", () => {
  const vault = { audit: [{ id: "old", event: "Vault created", at: "2026-05-01T00:00:00.000Z" }] };

  const next = appendAuditEvent(vault, "Sensitive value revealed: secret DemoGmail#2026");

  assert.equal(next.audit.length, 2);
  assert.equal(next.audit[0].event, "Sensitive value revealed");
  assert.ok(next.audit[0].id);
  assert.ok(next.audit[0].at);
});

test("limits local audit trail to the newest events", () => {
  const vault = {
    audit: Array.from({ length: 120 }, (_, index) => ({
      id: String(index),
      event: `Event ${index}`,
      at: "2026-05-01T00:00:00.000Z"
    }))
  };

  const next = appendAuditEvent(vault, "Record updated");

  assert.equal(next.audit.length, 100);
  assert.equal(next.audit[0].event, "Record updated");
});

test("returns recent audit events in display order", () => {
  const vault = {
    audit: [
      { id: "1", event: "Newest", at: "2026-05-03T00:00:00.000Z" },
      { id: "2", event: "Older", at: "2026-05-02T00:00:00.000Z" }
    ]
  };

  assert.deepEqual(getRecentAuditEvents(vault, 1), [vault.audit[0]]);
});

test("parses audit events into human-readable trust actions", () => {
  const parsed = parseAuditEvent({ event: "Auto-lock after inactivity", at: "2026-05-03T00:00:00.000Z" });

  assert.equal(parsed.actor, "OS-One");
  assert.equal(parsed.action, "Locked vault");
  assert.equal(parsed.reason, "Inactivity timeout");
  assert.equal(parsed.group, "Session security");
});

test("parses backup verification audit events without secret detail", () => {
  const success = parseAuditEvent({ event: "Backup verification succeeded: phrase Secret#2026", at: "2026-05-03T00:00:00.000Z" });
  const failure = parseAuditEvent({ event: "Backup verification failed: wrong phrase Secret#2026", at: "2026-05-03T00:00:00.000Z" });

  assert.equal(success.action, "Backup verification succeeded");
  assert.equal(success.reason, "Encrypted backup decrypted for verification only");
  assert.equal(success.group, "Backup and restore");
  assert.equal(failure.action, "Backup verification failed");
  assert.equal(failure.reason, "Verification failed without changing local vault");
  assert.equal(failure.group, "Backup and restore");
  assert.equal(JSON.stringify([success, failure]).includes("Secret#2026"), false);
});

test("parses recovery key replacement audit events without key material", () => {
  const parsed = parseAuditEvent({ event: "Recovery key replaced: OS1A-ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567", at: "2026-05-03T00:00:00.000Z" });

  assert.equal(parsed.action, "Recovery key replaced");
  assert.equal(parsed.reason, "Recovery envelope rotated while vault was unlocked");
  assert.equal(parsed.group, "Session security");
  assert.equal(JSON.stringify(parsed).includes("OS1A-"), false);
});

test("parses restore preview and destructive restore audit events without secrets", () => {
  const preview = parseAuditEvent({ event: "Restore preview created: phrase Secret#2026", at: "2026-05-03T00:00:00.000Z" });
  const refused = parseAuditEvent({ event: "Restore preview refused: Private bank", at: "2026-05-03T00:00:00.000Z" });
  const confirmed = parseAuditEvent({ event: "Restore confirmed: Secret#2026", at: "2026-05-03T00:00:00.000Z" });

  assert.equal(preview.action, "Restore preview created");
  assert.equal(preview.reason, "Backup decrypted for practice preview only");
  assert.equal(refused.action, "Restore preview refused");
  assert.equal(refused.reason, "Preview closed without replacing local vault");
  assert.equal(confirmed.action, "Restore confirmed");
  assert.equal(confirmed.reason, "Local vault replaced after typed confirmation");
  assert.equal(JSON.stringify([preview, refused, confirmed]).includes("Secret#2026"), false);
  assert.equal(JSON.stringify([preview, refused, confirmed]).includes("Private bank"), false);
});

test("groups audit events by trust meaning", () => {
  const vault = {
    audit: [
      { id: "1", event: "Failed unlock attempt", at: "2026-05-03T00:00:00.000Z" },
      { id: "2", event: "Attachment deleted", at: "2026-05-03T00:00:00.000Z" },
      { id: "3", event: "Restore confirmed", at: "2026-05-03T00:00:00.000Z" }
    ]
  };

  const groups = getAuditGroups(vault);

  assert.deepEqual(groups.map((group) => group.label), ["Session security", "Records and attachments", "Backup and restore"]);
});
